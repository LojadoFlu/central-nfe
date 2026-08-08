"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarDespesasFixas,
  salvarDespesaFixa,
  pagarDespesaFixa,
  excluirDespesaFixa,
  listarEmpresas,
  type DespesaFixa,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { podeAlterarFinanceiro } from "@/lib/auth/roles";
import { formatBRL, formatarData } from "@/lib/utils";
import { Receipt, Plus, Trash2, Check, RotateCcw, X, Pencil, ChevronLeft, ChevronRight } from "lucide-react";

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
  const { role } = useAuth();
  const podeEditar = podeAlterarFinanceiro(role);
  const [despesas, setDespesas] = useState<DespesaFixa[] | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [filtroEmp, setFiltroEmp] = useState("");
  const [ym, setYm] = useState(mesAtualYM());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  // Baixa (valor real + data)
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const [pValor, setPValor] = useState("");
  const [pData, setPData] = useState("");

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
  const [fBenef, setFBenef] = useState("");
  const [fObs, setFObs] = useState("");
  const [fAtivo, setFAtivo] = useState(true);
  const [salvando, setSalvando] = useState(false);

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

  function resetForm() {
    setEditId(null);
    setFEmpresa(empresas.length === 1 ? empresas[0].id : "");
    setFNome("");
    setFCategoria("aluguel");
    setFValor("");
    setFRecorrencia("mensal");
    setFMesBase(String(Number(ym.slice(5, 7))));
    setFDia("");
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
    setFMesBase(String(d.mesBase ?? Number(ym.slice(5, 7))));
    setFDia(d.diaVencimento != null ? String(d.diaVencimento) : "");
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

  function abrirBaixa(d: DespesaFixa) {
    setPagandoId(d.id);
    setPValor(String(d.valor ?? ""));
    setPData(`${ym}-${String(Math.min(d.diaVencimento ?? 1, 28)).padStart(2, "0")}`);
  }
  async function confirmarBaixa(d: DespesaFixa) {
    setOcupado(`pg:${d.id}`);
    setErro(null);
    try {
      const v = Number(pValor);
      await pagarDespesaFixa({ id: d.id, mes: ym, pago: true, valor: Number.isFinite(v) ? v : d.valor, data: pData });
      setPagandoId(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }
  async function reabrir(d: DespesaFixa) {
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

  const visiveis = useMemo(
    () => (despesas ?? []).filter((d) => !filtroEmp || (d.companyId ?? "") === filtroEmp),
    [despesas, filtroEmp],
  );

  const totais = useMemo(() => {
    let previsto = 0, pago = 0, falta = 0;
    for (const d of visiveis) {
      const incide = aplicaNoMes(d, ym);
      const p = pagamentoDe(d, ym);
      if (p?.pago) pago += p.valor ?? d.valor ?? 0;
      if (d.ativo !== false && incide) {
        previsto += d.valor ?? 0;
        if (!p?.pago) falta += d.valor ?? 0;
      }
    }
    return { previsto, pago, falta };
  }, [visiveis, ym]);

  return (
    <div>
      <PageHeader
        title="Despesas fixas"
        description="Recorrentes — previsto (fluxo de caixa) e valor real ao pagar."
        action={
          podeEditar && !formAberto ? (
            <Button size="sm" onClick={abrirNovo}>
              <Plus className="size-4" /> Nova despesa
            </Button>
          ) : undefined
        }
      />

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

      {/* Navegação de mês */}
      <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-card px-2 py-1.5">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setYm(addMesYM(ym, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-semibold">{mesLabelLongo(ym)}</span>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setYm(addMesYM(ym, 1))}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Previsto" value={despesas === null ? "…" : formatBRL(totais.previsto)} />
        <StatCard label="Pago (real)" value={despesas === null ? "…" : formatBRL(totais.pago)} tone="success" />
        <StatCard label="Falta pagar" value={despesas === null ? "…" : formatBRL(totais.falta)} tone="warning" />
      </div>

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
                <label className="text-xs text-muted-foreground">Empresa</label>
                <select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">— Selecione a empresa —</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Nome</label>
              <Input placeholder="Ex.: Condomínio loja Barra" value={fNome} onChange={(e) => setFNome(e.target.value)} maxLength={120} />
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Categoria</label>
                <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} className="h-10 w-44 rounded-md border border-input bg-background px-3 text-sm">
                  {CATEGORIAS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Valor previsto (R$)</label>
                <Input type="number" step="0.01" inputMode="decimal" value={fValor} onChange={(e) => setFValor(e.target.value)} className="w-36" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Dia venc.</label>
                <Input type="number" inputMode="numeric" min={1} max={31} placeholder="10" value={fDia} onChange={(e) => setFDia(e.target.value)} className="w-24" />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Recorrência</label>
                <select value={fRecorrencia} onChange={(e) => setFRecorrencia(e.target.value)} className="h-10 w-40 rounded-md border border-input bg-background px-3 text-sm">
                  {RECORRENCIAS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
              {fRecorrencia !== "mensal" ? (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Mês de referência</label>
                  <select value={fMesBase} onChange={(e) => setFMesBase(e.target.value)} className="h-10 w-32 rounded-md border border-input bg-background px-3 text-sm">
                    {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Beneficiário (opcional)</label>
              <Input placeholder="Ex.: Administradora, Light, Vivo…" value={fBenef} onChange={(e) => setFBenef(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Observação (opcional)</label>
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
            const incide = aplicaNoMes(d, ym);
            const p = pagamentoDe(d, ym);
            const pago = !!p?.pago;
            const real = p?.valor ?? null;
            const prev = p?.previsto ?? d.valor;
            const bz = `pg:${d.id}`;
            const pagando = pagandoId === d.id;
            return (
              <Card key={d.id} className={inativa || !incide ? "opacity-70" : undefined}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-medium">{d.nome}</p>
                        <Badge variant="neutral">{CAT_LABEL[d.categoria ?? "outros"] ?? d.categoria}</Badge>
                        {d.recorrencia && d.recorrencia !== "mensal" ? (
                          <Badge variant="neutral">{REC_LABEL[d.recorrencia]}</Badge>
                        ) : null}
                        {inativa ? <Badge variant="neutral">Inativa</Badge> : null}
                      </div>
                      {d.empresaNome ? <p className="mt-0.5 text-[11px] font-medium text-primary">{d.empresaNome}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {d.diaVencimento ? `vence dia ${d.diaVencimento}` : "sem dia definido"}
                        {d.beneficiario ? ` · ${d.beneficiario}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-bold tnum">{formatBRL(d.valor)}</p>
                      {!incide ? (
                        <Badge variant="neutral">Não incide</Badge>
                      ) : pago ? (
                        <Badge variant="success">Paga</Badge>
                      ) : !inativa ? (
                        <Badge variant="warning">Pendente</Badge>
                      ) : null}
                    </div>
                  </div>

                  {/* Detalhe do pagamento realizado */}
                  {incide && pago ? (
                    <p className="mt-1 text-xs text-success">
                      Pago em {formatarData(p?.data)} · real {formatBRL(real)}
                      {real != null && Math.abs((real ?? 0) - (prev ?? 0)) > 0.005 ? (
                        <span className="text-muted-foreground"> (previsto {formatBRL(prev)})</span>
                      ) : null}
                    </p>
                  ) : null}

                  {podeEditar ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      {!incide ? (
                        <span className="text-xs text-muted-foreground">Não incide em {mesLabelLongo(ym)}</span>
                      ) : pago ? (
                        <Button size="sm" variant="ghost" disabled={ocupado === bz} onClick={() => reabrir(d)}>
                          <RotateCcw className="size-4" /> {ocupado === bz ? "…" : `Reabrir (${mesLabelLongo(ym)})`}
                        </Button>
                      ) : pagando ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">Valor real (R$)</label>
                            <Input type="number" step="0.01" inputMode="decimal" value={pValor} onChange={(e) => setPValor(e.target.value)} className="h-9 w-32" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">Data</label>
                            <Input type="date" value={pData} onChange={(e) => setPData(e.target.value)} className="h-9 w-40" />
                          </div>
                          <Button size="sm" disabled={ocupado === bz} onClick={() => confirmarBaixa(d)}>
                            <Check className="size-4" /> {ocupado === bz ? "…" : "Confirmar"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPagandoId(null)}>Cancelar</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => abrirBaixa(d)}>
                          <Check className="size-4" /> Marcar pago ({mesLabelLongo(ym)})
                        </Button>
                      )}

                      {!pagando ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => abrirEdicao(d)}>
                            <Pencil className="size-4" /> Editar
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
