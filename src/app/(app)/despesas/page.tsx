"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hero } from "@/components/ui/hero";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarDespesasFixas,
  salvarDespesaFixa,
  pagarDespesaFixa,
  excluirDespesaFixa,
  listarEmpresas,
  importarContasPagar,
  type DespesaFixa,
  type ImportContasResp,
  type ContaPagamento,
} from "@/lib/nfe/repo";
import { ContasPagamento, contasValidas } from "@/components/ui/contas-pagamento";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { formatBRL, formatarData, vencimentoDoMes } from "@/lib/utils";
import { Receipt, Plus, Trash2, Check, RotateCcw, X, Pencil, Upload } from "lucide-react";

const CATEGORIAS: { key: string; label: string }[] = [
  { key: "aluguel", label: "Aluguel" },
  { key: "condominio", label: "Condomínio" },
  { key: "energia", label: "Energia" },
  { key: "agua", label: "Água" },
  { key: "internet", label: "Internet" },
  { key: "telefone", label: "Telefone" },
  { key: "contabilidade", label: "Contabilidade" },
  { key: "software", label: "Software/Sistema" },
  { key: "salarios", label: "Salários" },
  { key: "impostos", label: "Impostos/Taxas" },
  { key: "royalties", label: "Royalties" },
  { key: "outros", label: "Outros" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIAS.map((c) => [c.key, c.label]));
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const RECORRENCIAS: { key: string; label: string }[] = [
  { key: "mensal", label: "Mensal" },
  { key: "bimestral", label: "Bimestral" },
  { key: "trimestral", label: "Trimestral" },
  { key: "semestral", label: "Semestral" },
  { key: "anual", label: "Anual" },
];
const REC_LABEL = Object.fromEntries(RECORRENCIAS.map((r) => [r.key, r.label]));
const PERIODO: Record<string, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };

function mesAtualYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addMesYM(ym: string, k: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function mesLabelLongo(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${y}`;
}
/** Período padrão = mês corrente (1º ao último dia). */
function periodoEsteMes(): Periodo {
  const d = new Date();
  const de = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de, ate: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}` };
}
/** Lista de meses YYYY-MM dentro do intervalo (inclusivo). */
function mesesNoIntervalo(p: Periodo): string[] {
  const start = (p.de || p.ate || `${mesAtualYM()}-01`).slice(0, 7);
  const end = (p.ate || p.de || `${mesAtualYM()}-01`).slice(0, 7);
  const out: string[] = [];
  let cur = start <= end ? start : end;
  const fim = start <= end ? end : start;
  for (let i = 0; cur <= fim && i < 120; i++) {
    out.push(cur);
    cur = addMesYM(cur, 1);
  }
  return out.length ? out : [mesAtualYM()];
}
/** A despesa incide no mês `ym`, conforme a recorrência? */
function aplicaNoMes(d: DespesaFixa, ym: string): boolean {
  const p = PERIODO[d.recorrencia ?? "mensal"] ?? 1;
  if (p === 1) return true;
  const mesBase = d.mesBase ?? 1;
  const m = Number(ym.slice(5, 7));
  return ((((m - mesBase) % p) + p) % p) === 0;
}
function pagamentoDe(d: DespesaFixa, ym: string) {
  return d.pagamentos?.[ym];
}

export default function DespesasPage() {
  const { podeAcao } = useAuth();
  const podeEditar = podeAcao("financeiro.baixar");
  const [despesas, setDespesas] = useState<DespesaFixa[] | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [filtroEmp, setFiltroEmp] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(periodoEsteMes());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  // Baixa (mês + valor real + data)
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const [pMes, setPMes] = useState(mesAtualYM());
  const [pValor, setPValor] = useState("");
  const [pData, setPData] = useState("");
  const [pContas, setPContas] = useState<ContaPagamento[]>([]);

  // Formulário de cadastro
  const [formAberto, setFormAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fEmpresa, setFEmpresa] = useState("");
  const [fNome, setFNome] = useState("");
  const [fCategoria, setFCategoria] = useState("aluguel");
  const [fValor, setFValor] = useState("");
  const [fRecorrencia, setFRecorrencia] = useState("mensal");
  const [fMesBase, setFMesBase] = useState("1");
  const [fDia, setFDia] = useState("");
  const [fParcelas, setFParcelas] = useState(""); // vazio = permanente
  const [fBenef, setFBenef] = useState("");
  const [fObs, setFObs] = useState("");
  const [fAtivo, setFAtivo] = useState(true);
  const [salvando, setSalvando] = useState(false);
  // Import de contas a pagar do PDV → despesas fixas (prévia → confirmar)
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportContasResp | null>(null);
  const [impOcupado, setImpOcupado] = useState(false);
  const [impMsg, setImpMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meses = useMemo(() => mesesNoIntervalo(periodo), [periodo]);
  const multiMes = meses.length > 1;

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ds, emps] = await Promise.all([listarDespesasFixas(), listarEmpresas()]);
      setDespesas(ds);
      setEmpresas(emps);
    } catch (e) {
      setErro((e as Error).message);
      setDespesas([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setErro(null); setImpMsg(null); setImpOcupado(true);
    try {
      const buf = await file.arrayBuffer();
      let texto: string;
      try { texto = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch { texto = new TextDecoder("windows-1252").decode(buf); }
      const prev = await importarContasPagar(texto, true);
      setPendingText(texto); setPreview(prev);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setImpOcupado(false);
    }
  }
  async function confirmarImport() {
    if (!pendingText) return;
    setImpOcupado(true); setErro(null);
    try {
      const r = await importarContasPagar(pendingText, false);
      setImpMsg(`${r.importados} despesa(s) fixa(s) criada(s) de ${r.titulos} título(s)${r.removidos ? ` (substituiu ${r.removidos} importadas antes)` : ""}. Complete o que faltar editando abaixo.`);
      setPreview(null); setPendingText(null);
      await carregar(); // recarrega a lista de despesas fixas (os importados já aparecem)
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setImpOcupado(false);
    }
  }

  function resetForm() {
    setEditId(null);
    setFEmpresa(empresas.length === 1 ? empresas[0].id : "");
    setFNome("");
    setFCategoria("aluguel");
    setFValor("");
    setFRecorrencia("mensal");
    setFMesBase(String(Number(mesAtualYM().slice(5, 7))));
    setFDia("");
    setFParcelas("");
    setFBenef("");
    setFObs("");
    setFAtivo(true);
  }
  function abrirNovo() {
    resetForm();
    setFormAberto(true);
  }
  function abrirEdicao(d: DespesaFixa) {
    setEditId(d.id);
    setFEmpresa(d.companyId ?? (empresas.length === 1 ? empresas[0].id : ""));
    setFNome(d.nome);
    setFCategoria(d.categoria ?? "outros");
    setFValor(String(d.valor ?? ""));
    setFRecorrencia(d.recorrencia ?? "mensal");
    setFMesBase(String(d.mesBase ?? Number(mesAtualYM().slice(5, 7))));
    setFDia(d.diaVencimento != null ? String(d.diaVencimento) : "");
    setFParcelas(d.qtdParcelas ? String(d.qtdParcelas) : "");
    setFBenef(d.beneficiario ?? "");
    setFObs(d.observacao ?? "");
    setFAtivo(d.ativo !== false);
    setFormAberto(true);
  }

  async function salvar() {
    if (!fNome.trim()) return setErro("Informe o nome da despesa.");
    const valor = Number(fValor);
    if (!Number.isFinite(valor) || valor < 0) return setErro("Valor inválido.");
    setSalvando(true);
    setErro(null);
    try {
      await salvarDespesaFixa({
        id: editId ?? undefined,
        companyId: fEmpresa || undefined,
        nome: fNome.trim(),
        categoria: fCategoria,
        valor,
        recorrencia: fRecorrencia as DespesaFixa["recorrencia"],
        mesBase: fRecorrencia === "mensal" ? undefined : Number(fMesBase),
        diaVencimento: fDia ? Number(fDia) : undefined,
        qtdParcelas: fParcelas ? Number(fParcelas) : null,
        beneficiario: fBenef.trim() || undefined,
        observacao: fObs.trim() || undefined,
        ativo: fAtivo,
      });
      setFormAberto(false);
      resetForm();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function dataDefault(d: DespesaFixa, ym: string): string {
    return vencimentoDoMes(ym, d.diaVencimento);
  }
  function abrirBaixa(d: DespesaFixa, incid: string[]) {
    const alvo = incid.find((ym) => !pagamentoDe(d, ym)?.pago) ?? incid[incid.length - 1] ?? meses[0];
    setPagandoId(d.id);
    setPMes(alvo);
    const vAlvo = Number(pagamentoDe(d, alvo)?.valor ?? d.valor ?? 0);
    setPValor(String(pagamentoDe(d, alvo)?.valor ?? d.valor ?? ""));
    setPData(dataDefault(d, alvo));
    setPContas(d.companyId ? [{ empresaId: d.companyId, valor: vAlvo }] : []);
  }
  function trocarMesBaixa(d: DespesaFixa, ym: string) {
    setPMes(ym);
    setPValor(String(pagamentoDe(d, ym)?.valor ?? d.valor ?? ""));
    setPData(pagamentoDe(d, ym)?.data ?? dataDefault(d, ym));
  }
  async function confirmarBaixa(d: DespesaFixa) {
    setOcupado(`pg:${d.id}`);
    setErro(null);
    try {
      const v = Number(pValor);
      const cps = contasValidas(pContas);
      await pagarDespesaFixa({ id: d.id, mes: pMes, pago: true, valor: Number.isFinite(v) ? v : d.valor, data: pData, contasPagamento: cps.length ? cps : undefined });
      setPagandoId(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }
  async function reabrir(d: DespesaFixa, ym: string) {
    setOcupado(`pg:${d.id}`);
    setErro(null);
    try {
      await pagarDespesaFixa({ id: d.id, mes: ym, pago: false });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }
  async function remover(d: DespesaFixa) {
    setOcupado(`del:${d.id}`);
    setErro(null);
    try {
      await excluirDespesaFixa(d.id);
      setConfirmDel(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }
  // Cancelar/reativar uma despesa fixa (inativar sem apagar o histórico).
  async function alternarAtivo(d: DespesaFixa) {
    setOcupado(`at:${d.id}`);
    setErro(null);
    try {
      await salvarDespesaFixa({
        id: d.id, companyId: d.companyId ?? undefined, nome: d.nome, categoria: d.categoria,
        valor: d.valor, recorrencia: d.recorrencia, mesBase: d.mesBase ?? undefined,
        diaVencimento: d.diaVencimento ?? undefined, qtdParcelas: d.qtdParcelas ?? null,
        beneficiario: d.beneficiario ?? undefined, observacao: d.observacao ?? undefined,
        ativo: d.ativo === false, // inativa se ativa; reativa se inativa
      });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const visiveis = useMemo(
    () => (despesas ?? [])
      .filter((d) => !filtroEmp || (d.companyId ?? "") === filtroEmp)
      // por dia de vencimento, mais próximo (menor dia) primeiro
      .slice()
      .sort((a, b) => (Number(a.diaVencimento) || 99) - (Number(b.diaVencimento) || 99)),
    [despesas, filtroEmp],
  );

  const totais = useMemo(() => {
    let previsto = 0, pago = 0, falta = 0;
    for (const d of visiveis) {
      for (const ym of meses) {
        const incide = aplicaNoMes(d, ym);
        const p = pagamentoDe(d, ym);
        if (p?.pago) pago += p.valor ?? d.valor ?? 0;
        if (d.ativo !== false && incide) {
          previsto += d.valor ?? 0;
          if (!p?.pago) falta += d.valor ?? 0;
        }
      }
    }
    return { previsto, pago, falta };
  }, [visiveis, meses]);

  const periodoLabel = multiMes ? `${mesLabelLongo(meses[0])} – ${mesLabelLongo(meses[meses.length - 1])}` : mesLabelLongo(meses[0]);

  return (
    <div>
      <PageHeader
        title="Despesas fixas"
        description="Recorrentes — previsto (fluxo de caixa) e valor real ao pagar."
        action={
          podeEditar && !formAberto ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={impOcupado} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> {impOcupado ? "Lendo…" : "Importar PDV"}
              </Button>
              <Button size="sm" onClick={abrirNovo}>
                <Plus className="size-4" /> Nova
              </Button>
            </div>
          ) : undefined
        }
      />
      <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={aoEscolherArquivo} />
      {impMsg ? <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{impMsg}</p> : null}
      {preview ? (
        <Card className="mb-4 border-primary/40">
          <CardContent className="py-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Prévia da importação do PDV</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Vai criar <strong>{preview.resumo.qtd} despesa(s) fixa(s)</strong> (agrupando {preview.resumo.titulos} títulos) · {formatBRL(preview.resumo.total)}/mês
              {preview.resumo.semCategoria ? ` · ${preview.resumo.semCategoria} sem categoria` : ""}
              {preview.resumo.semEmpresa ? ` · ${preview.resumo.semEmpresa} sem loja` : ""}
              {preview.resumo.ignoradosMercadoria ? ` · ${preview.resumo.ignoradosMercadoria} de mercadoria ignorados` : ""}
            </p>
            <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {preview.resumo.porCategoria.map((c) => (
                <div key={c.categoria} className="flex items-center justify-between border-b border-border/40 py-1.5 text-sm last:border-0">
                  <span className="text-muted-foreground">{c.categoria} <span className="text-[11px]">· {c.qtd}</span></span>
                  <span className="font-medium tnum">{formatBRL(c.valor)}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Entram como <strong>despesas fixas</strong> — campos que não casaram (categoria, mês-base…) ficam <strong>em branco</strong> pra você completar editando.
              Confirmar <strong>substitui</strong> as despesas fixas importadas antes (o relatório do PDV é a fonte da verdade). Nada é gravado até confirmar.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={impOcupado} onClick={confirmarImport}>
                <Check className="size-4" /> {impOcupado ? "Importando…" : "Confirmar"}
              </Button>
              <Button size="sm" variant="ghost" disabled={impOcupado} onClick={() => { setPreview(null); setPendingText(null); }}>
                <X className="size-4" /> Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {empresas.length > 1 ? (
        <select
          value={filtroEmp}
          onChange={(e) => setFiltroEmp(e.target.value)}
          className="mb-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas as empresas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
          ))}
        </select>
      ) : null}

      <FiltroPeriodo value={periodo} onChange={setPeriodo} allowClear={false} className="mb-1" />
      <p className="mb-3 px-1 text-[11px] text-muted-foreground">
        Totais somados no período ({periodoLabel}). A baixa é lançada por mês.
      </p>

      <Hero
        eyebrow="Falta pagar"
        value={despesas === null ? "…" : formatBRL(totais.falta)}
        tone={(totais.falta ?? 0) > 0 ? "warning" : "success"}
        subtitle="Despesas fixas do período"
        metrics={[
          { label: "Previsto", value: despesas === null ? "…" : formatBRL(totais.previsto) },
          { label: "Pago (real)", value: despesas === null ? "…" : formatBRL(totais.pago), tone: "success" },
        ]}
      />

      {/* Formulário */}
      {formAberto ? (
        <Card className="my-4">
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{editId ? "Editar despesa" : "Nova despesa fixa"}</h2>
              <Button size="sm" variant="ghost" onClick={() => { setFormAberto(false); resetForm(); }}>
                <X className="size-4" /> Fechar
              </Button>
            </div>

            {empresas.length > 0 ? (
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">Empresa</label>
                <select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">— Selecione a empresa —</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">Nome</label>
              <Input placeholder="Ex.: Condomínio loja Barra" value={fNome} onChange={(e) => setFNome(e.target.value)} maxLength={120} />
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">Categoria</label>
                <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} className="h-10 w-44 rounded-md border border-input bg-background px-3 text-sm">
                  {CATEGORIAS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">Valor previsto (R$)</label>
                <Input type="number" step="0.01" inputMode="decimal" value={fValor} onChange={(e) => setFValor(e.target.value)} className="h-10 w-36" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">Dia venc.</label>
                <Input type="number" inputMode="numeric" min={1} max={31} placeholder="10" value={fDia} onChange={(e) => setFDia(e.target.value)} className="h-10 w-24" />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">Recorrência</label>
                <select value={fRecorrencia} onChange={(e) => setFRecorrencia(e.target.value)} className="h-10 w-40 rounded-md border border-input bg-background px-3 text-sm">
                  {RECORRENCIAS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
              {fRecorrencia !== "mensal" ? (
                <div className="space-y-1.5">
                  <label className="block text-xs text-muted-foreground">Mês de referência</label>
                  <select value={fMesBase} onChange={(e) => setFMesBase(e.target.value)} className="h-10 w-32 rounded-md border border-input bg-background px-3 text-sm">
                    {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">Nº de parcelas</label>
                <Input type="number" min={1} max={600} inputMode="numeric" placeholder="permanente" value={fParcelas} onChange={(e) => setFParcelas(e.target.value)} className="h-10 w-32" />
                <p className="text-[11px] text-muted-foreground">Vazio = permanente</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">Beneficiário (opcional)</label>
              <Input placeholder="Ex.: Administradora, Light, Vivo…" value={fBenef} onChange={(e) => setFBenef(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">Observação (opcional)</label>
              <Input value={fObs} onChange={(e) => setFObs(e.target.value)} maxLength={300} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fAtivo} onChange={(e) => setFAtivo(e.target.checked)} className="size-4" />
              Despesa ativa (entra no previsto)
            </label>

            <div className="flex gap-2">
              <Button size="sm" disabled={salvando} onClick={salvar}>
                <Check className="size-4" /> {salvando ? "Salvando…" : "Salvar"}
              </Button>
              <Button size="sm" variant="ghost" disabled={salvando} onClick={() => { setFormAberto(false); resetForm(); }}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Lista */}
      {despesas === null ? (
        <div className="mt-4 space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : visiveis.length === 0 ? (
        <div className="mt-4">
          <ModulePlaceholder icon={Receipt} title="Nenhuma despesa fixa" etapa="Recorrentes">
            Cadastre as despesas mensais fixas: aluguel, condomínio, luz, água, internet, telefone, contabilidade…
          </ModulePlaceholder>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visiveis.map((d) => {
            const inativa = d.ativo === false;
            const incid = meses.filter((ym) => aplicaNoMes(d, ym));
            const incideNoPeriodo = incid.length > 0;
            const pagosN = incid.filter((ym) => pagamentoDe(d, ym)?.pago).length;
            const previstoP = inativa ? 0 : incid.length * (d.valor ?? 0);
            const pagoP = incid.reduce((s, ym) => {
              const p = pagamentoDe(d, ym);
              return s + (p?.pago ? p.valor ?? d.valor ?? 0 : 0);
            }, 0);
            // Valor efetivo exibido: previsto enquanto pendente; valor REAL no mês pago.
            const efetivo = !incideNoPeriodo
              ? (d.valor ?? 0)
              : inativa
                ? 0
                : incid.reduce((s, ym) => {
                  const p = pagamentoDe(d, ym);
                  return s + (p?.pago ? (p.valor ?? d.valor ?? 0) : (d.valor ?? 0));
                }, 0);
            const mostraPrevisto = !multiMes && incideNoPeriodo && pagosN > 0 && Math.abs(efetivo - (d.valor ?? 0)) > 0.005;
            const bz = `pg:${d.id}`;
            const pagando = pagandoId === d.id;
            const mesPago = !!pagamentoDe(d, pMes)?.pago;
            const tudoPago = incideNoPeriodo && pagosN === incid.length;

            return (
              <Card key={d.id} className={inativa || !incideNoPeriodo ? "opacity-70" : undefined}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-medium">{d.nome}</p>
                        <Badge variant={d.categoria ? "neutral" : "warning"}>{d.categoria ? (CAT_LABEL[d.categoria] ?? d.categoria) : "a classificar"}</Badge>
                        {d.recorrencia && d.recorrencia !== "mensal" ? (
                          <Badge variant="neutral">{REC_LABEL[d.recorrencia]}</Badge>
                        ) : null}
                        {d.origem === "pdv-import" ? <Badge variant="neutral">PDV</Badge> : null}
                        {inativa ? <Badge variant="neutral">Inativa</Badge> : null}
                      </div>
                      {d.empresaNome ? <p className="mt-0.5 text-[11px] font-medium text-primary">{d.empresaNome}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {d.diaVencimento ? (Number(d.diaVencimento) >= 29 ? "vence no último dia útil do mês" : `vence dia ${d.diaVencimento}`) : "sem dia definido"}
                        {d.qtdParcelas ? ` · ${d.qtdParcelas}x${d.fimVigencia ? ` (até ${d.fimVigencia.slice(5, 7)}/${d.fimVigencia.slice(0, 4)})` : ""}` : " · permanente"}
                        {d.beneficiario ? ` · ${d.beneficiario}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-bold tnum">{formatBRL(efetivo)}</p>
                      {mostraPrevisto ? <p className="-mt-1 text-[10px] text-muted-foreground">previsto {formatBRL(d.valor)}</p> : null}
                      {!incideNoPeriodo ? (
                        <Badge variant="neutral">Não incide</Badge>
                      ) : tudoPago ? (
                        <Badge variant="success">{multiMes ? "Tudo pago" : "Paga"}</Badge>
                      ) : !inativa ? (
                        <Badge variant="warning">{multiMes ? `${pagosN}/${incid.length} pagos` : "Pendente"}</Badge>
                      ) : null}
                    </div>
                  </div>

                  {/* Rollup do período */}
                  {incideNoPeriodo && multiMes ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {incid.length} mês(es) no período · previsto {formatBRL(previstoP)} · pago{" "}
                      <span className="text-success">{formatBRL(pagoP)}</span>
                    </p>
                  ) : null}

                  {podeEditar ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      {!incideNoPeriodo ? (
                        <span className="text-xs text-muted-foreground">Não incide no período</span>
                      ) : pagando ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">Mês</label>
                            <select
                              value={pMes}
                              onChange={(e) => trocarMesBaixa(d, e.target.value)}
                              className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
                            >
                              {incid.map((ym) => (
                                <option key={ym} value={ym}>
                                  {mesLabelLongo(ym)}{pagamentoDe(d, ym)?.pago ? " ✓" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          {mesPago ? (
                            <Button size="sm" variant="ghost" disabled={ocupado === bz} onClick={() => reabrir(d, pMes)}>
                              <RotateCcw className="size-4" /> {ocupado === bz ? "…" : `Reabrir ${mesLabelLongo(pMes)}`}
                            </Button>
                          ) : (
                            <>
                              <div className="space-y-1">
                                <label className="text-[11px] text-muted-foreground">Valor real (R$)</label>
                                <Input type="number" step="0.01" inputMode="decimal" value={pValor} onChange={(e) => setPValor(e.target.value)} className="h-9 w-32" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[11px] text-muted-foreground">Data</label>
                                <Input type="date" value={pData} onChange={(e) => setPData(e.target.value)} className="h-9 w-40" />
                              </div>
                              <div className="w-full rounded-md border border-border p-2">
                                <ContasPagamento
                                  empresas={empresas}
                                  valorTotal={Number(pValor) || d.valor || 0}
                                  contas={pContas}
                                  onChange={setPContas}
                                />
                              </div>
                              <Button size="sm" disabled={ocupado === bz} onClick={() => confirmarBaixa(d)}>
                                <Check className="size-4" /> {ocupado === bz ? "…" : "Confirmar"}
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setPagandoId(null)}>Cancelar</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => abrirBaixa(d, incid)}>
                          <Check className="size-4" /> {tudoPago ? "Ver/editar pagamentos" : "Registrar pagamento"}
                        </Button>
                      )}

                      {!pagando ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => abrirEdicao(d)}>
                            <Pencil className="size-4" /> Editar
                          </Button>
                          <Button size="sm" variant="ghost" disabled={ocupado === `at:${d.id}`} onClick={() => alternarAtivo(d)}>
                            <X className="size-4" /> {ocupado === `at:${d.id}` ? "…" : (inativa ? "Reativar" : "Cancelar (inativar)")}
                          </Button>
                          {confirmDel === d.id ? (
                            <span className="flex items-center gap-2">
                              <Button size="sm" variant="destructive" disabled={ocupado === `del:${d.id}`} onClick={() => remover(d)}>
                                {ocupado === `del:${d.id}` ? "Excluindo…" : "Confirmar exclusão"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>Não</Button>
                            </span>
                          ) : (
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDel(d.id)}>
                              <Trash2 className="size-4" /> Excluir
                            </Button>
                          )}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        O <strong>previsto</strong> alimenta a simulação do fluxo de caixa; ao pagar, informe o <strong>valor real</strong> (pode variar).
        A recorrência define em quais meses a despesa incide. Tudo é registrado com autor e data.
      </p>

    </div>
  );
}
