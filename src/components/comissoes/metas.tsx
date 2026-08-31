"use client";

// Metas da competência: por loja e por funcionário (§9, §10).
// A meta individual tem prioridade sobre a do cargo, que tem sobre a da loja.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/utils";
import { Copy, Save } from "lucide-react";
import type { Funcionario, Meta, ResultadoCompetencia } from "@/lib/comissoes/tipos";
import type { StorePdv } from "@/lib/nfe/repo";
import { listarMetas, salvarMetas } from "@/lib/comissoes/repo";
import { Aviso, InputNumero, mesLabel } from "./comum";

/** Competência anterior a "YYYY-MM". */
function mesAnterior(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function Metas({
  competencia,
  metas,
  funcionarios,
  apuracao,
  lojas,
  podeGerir,
  onRecarregar,
}: {
  competencia: string;
  metas: Meta[];
  funcionarios: Funcionario[];
  apuracao: ResultadoCompetencia | null;
  lojas: StorePdv[];
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [porLoja, setPorLoja] = useState<Record<number, number | null>>({});
  const [porFuncionario, setPorFuncionario] = useState<Record<string, number | null>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Recarrega os campos sempre que a competência (ou as metas) mudam.
  useEffect(() => {
    const l: Record<number, number | null> = {};
    const f: Record<string, number | null> = {};
    for (const m of metas) {
      if (m.funcionarioId) f[m.funcionarioId] = m.valor;
      else if (m.lojaId != null && !m.cargoId) l[m.lojaId] = m.valor;
    }
    setPorLoja(l);
    setPorFuncionario(f);
  }, [metas, competencia]);

  const ativos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  const totalLojas = useMemo(
    () => Object.values(porLoja).reduce<number>((s, v) => s + (v ?? 0), 0),
    [porLoja],
  );

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
    }
  }

  async function salvarTudo() {
    const lote: Partial<Meta>[] = [];
    for (const [lojaId, valor] of Object.entries(porLoja)) {
      if (valor == null || valor <= 0) continue;
      lote.push({ competencia, lojaId: Number(lojaId), valor });
    }
    for (const [funcionarioId, valor] of Object.entries(porFuncionario)) {
      if (valor == null || valor <= 0) continue;
      lote.push({ competencia, funcionarioId, valor });
    }
    if (lote.length === 0) throw new Error("Nada para salvar — preencha ao menos uma meta.");
    await salvarMetas(lote);
  }

  async function copiarDoMesAnterior() {
    const anterior = mesAnterior(competencia);
    const antigas = await listarMetas(anterior);
    if (antigas.length === 0) throw new Error(`Nenhuma meta em ${mesLabel(anterior)} para copiar.`);
    await salvarMetas(
      antigas.map((m) => ({
        competencia,
        funcionarioId: m.funcionarioId ?? null,
        cargoId: m.cargoId ?? null,
        lojaId: m.lojaId ?? null,
        valor: m.valor,
      })),
    );
  }

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      {podeGerir ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={ocupado} onClick={() => executar(salvarTudo, "Metas salvas.")}>
            <Save /> Salvar metas de {mesLabel(competencia)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              executar(copiarDoMesAnterior, `Metas de ${mesLabel(mesAnterior(competencia))} copiadas.`)
            }
          >
            <Copy /> Copiar do mês anterior
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Meta por loja</h2>
            <span className="text-xs text-muted-foreground tnum">soma {formatBRL(totalLojas)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Vale para o bônus da loja e para a comissão de gerente/supervisor.
          </p>
          <div className="space-y-1.5">
            {lojas.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{l.grupoNome || l.nome}</span>
                <InputNumero
                  className="h-9 w-40"
                  placeholder="0,00"
                  disabled={!podeGerir}
                  value={porLoja[l.id] ?? null}
                  onChange={(n) => setPorLoja({ ...porLoja, [l.id]: n })}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 py-4">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Meta que vale para cada um</h2>
          <p className="text-[11px] text-muted-foreground">
            Não é campo — é o que o cálculo está usando hoje. Vendedor é medido pela venda própria,
            gerente pela loja dele, supervisor pela soma das lojas que supervisiona.
          </p>
          {apuracao && apuracao.linhas.length > 0 ? (
            <div className="divide-y divide-border">
              {apuracao.linhas.map((l) => (
                <div key={l.funcionarioId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{l.funcionarioNome}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {l.cargoNome ?? "sem cargo"} ·{" "}
                      {l.escopoMeta === "grupo"
                        ? "meta = soma das lojas que supervisiona"
                        : l.escopoMeta === "loja"
                          ? `meta = a da loja ${l.lojaNome ?? ""}`.trim()
                          : "meta individual"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold tnum ${
                      l.metaConsiderada == null ? "text-destructive" : ""
                    }`}
                  >
                    {l.metaConsiderada == null ? "sem meta" : formatBRL(l.metaConsiderada)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Cadastre funcionários e regras para ver a meta de cada um.
            </p>
          )}
          {apuracao?.divergencias.gruposSemMeta.length ? (
            <div className="rounded-md bg-warning/10 p-2.5 text-[11px] text-warning">
              {apuracao.divergencias.gruposSemMeta.map((g, i) => (
                <p key={i}>{g}</p>
              ))}
              <p className="mt-1 text-muted-foreground">
                Enquanto faltar a meta de uma das lojas, o supervisor fica sem meta — somar só as
                que existem daria um alvo menor que o real e um atingimento inflado.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 py-4">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Meta individual (exceção)</h2>
          <p className="text-[11px] text-muted-foreground">
            Só para quem tem meta própria negociada. Em branco, vale a meta da loja (ou a soma das
            lojas, no caso do supervisor).
          </p>
          <div className="space-y-1.5">
            {ativos.map((f) => (
              <div key={f.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{f.nome}</span>
                <InputNumero
                  className="h-9 w-40"
                  placeholder="—"
                  disabled={!podeGerir}
                  value={porFuncionario[f.id] ?? null}
                  onChange={(n) => setPorFuncionario({ ...porFuncionario, [f.id]: n })}
                />
              </div>
            ))}
            {ativos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Cadastre funcionários primeiro.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
