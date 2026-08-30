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
import { listarParcelas, baixarParcela, baixarParcelasLote, listarEmpresas, listarAcordos, baixarParcelaAcordo, listarDespesasFixas, pagarDespesaFixa, migrarParcelaAcordo, contestarParcela, resolverContestacao, listarDespesasManuais, baixarDespesaManual, type Parcela, type Acordo, type ContaPagamento, type DespesaFixa, type DespesaManual, type Contestacao } from "@/lib/nfe/repo";
import { ContasPagamento, contasValidas } from "@/components/ui/contas-pagamento";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { FiltroPeriodo, noPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { formatBRL, formatarData, diasAte, vencimentoDoMes } from "@/lib/utils";
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
/** Nº da parcela (1-based) da despesa fixa no mês `ym`: quantas incidências houve
 * da 1ª incidência (>= mês de criação) até `ym` inclusive. Espelha a âncora do backend. */
function parcelaDespesa(d: DespesaFixa, ym: string): number {
  const inicio = (d.createdAt ?? "").slice(0, 7) || ym;
  let y = Number(inicio.slice(0, 4));
  let m = Number(inicio.slice(5, 7));
  for (let i = 0; i < 36; i++) { // avança até a 1ª incidência
    if (incideNoMes(d, `${y}-${String(m).padStart(2, "0")}`)) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  let n = 0;
  for (let i = 0; i < 600; i++) {
    const cur = `${y}-${String(m).padStart(2, "0")}`;
    if (cur > ym) break;
    if (incideNoMes(d, cur)) n++;
    m++; if (m > 12) { m = 1; y++; }
  }
  return n;
}
/** Próxima parcela EM ABERTO (não paga) de uma despesa fixa: o 1º mês que incide,
 * da criação em diante, sem pagamento marcado. null se está tudo pago / fora de vigência. */
function proximaParcelaAberta(d: DespesaFixa): string | null {
  const ini = (d.createdAt ?? "").slice(0, 7);
  const agora = new Date();
  let ym0 = ini || `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  const fim = d.fimVigencia ?? "";
  // teto p/ permanentes: não procurar além de 24 meses à frente do mês atual
  const capD = new Date(agora.getFullYear(), agora.getMonth() + 24, 1);
  const cap = `${capD.getFullYear()}-${String(capD.getMonth() + 1).padStart(2, "0")}`;
  let [y, m] = ym0.split("-").map(Number);
  for (let i = 0; i < 600; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (fim && ym > fim) return null;
    if (!fim && ym > cap) return null;
    if (incideNoMes(d, ym) && d.pagamentos?.[ym]?.pago !== true) return ym;
    m++; if (m > 12) { m = 1; y++; }
  }
  return null;
}

/** Conta a pagar: parcela de NF-e, parcela de acordo, mês de despesa fixa ou despesa manual. */
interface Conta {
  id: string;               // NF-e = id; acordo = "acordo:{id}:{i}"; despesa = "despesa:{id}:{ym}"; manual = "manual:{id}"
  origem: "nfe" | "acordo" | "despesa" | "despesa-manual";
  acordoId?: string | null;
  indice?: number;
  despesaId?: string;
  despesaManualId?: string;
  ym?: string;
  parcelaFixa?: string;     // "8/10" p/ despesa fixa com nº de parcelas definido
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
  contestacao?: Contestacao | null;
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
const fmtDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Semana atual: domingo (início) a sábado (fim), contendo hoje. */
function semanaAtual(): { ini: string; fim: string } {
  const d = new Date();
  const ini = new Date(d); ini.setDate(d.getDate() - d.getDay());   // getDay(): 0=domingo
  const fim = new Date(ini); fim.setDate(ini.getDate() + 6);        // sábado
  return { ini: fmtDia(ini), fim: fmtDia(fim) };
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
/** "2026-08" → "Ago/2026". */
function mesLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${y}`;
}

export default function FinanceiroPage() {
  const { podeAcao, isAdmin } = useAuth();
  const podeBaixar = podeAcao("financeiro.baixar");
  const [parcelas, setParcelas] = useState<Parcela[] | null>(null);
  const [acordos, setAcordos] = useState<Acordo[]>([]);
  const [despesas, setDespesas] = useState<DespesaFixa[]>([]);
  const [despManuais, setDespManuais] = useState<DespesaManual[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  // Padrão: a semana atual (domingo a sábado). Mudar o filtro recalcula tudo.
  const [periodo, setPeriodo] = useState<Periodo>(() => { const { ini, fim } = semanaAtual(); return { de: ini, ate: fim }; });
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "a_vencer" | "vencida" | "paga">("a_vencer");
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

  // Contestação (divergência que bloqueia o pagamento)
  const [contestando, setContestando] = useState<string | null>(null);
  const [cMotivo, setCMotivo] = useState<"valor" | "parcelas" | "outro">("valor");
  const [cDescricao, setCDescricao] = useState("");
  const [cValor, setCValor] = useState("");
  const [cParcelas, setCParcelas] = useState("");

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
      const [ps, emps, acs, dfs, dms] = await Promise.all([listarParcelas(2000), listarEmpresas(), listarAcordos(), listarDespesasFixas(), listarDespesasManuais()]);
      setParcelas(ps);
      setEmpresas(emps);
      setAcordos(acs);
      setDespesas(dfs);
      setDespManuais(dms);
    } catch (e) {
      setErro((e as Error).message);
      setParcelas([]);
    }
  }, []);

  // Unifica parcelas de NF-e + parcelas de acordos numa lista só de "contas".
  const contas = useMemo<Conta[]>(() => {
    // Sequência N/total das parcelas de cada NF (por chNFe), ordenadas por vencimento.
    const seqNfe = new Map<string, string>(); // parcelaId -> "2/3"
    const porChave = new Map<string, Parcela[]>();
    for (const p of parcelas ?? []) {
      const k = p.chNFe ?? p.id;
      const arr = porChave.get(k); if (arr) arr.push(p); else porChave.set(k, [p]);
    }
    for (const arr of porChave.values()) {
      if (arr.length <= 1) continue;
      arr.slice()
        .sort((a, b) => (a.vencimento ?? "").localeCompare(b.vencimento ?? "") || (a.nDup ?? "").localeCompare(b.nDup ?? ""))
        .forEach((p, i) => seqNfe.set(p.id, `${i + 1}/${arr.length}`));
    }
    const nfe: Conta[] = (parcelas ?? []).map((p) => ({
      id: p.id, origem: "nfe", companyId: p.companyId, cnpjEmit: p.cnpjEmit, xNomeEmit: p.xNomeEmit,
      nDup: p.nDup, parcelaFixa: seqNfe.get(p.id), vencimento: p.vencimento, valor: p.valor, statusPagamento: p.statusPagamento,
      dataPagamento: p.dataPagamento, valorPago: p.valorPago, obsPagamento: p.obsPagamento, contasPagamento: p.contasPagamento,
      migradoAcordo: p.migradoAcordo, acordoId: p.acordoId, chNFe: p.chNFe, contestacao: p.contestacao,
    }));
    const ac: Conta[] = acordos.flatMap((a) => {
      const total = a.parcelas?.length ?? 0;
      return (a.parcelas ?? []).map((pc, i) => ({
        id: `acordo:${a.id}:${i}`, origem: "acordo" as const, acordoId: a.id, indice: i,
        companyId: a.companyId, cnpjEmit: a.cnpjFornecedor, xNomeEmit: a.nomeFornecedor,
        nDup: String(pc.n ?? i + 1), parcelaFixa: total > 1 ? `${pc.n ?? i + 1}/${total}` : undefined,
        vencimento: pc.vencimento, valor: pc.valor, contasPagamento: pc.contasPagamento,
        statusPagamento: pc.statusPagamento === "pago" ? "pago" : "nao_informado",
        dataPagamento: pc.dataPagamento ?? null, descricao: a.descricao ?? a.nomeFornecedor,
      }));
    });
    // Despesas fixas — UMA conta por despesa, na PRÓXIMA parcela em aberto (a vencer/vencida).
    // Ao pagar, avança sozinha para a próxima. O histórico pago fica na tela de Despesas fixas.
    const df: Conta[] = despesas.flatMap((d) => {
      if (d.ativo === false) return [];
      const ym = proximaParcelaAberta(d);
      if (!ym) return [];
      return [{
        id: `despesa:${d.id}:${ym}`, origem: "despesa" as const, despesaId: d.id, ym,
        companyId: d.companyId ?? undefined, cnpjEmit: null, xNomeEmit: d.nome,
        nDup: ym, vencimento: vencimentoDoMes(ym, d.diaVencimento),
        parcelaFixa: d.qtdParcelas && d.qtdParcelas > 1 ? `${parcelaDespesa(d, ym)}/${d.qtdParcelas}` : undefined,
        valor: d.valor,
        statusPagamento: "nao_informado" as const,
        dataPagamento: null, descricao: d.categoria,
      }];
    });
    // Despesas manuais NÃO pagas — cada uma é uma conta a pagar (vencimento = dia).
    const dm: Conta[] = despManuais
      .filter((d) => d.pago === false)
      .map((d) => ({
        id: `manual:${d.id}`, origem: "despesa-manual" as const, despesaManualId: d.id,
        companyId: d.contaEmpresaId ?? d.empresaId, cnpjEmit: null, xNomeEmit: d.fornecedor ?? d.empresaNome ?? null,
        nDup: "1", vencimento: d.dia, valor: d.valor, statusPagamento: "nao_informado",
        dataPagamento: null, descricao: d.descricao,
      }));
    return [...nfe, ...ac, ...df, ...dm];
  }, [parcelas, acordos, despesas, despManuais]);

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
      if (p.origem === "despesa-manual") {
        await baixarDespesaManual({ id: p.despesaManualId as string, pago: true, dataPagamento: dataPg });
      } else if (p.origem === "acordo") {
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
      } else if (p.origem === "despesa-manual") {
        await baixarDespesaManual({ id: p.despesaManualId as string, pago: false });
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

  function abrirContest(p: Conta) {
    setPendente(null); setContestando(p.id);
    setCMotivo("valor"); setCDescricao(""); setCValor(""); setCParcelas("");
  }
  async function enviarContest(p: Conta) {
    if (!cDescricao.trim()) return setErro("Descreva a divergência.");
    setSalvando(p.id); setErro(null);
    try {
      await contestarParcela({
        parcelaId: p.id, motivo: cMotivo, descricao: cDescricao.trim(),
        valorCorreto: cMotivo === "valor" && cValor ? Number(cValor) : undefined,
        parcelasCorreto: cMotivo === "parcelas" && cParcelas ? Number(cParcelas) : undefined,
      });
      setContestando(null);
      await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(null); }
  }
  async function resolver(p: Conta, resolucao: "aprovada" | "cancelada") {
    setSalvando(p.id); setErro(null);
    try {
      await resolverContestacao({ parcelaId: p.id, resolucao });
      await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(null); }
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

  // "A pagar hoje" é sempre HOJE (independe do filtro de período): base só por empresa+fornecedor.
  const baseDestaque = useMemo(
    () => contas.filter((p) => (!empresaId || (p.companyId ?? "") === empresaId) && (!forn || (p.cnpjEmit ?? "") === forn)),
    [contas, forn, empresaId],
  );
  const totalHoje = useMemo(() => {
    const hoje = hojeISO();
    let v = 0;
    for (const p of baseDestaque) {
      const { s } = situacao(p);
      if ((s === "a_vencer" || s === "vencida") && (p.vencimento ?? "").slice(0, 10) === hoje) v += p.valor ?? 0;
    }
    return v;
  }, [baseDestaque]);
  // A vencer / vencidas / pagas seguem o PERÍODO do filtro (base já filtrada por período).
  // Padrão do período = semana atual (dom–sáb); mudar o filtro recalcula os três.
  const totais = useMemo(() => {
    let aVencer = 0, vencido = 0, pago = 0;
    for (const p of base) {
      const { s } = situacao(p);
      if (s === "a_vencer") aVencer += p.valor ?? 0;
      else if (s === "vencida") vencido += p.valor ?? 0;
      else if (s === "paga") pago += p.valorPago ?? p.valor ?? 0;
    }
    return { aVencer, vencido, pago, hoje: totalHoje };
  }, [base, totalHoje]);

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
    // Não pagas primeiro, por vencimento MAIS PRÓXIMO no topo (atrasadas/urgentes
    // em cima); pagas depois, por data de pagamento mais recente. Interliga NF-e,
    // acordos e despesas fixas numa régua só.
    return [...arr].sort((a, b) => {
      const pagaA = situacao(a).s === "paga" ? 1 : 0;
      const pagaB = situacao(b).s === "paga" ? 1 : 0;
      if (pagaA !== pagaB) return pagaA - pagaB;
      if (pagaA === 1) return (b.dataPagamento ?? "").localeCompare(a.dataPagamento ?? "");
      return (a.vencimento ?? "").localeCompare(b.vencimento ?? "");
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
        eyebrow="A pagar hoje"
        value={parcelas === null ? "…" : formatBRL(totais.hoje)}
        valueTone={totais.hoje > 0 ? "destructive" : "default"}
        tone={totais.hoje > 0 ? "destructive" : "warning"}
        subtitle="Contas que vencem hoje, ainda não pagas"
        metrics={[
          { label: "A vencer", value: parcelas === null ? "…" : formatBRL(totais.aVencer), tone: "warning" },
          { label: "Vencidas", value: parcelas === null ? "…" : formatBRL(totais.vencido), tone: "destructive" },
          { label: "Pagas", value: parcelas === null ? "…" : formatBRL(totais.pago), tone: "success" },
        ]}
      />
      <p className="mb-1 mt-1 px-1 text-[11px] text-muted-foreground">
        A vencer / vencidas / pagas seguem o período do filtro (padrão: esta semana, domingo a sábado). &ldquo;A pagar hoje&rdquo; é sempre do dia.
      </p>

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
            const selecionavel = selMode && s !== "paga" && p.origem === "nfe" && p.contestacao?.status !== "aberta";
            const marcada = sel.has(p.id);

            const info = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.xNomeEmit ?? "Fornecedor"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.origem === "acordo" ? "Acordo · parcela" : p.origem === "despesa" ? "Despesa fixa" : p.origem === "despesa-manual" ? (p.descricao ?? "Despesa manual") : "Parcela"}
                      {p.origem === "despesa" ? (p.parcelaFixa ? ` · ${p.parcelaFixa}` : "") : p.origem === "despesa-manual" ? "" : ` ${p.parcelaFixa ?? p.nDup ?? "1"}`} · venc. {formatarData(p.vencimento)}
                    </p>
                    {p.companyId ? (
                      <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{nomeConta(p.companyId)}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.contestacao?.status === "aberta" ? <Badge variant="destructive">Em contestação</Badge> : null}
                    {p.origem === "acordo" ? <Badge variant="neutral">Acordo</Badge> : null}
                    {p.origem === "despesa" ? <Badge variant="neutral">Despesa fixa</Badge> : null}
                    {p.origem === "despesa-manual" ? <Badge variant="neutral">Despesa manual</Badge> : null}
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
                {p.contestacao?.status === "aberta" ? (
                  <p className="mt-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                    <strong>{p.contestacao.motivo === "valor" ? "Valor divergente" : p.contestacao.motivo === "parcelas" ? "Nº de parcelas errado" : "Divergência"}:</strong> {p.contestacao.descricao}
                    {p.contestacao.valorCorreto != null ? ` · correto: ${formatBRL(p.contestacao.valorCorreto)}` : ""}
                    {p.contestacao.parcelasCorreto != null ? ` · ${p.contestacao.parcelasCorreto}x` : ""} — pagamento bloqueado até aprovação.
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
                      <Link href={p.origem === "acordo" ? "/acordos" : p.origem === "despesa" ? `/despesas?despesa=${p.despesaId}` : p.origem === "despesa-manual" ? "/despesas-manuais" : (p.chNFe ? `/notas/${encodeURIComponent(p.chNFe)}` : "#")} className="block">
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
                          ) : p.contestacao?.status === "aberta" ? (
                            <div className="space-y-2">
                              <p className="text-xs text-destructive">⚠ Pagamento bloqueado por contestação.</p>
                              {isAdmin ? (
                                <div className="flex gap-2">
                                  <Button size="sm" disabled={ocupado} onClick={() => resolver(p, "aprovada")}>{ocupado ? "…" : "Aprovar e liberar"}</Button>
                                  <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => resolver(p, "cancelada")}>Cancelar contestação</Button>
                                </div>
                              ) : <p className="text-[11px] text-muted-foreground">Aguardando um administrador aprovar a correção.</p>}
                            </div>
                          ) : contestando === p.id ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="space-y-1">
                                  <label className="block text-xs text-muted-foreground">Tipo de divergência</label>
                                  <select value={cMotivo} onChange={(e) => setCMotivo(e.target.value as "valor" | "parcelas" | "outro")} className="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm">
                                    <option value="valor">Valor cobrado errado</option>
                                    <option value="parcelas">Nº de parcelas errado</option>
                                    <option value="outro">Outro</option>
                                  </select>
                                </div>
                                {cMotivo === "valor" ? (
                                  <div className="space-y-1">
                                    <label className="block text-xs text-muted-foreground">Valor correto (R$)</label>
                                    <Input type="number" step="0.01" inputMode="decimal" value={cValor} onChange={(e) => setCValor(e.target.value)} className="h-9 w-32" />
                                  </div>
                                ) : null}
                                {cMotivo === "parcelas" ? (
                                  <div className="space-y-1">
                                    <label className="block text-xs text-muted-foreground">Parcelas correto</label>
                                    <Input type="number" step="1" inputMode="numeric" value={cParcelas} onChange={(e) => setCParcelas(e.target.value)} className="h-9 w-24" />
                                  </div>
                                ) : null}
                              </div>
                              <div className="space-y-1">
                                <label className="block text-xs text-muted-foreground">Descreva a divergência</label>
                                <Input placeholder="Ex.: acordado R$ 1.000, cobrado R$ 1.200" value={cDescricao} onChange={(e) => setCDescricao(e.target.value)} maxLength={500} className="h-9" />
                              </div>
                              <div className="flex gap-2 pt-1">
                                <Button size="sm" variant="destructive" disabled={ocupado} onClick={() => enviarContest(p)}>{ocupado ? "Salvando…" : "Marcar divergência (bloqueia)"}</Button>
                                <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setContestando(null)}>Cancelar</Button>
                              </div>
                            </div>
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
                                {p.origem !== "acordo" && p.origem !== "despesa-manual" ? (
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
                              {p.origem === "despesa-manual" ? (
                                <p className="text-[11px] text-muted-foreground">Sai da conta desta despesa ({nomeConta(p.companyId ?? "")}). Para mudar a conta, edite a despesa em Despesas manuais.</p>
                              ) : (
                                <div className="rounded-md border border-border p-2">
                                  <ContasPagamento
                                    empresas={empresas}
                                    valorTotal={p.origem === "acordo" ? (p.valor ?? 0) : (Number(valorPg) || p.valor || 0)}
                                    contas={contasPg}
                                    onChange={setContasPg}
                                  />
                                </div>
                              )}
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
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={() => abrirSingle(p)}>
                                <Check className="size-4" /> Marcar como pago
                              </Button>
                              {p.origem === "nfe" ? (
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => abrirContest(p)}>Contestar divergência</Button>
                              ) : null}
                            </div>
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
