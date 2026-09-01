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
import { custoDaFolha, custoDaLinha } from "@/lib/comissoes/custo";
import { CardsDaFolha, ComposicaoDaFolha } from "./composicao";
import { BarraMeta, Select, mesLabel, pctFmt } from "./comum";

type Criterio = "valorDevido" | "comissaoTotal" | "vendaConsiderada" | "atingimentoPct";

// "Valor pago" e "comissão" não são a mesma coisa: quando a comissão fica
// abaixo do piso, paga-se o piso. O rótulo dizia "comissão" e ordenava pelo
// valor pago — dois nomes para números que divergem justamente em quem está
// no piso.
const CRITERIOS: { valor: Criterio; label: string }[] = [
  { valor: "valorDevido", label: "Valor pago" },
  { valor: "comissaoTotal", label: "Comissão calculada" },
  { valor: "vendaConsiderada", label: "Venda" },
  { valor: "atingimentoPct", label: "Atingimento da meta" },
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
  const [cargo, setCargo] = useState("");
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

  const cargos = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of apuracao?.linhas ?? []) if (l.cargoId) m.set(l.cargoId, l.cargoNome ?? l.cargoId);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [apuracao]);

  const ranking = useMemo(() => {
    const linhas = (apuracao?.linhas ?? []).filter((l) => !cargo || l.cargoId === cargo);
    return [...linhas].sort((a, b) => (b[criterio] ?? 0) - (a[criterio] ?? 0));
  }, [apuracao, criterio, cargo]);

  /** Piso × variável de cada cargo — a mesma divisão da folha, por cargo. */
  const custoPorCargo = useMemo(() => {
    const m = new Map<string, { nome: string; piso: number; variavel: number; total: number; pessoas: number }>();
    for (const l of apuracao?.linhas ?? []) {
      const chave = l.cargoId ?? "sem";
      const c = custoDaLinha(l);
      const atual = m.get(chave) ?? {
        nome: l.cargoNome ?? "Sem cargo",
        piso: 0,
        variavel: 0,
        total: 0,
        pessoas: 0,
      };
      atual.piso += c.piso;
      atual.variavel += c.comissao;
      atual.total += c.total;
      atual.pessoas += 1;
      m.set(chave, atual);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [apuracao]);

  const maiorCusto = useMemo(
    () => Math.max(1, ...(historico ?? []).map((m) => m.valorDevido)),
    [historico],
  );

  if (!apuracao) return <Skeleton className="h-40" />;
  const t = apuracao.totais;
  const custo = custoDaFolha(apuracao.linhas);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Faturamento" value={formatBRL(t.faturamento)} />
        <CardsDaFolha apuracao={apuracao} />
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

      <ComposicaoDaFolha apuracao={apuracao} />

      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-[0.95rem] font-semibold tracking-tight">
              <Medal className="size-4" /> Ranking
            </h2>
            <div className="flex gap-2">
              {/* Cargos diferentes não competem entre si: o supervisor é medido
                  pela soma das lojas, então aparece com uma "venda" que nenhum
                  vendedor alcança. Daí o filtro ao lado do critério. */}
              <Select
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
                className="h-9 w-auto"
              >
                <option value="">Todos os cargos</option>
                {cargos.map(([id, nome]) => (
                  <option key={id} value={id}>
                    {nome}
                  </option>
                ))}
              </Select>
              <Select
                value={criterio}
                onChange={(e) => setCriterio(e.target.value as Criterio)}
                className="h-9 w-auto"
                aria-label="Ordenar por"
              >
                {CRITERIOS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    Ordenar por {c.label.toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
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
                    {l.cargoNome ?? "sem cargo"} · {l.lojaNome ?? "sem loja"} ·{" "}
                    {formatBRL(l.vendaConsiderada)}
                  </p>
                  <BarraMeta pct={l.atingimentoPct} />
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Valor pago
                  </p>
                  <p className="font-semibold tnum">{formatBRL(l.valorDevido)}</p>
                  {l.pisoAplicado ? (
                    <p className="text-[10px] text-warning">no piso</p>
                  ) : null}
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

      {custoPorCargo.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Custo por cargo</h2>
            {/* A mesma divisão da folha, por cargo: cargo que só tem piso
                aparece com variável zerada, e é isso mesmo. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Cargo</th>
                    <th className="py-1.5 text-right font-medium">Piso</th>
                    <th className="py-1.5 text-right font-medium">Variável</th>
                    <th className="py-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {custoPorCargo.map((c) => (
                    <tr key={c.nome} className="border-b border-border/60">
                      <td className="py-1.5 pr-3">
                        <span className="block truncate">{c.nome}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {c.pessoas} pessoa{c.pessoas === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="py-1.5 text-right tnum">{formatBRL(c.piso)}</td>
                      <td className="py-1.5 text-right tnum">{formatBRL(c.variavel)}</td>
                      <td className="py-1.5 text-right font-semibold tnum">{formatBRL(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-1.5 pr-3">Total</td>
                    <td className="py-1.5 text-right tnum">{formatBRL(custo.piso)}</td>
                    <td className="py-1.5 text-right tnum">{formatBRL(custo.comissao)}</td>
                    <td className="py-1.5 text-right tnum">{formatBRL(custo.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
