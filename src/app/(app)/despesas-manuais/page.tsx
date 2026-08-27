"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { FiltroPeriodo, noPeriodo, PERIODO_VAZIO, type Periodo } from "@/components/ui/filtro-periodo";
import {
  listarEmpresas,
  listarDespesasManuais,
  salvarDespesaManual,
  excluirDespesaManual,
  baixarDespesaManual,
  CATEGORIAS_DESPESA_MANUAL,
  type DespesaManual,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatarData } from "@/lib/utils";
import { Receipt, Plus, Trash2, PencilLine, X, Check, RotateCcw } from "lucide-react";

const CAT_LABEL = Object.fromEntries(CATEGORIAS_DESPESA_MANUAL.map((c) => [c.key, c.label]));

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DespesasManuaisPage() {
  const { podeAcao } = useAuth();
  const podeEditar = podeAcao("financeiro.baixar");
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [lista, setLista] = useState<DespesaManual[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // filtros
  const [fEmpresa, setFEmpresa] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_VAZIO);
  const [busca, setBusca] = useState("");

  // formulário
  const [editId, setEditId] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState("");
  const [dia, setDia] = useState(hojeISO());
  const [descricao, setDescricao] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [categoria, setCategoria] = useState("outros");
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState<"dinheiro" | "pix">("dinheiro");
  const [conta, setConta] = useState("");
  const [pago, setPago] = useState(true); // false = lança como conta a pagar (vencimento = dia)
  const [salvando, setSalvando] = useState(false);

  const nomeEmp = (id?: string) => empresas.find((e) => e.id === id)?.nomeFantasia || empresas.find((e) => e.id === id)?.razaoSocial || id || "—";

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setLista(await listarDespesasManuais());
    } catch (e) {
      setErro((e as Error).message);
      setLista([]);
    }
  }, []);

  useEffect(() => {
    void listarEmpresas().then((es) => {
      setEmpresas(es);
      if (es.length && !empresaId) setEmpresaId(es[0].id);
    }).catch(() => {});
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function limparForm() {
    setEditId(null);
    setDescricao("");
    setFornecedor("");
    setValor("");
    setCategoria("outros");
    setForma("dinheiro");
    setConta("");
    setPago(true);
    setDia(hojeISO());
  }
  function editar(d: DespesaManual) {
    setEditId(d.id);
    setEmpresaId(d.empresaId);
    setDia(d.dia);
    setDescricao(d.descricao);
    setFornecedor(d.fornecedor ?? "");
    setCategoria(d.categoria || "outros");
    setValor(String(d.valor ?? ""));
    setForma(d.formaPagamento === "pix" ? "pix" : "dinheiro");
    setConta(d.contaEmpresaId ?? "");
    setPago(d.pago !== false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function salvar() {
    if (!empresaId) return setErro("Selecione a empresa.");
    if (!descricao.trim()) return setErro("Informe a descrição.");
    const v = Number(valor);
    if (!Number.isFinite(v) || v <= 0) return setErro("Informe um valor.");
    setSalvando(true);
    setErro(null);
    try {
      await salvarDespesaManual({
        id: editId ?? undefined, empresaId, dia, descricao: descricao.trim(), fornecedor: fornecedor.trim() || undefined, categoria, valor: v,
        formaPagamento: forma, contaEmpresaId: forma === "pix" ? (conta || empresaId) : undefined,
        pago, dataPagamento: pago ? dia : undefined,
      });
      limparForm();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  async function remover(id: string) {
    setOcupado(id);
    setErro(null);
    try {
      await excluirDespesaManual(id);
      if (editId === id) limparForm();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }
  async function alternarPago(d: DespesaManual, novoPago: boolean) {
    setOcupado(d.id);
    setErro(null);
    try {
      await baixarDespesaManual({ id: d.id, pago: novoPago, dataPagamento: novoPago ? hojeISO() : undefined });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (lista ?? []).filter(
      (d) => (!fEmpresa || d.empresaId === fEmpresa)
        && (!fCategoria || d.categoria === fCategoria)
        && noPeriodo(d.dia, periodo)
        && (!t || (d.descricao ?? "").toLowerCase().includes(t) || (d.fornecedor ?? "").toLowerCase().includes(t)),
    );
  }, [lista, fEmpresa, fCategoria, periodo, busca]);

  const total = visiveis.reduce((s, d) => s + (d.valor ?? 0), 0);
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of visiveis) m.set(d.categoria, (m.get(d.categoria) ?? 0) + (d.valor ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [visiveis]);

  return (
    <div>
      <PageHeader
        title="Despesas manuais"
        description="Gastos sem nota fiscal ou extraordinários — limpeza, escritório, transporte, etc. Entram no DRE e no fluxo de caixa."
      />

      {empresas.length === 0 ? (
        <ModulePlaceholder icon={Receipt} title="Nenhuma empresa cadastrada" etapa="Despesas manuais">
          Cadastre uma empresa em Empresas para lançar despesas manuais.
        </ModulePlaceholder>
      ) : (
        <>
          {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

          {/* Formulário */}
          {podeEditar ? (
            <Card className={`mb-4 ${editId ? "border-primary/40" : ""}`}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{editId ? "Editar despesa" : "Nova despesa"}</p>
                  {editId ? (
                    <Button size="sm" variant="ghost" onClick={limparForm}><X className="size-4" /> Cancelar edição</Button>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="block text-[11px] text-muted-foreground">Empresa (de onde saiu o pagamento)</span>
                    <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] text-muted-foreground">{pago ? "Data do pagamento" : "Vencimento"}</span>
                    <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="h-9" />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="block text-[11px] text-muted-foreground">Descrição</span>
                    <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Uber para o banco, material de limpeza…" className="h-9" />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="block text-[11px] text-muted-foreground">Fornecedor / prestador (quem vendeu ou prestou o serviço)</span>
                    <Input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Ex.: Padaria do João, Uber, Eletricista Carlos…" className="h-9" />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] text-muted-foreground">Categoria</span>
                    <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      {CATEGORIAS_DESPESA_MANUAL.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] text-muted-foreground">Valor (R$)</span>
                    <Input type="number" step="0.01" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className="h-9" />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] text-muted-foreground">Forma de pagamento</span>
                    <select value={forma} onChange={(e) => setForma(e.target.value as "dinheiro" | "pix")} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      <option value="dinheiro">Dinheiro</option>
                      <option value="pix">PIX da conta</option>
                    </select>
                  </label>
                  {forma === "pix" ? (
                    <label className="space-y-1">
                      <span className="block text-[11px] text-muted-foreground">Conta (banco de onde saiu o PIX)</span>
                      <select value={conta} onChange={(e) => setConta(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                        <option value="">Mesma empresa da despesa</option>
                        {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <div className="sm:col-span-2 rounded-md border border-border bg-muted/30 p-2.5">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" checked={pago} onChange={(e) => setPago(e.target.checked)} />
                      Já paga
                    </label>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {pago
                        ? "Sai do caixa na data acima."
                        : "Vai para Contas a pagar e entra no fluxo como saída prevista no vencimento — quite quando pagar."}
                    </p>
                  </div>
                </div>
                <Button size="sm" disabled={salvando} onClick={salvar}>
                  <Plus className="size-4" /> {salvando ? "Salvando…" : editId ? "Salvar alterações" : "Adicionar despesa"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Filtros */}
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Empresa</span>
              <select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Todas as empresas</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Categoria</span>
              <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Todas as categorias</option>
                {CATEGORIAS_DESPESA_MANUAL.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <FiltroPeriodo value={periodo} onChange={setPeriodo} className="mb-3" />
          <Input placeholder="Buscar na descrição…" value={busca} onChange={(e) => setBusca(e.target.value)} className="mb-3 h-10" />

          {/* Total */}
          {lista && visiveis.length > 0 ? (
            <Card className="mb-3">
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Total no filtro</span>
                  <span className="text-lg font-bold tnum text-destructive">{formatBRL(total)}</span>
                </div>
                {porCategoria.length > 1 ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {porCategoria.map(([k, v]) => <span key={k}>{CAT_LABEL[k] ?? k}: <span className="tnum font-medium">{formatBRL(v)}</span></span>)}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Lista */}
          {lista === null ? (
            <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          ) : visiveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma despesa no filtro atual.</p>
          ) : (
            <div className="space-y-2">
              {visiveis.map((d) => (
                <Card key={d.id}>
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.descricao}</p>
                      {d.fornecedor ? <p className="truncate text-xs text-muted-foreground">{d.fornecedor}</p> : null}
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {d.pago === false
                          ? <Badge variant="warning">A pagar · vence {formatarData(d.dia)}</Badge>
                          : <Badge variant="success">Paga {formatarData(d.dataPagamento ?? d.dia)}</Badge>}
                        <Badge variant="neutral">{CAT_LABEL[d.categoria] ?? d.categoria}</Badge>
                        {d.formaPagamento === "pix"
                          ? <Badge variant="neutral">PIX · {nomeEmp(d.contaEmpresaId ?? d.empresaId)}</Badge>
                          : <Badge variant="neutral">Dinheiro</Badge>}
                        {nomeEmp(d.empresaId)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <p className="font-bold tnum text-destructive">{formatBRL(d.valor)}</p>
                      {podeEditar ? (
                        <>
                          <Button size="sm" variant={d.pago === false ? "outline" : "ghost"} disabled={ocupado === d.id} onClick={() => alternarPago(d, d.pago === false)}>
                            {d.pago === false ? <><Check className="size-4" /> Pagar</> : <RotateCcw className="size-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => editar(d)}>
                            <PencilLine className="size-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" disabled={ocupado === d.id} onClick={() => remover(d.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Despesa <strong>paga</strong> sai do caixa na data do pagamento. Despesa <strong>a pagar</strong> vai para Contas a pagar e entra no fluxo como saída prevista no vencimento até você quitar. Nos dois casos reduz o resultado no DRE por competência (data informada).
          </p>
        </>
      )}
    </div>
  );
}
