"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hero } from "@/components/ui/hero";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { listarParcelas, baixarParcela, baixarParcelasLote, listarEmpresas, listarAcordos, baixarParcelaAcordo, listarDespesasFixas, pagarDespesaFixa, migrarParcelaAcordo, type Parcela, type Acordo, type ContaPagamento, type DespesaFixa } from "@/lib/nfe/repo";
import { ContasPagamento, contasValidas } from "@/components/ui/contas-pagamento";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { FiltroPeriodo, noPeriodo, PERIODO_VAZIO, type Periodo } from "@/components/ui/filtro-periodo";
import { formatBRL, formatarData, diasAte } from "@/lib/utils";
import { Wallet, Check, RotateCcw, CheckSquare, X } from "lucide-react";

type Situacao = "paga" | "vencida" | "a_vencer" | "sem_venc" | "migrado";

const PERIODO_REC: Record<string, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
/** Uma despesa fixa incide num mês (YYYY-MM)? Replica a regra do backend. */
function incideNoMes(d: DespesaFixa, ym: string): boolean {
  const p = PERIODO_REC[d.recorrencia ?? "mensal"] ?? 1;
  if (p === 1) return true;
  const mesBase = Number(d.mesBase ?? 1);
  const m = Number(ym.slice(5, 7));
  return ((((m - mesBase) % p) + p) % p) === 0;
}
/** Janela de meses (YYYY-MM) de `back` meses atrás até `fwd` meses à frente. */
function janelaMeses(back: number, fwd: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = -back; i <= fwd; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Conta a pagar: parcela de NF-e, parcela de acordo ou mês de despesa fixa. */
interface Conta {
  id: string;               // NF-e = id; acordo = "acordo:{id}:{i}"; despesa = "despesa:{id}:{ym}"
  origem: "nfe" | "acordo" | "despesa";
  acordoId?: string | null;
  indice?: number;
  despesaId?: string;
  ym?: string;
  companyId?: string | null;
  cnpjEmit?: string | null;
  xNomeEmit?: string | null;
  nDup?: string;
  vencimento?: string | null;
  valor?: number | null;
  statusPagamento?: string;
  dataPagamento?: string | null;
  valorPago?: number | null;
  obsPagamento?: string | null;
  contasPagamento?: ContaPagamento[] | null;
  migradoAcordo?: boolean;
  chNFe?: string | null;
  descricao?: string | null;
}

/** Uma parcela paga sai da régua de vencimento — vira "paga". Migrada p/ acordo sai do fluxo. */
function situacao(p: { statusPagamento?: string; vencimento?: string | null; migradoAcordo?: boolean }): { s: Situacao; dias: number | null } {
  if (p.migradoAcordo) return { s: "migrado", dias: null };
  if (p.statusPagamento === "pago") return { s: "paga", dias: null };
  const dias = diasAte(p.vencimento);
  if (dias === null) return { s: "sem_venc", dias: null };
  return { s: dias < 0 ? "vencida" : "a_vencer", dias };
}

/** Data de hoje em YYYY-MM-DD (sem depender de UTC). */
function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
/** "2026-08" → "Ago/2026". */
function mesLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${y}`;
}

export default function FinanceiroPage() {
  const { podeAcao } = useAuth();
  const podeBaixar = podeAcao("financeiro.baixar");
  const [parcelas, setParcelas] = useState<Parcela[] | null>(null);
  const [acordos, setAcordos] = useState<Acordo[]>([]);
  const [despesas, setDespesas] = useState<DespesaFixa[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "a_vencer" | "vencida" | "paga">("todas");
  const [forn, setForn] = useState(""); // cnpjEmit selecionado ("" = todos)
  const [salvando, setSalvando] = useState<string | null>(null); // id ou "lote"

  // Baixa individual (form expandido)
  const [pendente, setPendente] = useState<string | null>(null);
  const [dataPg, setDataPg] = useState(hojeISO());
  const [valorPg, setValorPg] = useState("");
  const [obsPg, setObsPg] = useState("");
  const [contasPg, setContasPg] = useState<ContaPagamento[]>([]);
  const [migrarChk, setMigrarChk] = useState(false);
  const [migrarAcordoId, setMigrarAcordoId] = useState("");

  // Baixa em lote (modo seleção)
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loteForm, setLoteForm] = useState(false);
  const [dataLote, setDataLote] = useState(hojeISO());
  const [obsLote, setObsLote] = useState("");
  const [contaLote, setContaLote] = useState("");

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ps, emps, acs, dfs] = await Promise.all([listarParcelas(2000), listarEmpresas(), listarAcordos(), listarDespesasFixas()]);
      setParcelas(ps);
      setEmpresas(emps);
      setAcordos(acs);
      setDespesas(dfs);
    } catch (e) {
      setErro((e as Error).message);
      setParcelas([]);
    }
  }, []);

  // Unifica parcelas de NF-e + parcelas de acordos numa lista só de "contas".
  const contas = useMemo<Conta[]>(() => {
    const nfe: Conta[] = (parcelas ?? []).map((p) => ({
      id: p.id, origem: "nfe", companyId: p.companyId, cnpjEmit: p.cnpjEmit, xNomeEmit: p.xNomeEmit,
      nDup: p.nDup, vencimento: p.vencimento, valor: p.valor, statusPagamento: p.statusPagamento,
      dataPagamento: p.dataPagamento, valorPago: p.valorPago, obsPagamento: p.obsPagamento, contasPagamento: p.contasPagamento,
      migradoAcordo: p.migradoAcordo, acordoId: p.acordoId, chNFe: p.chNFe,
    }));
    const ac: Conta[] = acordos.flatMap((a) =>
      (a.parcelas ?? []).map((pc, i) => ({
        id: `acordo:${a.id}:${i}`, origem: "acordo" as const, acordoId: a.id, indice: i,
        companyId: a.companyId, cnpjEmit: a.cnpjFornecedor, xNomeEmit: a.nomeFornecedor,
        nDup: String(pc.n ?? i + 1), vencimento: pc.vencimento, valor: pc.valor, contasPagamento: pc.contasPagamento,
        statusPagamento: pc.statusPagamento === "pago" ? "pago" : "nao_informado",
        dataPagamento: pc.dataPagamento ?? null, descricao: a.descricao ?? a.nomeFornecedor,
      })),
    );
    // Despesas fixas — uma "conta" por mês que incide (janela recente + próximos).
    const meses = janelaMeses(3, 1);
    const df: Conta[] = despesas.flatMap((d) => {
      if (d.ativo === false) return [];
      const dia = String(Math.min(Number(d.diaVencimento) || 1, 28)).padStart(2, "0");
      return meses.filter((ym) => incideNoMes(d, ym)).map((ym) => {
        const pg = d.pagamentos?.[ym];
        return {
          id: `despesa:${d.id}:${ym}`, origem: "despesa" as const, despesaId: d.id, ym,
          companyId: d.companyId ?? undefined, cnpjEmit: null, xNomeEmit: d.nome,
          nDup: ym, vencimento: `${ym}-${dia}`,
          valor: pg?.pago ? (pg.valor ?? d.valor) : d.valor,
          statusPagamento: pg?.pago ? "pago" : "nao_informado",
          dataPagamento: pg?.data ?? null, valorPago: pg?.valor ?? null,
          contasPagamento: pg?.contasPagamento, descricao: d.categoria,
        };
      });
    });
    return [...nfe, ...ac, ...df];
  }, [parcelas, acordos, despesas]);

  const nomeConta = (id: string) => {
    const e = empresas.find((x) => x.id === id);
    return e?.nomeFantasia || e?.razaoSocial || id;
  };

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrirSingle(p: Conta) {
    setPendente(p.id);
    setDataPg(hojeISO());
    setValorPg(p.valor != null ? String(p.valor) : "");
    setObsPg("");
    // Pré-preenche com a própria empresa da conta a pagar (edite p/ outra conta ou rateio).
    setContasPg(p.companyId ? [{ empresaId: p.companyId, valor: p.valor ?? 0 }] : []);
    setMigrarChk(false);
    setMigrarAcordoId("");
  }

  async function confirmarSingle(p: Conta) {
    setSalvando(p.id);
    setErro(null);
    try {
      // "Migrou para acordo" (só NF-e): registra sem baixar (sem movimentação).
      if (p.origem === "nfe" && migrarChk) {
        await migrarParcelaAcordo({ parcelaId: p.id, migrado: true, acordoId: migrarAcordoId || undefined });
        setPendente(null);
        await carregar();
        return;
      }
      const cps = contasValidas(contasPg);
      if (p.origem === "acordo") {
        await baixarParcelaAcordo({ acordoId: p.acordoId as string, indice: p.indice as number, pago: true, dataPagamento: dataPg, contasPagamento: cps.length ? cps : undefined });
      } else if (p.origem === "despesa") {
        const v = Number(valorPg);
        await pagarDespesaFixa({ id: p.despesaId as string, mes: p.ym as string, pago: true, valor: Number.isFinite(v) && valorPg !== "" ? v : (p.valor ?? undefined), data: dataPg, contasPagamento: cps.length ? cps : undefined });
      } else {
        const v = Number(valorPg);
        await baixarParcela({
          parcelaId: p.id,
          pago: true,
          dataPagamento: dataPg,
          valorPago: Number.isFinite(v) && valorPg !== "" ? v : undefined,
          obsPagamento: obsPg.trim() || undefined,
          contasPagamento: cps.length ? cps : undefined,
        });
      }
      setPendente(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  async function reabrir(p: Conta) {
    setSalvando(p.id);
    setErro(null);
    try {
      if (p.migradoAcordo) {
        await migrarParcelaAcordo({ parcelaId: p.id, migrado: false });
      } else if (p.origem === "acordo") {
        await baixarParcelaAcordo({ acordoId: p.acordoId as string, indice: p.indice as number, pago: false });
      } else if (p.origem === "despesa") {
        await pagarDespesaFixa({ id: p.despesaId as string, mes: p.ym as string, pago: false });
      } else {
        await baixarParcela({ parcelaId: p.id, pago: false });
      }
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  function toggleSel(id: string) {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function sairSelecao() {
    setSelMode(false);
    setSel(new Set());
    setLoteForm(false);
  }

  async function confirmarLote() {
    if (sel.size === 0) return;
    setSalvando("lote");
    setErro(null);
    try {
      await baixarParcelasLote({
        parcelaIds: [...sel],
        dataPagamento: dataLote,
        obsPagamento: obsLote.trim() || undefined,
        contaEmpresaId: contaLote || undefined,
      });
      sairSelecao();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  // Fornecedores distintos (para o filtro).
  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of contas) {
      const c = p.cnpjEmit ?? "";
      if (c) m.set(c, p.xNomeEmit ?? c);
    }
    return [...m.entries()].map(([cnpj, nome]) => ({ cnpj, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [contas]);

  // Base filtrada por empresa + fornecedor (alimenta totais, resumo e lista).
  const base = useMemo(
    () =>
      contas.filter(
        (p) =>
          (!empresaId || (p.companyId ?? "") === empresaId) &&
          (!forn || (p.cnpjEmit ?? "") === forn) &&
          noPeriodo(p.vencimento, periodo),
      ),
    [contas, forn, empresaId, periodo],
  );

  const totais = useMemo(() => {
    let aVencer = 0;
    let vencido = 0;
    let pago = 0;
    for (const p of base) {
      const { s } = situacao(p);
      if (s === "a_vencer") aVencer += p.valor ?? 0;
      else if (s === "vencida") vencido += p.valor ?? 0;
      else if (s === "paga") pago += p.valorPago ?? p.valor ?? 0;
    }
    return { aVencer, vencido, pago };
  }, [base]);

  // Pagamentos por mês (pela data de pagamento), respeitando o fornecedor.
  const mesAtual = hojeISO().slice(0, 7);
  const porMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of base) {
      if (p.statusPagamento !== "pago" || !p.dataPagamento) continue;
      const k = p.dataPagamento.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + (p.valorPago ?? p.valor ?? 0));
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [base]);
  const pagoNoMes = porMes.find(([k]) => k === mesAtual)?.[1] ?? 0;

  const lista = useMemo(() => {
    const arr = base.filter((p) => filtro === "todas" || situacao(p).s === filtro);
    // Não pagas primeiro (por vencimento, mais recente primeiro); pagas depois
    // (por data de pagamento, mais recente primeiro). Interliga NF-e, acordos e
    // despesas fixas numa régua só.
    return [...arr].sort((a, b) => {
      const pagaA = situacao(a).s === "paga" ? 1 : 0;
      const pagaB = situacao(b).s === "paga" ? 1 : 0;
      if (pagaA !== pagaB) return pagaA - pagaB;
      if (pagaA === 1) return (b.dataPagamento ?? "").localeCompare(a.dataPagamento ?? "");
      return (b.vencimento ?? "").localeCompare(a.vencimento ?? "");
    });
  }, [base, filtro]);

  // Total selecionado (para a barra de lote).
  const totalSel = useMemo(() => {
    let t = 0;
    for (const p of contas) if (sel.has(p.id)) t += p.valor ?? 0;
    return t;
  }, [contas, sel]);

  return (
    <div>
      <PageHeader
        title="Financeiro"
        description="Contas a pagar das NF-e e dos acordos. Dê baixa ao pagar."
        action={
          podeBaixar && !selMode ? (
            <Button size="sm" variant="outline" onClick={() => setSelMode(true)}>
              <CheckSquare className="size-4" /> Selecionar
            </Button>
          ) : podeBaixar ? (
            <Button size="sm" variant="ghost" onClick={sairSelecao}>
              <X className="size-4" /> Cancelar
            </Button>
          ) : undefined
        }
      />

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : null}

      {/* Filtro por empresa */}
      {empresas.length > 1 ? (
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="mb-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas as empresas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
          ))}
        </select>
      ) : null}

      {/* Filtro por fornecedor */}
      {fornecedores.length > 0 ? (
        <div className="mb-3">
          <select
            value={forn}
            onChange={(e) => setForn(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos os fornecedores</option>
            {fornecedores.map((f) => (
              <option key={f.cnpj} value={f.cnpj}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <FiltroPeriodo value={periodo} onChange={setPeriodo} className="mb-1" />
      <p className="mb-3 px-1 text-[11px] text-muted-foreground">Período pela data de vencimento das parcelas.</p>

      <Hero
        eyebrow="A pagar em aberto"
        value={parcelas === null ? "…" : formatBRL(totais.aVencer + totais.vencido)}
        valueTone={totais.vencido > 0 ? "destructive" : "default"}
        tone={totais.vencido > 0 ? "destructive" : "warning"}
        subtitle="Parcelas de fornecedores por vencimento no período"
        metrics={[
          { label: "A vencer", value: parcelas === null ? "…" : formatBRL(totais.aVencer), tone: "warning" },
          { label: "Vencidas", value: parcelas === null ? "…" : formatBRL(totais.vencido), tone: "destructive" },
          { label: "Pagas", value: parcelas === null ? "…" : formatBRL(totais.pago), tone: "success" },
        ]}
      />

      {/* Resumo de pagamentos por mês */}
      {porMes.length > 0 ? (
        <Card className="mt-3">
          <CardContent className="py-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[0.95rem] font-semibold tracking-tight">
                Pagamentos por mês
              </h2>
              <span className="text-sm text-muted-foreground">
                {mesLabel(mesAtual)}: <strong className="text-foreground tnum">{formatBRL(pagoNoMes)}</strong>
              </span>
            </div>
            <div className="divide-y divide-border">
              {porMes.map(([ym, v]) => (
                <div key={ym} className="flex items-center justify-between py-1.5 text-sm">
                  <span className={ym === mesAtual ? "font-medium" : "text-muted-foreground"}>
                    {mesLabel(ym)}
                    {ym === mesAtual ? " · este mês" : ""}
                  </span>
                  <span className="font-medium tnum">{formatBRL(v)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="my-4 flex gap-2">
        {(["todas", "a_vencer", "vencida", "paga"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              filtro === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {{ todas: "Todas", a_vencer: "A vencer", vencida: "Vencidas", paga: "Pagas" }[f]}
          </button>
        ))}
      </div>

      {parcelas === null ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : lista.length === 0 ? (
        <ModulePlaceholder icon={Wallet} title="Nenhuma parcela" etapa="Contas a pagar">
          As parcelas aparecem a partir das duplicatas informadas nas NF-e completas.
          “Pago” não é inferido do XML — você dá a baixa manualmente ao pagar.
        </ModulePlaceholder>
      ) : (
        <div className={`space-y-3 ${selMode ? "pb-28" : ""}`}>
          {lista.length > 600 ? (
            <p className="text-xs text-muted-foreground">Mostrando as 600 primeiras de {lista.length}. Use os filtros (empresa, fornecedor, período) para refinar.</p>
          ) : null}
          {lista.slice(0, 600).map((p) => {
            const { s, dias } = situacao(p);
            const cfg = {
              paga: { variant: "success" as const, label: "Paga" },
              vencida: { variant: "destructive" as const, label: "Vencida" },
              a_vencer: { variant: "warning" as const, label: "A vencer" },
              sem_venc: { variant: "neutral" as const, label: "Sem vencimento" },
              migrado: { variant: "neutral" as const, label: "Migrou p/ acordo" },
            }[s];
            const abrindo = pendente === p.id;
            const ocupado = salvando === p.id;
            // Lote de baixa só cobre parcelas de NF-e; acordo/despesa baixa individualmente.
            const selecionavel = selMode && s !== "paga" && p.origem === "nfe";
            const marcada = sel.has(p.id);

            const info = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.xNomeEmit ?? "Fornecedor"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.origem === "acordo" ? "Acordo · parcela" : p.origem === "despesa" ? "Despesa fixa" : "Parcela"}
                      {p.origem === "despesa" ? "" : ` ${p.nDup ?? "1"}`} · venc. {formatarData(p.vencimento)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.origem === "acordo" ? <Badge variant="neutral">Acordo</Badge> : null}
                    {p.origem === "despesa" ? <Badge variant="neutral">Despesa fixa</Badge> : null}
                    <Badge variant={cfg.variant}>{cfg.label}</Badge>
                  </div>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <p className="text-lg font-bold tnum">{formatBRL(p.valor)}</p>
                  {s === "paga" ? (
                    <p className="text-xs text-success tnum">Pago em {formatarData(p.dataPagamento)}</p>
                  ) : dias !== null ? (
                    <p className="text-xs text-muted-foreground tnum">
                      {dias < 0 ? `${-dias} dias em atraso` : dias === 0 ? "vence hoje" : `em ${dias} dias`}
                    </p>
                  ) : null}
                </div>
                {s === "paga" && p.valorPago != null && p.valorPago !== p.valor ? (
                  <p className="mt-1 text-xs text-muted-foreground tnum">Valor pago: {formatBRL(p.valorPago)}</p>
                ) : null}
                {s === "paga" && p.obsPagamento ? (
                  <p className="mt-1 text-xs text-muted-foreground">Obs.: {p.obsPagamento}</p>
                ) : null}
                {s === "paga" && p.contasPagamento && p.contasPagamento.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pago de: {p.contasPagamento.map((c) => `${nomeConta(c.empresaId)} (${formatBRL(c.valor)})`).join(" · ")}
                  </p>
                ) : null}
                {s === "migrado" ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Renegociada em acordo{p.acordoId ? ` · ${acordos.find((a) => a.id === p.acordoId)?.nomeFornecedor ?? "acordo"}` : ""} — sem movimentação financeira.
                  </p>
                ) : null}
              </>
            );

            return (
              <Card
                key={p.id}
                className={marcada ? "ring-2 ring-primary" : undefined}
              >
                <CardContent className="py-4">
                  {selMode ? (
                    // Modo seleção: card inteiro alterna a marcação (parcelas pagas ficam inertes)
                    <button
                      type="button"
                      disabled={!selecionavel}
                      onClick={() => selecionavel && toggleSel(p.id)}
                      className="flex w-full items-start gap-3 text-left disabled:opacity-50"
                    >
                      <span
                        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded border ${
                          marcada ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {marcada ? <Check className="size-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">{info}</span>
                    </button>
                  ) : (
                    <>
                      <Link href={p.origem === "acordo" ? "/acordos" : p.origem === "despesa" ? "/despesas" : (p.chNFe ? `/notas/${encodeURIComponent(p.chNFe)}` : "#")} className="block">
                        {info}
                      </Link>

                      {/* Ações de baixa (admin/financeiro) */}
                      {podeBaixar ? (
                        <div className="mt-3 border-t border-border pt-3">
                          {s === "migrado" ? (
                            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => reabrir(p)}>
                              <RotateCcw className="size-4" />
                              {ocupado ? "Desfazendo…" : "Desfazer migração p/ acordo"}
                            </Button>
                          ) : s === "paga" ? (
                            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => reabrir(p)}>
                              <RotateCcw className="size-4" />
                              {ocupado ? "Reabrindo…" : "Reabrir (marcar como não paga)"}
                            </Button>
                          ) : abrindo ? (
                            <div className="space-y-2">
                              {p.origem === "nfe" ? (
                                <label className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" className="size-4" checked={migrarChk} onChange={(e) => setMigrarChk(e.target.checked)} />
                                  Migrou para acordo <span className="text-xs text-muted-foreground">(só registra, sem movimentação)</span>
                                </label>
                              ) : null}
                              {p.origem === "nfe" && migrarChk ? (
                                <div className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Associar a um acordo (opcional)</label>
                                  <select value={migrarAcordoId} onChange={(e) => setMigrarAcordoId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                                    <option value="">— sem associação —</option>
                                    {acordos.map((a) => <option key={a.id} value={a.id}>{a.nomeFornecedor}{a.companyId ? ` · ${nomeConta(a.companyId)}` : ""}</option>)}
                                  </select>
                                  <p className="text-[11px] text-muted-foreground">A parcela sai do &quot;a pagar&quot; em aberto e não entra no fluxo/conciliação. O acordo carrega as novas parcelas.</p>
                                </div>
                              ) : (
                              <>
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Data do pagamento</label>
                                  <Input
                                    type="date"
                                    value={dataPg}
                                    onChange={(e) => setDataPg(e.target.value)}
                                    className="h-9 w-40"
                                  />
                                </div>
                                {p.origem !== "acordo" ? (
                                  <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Valor pago (R$)</label>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      inputMode="decimal"
                                      value={valorPg}
                                      onChange={(e) => setValorPg(e.target.value)}
                                      className="h-9 w-32"
                                    />
                                  </div>
                                ) : null}
                              </div>
                              {p.origem === "nfe" ? (
                                <div className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Observação (opcional)</label>
                                  <Input
                                    placeholder="Ex.: pago via PIX, desconto de 2%…"
                                    value={obsPg}
                                    onChange={(e) => setObsPg(e.target.value)}
                                    maxLength={300}
                                    className="h-9"
                                  />
                                </div>
                              ) : null}
                              <div className="rounded-md border border-border p-2">
                                <ContasPagamento
                                  empresas={empresas}
                                  valorTotal={p.origem === "acordo" ? (p.valor ?? 0) : (Number(valorPg) || p.valor || 0)}
                                  contas={contasPg}
                                  onChange={setContasPg}
                                />
                              </div>
                              </>
                              )}
                              <div className="flex gap-2 pt-1">
                                <Button size="sm" disabled={ocupado} onClick={() => confirmarSingle(p)}>
                                  <Check className="size-4" />
                                  {ocupado ? "Salvando…" : (p.origem === "nfe" && migrarChk) ? "Registrar migração" : "Confirmar baixa"}
                                </Button>
                                <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setPendente(null)}>
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => abrirSingle(p)}>
                              <Check className="size-4" /> Marcar como pago
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Barra fixa de baixa em lote */}
      {selMode ? (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-background/95 p-3 backdrop-blur md:bottom-0">
          <div className="mx-auto max-w-2xl">
            {loteForm ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Data do pagamento</label>
                    <Input type="date" value={dataLote} onChange={(e) => setDataLote(e.target.value)} className="h-9 w-40" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Conta que pagou (opcional)</label>
                    <select value={contaLote} onChange={(e) => setContaLote(e.target.value)} className="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm">
                      <option value="">Empresa de cada conta</option>
                      {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
                    </select>
                  </div>
                  <div className="min-w-[10rem] flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground">Observação (opcional)</label>
                    <Input
                      placeholder="Aplicada a todas as selecionadas"
                      value={obsLote}
                      onChange={(e) => setObsLote(e.target.value)}
                      maxLength={300}
                      className="h-9"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={salvando === "lote"} onClick={confirmarLote}>
                    <Check className="size-4" />
                    {salvando === "lote" ? "Baixando…" : `Confirmar baixa de ${sel.size}`}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={salvando === "lote"} onClick={() => setLoteForm(false)}>
                    Voltar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium">{sel.size} selecionada{sel.size === 1 ? "" : "s"}</span>
                  <span className="text-muted-foreground"> · {formatBRL(totalSel)}</span>
                </div>
                <Button size="sm" disabled={sel.size === 0} onClick={() => setLoteForm(true)}>
                  <Check className="size-4" /> Dar baixa
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {!selMode ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            A baixa é manual e registrada com autor e data (auditoria). Parcelas pagas saem dos alertas de atraso.
            Use “Selecionar” para dar baixa em várias de uma vez.
          </p>
          {podeBaixar ? (
            <Link href="/acordos" className="inline-block text-sm font-medium text-primary hover:underline">
              Acordos com fornecedores →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
