"use client";

// Como a folha se divide: piso + (regras + bônus).
//
// Vive aqui, e não dentro de uma das telas, porque acompanhamento e dashboard
// mostram os mesmos números — dois desenhos da mesma conta é como eles
// começam a divergir.

import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { formatBRL } from "@/lib/utils";
import type { ResultadoCompetencia } from "@/lib/comissoes/tipos";
import { custoDaFolha } from "@/lib/comissoes/custo";
import { pctFmt } from "./comum";

/** Os três números da folha: o que sai de qualquer jeito, o que o alcance somou, o total. */
export function CardsDaFolha({ apuracao }: { apuracao: ResultadoCompetencia }) {
  const t = apuracao.totais;
  const custo = custoDaFolha(apuracao.linhas);
  return (
    <>
      <StatCard
        label="Piso total pago"
        value={formatBRL(custo.piso)}
        hint={`sai mesmo sem venda${
          t.pisoSemComissao > 0 ? ` · ${formatBRL(t.pisoSemComissao)} de quem não comissiona` : ""
        }`}
      />
      <StatCard
        label="Variável (regras + bônus)"
        value={formatBRL(custo.comissao)}
        hint={
          t.faturamento > 0
            ? `${pctFmt((custo.comissao / t.faturamento) * 100)} da venda · bônus ${formatBRL(t.bonus)}`
            : `bônus ${formatBRL(t.bonus)}`
        }
      />
      <StatCard
        label="Folha total"
        value={formatBRL(custo.total)}
        tone="warning"
        hint={`${
          t.faturamento > 0 ? `${pctFmt((custo.total / t.faturamento) * 100)} da venda` : ""
        }${custo.desconto > 0 ? ` · já sem ${formatBRL(custo.desconto)} de descontos` : ""}`}
      />
    </>
  );
}

/** A proporção entre as duas partes, com o que o piso absorveu. */
export function ComposicaoDaFolha({ apuracao }: { apuracao: ResultadoCompetencia }) {
  const t = apuracao.totais;
  const custo = custoDaFolha(apuracao.linhas);
  // Quem ficou no piso gerou comissão que não virou pagamento nenhum: é o que
  // explica o variável ser menor que o total calculado pelas regras.
  const absorvido =
    Math.round(
      apuracao.linhas
        .filter((l) => l.pisoAplicado && !l.semComissao)
        .reduce((s, l) => s + l.comissaoTotal, 0) * 100,
    ) / 100;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <h2 className="text-[0.95rem] font-semibold tracking-tight">Composição da folha</h2>
        <div className="flex h-3 overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-primary"
            style={{ width: `${custo.total > 0 ? (custo.piso / custo.total) * 100 : 0}%` }}
          />
          <div
            className="h-full bg-warning"
            style={{ width: `${custo.total > 0 ? (custo.comissao / custo.total) * 100 : 0}%` }}
          />
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-primary" />
              Piso total pago
              <span className="text-xs text-muted-foreground">sai mesmo sem venda</span>
            </span>
            <span className="shrink-0 font-semibold tnum">
              {formatBRL(custo.piso)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {custo.total > 0 ? pctFmt((custo.piso / custo.total) * 100) : "—"}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-warning" />
              Variável (regras + bônus)
              <span className="text-xs text-muted-foreground">o que o alcance acrescentou</span>
            </span>
            <span className="shrink-0 font-semibold tnum">
              {formatBRL(custo.comissao)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {custo.total > 0 ? pctFmt((custo.comissao / custo.total) * 100) : "—"}
              </span>
            </span>
          </div>
          {custo.desconto > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="size-2.5 rounded-sm bg-border" />
                Descontos de folha
                <span className="text-xs">retirada, falta, suspensão</span>
              </span>
              <span className="shrink-0 font-semibold tnum text-destructive">
                − {formatBRL(custo.desconto)}
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5 font-semibold">
            <span>Folha total</span>
            <span className="tnum">
              {formatBRL(custo.total)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t.faturamento > 0 ? `${pctFmt((custo.total / t.faturamento) * 100)} da venda` : ""}
              </span>
            </span>
          </div>
        </div>
        {absorvido > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Quem não alcançou o próprio piso gerou {formatBRL(absorvido)} em regras e bônus, que
            não virou pagamento — o piso já cobria. A empresa completou{" "}
            {formatBRL(t.pisoUtilizado)} até o piso dessas pessoas.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
