"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { listarParcelas, baixarParcela, baixarParcelasLote, type Parcela } from "@/lib/nfe/repo";
import { useAuth } from "@/lib/auth/auth-provider";
import { podeAlterarFinanceiro } from "@/lib/auth/roles";
import { formatBRL, formatarData, diasAte } from "@/lib/utils";
import { Wallet, Check, RotateCcw, CheckSquare, X } from "lucide-react";

type Situacao = "paga" | "vencida" | "a_vencer" | "sem_venc";

/** Uma parcela paga sai da régua de vencimento — vira "paga". */
function situacao(p: Parcela): { s: Situacao; dias: number | null } {
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
  const { role } = useAuth();
  const podeBaixar = podeAlterarFinanceiro(role);
  const [parcelas, setParcelas] = useState<Parcela[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "a_vencer" | "vencida" | "paga">("todas");
  const [forn, setForn] = useState(""); // cnpjEmit selecionado ("" = todos)
  const [salvando, setSalvando] = useState<string | null>(null); // id ou "lote"

  // Baixa individual (form expandido)
  const [pendente, setPendente] = useState<string | null>(null);
  const [dataPg, setDataPg] = useState(hojeISO());
  const [valorPg, setValorPg] = useState("");
  const [obsPg, setObsPg] = useState("");

  // Baixa em lote (modo seleção)
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loteForm, setLoteForm] = useState(false);
  const [dataLote, setDataLote] = useState(hojeISO());
  const [obsLote, setObsLote] = useState("");

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setParcelas(await listarParcelas());
    } catch (e) {
      setErro((e as Error).message);
      setParcelas([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrirSingle(p: Parcela) {
    setPendente(p.id);
    setDataPg(hojeISO());
    setValorPg(p.valor != null ? String(p.valor) : "");
    setObsPg("");
  }

  async function confirmarSingle(p: Parcela) {
    setSalvando(p.id);
    setErro(null);
    try {
      const v = Number(valorPg);
      await baixarParcela({
        parcelaId: p.id,
        pago: true,
        dataPagamento: dataPg,
        valorPago: Number.isFinite(v) && valorPg !== "" ? v : undefined,
        obsPagamento: obsPg.trim() || undefined,
      });
      setPendente(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  async function reabrir(p: Parcela) {
    setSalvando(p.id);
    setErro(null);
    try {
      await baixarParcela({ parcelaId: p.id, pago: false });
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
    for (const p of parcelas ?? []) {
      const c = p.cnpjEmit ?? "";
      if (c) m.set(c, p.xNomeEmit ?? c);
    }
    return [...m.entries()].map(([cnpj, nome]) => ({ cnpj, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [parcelas]);

  // Base filtrada por fornecedor (alimenta totais, resumo e lista).
  const base = useMemo(
    () => (parcelas ?? []).filter((p) => !forn || (p.cnpjEmit ?? "") === forn),
    [parcelas, forn],
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
    return base.filter((p) => filtro === "todas" || situacao(p).s === filtro);
  }, [base, filtro]);

  // Total selecionado (para a barra de lote).
  const totalSel = useMemo(() => {
    let t = 0;
    for (const p of parcelas ?? []) if (sel.has(p.id)) t += p.valor ?? 0;
    return t;
  }, [parcelas, sel]);

  return (
    <div>
      <PageHeader
        title="Financeiro"
        description="Contas a pagar das NF-e. Dê baixa ao pagar."
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

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="A vencer" value={parcelas === null ? "…" : formatBRL(totais.aVencer)} tone="warning" />
        <StatCard label="Vencidas" value={parcelas === null ? "…" : formatBRL(totais.vencido)} tone="destructive" />
        <StatCard label="Pagas" value={parcelas === null ? "…" : formatBRL(totais.pago)} tone="success" />
      </div>

      {/* Resumo de pagamentos por mês */}
      {porMes.length > 0 ? (
        <Card className="mt-3">
          <CardContent className="py-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
          {lista.map((p) => {
            const { s, dias } = situacao(p);
            const cfg = {
              paga: { variant: "success" as const, label: "Paga" },
              vencida: { variant: "destructive" as const, label: "Vencida" },
              a_vencer: { variant: "warning" as const, label: "A vencer" },
              sem_venc: { variant: "neutral" as const, label: "Sem vencimento" },
            }[s];
            const abrindo = pendente === p.id;
            const ocupado = salvando === p.id;
            const selecionavel = selMode && s !== "paga";
            const marcada = sel.has(p.id);

            const info = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.xNomeEmit ?? "Fornecedor"}</p>
                    <p className="text-xs text-muted-foreground">
                      Parcela {p.nDup ?? "1"} · venc. {formatarData(p.vencimento)}
                    </p>
                  </div>
                  <Badge variant={cfg.variant}>{cfg.label}</Badge>
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
                      <Link href={p.chNFe ? `/notas/${encodeURIComponent(p.chNFe)}` : "#"} className="block">
                        {info}
                      </Link>

                      {/* Ações de baixa (admin/financeiro) */}
                      {podeBaixar ? (
                        <div className="mt-3 border-t border-border pt-3">
                          {s === "paga" ? (
                            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => reabrir(p)}>
                              <RotateCcw className="size-4" />
                              {ocupado ? "Reabrindo…" : "Reabrir (marcar como não paga)"}
                            </Button>
                          ) : abrindo ? (
                            <div className="space-y-2">
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
                              </div>
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
                              <div className="flex gap-2 pt-1">
                                <Button size="sm" disabled={ocupado} onClick={() => confirmarSingle(p)}>
                                  <Check className="size-4" />
                                  {ocupado ? "Salvando…" : "Confirmar baixa"}
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
