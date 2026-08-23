"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarEmpresas,
  listarPedidos,
  salvarPedido,
  obterMapaFornecedor,
  salvarMapaFornecedor,
  type PedidoCompra,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatarData, normalizar } from "@/lib/utils";
import { ShoppingCart, Upload, Plus, X } from "lucide-react";

type Campo = "codigo" | "nome" | "cor" | "tamanho" | "qtd" | "valorUnit" | "valorTotal";
const CAMPOS: { key: Campo; label: string; req: boolean }[] = [
  { key: "codigo", label: "Código do produto", req: true },
  { key: "nome", label: "Nome / descrição", req: true },
  { key: "cor", label: "Cor (se houver)", req: false },
  { key: "tamanho", label: "Tamanho (se houver)", req: false },
  { key: "qtd", label: "Quantidade", req: true },
  { key: "valorUnit", label: "Valor unitário", req: true },
  { key: "valorTotal", label: "Valor total (opcional)", req: false },
];
const MAP_VAZIO: Record<Campo, number> = { codigo: -1, nome: -1, cor: -1, tamanho: -1, qtd: -1, valorUnit: -1, valorTotal: -1 };
type ModoLoja = "unica" | "coluna" | "aba";
interface Aba { nome: string; headers: string[]; linhas: unknown[][] }
interface ItemPrev { codigo: string; nome: string; cor: string; tamanho: string; qtd: number; valorUnit: number; valorTotal: number }
interface Grupo { loja: string; empresaId: string; itens: ItemPrev[]; total: number }

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  s = s.replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
const KEYS: Record<Campo | "loja", string[]> = {
  codigo: ["codigo", "cod", "ref", "sku", "item"],
  nome: ["nome", "descri", "produto", "material"],
  cor: ["cor", "color"],
  tamanho: ["tamanho", "tam", "size", "grade", "numer"],
  qtd: ["qtd", "quant", "qty", "pecas", "pares"],
  valorUnit: ["unit", "unitario", "preco", "vlrun", "valorun"],
  valorTotal: ["total", "vlrtot", "valortot", "subtotal"],
  loja: ["loja", "filial", "unidade", "estabelec", "cliente"],
};
function palpitar(headers: string[], campo: Campo | "loja"): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizar(headers[i] ?? "");
    if (KEYS[campo].some((k) => h.includes(k))) return i;
  }
  return -1;
}
function colLetra(i: number): string {
  let s = "", n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
function chaveFornecedor(cnpj: string, nome: string): string {
  const c = cnpj.replace(/\D/g, "");
  return c || normalizar(nome).replace(/\s+/g, "-").slice(0, 60) || "sem-fornecedor";
}
/** Palpita a empresa a partir do valor de loja (por nome). */
function acharEmpresa(valor: string, empresas: Company[]): string {
  const v = normalizar(valor).trim();
  if (!v) return "";
  for (const e of empresas) {
    const nomes = [normalizar(e.nomeFantasia ?? ""), normalizar(e.razaoSocial ?? "")];
    if (nomes.some((n) => n && (n.includes(v) || v.includes(n)))) return e.id;
    // por palavra (ex.: "BARRA" casa "Loja do Flu Barra")
    if (nomes.some((n) => n.split(/\s+/).some((w) => w.length >= 3 && v.split(/\s+/).includes(w)))) return e.id;
  }
  return "";
}

export default function PedidosPage() {
  const { podeAcao } = useAuth();
  const podeEditar = podeAcao("financeiro.baixar");
  const [pedidos, setPedidos] = useState<PedidoCompra[] | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  // novo pedido
  const [aberto, setAberto] = useState(false);
  const [empresaId, setEmpresaId] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [cnpjForn, setCnpjForn] = useState("");
  const [data, setData] = useState(hojeISO());
  const [abasRaw, setAbasRaw] = useState<{ nome: string; rows: unknown[][] }[]>([]);
  const [linhaCab, setLinhaCab] = useState(0); // índice da linha do cabeçalho
  const [salvoMap, setSalvoMap] = useState<Record<string, string>>({});
  const [map, setMap] = useState<Record<Campo, number>>(MAP_VAZIO);
  const [modoLoja, setModoLoja] = useState<ModoLoja>("unica");
  const [colLoja, setColLoja] = useState(-1);
  const [lojaEmp, setLojaEmp] = useState<Record<string, string>>({}); // valor da loja → empresaId
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Abas derivadas: cabeçalho na linha escolhida, dados abaixo.
  const abas = useMemo<Aba[]>(() => abasRaw.map((a) => {
    const headers = ((a.rows[linhaCab] ?? []) as unknown[]).map((h) => String(h ?? "").trim());
    const linhas = a.rows.slice(linhaCab + 1).filter((r) => (r as unknown[]).some((c) => String(c ?? "").trim() !== ""));
    return { nome: a.nome, headers, linhas };
  }), [abasRaw, linhaCab]);

  // Re-mapeia colunas quando o cabeçalho muda (mapa salvo do fornecedor, senão palpite).
  useEffect(() => {
    const hs = abas[0]?.headers ?? [];
    if (!hs.length) return;
    const novo: Record<Campo, number> = { ...MAP_VAZIO };
    for (const c of CAMPOS) {
      const idx = salvoMap[c.key] ? hs.indexOf(salvoMap[c.key]) : -1;
      novo[c.key] = idx >= 0 ? idx : palpitar(hs, c.key);
    }
    setMap(novo);
    setColLoja(palpitar(hs, "loja"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abas, salvoMap]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ps, es] = await Promise.all([listarPedidos(), listarEmpresas()]);
      setPedidos(ps);
      setEmpresas(es);
      if (es.length && !empresaId) setEmpresaId(es[0].id);
    } catch (e) { setErro((e as Error).message); setPedidos([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const nomeEmp = (id?: string) => empresas.find((e) => e.id === id)?.nomeFantasia || empresas.find((e) => e.id === id)?.razaoSocial || id || "—";

  // Acha a linha do cabeçalho: a que mais bate com palavras-chave dos campos.
  function acharCab(rows: unknown[][]): number {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const hs = (rows[i] as unknown[]).map((h) => normalizar(String(h ?? "")));
      let score = 0;
      for (const c of ["codigo", "nome", "qtd", "valorUnit", "valorTotal", "cor", "tamanho"] as const) {
        if (KEYS[c].some((k) => hs.some((h) => h.includes(k)))) score++;
      }
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setErro(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raws: { nome: string; rows: unknown[][] }[] = [];
      for (const nome of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, blankrows: false, defval: "" });
        if (rows.length >= 1) raws.push({ nome, rows });
      }
      if (raws.length === 0) { setErro("Planilha vazia."); return; }
      // mapa salvo do fornecedor (colunas + linha do cabeçalho)
      const salvo = await obterMapaFornecedor(chaveFornecedor(cnpjForn, fornecedor)).catch(() => null);
      const cabSalvo = salvo?.map?._linhaCab != null ? Number(salvo.map._linhaCab) : NaN;
      const cab = Number.isInteger(cabSalvo) && cabSalvo >= 0 ? cabSalvo : acharCab(raws[0].rows);
      setSalvoMap(salvo?.map ?? {});
      setAbasRaw(raws);
      setLinhaCab(cab);
      // modo da loja (o efeito recalcula o mapa/colLoja)
      const hs = ((raws[0].rows[cab] ?? []) as unknown[]).map((h) => String(h ?? "").trim());
      const colL = palpitar(hs, "loja");
      if (colL >= 0) setModoLoja("coluna");
      else if (raws.length > 1) setModoLoja("aba");
      else setModoLoja("unica");
      setLojaEmp({});
    } catch (err) {
      setErro("Não foi possível ler a planilha: " + (err as Error).message);
    }
  }

  function parseItem(row: unknown[]): ItemPrev {
    const g = (c: Campo) => (map[c] >= 0 ? row[map[c]] : "");
    const qtd = parseNum(g("qtd"));
    const valorUnit = parseNum(g("valorUnit"));
    const valorTotal = map.valorTotal >= 0 ? parseNum(g("valorTotal")) : Math.round(qtd * valorUnit * 100) / 100;
    return { codigo: String(g("codigo") ?? "").trim(), nome: String(g("nome") ?? "").trim(), cor: String(g("cor") ?? "").trim(), tamanho: String(g("tamanho") ?? "").trim(), qtd, valorUnit, valorTotal };
  }

  // Agrupa por loja conforme o modo escolhido.
  const grupos = useMemo<Grupo[]>(() => {
    if (!abas.length) return [];
    const mk = (loja: string, itens: ItemPrev[]): Grupo => ({
      loja, empresaId: modoLoja === "unica" ? empresaId : (lojaEmp[loja] ?? acharEmpresa(loja, empresas)),
      itens, total: itens.reduce((s, it) => s + it.valorTotal, 0),
    });
    if (modoLoja === "aba") {
      return abas.map((a) => mk(a.nome, a.linhas.map(parseItem).filter((it) => (it.codigo || it.nome) && it.qtd > 0)));
    }
    if (modoLoja === "coluna" && colLoja >= 0) {
      const porLoja = new Map<string, ItemPrev[]>();
      for (const a of abas) for (const r of a.linhas) {
        const loja = String(r[colLoja] ?? "").trim() || "(sem loja)";
        const it = parseItem(r);
        if ((!it.codigo && !it.nome) || it.qtd <= 0) continue;
        (porLoja.get(loja) ?? porLoja.set(loja, []).get(loja)!).push(it);
      }
      return [...porLoja.entries()].map(([loja, itens]) => mk(loja, itens));
    }
    // única
    const itens = abas.flatMap((a) => a.linhas.map(parseItem)).filter((it) => (it.codigo || it.nome) && it.qtd > 0);
    return [mk(nomeEmp(empresaId), itens)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abas, map, modoLoja, colLoja, lojaEmp, empresaId, empresas]);

  const faltaMap = CAMPOS.filter((c) => c.req && map[c.key] < 0);
  const semEmpresa = grupos.filter((g) => !g.empresaId);
  const totalGeral = grupos.reduce((s, g) => s + g.total, 0);

  function limparNovo() {
    setAberto(false); setFornecedor(""); setCnpjForn(""); setData(hojeISO());
    setAbasRaw([]); setLinhaCab(0); setSalvoMap({}); setMap({ ...MAP_VAZIO }); setModoLoja("unica"); setColLoja(-1); setLojaEmp({});
  }

  async function salvar() {
    if (!fornecedor.trim()) return setErro("Informe o fornecedor.");
    if (grupos.length === 0 || grupos.every((g) => g.itens.length === 0)) return setErro("Nenhum item para importar.");
    if (faltaMap.length) return setErro("Mapeie: " + faltaMap.map((c) => c.label).join(", "));
    if (semEmpresa.length) return setErro("Vincule a empresa das lojas: " + semEmpresa.map((g) => g.loja).join(", "));
    setSalvando(true);
    setErro(null);
    try {
      const mapNomes: Record<string, string> = { _linhaCab: String(linhaCab) };
      for (const c of CAMPOS) if (map[c.key] >= 0) mapNomes[c.key] = abas[0].headers[map[c.key]] ?? "";
      await salvarMapaFornecedor(chaveFornecedor(cnpjForn, fornecedor), fornecedor.trim(), mapNomes).catch(() => {});
      let ultimoId = "";
      for (const g of grupos) {
        if (g.itens.length === 0) continue;
        const r = await salvarPedido({
          empresaId: g.empresaId, fornecedorNome: fornecedor.trim(), cnpjFornecedor: cnpjForn.replace(/\D/g, "") || undefined, data,
          itens: g.itens.map((it) => ({ codigo: it.codigo, nome: it.nome, cor: it.cor || undefined, tamanho: it.tamanho || undefined, qtd: it.qtd, valorUnit: it.valorUnit, valorTotal: it.valorTotal })),
        });
        ultimoId = r.id;
      }
      limparNovo();
      await carregar();
      if (grupos.length === 1 && ultimoId && typeof window !== "undefined") window.location.href = `/pedidos/${ultimoId}`;
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  return (
    <div>
      <PageHeader
        title="Pedidos de compra"
        description="Importe o pedido da planilha do fornecedor (uma ou várias lojas), associe as NFs na entrega e concilie pedido × entregue."
        action={podeEditar && !aberto ? (<Button size="sm" onClick={() => setAberto(true)}><Plus className="size-4" /> Novo pedido</Button>) : undefined}
      />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {aberto ? (
        <Card className="mb-4 border-primary/30">
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Novo pedido</p>
              <Button size="sm" variant="ghost" onClick={limparNovo}><X className="size-4" /> Fechar</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Fornecedor</span>
                <Input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Nome do fornecedor" className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">CNPJ do fornecedor (opcional)</span>
                <Input value={cnpjForn} onChange={(e) => setCnpjForn(e.target.value)} placeholder="00.000.000/0000-00" className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Data do pedido</span>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-9" />
              </label>
            </div>

            <div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={aoEscolherArquivo} />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> {abas.length ? "Trocar planilha" : "Escolher planilha (xlsx/csv)"}
              </Button>
              {abas.length ? <span className="ml-2 text-xs text-muted-foreground">{abas.length} aba(s) · {abas.reduce((s, a) => s + a.linhas.length, 0)} linha(s)</span> : null}
            </div>

            {abasRaw.length ? (
              <label className="block space-y-1">
                <span className="text-[11px] text-muted-foreground">Linha do cabeçalho</span>
                <select value={linhaCab} onChange={(e) => setLinhaCab(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {(abasRaw[0].rows.slice(0, 15)).map((r, i) => (
                    <option key={i} value={i}>Linha {i + 1}: {(r as unknown[]).slice(0, 5).map((c) => String(c ?? "")).filter(Boolean).join(" | ").slice(0, 60) || "(vazia)"}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {abas.length ? (
              <>
                {/* Identificação da loja */}
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Como identificar a loja de cada pedido?</p>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {([["unica", "Uma loja só"], ["coluna", "Por coluna"], ["aba", "Por aba"]] as const).map(([k, lb]) => (
                      <button key={k} onClick={() => setModoLoja(k)} className={`rounded-full px-3 py-1 font-medium ${modoLoja === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{lb}</button>
                    ))}
                  </div>
                  {modoLoja === "unica" ? (
                    <label className="mt-2 block space-y-1">
                      <span className="text-[11px] text-muted-foreground">Loja</span>
                      <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                        {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
                      </select>
                    </label>
                  ) : modoLoja === "coluna" ? (
                    <label className="mt-2 block space-y-1">
                      <span className="text-[11px] text-muted-foreground">Coluna da loja</span>
                      <select value={colLoja} onChange={(e) => setColLoja(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                        <option value={-1}>—</option>
                        {abas[0].headers.map((h, i) => <option key={i} value={i}>{colLetra(i)}{h ? ` · ${h}` : ""}</option>)}
                      </select>
                    </label>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">Cada aba do arquivo vira um pedido. Abas: {abas.map((a) => a.nome).join(", ")}</p>
                  )}
                </div>

                {/* Mapeamento das colunas do produto */}
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Aponte cada coluna da planilha:</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CAMPOS.map((c) => (
                      <label key={c.key} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{c.label}{c.req ? " *" : ""}</span>
                        <select value={map[c.key]} onChange={(e) => setMap((m) => ({ ...m, [c.key]: Number(e.target.value) }))} className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm">
                          <option value={-1}>—</option>
                          {abas[0].headers.map((h, i) => <option key={i} value={i}>{colLetra(i)}{h ? ` · ${h}` : ""}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Mapeamento salvo por fornecedor — no próximo import já vem preenchido.</p>
                </div>

                {/* Grupos por loja + vínculo com empresa */}
                {grupos.length ? (
                  <div className="rounded-md border border-border">
                    <div className="border-b border-border px-3 py-2 text-xs font-medium">{grupos.length} pedido(s) · {formatBRL(totalGeral)}</div>
                    <div className="divide-y divide-border">
                      {grupos.map((g, i) => (
                        <div key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <span className="font-medium">{g.loja}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{g.itens.length} itens · {formatBRL(g.total)}</span>
                          </div>
                          {modoLoja !== "unica" ? (
                            <select
                              value={g.empresaId}
                              onChange={(e) => setLojaEmp((m) => ({ ...m, [g.loja]: e.target.value }))}
                              className={`h-8 w-48 rounded-md border px-2 text-xs ${g.empresaId ? "border-input" : "border-destructive"} bg-background`}
                            >
                              <option value="">— vincular empresa —</option>
                              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
                            </select>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <Button size="sm" disabled={salvando || grupos.length === 0} onClick={salvar}>
                  {salvando ? "Salvando…" : grupos.length > 1 ? `Salvar ${grupos.length} pedidos` : "Salvar pedido"}
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Lista */}
      {pedidos === null ? (
        <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : pedidos.length === 0 ? (
        <ModulePlaceholder icon={ShoppingCart} title="Nenhum pedido" etapa="Pedidos de compra">
          Crie um pedido importando a planilha do fornecedor. Depois associe as NFs da entrega e concilie.
        </ModulePlaceholder>
      ) : (
        <div className="space-y-2">
          {pedidos.map((p) => (
            <Card key={p.id} className="transition-colors hover:bg-accent/50">
              <Link href={`/pedidos/${p.id}`} className="block">
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.fornecedorNome}</p>
                      <p className="text-xs text-muted-foreground">{formatarData(p.data)} · {nomeEmp(p.empresaId)} · {p.itens?.length ?? 0} itens</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <p className="font-bold tnum">{formatBRL(p.totalValor)}</p>
                      <Badge variant={p.nfs?.length ? "success" : "neutral"}>{p.nfs?.length ? `${p.nfs.length} NF` : "sem NF"}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
