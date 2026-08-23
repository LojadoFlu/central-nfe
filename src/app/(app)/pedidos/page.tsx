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
import { FiltroPeriodo, noPeriodo, PERIODO_VAZIO, type Periodo } from "@/components/ui/filtro-periodo";
import { formatBRL, formatarData, normalizar, diasAte } from "@/lib/utils";
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
type Formato = "vertical" | "horizontal"; // vertical = 1 linha por tamanho; horizontal = colunas por tamanho (grade)
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
  // "produto"/"prod"/"ref"/"modelo" costumam rotular a coluna do CÓDIGO (ex.: Foxton "PRODUTO").
  codigo: ["codigo", "cod", "ref", "sku", "item", "produto", "prod", "modelo", "estilo", "style", "artigo"],
  nome: ["descri", "nome", "produto", "material", "mercadoria"],
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
/** Igual a palpitar, mas ignora colunas já atribuídas a outro campo (atribuição gulosa/exclusiva). */
function palpitarLivre(headers: string[], campo: Campo | "loja", usados: Set<number>): number {
  for (let i = 0; i < headers.length; i++) {
    if (usados.has(i)) continue;
    const h = normalizar(headers[i] ?? "");
    if (KEYS[campo].some((k) => h.includes(k))) return i;
  }
  return -1;
}
/** Resolve a coluna salva no mapa do fornecedor. Formato novo = índice ("2"); formato antigo
 * = nome do cabeçalho — só aceito se for NÃO-VAZIO e ÚNICO (cabeçalhos vazios/duplicados,
 * comuns em planilhas de grade, davam match na coluna errada). */
function resolverCol(raw: string | undefined, hs: string[]): number {
  if (raw == null) return -1;
  if (/^\d+$/.test(raw)) { const n = Number(raw); return n >= 0 && n < hs.length ? n : -1; }
  const alvo = raw.trim();
  if (!alvo) return -1;
  const i = hs.indexOf(alvo);
  return i >= 0 && i === hs.lastIndexOf(alvo) ? i : -1; // ignora se ambíguo (duplicado)
}
function colLetra(i: number): string {
  let s = "", n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
/** Uma célula parece um rótulo de tamanho? (P/M/G/GG/XG… ou número de grade 2–70) */
function ehTam(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (!s || s.length > 4) return false;
  if (/^(pp|p|m|g|gg|xg|xxg|xxxg|eg|egg|u|un|uni)$/i.test(s)) return true;
  if (/^\d{1,3}$/.test(s)) { const n = Number(s); return n >= 2 && n <= 70; }
  return false;
}
/** Acha a linha que carrega os rótulos de tamanho (grade), abaixo do cabeçalho e acima dos dados. */
function acharLinhaTam(rows: unknown[][], cab: number): { linha: number; count: number } {
  let best = cab, bestC = 0;
  for (let i = cab + 1; i < Math.min(rows.length, cab + 9); i++) {
    const r = (rows[i] ?? []) as unknown[];
    let c = 0, longo = false;
    for (const cell of r) {
      if (String(cell ?? "").trim().length > 8) longo = true; // descrição de produto = linha de dados, não de grade
      if (ehTam(cell)) c++;
    }
    if (!longo && c > bestC) { bestC = c; best = i; }
  }
  return { linha: best, count: bestC };
}
function chaveFornecedor(cnpj: string, nome: string): string {
  const c = cnpj.replace(/\D/g, "");
  return c || normalizar(nome).replace(/\s+/g, "-").slice(0, 60) || "sem-fornecedor";
}
/** Pedido atrasado: sem NF associada (não entregue) e +7 dias além da entrega prevista. */
function estaAtrasado(p: PedidoCompra): boolean {
  if (p.nfs?.length) return false;
  const d = diasAte(p.dataEntrega);
  return d !== null && d < -7;
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
  const [aviso, setAviso] = useState<string | null>(null);
  // filtros da lista
  const [fForn, setFForn] = useState("");
  const [fLoja, setFLoja] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_VAZIO);
  const [soAtrasados, setSoAtrasados] = useState(false);

  // novo pedido
  const [aberto, setAberto] = useState(false);
  const [empresaId, setEmpresaId] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [cnpjForn, setCnpjForn] = useState("");
  const [data, setData] = useState(hojeISO());
  const [dataEntrega, setDataEntrega] = useState("");
  const [abasRaw, setAbasRaw] = useState<{ nome: string; rows: unknown[][] }[]>([]);
  const [linhaCab, setLinhaCab] = useState(0); // índice da linha do cabeçalho
  const [formato, setFormato] = useState<Formato>("vertical");
  const [linhaTam, setLinhaTam] = useState(0);  // linha com os rótulos de tamanho (grade)
  const [tamOff, setTamOff] = useState<number[]>([]); // colunas de tamanho desmarcadas pelo usuário
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

  // Colunas de tamanho (grade): rótulo na "linha dos tamanhos", fora das colunas já
  // mapeadas para código/nome/cor/valor. Usadas só no formato horizontal.
  const tamCandidatos = useMemo<{ idx: number; label: string }[]>(() => {
    if (formato !== "horizontal" || !abasRaw.length) return [];
    const linha = (abasRaw[0].rows[linhaTam] ?? []) as unknown[];
    const mapeadas = new Set([map.codigo, map.nome, map.cor, map.valorUnit].filter((i) => i >= 0));
    const total = Math.max(linha.length, abas[0]?.headers.length ?? 0);
    const out: { idx: number; label: string }[] = [];
    for (let i = 0; i < total; i++) {
      const label = String(linha[i] ?? "").trim();
      if (!label || mapeadas.has(i)) continue;
      out.push({ idx: i, label });
    }
    return out;
  }, [formato, abasRaw, linhaTam, map, abas]);
  const tamAtivos = useMemo(() => tamCandidatos.filter((t) => !tamOff.includes(t.idx)), [tamCandidatos, tamOff]);

  // Re-mapeia colunas quando o cabeçalho muda (mapa salvo do fornecedor, senão palpite).
  // Atribuição GULOSA e exclusiva: campos específicos primeiro, "nome" por último (fica
  // com a coluna de descrição que sobrar), evitando que "PRODUTO" (código) roube o nome.
  useEffect(() => {
    const hs = abas[0]?.headers ?? [];
    if (!hs.length) return;
    const novo: Record<Campo, number> = { ...MAP_VAZIO };
    const usados = new Set<number>();
    const ordem: Campo[] = ["codigo", "valorTotal", "valorUnit", "qtd", "tamanho", "cor", "nome"];
    for (const c of ordem) {
      let idx = resolverCol(salvoMap[c], hs);
      if (idx < 0 || usados.has(idx)) idx = palpitarLivre(hs, c, usados);
      novo[c] = idx;
      if (idx >= 0) usados.add(idx);
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

  const fornecedores = useMemo(() => [...new Set((pedidos ?? []).map((p) => p.fornecedorNome).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [pedidos]);
  const lojasPed = useMemo(() => [...new Set((pedidos ?? []).map((p) => p.empresaId).filter(Boolean))], [pedidos]);
  const qtdAtrasados = useMemo(() => (pedidos ?? []).filter(estaAtrasado).length, [pedidos]);
  const visiveis = useMemo(() => (pedidos ?? []).filter(
    (p) => (!fForn || p.fornecedorNome === fForn) && (!fLoja || p.empresaId === fLoja) && noPeriodo(p.data, periodo) && (!soAtrasados || estaAtrasado(p)),
  ), [pedidos, fForn, fLoja, periodo, soAtrasados]);

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
      // formato (vertical/horizontal) + linha dos tamanhos: do mapa salvo, senão detecta.
      const det = acharLinhaTam(raws[0].rows, cab);
      const fmtSalvo = salvo?.map?._formato;
      const fmt: Formato = fmtSalvo === "horizontal" ? "horizontal" : fmtSalvo === "vertical" ? "vertical" : (det.count >= 4 ? "horizontal" : "vertical");
      const tamSalvo = salvo?.map?._linhaTam != null ? Number(salvo.map._linhaTam) : NaN;
      setFormato(fmt);
      setLinhaTam(Number.isInteger(tamSalvo) && tamSalvo >= 0 ? tamSalvo : det.linha);
      setTamOff([]);
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

  // Formato vertical: cada linha da planilha é 1 item.
  function parseVert(row: unknown[]): ItemPrev {
    const g = (c: Campo) => (map[c] >= 0 ? row[map[c]] : "");
    const qtd = parseNum(g("qtd"));
    const vuRaw = parseNum(g("valorUnit"));
    const valorTotal = map.valorTotal >= 0 ? parseNum(g("valorTotal")) : Math.round(qtd * vuRaw * 100) / 100;
    // Unitário = total ÷ qtd quando há total (mais confiável); senão a coluna de unitário.
    const valorUnit = (map.valorTotal >= 0 && qtd > 0) ? Math.round((valorTotal / qtd) * 100) / 100 : vuRaw;
    return { codigo: String(g("codigo") ?? "").trim(), nome: String(g("nome") ?? "").trim(), cor: String(g("cor") ?? "").trim(), tamanho: String(g("tamanho") ?? "").trim(), qtd, valorUnit, valorTotal };
  }
  // Uma linha vira N itens: vertical → 1; horizontal → 1 por coluna de tamanho com qtd > 0.
  function expandir(row: unknown[]): ItemPrev[] {
    if (formato !== "horizontal") return [parseVert(row)];
    const codigo = String((map.codigo >= 0 ? row[map.codigo] : "") ?? "").trim();
    const nome = String((map.nome >= 0 ? row[map.nome] : "") ?? "").trim();
    const cor = String((map.cor >= 0 ? row[map.cor] : "") ?? "").trim();
    const unit = parseNum(map.valorUnit >= 0 ? row[map.valorUnit] : ""); // preço vale pra linha toda
    const out: ItemPrev[] = [];
    for (const t of tamAtivos) {
      const qtd = parseNum(row[t.idx]);
      if (qtd <= 0) continue;
      out.push({ codigo, nome, cor, tamanho: t.label, qtd, valorUnit: unit, valorTotal: Math.round(qtd * unit * 100) / 100 });
    }
    return out;
  }

  // Agrupa por loja conforme o modo escolhido.
  const grupos = useMemo<Grupo[]>(() => {
    if (!abas.length) return [];
    const ok = (it: ItemPrev) => (it.codigo || it.nome) && it.qtd > 0;
    const mk = (loja: string, itens: ItemPrev[]): Grupo => ({
      loja, empresaId: modoLoja === "unica" ? empresaId : (lojaEmp[loja] ?? acharEmpresa(loja, empresas)),
      itens, total: itens.reduce((s, it) => s + it.valorTotal, 0),
    });
    if (modoLoja === "aba") {
      return abas.map((a) => mk(a.nome, a.linhas.flatMap(expandir).filter(ok)));
    }
    if (modoLoja === "coluna" && colLoja >= 0) {
      const porLoja = new Map<string, ItemPrev[]>();
      for (const a of abas) for (const r of a.linhas) {
        const loja = String(r[colLoja] ?? "").trim() || "(sem loja)";
        for (const it of expandir(r)) {
          if (!ok(it)) continue;
          (porLoja.get(loja) ?? porLoja.set(loja, []).get(loja)!).push(it);
        }
      }
      return [...porLoja.entries()].map(([loja, itens]) => mk(loja, itens));
    }
    // única
    const itens = abas.flatMap((a) => a.linhas.flatMap(expandir)).filter(ok);
    return [mk(nomeEmp(empresaId), itens)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abas, map, modoLoja, colLoja, lojaEmp, empresaId, empresas, formato, tamAtivos]);

  // No horizontal, qtd/tamanho vêm da grade — obrigatórios são só código, nome e valor unitário.
  const reqKeys: Campo[] = formato === "horizontal" ? ["codigo", "nome", "valorUnit"] : CAMPOS.filter((c) => c.req).map((c) => c.key);
  const faltaMap = CAMPOS.filter((c) => reqKeys.includes(c.key) && map[c.key] < 0);
  // Pedidos de verdade (com itens) sem empresa vinculada — não serão salvos.
  const semEmpresa = grupos.filter((g) => g.itens.length > 0 && !g.empresaId);
  const totalGeral = grupos.reduce((s, g) => s + g.total, 0);

  // Ignora o mapa salvo do fornecedor e re-detecta tudo do zero a partir do arquivo.
  function redefinirMapeamento() {
    if (!abasRaw.length) return;
    setSalvoMap({});
    const cab = acharCab(abasRaw[0].rows);
    const det = acharLinhaTam(abasRaw[0].rows, cab);
    setLinhaCab(cab);
    setFormato(det.count >= 4 ? "horizontal" : "vertical");
    setLinhaTam(det.linha);
    setTamOff([]);
  }

  function limparNovo() {
    setAberto(false); setFornecedor(""); setCnpjForn(""); setData(hojeISO()); setDataEntrega("");
    setAbasRaw([]); setLinhaCab(0); setSalvoMap({}); setMap({ ...MAP_VAZIO }); setModoLoja("unica"); setColLoja(-1); setLojaEmp({});
    setFormato("vertical"); setLinhaTam(0); setTamOff([]);
  }

  async function salvar() {
    setAviso(null);
    if (!fornecedor.trim()) return setErro("Informe o fornecedor.");
    if (grupos.length === 0 || grupos.every((g) => g.itens.length === 0)) return setErro("Nenhum item para importar.");
    if (faltaMap.length) return setErro("Mapeie: " + faltaMap.map((c) => c.label).join(", "));
    if (formato === "horizontal" && tamAtivos.length === 0) return setErro("Marque ao menos uma coluna de tamanho (grade).");
    // Só salva pedidos com loja vinculada; os sem empresa são pulados (não salvos).
    const validos = grupos.filter((g) => g.itens.length > 0 && g.empresaId);
    const pulados = grupos.filter((g) => g.itens.length > 0 && !g.empresaId);
    if (validos.length === 0) return setErro("Vincule a empresa das lojas antes de salvar: " + pulados.map((g) => g.loja).join(", "));
    setSalvando(true);
    setErro(null);
    try {
      const mapNomes: Record<string, string> = { _linhaCab: String(linhaCab), _formato: formato, _linhaTam: String(linhaTam) };
      for (const c of CAMPOS) if (map[c.key] >= 0) mapNomes[c.key] = String(map[c.key]); // índice da coluna (robusto p/ cabeçalhos vazios/duplicados)
      await salvarMapaFornecedor(chaveFornecedor(cnpjForn, fornecedor), fornecedor.trim(), mapNomes).catch(() => {});
      let ultimoId = "";
      for (const g of validos) {
        const r = await salvarPedido({
          empresaId: g.empresaId, fornecedorNome: fornecedor.trim(), cnpjFornecedor: cnpjForn.replace(/\D/g, "") || undefined, data, dataEntrega: dataEntrega || undefined,
          itens: g.itens.map((it) => ({ codigo: it.codigo, nome: it.nome, cor: it.cor || undefined, tamanho: it.tamanho || undefined, qtd: it.qtd, valorUnit: it.valorUnit, valorTotal: it.valorTotal })),
        });
        ultimoId = r.id;
      }
      limparNovo();
      await carregar();
      if (pulados.length) {
        // Avisa quais lojas não foram salvas (sem empresa) — não redireciona pra o aviso aparecer.
        setAviso(`${validos.length} pedido(s) salvos. Não salvos por falta de loja vinculada: ${pulados.map((g) => g.loja).join(", ")}.`);
      } else if (validos.length === 1 && ultimoId && typeof window !== "undefined") {
        window.location.href = `/pedidos/${ultimoId}`;
      }
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
      {aviso ? <p className="mb-4 rounded-md bg-warning/10 p-3 text-sm text-warning">{aviso}</p> : null}

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
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Data prevista de entrega</span>
                <Input type="date" value={dataEntrega} onChange={(e) => setDataEntrega(e.target.value)} className="h-9" />
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
              <div className="space-y-2">
                {/* Formato da planilha */}
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground">Formato da planilha</p>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {([["vertical", "Vertical (uma linha por tamanho)"], ["horizontal", "Horizontal / grade (colunas por tamanho)"]] as const).map(([k, lb]) => (
                      <button key={k} onClick={() => setFormato(k)} className={`rounded-full px-3 py-1 font-medium ${formato === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{lb}</button>
                    ))}
                  </div>
                </div>
                <label className="block space-y-1">
                  <span className="text-[11px] text-muted-foreground">Linha do cabeçalho</span>
                  <select value={linhaCab} onChange={(e) => setLinhaCab(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {(abasRaw[0].rows.slice(0, 15)).map((r, i) => (
                      <option key={i} value={i}>Linha {i + 1}: {(r as unknown[]).slice(0, 8).map((c) => String(c ?? "")).filter(Boolean).join(" | ").slice(0, 60) || "(vazia)"}</option>
                    ))}
                  </select>
                </label>
                {formato === "horizontal" ? (
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">Linha dos tamanhos (grade)</span>
                    <select value={linhaTam} onChange={(e) => { setLinhaTam(Number(e.target.value)); setTamOff([]); }} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      {(abasRaw[0].rows.slice(0, 15)).map((r, i) => (
                        <option key={i} value={i}>Linha {i + 1}: {(r as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean).slice(0, 10).join(" | ").slice(0, 60) || "(vazia)"}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
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
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Aponte cada coluna da planilha:</p>
                    <button onClick={redefinirMapeamento} className="text-[11px] font-medium text-primary hover:underline">Redefinir (ignorar memória)</button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CAMPOS.filter((c) => formato !== "horizontal" || ["codigo", "nome", "cor", "valorUnit"].includes(c.key)).map((c) => (
                      <label key={c.key} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{c.key === "valorUnit" && formato === "horizontal" ? "Valor unitário (vale a linha toda)" : c.label}{reqKeys.includes(c.key) ? " *" : ""}</span>
                        <select value={map[c.key]} onChange={(e) => setMap((m) => ({ ...m, [c.key]: Number(e.target.value) }))} className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm">
                          <option value={-1}>—</option>
                          {abas[0].headers.map((h, i) => <option key={i} value={i}>{colLetra(i)}{h ? ` · ${h}` : ""}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Mapeamento salvo por fornecedor — no próximo import já vem preenchido.</p>
                </div>

                {/* Colunas de tamanho (grade) — só no formato horizontal */}
                {formato === "horizontal" ? (
                  <div className="rounded-md border border-border p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Colunas de tamanho (a quantidade está em cada coluna):</p>
                    {tamCandidatos.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {tamCandidatos.map((t) => {
                          const on = !tamOff.includes(t.idx);
                          return (
                            <button key={t.idx} onClick={() => setTamOff((o) => o.includes(t.idx) ? o.filter((x) => x !== t.idx) : [...o, t.idx])}
                              className={`rounded-md border px-2 py-1 text-xs font-medium ${on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-muted text-muted-foreground line-through"}`}>
                              {colLetra(t.idx)} · {t.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-warning">Nenhuma coluna de tamanho encontrada nessa linha. Ajuste a &ldquo;Linha dos tamanhos&rdquo; acima.</p>
                    )}
                    <p className="mt-2 text-[11px] text-muted-foreground">Clique para incluir/excluir. O nome do tamanho vem do cabeçalho da coluna. {tamAtivos.length} tamanho(s) ativos.</p>
                  </div>
                ) : null}

                {/* Amostra do mapeamento — confira se as colunas caíram certo */}
                {abas[0]?.linhas.length ? (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">Amostra (confira se as colunas estão certas)</div>
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground"><tr><th className="p-1.5 text-left">Código</th><th className="p-1.5 text-left">Nome</th><th className="p-1.5 text-left">Cor</th><th className="p-1.5 text-left">Tam.</th><th className="p-1.5 text-right">Qtd</th><th className="p-1.5 text-right">Unit</th><th className="p-1.5 text-right">Total</th></tr></thead>
                      <tbody>
                        {abas[0].linhas.flatMap(expandir).slice(0, 6).map((it, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="p-1.5 font-mono">{it.codigo}</td><td className="p-1.5">{it.nome}</td><td className="p-1.5">{it.cor}</td><td className="p-1.5">{it.tamanho}</td>
                            <td className="p-1.5 text-right tnum">{it.qtd}</td><td className="p-1.5 text-right tnum">{formatBRL(it.valorUnit)}</td><td className="p-1.5 text-right tnum">{formatBRL(it.valorTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

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

      {/* Filtros da lista */}
      {pedidos && pedidos.length > 0 ? (
        <>
          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Fornecedor</span>
              <select value={fForn} onChange={(e) => setFForn(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Todos os fornecedores</option>
                {fornecedores.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Loja destino</span>
              <select value={fLoja} onChange={(e) => setFLoja(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Todas as lojas</option>
                {lojasPed.map((id) => <option key={id} value={id}>{nomeEmp(id)}</option>)}
              </select>
            </label>
          </div>
          <FiltroPeriodo value={periodo} onChange={setPeriodo} className="mb-3" />
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-[11px] text-muted-foreground">Período pela data do pedido.</p>
            <button
              onClick={() => setSoAtrasados((v) => !v)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${soAtrasados ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {soAtrasados ? "✓ " : ""}Só atrasados{qtdAtrasados ? ` (${qtdAtrasados})` : ""}
            </button>
          </div>
          {soAtrasados ? <p className="mb-2 px-1 text-[11px] text-muted-foreground">Atrasado = sem NF associada e +7 dias além da entrega prevista.</p> : null}
        </>
      ) : null}

      {/* Lista */}
      {pedidos === null ? (
        <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : pedidos.length === 0 ? (
        <ModulePlaceholder icon={ShoppingCart} title="Nenhum pedido" etapa="Pedidos de compra">
          Crie um pedido importando a planilha do fornecedor. Depois associe as NFs da entrega e concilie.
        </ModulePlaceholder>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum pedido no filtro atual.</p>
      ) : (
        <div className="space-y-2">
          {visiveis.map((p) => (
            <Card key={p.id} className="transition-colors hover:bg-accent/50">
              <Link href={`/pedidos/${p.id}`} className="block">
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.fornecedorNome}</p>
                      <p className="text-xs text-muted-foreground">{formatarData(p.data)} · {nomeEmp(p.empresaId)} · {p.itens?.length ?? 0} itens{p.dataEntrega ? ` · entrega prev. ${formatarData(p.dataEntrega)}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <p className="font-bold tnum">{formatBRL(p.totalValor)}</p>
                      {estaAtrasado(p) ? <Badge variant="destructive">Atrasado</Badge> : <Badge variant={p.nfs?.length ? "success" : "neutral"}>{p.nfs?.length ? `${p.nfs.length} NF` : "sem NF"}</Badge>}
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
