"use client";

// Acompanhamento / fechamento do mês (§18, §19, §21, §22, §38).
// Cada linha abre a memória de cálculo — de onde saiu cada centavo.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/utils";
import { ChevronDown, TriangleAlert } from "lucide-react";
import type { LinhaApuracao, ResultadoCompetencia } from "@/lib/comissoes/tipos";
import { BarraMeta, Select, mesLabel, pctFmt } from "./comum";
import { CardsDaFolha, ComposicaoDaFolha } from "./composicao";

function Memoria({ linha }: { linha: LinhaApuracao }) {
  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Memória de cálculo
      </p>
      <div className="divide-y divide-border/60">
        {linha.memoria.length === 0 ? (
          <p className="py-1.5 text-xs text-muted-foreground">Sem lançamentos no período.</p>
        ) : (
          linha.memoria.map((m, i) => (
            <div key={i} className="flex items-start justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className={`text-xs font-medium ${m.informativa ? "text-muted-foreground" : ""}`}>
                  {m.rotulo}
                </p>
                <p className="text-[11px] leading-snug text-muted-foreground">{m.detalhe}</p>
              </div>
              <span
                className={`shrink-0 text-xs font-semibold tnum ${
                  m.informativa ? "text-muted-foreground" : m.valor < 0 ? "text-destructive" : ""
                }`}
              >
                {m.informativa && m.valor === 0 ? "—" : formatBRL(m.valor)}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-2.5 text-xs sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Comissão calculada</p>
          <p className="font-semibold tnum">{formatBRL(linha.comissaoTotal)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">
            Piso garantido
            {linha.pisoOrigem === "cargo"
              ? " (do cargo)"
              : linha.pisoOrigem === "funcionario"
                ? " (acordo individual)"
                : ""}
          </p>
          <p className="font-semibold tnum">{formatBRL(linha.piso)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">% efetivo</p>
          <p className="font-semibold tnum">{pctFmt(linha.percentualEfetivo)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Valor devido</p>
          <p className="font-bold tnum text-success">{formatBRL(linha.valorDevido)}</p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Regra aplicada: {linha.regraNome ?? "— nenhuma regra vigente —"}
        {linha.pdvVendedorId ? ` · código PDV ${linha.pdvVendedorId}` : " · sem vínculo com o PDV"}
      </p>
      {linha.divergencias.length > 0 ? (
        <ul className="space-y-0.5">
          {linha.divergencias.map((d, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-warning">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              {d}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Acompanhamento({
  apuracao,
  carregando,
}: {
  apuracao: ResultadoCompetencia | null;
  carregando: boolean;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [loja, setLoja] = useState("");
  const [cargo, setCargo] = useState("");

  const cargos = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of apuracao?.linhas ?? []) if (l.cargoId) m.set(l.cargoId, l.cargoNome ?? l.cargoId);
    return [...m.entries()];
  }, [apuracao]);

  const linhas = useMemo(
    () =>
      (apuracao?.linhas ?? []).filter(
        (l) =>
          (!loja || String(l.lojaId) === loja) && (!cargo || l.cargoId === cargo),
      ),
    [apuracao, loja, cargo],
  );

  if (carregando && !apuracao) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (!apuracao) return null;

  const t = apuracao.totais;
  const proj = apuracao.projecao;
  const pendencias =
    apuracao.divergencias.vendedoresSemCadastro.length +
    apuracao.divergencias.funcionariosSemRegra.length +
    apuracao.divergencias.funcionariosSemPiso.length +
    apuracao.divergencias.gruposSemMeta.length +
    apuracao.divergencias.inativosComVenda.length +
    apuracao.divergencias.funcionariosSemLoja.length +
    (apuracao.divergencias.vendasSemVendedor.qtd > 0 ? 1 : 0);

  return (
    <div className="space-y-4">
      {apuracao.congelado ? (
        <p className="rounded-md bg-success/10 p-3 text-sm text-success">
          {mesLabel(apuracao.competencia)} está fechado — estes números são os congelados no
          fechamento, não um novo cálculo.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Faturamento"
          value={formatBRL(t.faturamento)}
          hint={
            proj
              ? `${proj.diasDecorridos} de ${proj.diasTotais} dias · projeção ${formatBRL(proj.faturamento)}`
              : `${mesLabel(apuracao.competencia)} encerrado`
          }
        />
        {/* Os mesmos três números do dashboard: a folha se divide em piso e
            variável, e é assim que ela é decidida e conferida. */}
        <CardsDaFolha apuracao={apuracao} />
        <StatCard label="Comissão calculada" value={formatBRL(t.comissaoTotal)} hint={`Base ${formatBRL(t.comissaoBase)} + bônus ${formatBRL(t.bonus)}`} />
        <StatCard
          label="Folha projetada"
          value={proj ? formatBRL(proj.valorDevido) : "—"}
          hint={proj ? "se o ritmo do mês se mantiver" : "mês encerrado"}
        />
        <StatCard label="Ajustes" value={formatBRL(t.ajustes)} tone={t.ajustes < 0 ? "destructive" : "default"} />
        <StatCard label="Acima da meta" value={`${t.acimaDaMeta} de ${t.funcionarios}`} tone="success" />
        <StatCard label="Pendências" value={String(pendencias)} tone={pendencias > 0 ? "destructive" : "success"} />
      </div>

      <ComposicaoDaFolha apuracao={apuracao} />

      {pendencias > 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="space-y-1.5 py-3 text-xs">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
              <TriangleAlert className="size-4" /> Confira antes de fechar o mês
            </p>
            {apuracao.divergencias.vendasSemVendedor.qtd > 0 ? (
              <p>
                {apuracao.divergencias.vendasSemVendedor.qtd} venda(s) sem vendedor identificado —{" "}
                {formatBRL(apuracao.divergencias.vendasSemVendedor.valor)} fora de qualquer comissão.
              </p>
            ) : null}
            {apuracao.divergencias.vendedoresSemCadastro.length > 0 ? (
              <p>
                {apuracao.divergencias.vendedoresSemCadastro.length} vendedor(es) do PDV sem cadastro:{" "}
                {apuracao.divergencias.vendedoresSemCadastro
                  .slice(0, 4)
                  .map((v) => `${v.nome ?? v.id} (${formatBRL(v.total)})`)
                  .join(", ")}
                {apuracao.divergencias.vendedoresSemCadastro.length > 4 ? "…" : ""} — importe na aba Funcionários.
              </p>
            ) : null}
            {apuracao.divergencias.funcionariosSemRegra.length > 0 ? (
              <p>Sem regra vigente: {apuracao.divergencias.funcionariosSemRegra.join(", ")}.</p>
            ) : null}
            {apuracao.divergencias.funcionariosSemPiso.length > 0 ? (
              <p>Sem piso cadastrado: {apuracao.divergencias.funcionariosSemPiso.join(", ")}.</p>
            ) : null}
            {apuracao.divergencias.funcionariosSemMeta.length > 0 ? (
              <p>Sem meta: {apuracao.divergencias.funcionariosSemMeta.join(", ")}.</p>
            ) : null}
            {apuracao.divergencias.funcionariosSemLoja.length > 0 ? (
              <p>
                Sem loja: {apuracao.divergencias.funcionariosSemLoja.join(", ")} — ficam fora da
                meta da loja e do grupo de qualquer supervisor.
              </p>
            ) : null}
            {apuracao.divergencias.gruposSemMeta.map((g, i) => (
              <p key={i}>{g}.</p>
            ))}
            {apuracao.divergencias.inativosComVenda.map((v, i) => (
              <p key={i}>
                {v.nome} está inativo mas vendeu {formatBRL(v.total)} — essa venda não gera
                comissão para ninguém.
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Select value={loja} onChange={(e) => setLoja(e.target.value)} className="w-auto min-w-[10rem]">
          <option value="">Todas as lojas</option>
          {apuracao.porLoja.map((l) => (
            <option key={l.lojaId} value={String(l.lojaId)}>
              {l.lojaNome ?? `Loja ${l.lojaId}`}
            </option>
          ))}
        </Select>
        <Select value={cargo} onChange={(e) => setCargo(e.target.value)} className="w-auto min-w-[9rem]">
          <option value="">Todos os cargos</option>
          {cargos.map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </Select>
      </div>

      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum funcionário neste filtro. Cadastre a equipe na aba <strong>Funcionários</strong>.
        </p>
      ) : (
        <div className="space-y-2">
          {linhas.map((l) => {
            const aberto = aberta === l.funcionarioId;
            return (
              <Card key={l.funcionarioId}>
                <CardContent className="py-3">
                  <button
                    className="flex w-full items-start justify-between gap-3 text-left"
                    onClick={() => setAberta(aberto ? null : l.funcionarioId)}
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        {l.funcionarioNome}
                        {l.pisoAplicado ? (
                          <Badge variant="neutral" className="shrink-0">
                            no piso
                          </Badge>
                        ) : null}
                        {l.divergencias.length > 0 ? (
                          <TriangleAlert className="size-3.5 shrink-0 text-warning" />
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {l.cargoNome ?? "sem cargo"} · {l.lojaNome ?? "sem loja"} ·{" "}
                        {formatBRL(l.vendaConsiderada)} vendidos
                      </p>
                      <div className="mt-1">
                        <BarraMeta pct={l.atingimentoPct} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold tnum text-success">{formatBRL(l.valorDevido)}</p>
                      <p className="text-[11px] text-muted-foreground tnum">
                        comissão {formatBRL(l.comissaoTotal)}
                      </p>
                      {l.valorDevidoProjetado != null && l.valorDevidoProjetado !== l.valorDevido ? (
                        <p className="text-[11px] text-muted-foreground tnum">
                          projeção {formatBRL(l.valorDevidoProjetado)}
                        </p>
                      ) : null}
                      <ChevronDown
                        className={`ml-auto mt-0.5 size-4 text-muted-foreground transition-transform ${
                          aberto ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </button>
                  {aberto ? <Memoria linha={l} /> : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {apuracao.porLoja.length > 0 ? (
        <Card>
          <CardContent className="py-4">
            <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">Por loja</h2>
            <div className="divide-y divide-border">
              {apuracao.porLoja.map((l) => (
                <div key={l.lojaId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.lojaNome ?? `Loja ${l.lojaId}`}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBRL(l.faturamento)}
                      {l.meta ? ` · meta ${formatBRL(l.meta)}` : " · sem meta"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tnum">{formatBRL(l.comissao)}</p>
                    <p className="text-[11px] text-muted-foreground tnum">
                      {l.faturamento > 0 ? pctFmt((l.comissao / l.faturamento) * 100) : "—"} do faturamento
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
