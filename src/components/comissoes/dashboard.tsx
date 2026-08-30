"use client";

// Dashboard gerencial: ranking, custo por cargo e evolução da folha (§23, §24).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL, formatarData } from "@/lib/utils";
import { Medal } from "lucide-react";
import type { CustoMes, ResultadoCompetencia } from "@/lib/comissoes/tipos";
import { custoComissoes } from "@/lib/comissoes/repo";
import { BarraMeta, Select, mesLabel, pctFmt } from "./comum";

type Criterio = "valorDevido" | "vendaConsiderada" | "atingimentoPct";

const CRITERIOS: { valor: Criterio; label: string }[] = [
  { valor: "vendaConsiderada", label: "Venda" },
  { valor: "atingimentoPct", label: "Atingimento da meta" },
  { valor: "valorDevido", label: "Comissão" },
];

/** 12 competências terminando na atual. */
function janelaDeMeses(competencia: string): { de: string; ate: string } {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 12, 1));
  return { de: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, ate: competencia };
}

export function Dashboard({
  competencia,
  apuracao,
}: {
  competencia: string;
  apuracao: ResultadoCompetencia | null;
}) {
  const [criterio, setCriterio] = useState<Criterio>("valorDevido");
  const [historico, setHistorico] = useState<CustoMes[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { de, ate } = janelaDeMeses(competencia);
      const r = await custoComissoes(de, ate);
      setHistorico(r.meses);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [competencia]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const ranking = useMemo(() => {
    const linhas = [...(apuracao?.linhas ?? [])];
    linhas.sort((a, b) => (b[criterio] ?? 0) - (a[criterio] ?? 0));
    return linhas;
  }, [apuracao, criterio]);

  const maiorCusto = useMemo(
    () => Math.max(1, ...(historico ?? []).map((m) => m.valorDevido)),
    [historico],
  );

  if (!apuracao) return <Skeleton className="h-40" />;
  const t = apuracao.totais;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Faturamento" value={formatBRL(t.faturamento)} />
        <StatCard
          label="Custo de comissões"
          value={formatBRL(t.valorDevido)}
          tone="warning"
          hint={t.faturamento > 0 ? `${pctFmt((t.valorDevido / t.faturamento) * 100)} da venda` : undefined}
        />
        <StatCard
          label="Folha sai em"
          value={formatarData(apuracao.pagamentoEm)}
          hint={`competência ${mesLabel(apuracao.competencia)}`}
        />
        <StatCard
          label="Projeção do mês"
          value={apuracao.projecao ? formatBRL(apuracao.projecao.valorDevido) : "—"}
          hint={
            apuracao.projecao
              ? `${apuracao.projecao.diasDecorridos} de ${apuracao.projecao.diasTotais} dias · venda ${formatBRL(apuracao.projecao.faturamento)}`
              : "mês encerrado"
          }
        />
      </div>

      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-[0.95rem] font-semibold tracking-tight">
              <Medal className="size-4" /> Ranking
            </h2>
            <Select
              value={criterio}
              onChange={(e) => setCriterio(e.target.value as Criterio)}
              className="h-9 w-auto"
            >
              {CRITERIOS.map((c) => (
                <option key={c.valor} value={c.valor}>
                  Por {c.label.toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <div className="divide-y divide-border">
            {ranking.map((l, i) => (
              <div key={l.funcionarioId} className="flex items-center gap-3 py-2">
                <span
                  className={`w-6 shrink-0 text-center text-sm font-bold tnum ${
                    i === 0 ? "text-warning" : "text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.funcionarioNome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.lojaNome ?? "sem loja"} · {formatBRL(l.vendaConsiderada)}
                  </p>
                  <BarraMeta pct={l.atingimentoPct} />
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tnum">{formatBRL(l.valorDevido)}</p>
                  {l.valorDevidoProjetado != null && l.valorDevidoProjetado !== l.valorDevido ? (
                    <p className="text-[11px] text-muted-foreground tnum">
                      projeção {formatBRL(l.valorDevidoProjetado)}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            {ranking.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Sem funcionários apurados.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {apuracao.porCargo.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Custo por cargo</h2>
            <div className="divide-y divide-border">
              {apuracao.porCargo.map((c) => (
                <div key={c.cargoId ?? "sem"} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {c.cargoNome}{" "}
                    <span className="text-muted-foreground">
                      · {c.funcionarios} pessoa{c.funcionarios === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tnum">{formatBRL(c.valor)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 py-2 text-sm font-semibold">
                <span>Total</span>
                <span className="tnum">{formatBRL(t.valorDevido)}</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Piso garantido dentro deste total: {formatBRL(t.pisoUtilizado)} · bônus {formatBRL(t.bonus)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-2 py-4">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Evolução da folha variável</h2>
          {erro ? <p className="text-xs text-destructive">{erro}</p> : null}
          {historico === null ? (
            <Skeleton className="h-24" />
          ) : historico.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não há histórico — ele se forma conforme os meses são apurados.
            </p>
          ) : (
            <div className="space-y-1.5">
              {historico.map((m) => (
                <div key={m.competencia} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">
                    {mesLabel(m.competencia)}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className={`h-full rounded ${m.status === "fechado" ? "bg-primary" : "bg-primary/50"}`}
                      style={{ width: `${(m.valorDevido / maiorCusto) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs font-medium tnum">
                    {formatBRL(m.valorDevido)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground tnum">
                    {m.faturamento > 0 ? pctFmt((m.valorDevido / m.faturamento) * 100) : "—"}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-muted-foreground">
                Barra cheia = mês fechado. Barra clara = provisão, ainda muda.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
