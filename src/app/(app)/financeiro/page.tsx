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
import { listarParcelas, baixarParcela, type Parcela } from "@/lib/nfe/repo";
import { useAuth } from "@/lib/auth/auth-provider";
import { podeAlterarFinanceiro } from "@/lib/auth/roles";
import { formatBRL, formatarData, diasAte } from "@/lib/utils";
import { Wallet, Check, RotateCcw } from "lucide-react";

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

export default function FinanceiroPage() {
  const { role } = useAuth();
  const podeBaixar = podeAlterarFinanceiro(role);
  const [parcelas, setParcelas] = useState<Parcela[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "a_vencer" | "vencida" | "paga">("todas");
  const [pendente, setPendente] = useState<string | null>(null); // parcela abrindo o form de baixa
  const [dataPg, setDataPg] = useState(hojeISO());
  const [salvando, setSalvando] = useState<string | null>(null);

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

  async function confirmarBaixa(p: Parcela) {
    setSalvando(p.id);
    setErro(null);
    try {
      await baixarParcela({ parcelaId: p.id, pago: true, dataPagamento: dataPg, valorPago: p.valor ?? undefined });
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

  const totais = useMemo(() => {
    let aVencer = 0;
    let vencido = 0;
    let pago = 0;
    for (const p of parcelas ?? []) {
      const { s } = situacao(p);
      if (s === "a_vencer") aVencer += p.valor ?? 0;
      else if (s === "vencida") vencido += p.valor ?? 0;
      else if (s === "paga") pago += p.valorPago ?? p.valor ?? 0;
    }
    return { aVencer, vencido, pago };
  }, [parcelas]);

  const lista = useMemo(() => {
    return (parcelas ?? []).filter((p) => filtro === "todas" || situacao(p).s === filtro);
  }, [parcelas, filtro]);

  return (
    <div>
      <PageHeader title="Financeiro" description="Contas a pagar das NF-e. Dê baixa ao pagar." />

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="A vencer" value={parcelas === null ? "…" : formatBRL(totais.aVencer)} tone="warning" />
        <StatCard label="Vencidas" value={parcelas === null ? "…" : formatBRL(totais.vencido)} tone="destructive" />
        <StatCard label="Pagas" value={parcelas === null ? "…" : formatBRL(totais.pago)} tone="success" />
      </div>

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
        <div className="space-y-3">
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
            return (
              <Card key={p.id}>
                <CardContent className="py-4">
                  <Link
                    href={p.chNFe ? `/notas/${encodeURIComponent(p.chNFe)}` : "#"}
                    className="block"
                  >
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
                  </Link>

                  {/* Ações de baixa (admin/financeiro) */}
                  {podeBaixar ? (
                    <div className="mt-3 border-t border-border pt-3">
                      {s === "paga" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={ocupado}
                          onClick={() => reabrir(p)}
                        >
                          <RotateCcw className="size-4" />
                          {ocupado ? "Reabrindo…" : "Reabrir (marcar como não paga)"}
                        </Button>
                      ) : abrindo ? (
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
                          <Button size="sm" disabled={ocupado} onClick={() => confirmarBaixa(p)}>
                            <Check className="size-4" />
                            {ocupado ? "Salvando…" : "Confirmar baixa"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={ocupado}
                            onClick={() => setPendente(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDataPg(hojeISO());
                            setPendente(p.id);
                          }}
                        >
                          <Check className="size-4" /> Marcar como pago
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
        A baixa é manual e registrada com autor e data (auditoria). Parcelas pagas saem dos alertas de atraso.
      </p>
    </div>
  );
}
