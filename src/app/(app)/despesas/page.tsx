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
  type DespesaFixa,
} from "@/lib/nfe/repo";
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
function pagamentoDe(d: DespesaFixa, ym: string) {
  return d.pagamentos?.[ym];
}
function valorPagoDe(d: DespesaFixa, ym: string): number {
  const p = pagamentoDe(d, ym);
  return p?.valor ?? d.valor ?? 0;
}

export default function DespesasPage() {
  const { role } = useAuth();
  const podeEditar = podeAlterarFinanceiro(role);
  const [despesas, setDespesas] = useState<DespesaFixa[] | null>(null);
  const [ym, setYm] = useState(mesAtualYM());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  // Formulário
  const [formAberto, setFormAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fNome, setFNome] = useState("");
  const [fCategoria, setFCategoria] = useState("aluguel");
  const [fValor, setFValor] = useState("");
  const [fDia, setFDia] = useState("");
  const [fBenef, setFBenef] = useState("");
  const [fObs, setFObs] = useState("");
  const [fAtivo, setFAtivo] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDespesas(await listarDespesasFixas());
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
    setFNome("");
    setFCategoria("aluguel");
    setFValor("");
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
    setFNome(d.nome);
    setFCategoria(d.categoria ?? "outros");
    setFValor(String(d.valor ?? ""));
    setFDia(d.diaVencimento != null ? String(d.diaVencimento) : "");
    setFBenef(d.beneficiario ?? "");
    setFObs(d.observacao ?? "");
    setFAtivo(d.ativo !== false);
    setFormAberto(true);
  }

  async function salvar() {
    if (!fNome.trim()) {
      setErro("Informe o nome da despesa.");
      return;
    }
    const valor = Number(fValor);
    if (!Number.isFinite(valor) || valor < 0) {
      setErro("Valor inválido.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await salvarDespesaFixa({
        id: editId ?? undefined,
        nome: fNome.trim(),
        categoria: fCategoria,
        valor,
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

  async function alternarPago(d: DespesaFixa) {
    const p = pagamentoDe(d, ym);
    const pago = !!p?.pago;
    setOcupado(`pg:${d.id}`);
    setErro(null);
    try {
      const dia = d.diaVencimento ?? 1;
      const data = `${ym}-${String(Math.min(dia, 28)).padStart(2, "0")}`;
      await pagarDespesaFixa({ id: d.id, mes: ym, pago: !pago, valor: d.valor, data });
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

  const totais = useMemo(() => {
    let previsto = 0;
    let pago = 0;
    let falta = 0;
    for (const d of despesas ?? []) {
      const ativa = d.ativo !== false;
      const p = pagamentoDe(d, ym);
      if (p?.pago) pago += valorPagoDe(d, ym);
      if (ativa) {
        previsto += d.valor ?? 0;
        if (!p?.pago) falta += d.valor ?? 0;
      }
    }
    return { previsto, pago, falta };
  }, [despesas, ym]);

  return (
    <div>
      <PageHeader
        title="Despesas fixas"
        description="Aluguel, luz, internet, contabilidade e outras recorrentes."
        action={
          podeEditar && !formAberto ? (
            <Button size="sm" onClick={abrirNovo}>
              <Plus className="size-4" /> Nova despesa
            </Button>
          ) : undefined
        }
      />

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
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
        <StatCard label="Pago" value={despesas === null ? "…" : formatBRL(totais.pago)} tone="success" />
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

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Nome</label>
              <Input placeholder="Ex.: Aluguel loja Barra" value={fNome} onChange={(e) => setFNome(e.target.value)} maxLength={120} />
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Categoria</label>
                <select
                  value={fCategoria}
                  onChange={(e) => setFCategoria(e.target.value)}
                  className="h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Valor mensal (R$)</label>
                <Input type="number" step="0.01" inputMode="decimal" value={fValor} onChange={(e) => setFValor(e.target.value)} className="w-36" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Dia venc.</label>
                <Input type="number" inputMode="numeric" min={1} max={31} placeholder="10" value={fDia} onChange={(e) => setFDia(e.target.value)} className="w-24" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Beneficiário (opcional)</label>
              <Input placeholder="Ex.: Imobiliária XYZ, Light, Vivo…" value={fBenef} onChange={(e) => setFBenef(e.target.value)} maxLength={120} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Observação (opcional)</label>
              <Input value={fObs} onChange={(e) => setFObs(e.target.value)} maxLength={300} />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fAtivo} onChange={(e) => setFAtivo(e.target.checked)} className="size-4" />
              Despesa ativa (entra no previsto do mês)
            </label>

            <div className="flex gap-2">
              <Button size="sm" disabled={salvando} onClick={salvar}>
                <Check className="size-4" /> {salvando ? "Salvando…" : "Salvar"}
              </Button>
              <Button size="sm" variant="ghost" disabled={salvando} onClick={() => { setFormAberto(false); resetForm(); }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Lista */}
      {despesas === null ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : despesas.length === 0 ? (
        <div className="mt-4">
          <ModulePlaceholder icon={Receipt} title="Nenhuma despesa fixa" etapa="Recorrentes">
            Cadastre aqui as despesas mensais fixas: aluguel, condomínio, luz, água, internet, telefone, contabilidade…
          </ModulePlaceholder>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {despesas.map((d) => {
            const inativa = d.ativo === false;
            const p = pagamentoDe(d, ym);
            const pago = !!p?.pago;
            const bz = `pg:${d.id}`;
            return (
              <Card key={d.id} className={inativa ? "opacity-60" : undefined}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{d.nome}</p>
                        <Badge variant="neutral">{CAT_LABEL[d.categoria ?? "outros"] ?? d.categoria}</Badge>
                        {inativa ? <Badge variant="neutral">Inativa</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.diaVencimento ? `vence dia ${d.diaVencimento}` : "sem dia definido"}
                        {d.beneficiario ? ` · ${d.beneficiario}` : ""}
                        {pago && p?.data ? ` · pago em ${formatarData(p.data)}` : ""}
                      </p>
                      {d.observacao ? <p className="mt-1 text-xs text-muted-foreground">Obs.: {d.observacao}</p> : null}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-bold tnum">{formatBRL(d.valor)}</p>
                      {pago ? <Badge variant="success">Paga</Badge> : !inativa ? <Badge variant="warning">Pendente</Badge> : null}
                    </div>
                  </div>

                  {podeEditar ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <Button
                        size="sm"
                        variant={pago ? "ghost" : "outline"}
                        disabled={ocupado === bz}
                        onClick={() => alternarPago(d)}
                      >
                        {pago ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                        {ocupado === bz ? "…" : pago ? `Reabrir (${mesLabelLongo(ym)})` : `Marcar pago (${mesLabelLongo(ym)})`}
                      </Button>
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
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        As despesas fixas se repetem todo mês. Use as setas para navegar entre os meses e marque o pagamento de cada uma.
        Toda alteração é registrada com autor e data (auditoria).
      </p>
    </div>
  );
}
