"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { listarParcelas, type Parcela } from "@/lib/nfe/repo";
import { formatBRL, formatarData, diasAte } from "@/lib/utils";
import { Wallet } from "lucide-react";

type Situacao = "vencida" | "a_vencer" | "sem_venc";

function situacao(p: Parcela): { s: Situacao; dias: number | null } {
  const dias = diasAte(p.vencimento);
  if (dias === null) return { s: "sem_venc", dias: null };
  return { s: dias < 0 ? "vencida" : "a_vencer", dias };
}

export default function FinanceiroPage() {
  const [parcelas, setParcelas] = useState<Parcela[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "a_vencer" | "vencida">("todas");

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

  const totais = useMemo(() => {
    let aVencer = 0;
    let vencido = 0;
    for (const p of parcelas ?? []) {
      const { s } = situacao(p);
      if (s === "a_vencer") aVencer += p.valor ?? 0;
      else if (s === "vencida") vencido += p.valor ?? 0;
    }
    return { aVencer, vencido };
  }, [parcelas]);

  const lista = useMemo(() => {
    return (parcelas ?? []).filter((p) => filtro === "todas" || situacao(p).s === filtro);
  }, [parcelas, filtro]);

  return (
    <div>
      <PageHeader title="Financeiro" description="Parcelas e vencimentos informados nas NF-e." />

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="A vencer" value={parcelas === null ? "…" : formatBRL(totais.aVencer)} tone="warning" />
        <StatCard label="Vencidas" value={parcelas === null ? "…" : formatBRL(totais.vencido)} tone="destructive" />
      </div>

      <div className="my-4 flex gap-2">
        {(["todas", "a_vencer", "vencida"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              filtro === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {f === "todas" ? "Todas" : f === "a_vencer" ? "A vencer" : "Vencidas"}
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
          Lembrando: “pago” não é inferido do XML — depende de conciliação futura.
        </ModulePlaceholder>
      ) : (
        <div className="space-y-3">
          {lista.map((p) => {
            const { s, dias } = situacao(p);
            const cfg = {
              vencida: { variant: "destructive" as const, label: "Vencida" },
              a_vencer: { variant: "warning" as const, label: "A vencer" },
              sem_venc: { variant: "neutral" as const, label: "Sem vencimento" },
            }[s];
            return (
              <Card key={p.id} className="transition-colors hover:bg-accent/50">
                <Link href={p.chNFe ? `/notas/${encodeURIComponent(p.chNFe)}` : "#"} className="block">
                  <CardContent className="py-4">
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
                      {dias !== null ? (
                        <p className="text-xs text-muted-foreground tnum">
                          {dias < 0 ? `${-dias} dias em atraso` : dias === 0 ? "vence hoje" : `em ${dias} dias`}
                        </p>
                      ) : null}
                    </div>
                  </CardContent>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
