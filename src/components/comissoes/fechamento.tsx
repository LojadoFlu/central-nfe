"use client";

// Fechamento da competência (§26, §27) + exportação da folha (§44).
// Fechar congela a apuração de cada pessoa; depois disso, só ajuste — nunca
// reescrita do que já foi pago.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatarData, formatarDataHora } from "@/lib/utils";
import { Check, Download, FileText, Lock, LockOpen, TriangleAlert } from "lucide-react";
import type { Cargo, ResultadoCompetencia, StatusFechamento } from "@/lib/comissoes/tipos";
import { STATUS_LABEL } from "@/lib/comissoes/tipos";
import { alterarStatusFechamento, fecharComissoes } from "@/lib/comissoes/repo";
import { gerarPdfPorLoja } from "@/lib/comissoes/folha-pdf";
import { Aviso, mesLabel, pctFmt } from "./comum";

const FLUXO: StatusFechamento[] = ["aberto", "pre-fechamento", "conferido", "fechado"];

function baixarCSV(nome: string, headers: string[], rows: string[][]) {
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const linhas = [headers.map(esc).join(";"), ...rows.map((r) => r.map(esc).join(";"))];
  const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Números com vírgula, do jeito que o Excel brasileiro espera. */
function br(n: number | null | undefined): string {
  if (n == null) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function Fechamento({
  competencia,
  apuracao,
  cargos,
  podeFechar,
  isAdmin,
  onRecarregar,
}: {
  competencia: string;
  apuracao: ResultadoCompetencia | null;
  cargos: Cargo[];
  podeFechar: boolean;
  isAdmin: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const pendencias = useMemo(() => {
    if (!apuracao) return [];
    const d = apuracao.divergencias;
    const itens: { texto: string; grave: boolean }[] = [];
    if (d.vendasSemVendedor.qtd > 0) {
      itens.push({
        texto: `${d.vendasSemVendedor.qtd} venda(s) sem vendedor — ${formatBRL(d.vendasSemVendedor.valor)} fora de qualquer comissão`,
        grave: true,
      });
    }
    if (d.vendedoresSemCadastro.length > 0) {
      itens.push({
        texto: `${d.vendedoresSemCadastro.length} vendedor(es) do PDV sem cadastro (venderam ${formatBRL(d.vendedoresSemCadastro.reduce((s, v) => s + v.total, 0))})`,
        grave: true,
      });
    }
    if (d.funcionariosSemRegra.length > 0) {
      itens.push({ texto: `Sem regra vigente: ${d.funcionariosSemRegra.join(", ")}`, grave: true });
    }
    if (d.funcionariosSemPiso.length > 0) {
      itens.push({ texto: `Sem piso cadastrado: ${d.funcionariosSemPiso.join(", ")}`, grave: false });
    }
    if (d.funcionariosSemMeta.length > 0) {
      itens.push({ texto: `Sem meta: ${d.funcionariosSemMeta.join(", ")}`, grave: false });
    }
    if (d.funcionariosSemLoja.length > 0) {
      itens.push({
        texto: `Sem loja: ${d.funcionariosSemLoja.join(", ")} — ficam fora da meta da loja`,
        grave: true,
      });
    }
    for (const g of d.gruposSemMeta) itens.push({ texto: g, grave: true });
    for (const v of d.inativosComVenda) {
      itens.push({
        texto: `${v.nome} está inativo mas vendeu ${formatBRL(v.total)} — sem comissão para ninguém`,
        grave: true,
      });
    }
    const ajustes = apuracao.linhas.filter((l) => l.ajustesTotal !== 0).length;
    if (ajustes > 0) {
      itens.push({ texto: `${ajustes} funcionário(s) com ajuste lançado nesta competência`, grave: false });
    }
    return itens;
  }, [apuracao]);

  async function executar(fn: () => Promise<unknown>, mensagem: string) {
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      await fn();
      await onRecarregar();
      setOk(mensagem);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
      setConfirmando(false);
    }
  }

  function exportar() {
    if (!apuracao) return;
    baixarCSV(
      `comissoes-${competencia}`,
      [
        "Funcionário",
        "Cargo",
        "Loja",
        "Código PDV",
        "Venda",
        "Meta",
        "% da meta",
        "Comissão base",
        "Bônus",
        "Ajustes",
        "Comissão total",
        "Piso garantido",
        "Descontos",
        "Valor devido",
        "Regra aplicada",
      ],
      apuracao.linhas.map((l) => [
        l.funcionarioNome,
        l.cargoNome ?? "",
        l.lojaNome ?? "",
        l.pdvVendedorId ?? "",
        br(l.vendaConsiderada),
        br(l.metaConsiderada),
        l.atingimentoPct == null ? "" : br(l.atingimentoPct),
        br(l.comissaoBase),
        br(l.bonusTotal),
        br(l.ajustesTotal),
        br(l.comissaoTotal),
        br(l.piso),
        br(l.descontosTotal ?? 0),
        br(l.valorDevido),
        l.regraNome ?? "",
      ]),
    );
  }

  if (!apuracao) return null;
  const fechado = apuracao.status === "fechado";
  const t = apuracao.totais;

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      <Card className={fechado ? "border-success/40 bg-success/5" : undefined}>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight">
                {fechado ? <Lock className="size-4 text-success" /> : null}
                {mesLabel(competencia)} · {STATUS_LABEL[apuracao.status]}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatarData(apuracao.periodo.de)} a {formatarData(apuracao.periodo.ate)} · folha sai em{" "}
                {formatarData(apuracao.pagamentoEm)}
              </p>
              {fechado && apuracao.fechadoEm ? (
                <p className="text-[11px] text-muted-foreground">
                  Fechado em {formatarDataHora(apuracao.fechadoEm)}
                  {apuracao.fechadoPor ? ` por ${apuracao.fechadoPor}` : ""} · valores congelados
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={exportar}>
                <Download /> CSV
              </Button>
              {/* O que vai para a loja: uma página por loja, piso e o que veio
                  além dele. */}
              <Button size="sm" variant="outline" onClick={() =>
                  void gerarPdfPorLoja(apuracao, {
                    cargosSemGratificacao: new Set(
                      cargos.filter((c) => c.ocultaGratificacaoPdf).map((c) => c.id),
                    ),
                  })
                }>
                <FileText /> PDF por loja
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-3 text-xs sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Faturamento</p>
              <p className="font-semibold tnum">{formatBRL(t.faturamento)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Comissões</p>
              <p className="font-semibold tnum">{formatBRL(t.comissaoTotal)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Piso garantido</p>
              <p className="font-semibold tnum">{formatBRL(t.pisoUtilizado)}</p>
              {t.pisoSemComissao > 0 ? (
                <p className="text-[10px] text-muted-foreground tnum">
                  + {formatBRL(t.pisoSemComissao)} sem comissão
                </p>
              ) : null}
            </div>
            {t.descontos > 0 ? (
              <div>
                <p className="text-muted-foreground">Descontos</p>
                <p className="font-semibold tnum text-destructive">− {formatBRL(t.descontos)}</p>
                <p className="text-[10px] text-muted-foreground">retirada, falta, suspensão</p>
              </div>
            ) : null}
            <div>
              <p className="text-muted-foreground">Folha variável</p>
              <p className="font-bold tnum text-warning">{formatBRL(t.valorDevido)}</p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t.funcionarios} funcionário(s) · {t.acimaDaMeta} acima da meta ·{" "}
            {t.faturamento > 0 ? pctFmt((t.valorDevido / t.faturamento) * 100) : "—"} do faturamento
          </p>
        </CardContent>
      </Card>

      <Card className={pendencias.some((p) => p.grave) ? "border-warning/40" : undefined}>
        <CardContent className="space-y-2 py-4">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Antes de fechar</h2>
          {pendencias.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <Check className="size-4" /> Nenhuma divergência. Pode fechar.
            </p>
          ) : (
            <ul className="space-y-1">
              {pendencias.map((p, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <TriangleAlert
                    className={`mt-0.5 size-3.5 shrink-0 ${p.grave ? "text-destructive" : "text-warning"}`}
                  />
                  <span className={p.grave ? "" : "text-muted-foreground"}>{p.texto}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {podeFechar ? (
        <Card>
          <CardContent className="space-y-3 py-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Status</h2>
            <div className="flex flex-wrap gap-2">
              {FLUXO.filter((s) => s !== "fechado").map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={apuracao.status === s ? "default" : "outline"}
                  disabled={ocupado || fechado}
                  onClick={() =>
                    executar(
                      () => alterarStatusFechamento(competencia, s),
                      `Status alterado para ${STATUS_LABEL[s]}.`,
                    )
                  }
                >
                  {STATUS_LABEL[s]}
                </Button>
              ))}
            </div>

            {fechado ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Competência fechada. Ajustes desta competência ficam bloqueados — o caminho normal
                  para uma correção é lançar o ajuste no mês seguinte.
                </p>
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocupado}
                    onClick={() =>
                      executar(
                        () => alterarStatusFechamento(competencia, "reaberto"),
                        "Competência reaberta. O histórico do fechamento anterior foi preservado.",
                      )
                    }
                  >
                    <LockOpen /> Reabrir competência
                  </Button>
                ) : (
                  <Badge variant="neutral">Só o administrador pode reabrir</Badge>
                )}
              </div>
            ) : confirmando ? (
              <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                <p className="text-sm font-medium">
                  Fechar {mesLabel(competencia)} com {formatBRL(t.valorDevido)} de folha variável?
                </p>
                <p className="text-xs text-muted-foreground">
                  A apuração de cada pessoa será congelada — inclusive a memória de cálculo. Depois
                  disso, alteração só por ajuste.
                  {pendencias.some((p) => p.grave)
                    ? " Ainda há divergências graves na lista acima."
                    : ""}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={ocupado}
                    onClick={() =>
                      executar(async () => {
                        const r = await fecharComissoes(competencia);
                        if (r.estornos > 0) {
                          setOk(`Fechado. ${r.estornos} estorno(s) de meses anteriores entraram na conta.`);
                        }
                      }, `${mesLabel(competencia)} fechado.`)
                    }
                  >
                    <Lock /> Confirmar fechamento
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)} disabled={ocupado}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" disabled={ocupado} onClick={() => setConfirmando(true)}>
                <Lock /> Fechar comissões do mês
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
