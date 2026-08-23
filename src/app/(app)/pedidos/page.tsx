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

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Número pt-BR ou en: "1.234,56" / "1234.56" → number. */
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
/** Palpite de coluna por palavras-chave no cabeçalho. */
function palpitar(headers: string[], campo: Campo): number {
  const chaves: Record<Campo, string[]> = {
    codigo: ["codigo", "cod", "ref", "sku", "item"],
    nome: ["nome", "descri", "produto", "material"],
    cor: ["cor", "color"],
    tamanho: ["tamanho", "tam", "size", "grade", "numer"],
    qtd: ["qtd", "quant", "qty", "pecas", "pares"],
    valorUnit: ["unit", "unitario", "preco", "vlrun", "valorun"],
    valorTotal: ["total", "vlrtot", "valortot", "subtotal"],
  };
  const ks = chaves[campo];
  for (let i = 0; i < headers.length; i++) {
    const h = normalizar(headers[i] ?? "");
    if (ks.some((k) => h.includes(k))) return i;
  }
  return -1;
}
/** Índice de coluna → letra do Excel: 0→A, 25→Z, 26→AA. */
function colLetra(i: number): string {
  let s = "", n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
function chaveFornecedor(cnpj: string, nome: string): string {
  const c = cnpj.replace(/\D/g, "");
  return c || normalizar(nome).replace(/\s+/g, "-").slice(0, 60) || "sem-fornecedor";
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
  const [headers, setHeaders] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<unknown[][]>([]);
  const [map, setMap] = useState<Record<Campo, number>>(MAP_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ps, es] = await Promise.all([listarPedidos(), listarEmpresas()]);
      setPedidos(ps);
      setEmpresas(es);
      if (es.length && !empresaId) setEmpresaId(es[0].id);
    } catch (e) {
      setErro((e as Error).message);
      setPedidos([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const nomeEmp = (id?: string) => empresas.find((e) => e.id === id)?.nomeFantasia || empresas.find((e) => e.id === id)?.razaoSocial || id || "—";

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setErro(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
      if (raw.length < 2) { setErro("Planilha sem linhas de dados."); return; }
      const hs = (raw[0] as unknown[]).map((h) => String(h ?? "").trim());
      const dt = raw.slice(1).filter((r) => (r as unknown[]).some((c) => String(c ?? "").trim() !== ""));
      setHeaders(hs);
      setLinhas(dt);
      // aplica mapa salvo do fornecedor, senão palpita
      const salvo = await obterMapaFornecedor(chaveFornecedor(cnpjForn, fornecedor)).catch(() => null);
      const novo: Record<Campo, number> = { ...MAP_VAZIO };
      for (const c of CAMPOS) {
        const salvoIdx = salvo?.map?.[c.key] != null ? hs.indexOf(salvo.map[c.key]) : -1;
        novo[c.key] = salvoIdx >= 0 ? salvoIdx : palpitar(hs, c.key);
      }
      setMap(novo);
    } catch (err) {
      setErro("Não foi possível ler a planilha: " + (err as Error).message);
    }
  }

  const previa = useMemo(() => {
    if (!linhas.length) return [];
    return linhas.map((r) => {
      const g = (c: Campo) => (map[c] >= 0 ? r[map[c]] : "");
      const qtd = parseNum(g("qtd"));
      const valorUnit = parseNum(g("valorUnit"));
      const valorTotal = map.valorTotal >= 0 ? parseNum(g("valorTotal")) : Math.round(qtd * valorUnit * 100) / 100;
      return { codigo: String(g("codigo") ?? "").trim(), nome: String(g("nome") ?? "").trim(), cor: String(g("cor") ?? "").trim(), tamanho: String(g("tamanho") ?? "").trim(), qtd, valorUnit, valorTotal };
    }).filter((it) => it.codigo || it.nome);
  }, [linhas, map]);

  const totalPrev = previa.reduce((s, it) => s + it.valorTotal, 0);
  const faltaMap = CAMPOS.filter((c) => c.req && map[c.key] < 0);

  function limparNovo() {
    setAberto(false);
    setFornecedor(""); setCnpjForn(""); setData(hojeISO());
    setHeaders([]); setLinhas([]);
    setMap(MAP_VAZIO);
  }

  async function salvar() {
    if (!empresaId) return setErro("Selecione a loja.");
    if (!fornecedor.trim()) return setErro("Informe o fornecedor.");
    if (previa.length === 0) return setErro("Nenhum item para importar.");
    if (faltaMap.length) return setErro("Mapeie: " + faltaMap.map((c) => c.label).join(", "));
    setSalvando(true);
    setErro(null);
    try {
      // salva o mapeamento do fornecedor (por nome de coluna) p/ reuso
      const mapNomes: Record<string, string> = {};
      for (const c of CAMPOS) if (map[c.key] >= 0) mapNomes[c.key] = headers[map[c.key]] ?? "";
      await salvarMapaFornecedor(chaveFornecedor(cnpjForn, fornecedor), fornecedor.trim(), mapNomes).catch(() => {});
      const r = await salvarPedido({
        empresaId, fornecedorNome: fornecedor.trim(), cnpjFornecedor: cnpjForn.replace(/\D/g, "") || undefined, data,
        itens: previa.map((it) => ({ codigo: it.codigo, nome: it.nome, cor: it.cor || undefined, tamanho: it.tamanho || undefined, qtd: it.qtd, valorUnit: it.valorUnit, valorTotal: it.valorTotal })),
      });
      limparNovo();
      await carregar();
      if (typeof window !== "undefined") window.location.href = `/pedidos/${r.id}`;
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Pedidos de compra"
        description="Importe o pedido da planilha do fornecedor, associe as NFs na entrega e concilie o que foi pedido × entregue."
        action={podeEditar && !aberto ? (
          <Button size="sm" onClick={() => setAberto(true)}><Plus className="size-4" /> Novo pedido</Button>
        ) : undefined}
      />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {/* Novo pedido */}
      {aberto ? (
        <Card className="mb-4 border-primary/30">
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Novo pedido</p>
              <Button size="sm" variant="ghost" onClick={limparNovo}><X className="size-4" /> Fechar</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Loja</span>
                <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Data do pedido</span>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Fornecedor</span>
                <Input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Nome do fornecedor" className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">CNPJ do fornecedor (opcional)</span>
                <Input value={cnpjForn} onChange={(e) => setCnpjForn(e.target.value)} placeholder="00.000.000/0000-00" className="h-9" />
              </label>
            </div>

            <div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={aoEscolherArquivo} />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> {headers.length ? "Trocar planilha" : "Escolher planilha (xlsx/csv)"}
              </Button>
              {headers.length ? <span className="ml-2 text-xs text-muted-foreground">{linhas.length} linha(s)</span> : null}
            </div>

            {/* Mapeamento de colunas */}
            {headers.length ? (
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Aponte cada coluna da planilha:</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CAMPOS.map((c) => (
                    <label key={c.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">{c.label}{c.req ? " *" : ""}</span>
                      <select
                        value={map[c.key]}
                        onChange={(e) => setMap((m) => ({ ...m, [c.key]: Number(e.target.value) }))}
                        className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value={-1}>—</option>
                        {headers.map((h, i) => <option key={i} value={i}>{colLetra(i)}{h ? ` · ${h}` : ""}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">O mapeamento é salvo por fornecedor — no próximo import já vem preenchido.</p>
              </div>
            ) : null}

            {/* Prévia */}
            {previa.length ? (
              <div className="rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
                  <span className="font-medium">Prévia · {previa.length} itens</span>
                  <span className="tnum">Total {formatBRL(totalPrev)}</span>
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                      <tr><th className="p-1.5 text-left">Código</th><th className="p-1.5 text-left">Nome</th><th className="p-1.5 text-left">Cor</th><th className="p-1.5 text-left">Tam.</th><th className="p-1.5 text-right">Qtd</th><th className="p-1.5 text-right">Unit</th><th className="p-1.5 text-right">Total</th></tr>
                    </thead>
                    <tbody>
                      {previa.slice(0, 100).map((it, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="p-1.5 font-mono">{it.codigo}</td><td className="p-1.5">{it.nome}</td><td className="p-1.5">{it.cor}</td><td className="p-1.5">{it.tamanho}</td>
                          <td className="p-1.5 text-right tnum">{it.qtd}</td><td className="p-1.5 text-right tnum">{formatBRL(it.valorUnit)}</td><td className="p-1.5 text-right tnum">{formatBRL(it.valorTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previa.length > 100 ? <p className="p-2 text-[11px] text-muted-foreground">Mostrando 100 de {previa.length}.</p> : null}
              </div>
            ) : null}

            <Button size="sm" disabled={salvando || previa.length === 0} onClick={salvar}>
              {salvando ? "Salvando…" : "Salvar pedido"}
            </Button>
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
