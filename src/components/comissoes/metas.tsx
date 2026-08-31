"use client";

// Metas da competência: por loja e por funcionário (§9, §10).
// A meta individual tem prioridade sobre a do cargo, que tem sobre a da loja.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/utils";
import { Copy, Save } from "lucide-react";
import type { Cargo, Funcionario, Meta, ResultadoCompetencia } from "@/lib/comissoes/tipos";
import type { StorePdv } from "@/lib/nfe/repo";
import {
  listarMetas,
  listarParticipacoes,
  salvarMetas,
  salvarParticipacoes,
} from "@/lib/comissoes/repo";
import { Aviso, InputNumero, mesLabel } from "./comum";
import { ImportarMetas } from "./importar-metas";

const SEMANAS = [0, 1, 2, 3, 4, 5];

function somaSemanas(sem: (number | null)[] | undefined): number {
  return Math.round((sem ?? []).reduce<number>((s, v) => s + (v ?? 0), 0) * 100) / 100;
}

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
  cargos,
  apuracao,
  lojas,
  podeGerir,
  onRecarregar,
}: {
  competencia: string;
  metas: Meta[];
  funcionarios: Funcionario[];
  cargos: Cargo[];
  apuracao: ResultadoCompetencia | null;
  lojas: StorePdv[];
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [porLoja, setPorLoja] = useState<Record<number, (number | null)[]>>({});
  const [porFuncionario, setPorFuncionario] = useState<Record<string, number | null>>({});
  const [participacao, setParticipacao] = useState<Record<string, boolean[]>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Recarrega os campos sempre que a competência (ou as metas) mudam.
  useEffect(() => {
    const l: Record<number, (number | null)[]> = {};
    const f: Record<string, number | null> = {};
    for (const m of metas) {
      if (m.funcionarioId) {
        f[m.funcionarioId] = m.valor;
      } else if (m.lojaId != null && !m.cargoId) {
        // Meta antiga (sem semanas) entra na semana 1: o total do mês não muda
        // e dá para redistribuir depois.
        const base = m.semanas?.length ? m.semanas : [m.valor, null, null, null, null, null];
        l[m.lojaId] = [0, 1, 2, 3, 4, 5].map((i) => base[i] ?? null);
      }
    }
    setPorLoja(l);
    setPorFuncionario(f);
  }, [metas, competencia]);

  // Quem entra na meta em cada semana (férias, afastamento, entrada no meio
  // do mês). Sem registro, entra em todas.
  useEffect(() => {
    let vivo = true;
    void listarParticipacoes(competencia).then((lista) => {
      if (!vivo) return;
      const m: Record<string, boolean[]> = {};
      for (const p of lista) {
        m[p.funcionarioId] = [0, 1, 2, 3, 4, 5].map((i) => p.semanas?.[i] !== false);
      }
      setParticipacao(m);
    });
    return () => {
      vivo = false;
    };
  }, [competencia]);

  const semanasDe = (id: string) => participacao[id] ?? [true, true, true, true, true, true];

  const ativos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  /** Quem divide a meta da loja: cargo marcado como "recebe meta individual". */
  const comMetaIndividual = useMemo(() => {
    const ids = new Set(cargos.filter((c) => c.recebeMetaIndividual).map((c) => c.id));
    return funcionarios.filter((f) => f.ativo && f.cargoId && ids.has(f.cargoId) && f.lojaId != null);
  }, [funcionarios, cargos]);

  /**
   * Meta da loja quando as metas vieram do import: é a SOMA das metas dos
   * vendedores dela. Aí não há o que digitar aqui — digitar seria criar um
   * segundo número para a mesma coisa.
   */
  const somaImportadaPorLoja = useMemo(() => {
    const porFuncionario = new Map(metas.filter((m) => m.funcionarioId).map((m) => [m.funcionarioId!, m]));
    const m = new Map<number, { total: number; semanas: (number | null)[]; pessoas: number }>();
    for (const f of funcionarios) {
      if (!f.ativo || f.lojaId == null) continue;
      const meta = porFuncionario.get(f.id);
      if (!meta) continue;
      const atual = m.get(f.lojaId) ?? { total: 0, semanas: [null, null, null, null, null, null], pessoas: 0 };
      atual.total += meta.valor;
      atual.pessoas += 1;
      SEMANAS.forEach((i) => {
        const v = meta.semanas?.[i];
        if (v != null) atual.semanas[i] = (atual.semanas[i] ?? 0) + v;
      });
      m.set(f.lojaId, atual);
    }
    return m;
  }, [metas, funcionarios]);

  /** Por loja e por semana: quantos dividem a meta daquela semana. */
  const participantesPorLojaSemana = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const f of comMetaIndividual) {
      const sem = semanasDe(f.id);
      const atual = m.get(f.lojaId!) ?? [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) if (sem[i]) atual[i] += 1;
      m.set(f.lojaId!, atual);
    }
    return m;
  }, [comMetaIndividual, participacao]);
  const totalLojas = useMemo(
    () => Object.values(porLoja).reduce<number>((s, sem) => s + somaSemanas(sem), 0),
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
    for (const [lojaId, semanas] of Object.entries(porLoja)) {
      const valor = somaSemanas(semanas);
      if (valor <= 0) continue;
      lote.push({ competencia, lojaId: Number(lojaId), valor, semanas });
    }
    for (const [funcionarioId, valor] of Object.entries(porFuncionario)) {
      if (valor == null || valor <= 0) continue;
      lote.push({ competencia, funcionarioId, valor });
    }
    if (lote.length === 0) throw new Error("Nada para salvar — preencha ao menos uma meta.");
    await salvarMetas(lote);
    const itens = comMetaIndividual.map((f) => ({ funcionarioId: f.id, semanas: semanasDe(f.id) }));
    if (itens.length > 0) await salvarParticipacoes(competencia, itens);
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

      {podeGerir ? <ImportarMetas lojas={lojas} onImportado={onRecarregar} /> : null}

      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Meta por loja</h2>
            <span className="text-xs text-muted-foreground tnum">soma {formatBRL(totalLojas)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A meta do mês é a soma das semanas. Ela vale para o gerente e o supervisor, e é
            dividida <strong>igualmente entre os vendedores da loja</strong> — quem tiver meta
            própria cadastrada abaixo usa a dela.
          </p>
          <div className="space-y-3">
            {lojas.map((l) => {
              const importada = somaImportadaPorLoja.get(l.id);
              const semanas = importada ? importada.semanas : porLoja[l.id] ?? [null, null, null, null, null, null];
              const total = importada ? Math.round(importada.total * 100) / 100 : somaSemanas(semanas);
              const participantes = participantesPorLojaSemana.get(l.id) ?? [0, 0, 0, 0, 0, 0];
              const daLoja = comMetaIndividual.filter((f) => f.lojaId === l.id);
              // Rateio semana a semana: quem está de férias numa semana não
              // divide a daquela semana, e os que ficam dividem entre menos.
              const fatiaCheia = SEMANAS.reduce(
                (acc, i) =>
                  acc + (semanas[i] && participantes[i] > 0 ? semanas[i]! / participantes[i] : 0),
                0,
              );
              return (
                <div key={l.id} className="rounded-md border border-border/60 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{l.grupoNome || l.nome}</span>
                    <span className="text-xs text-muted-foreground tnum">
                      mês {formatBRL(total)}
                      {importada
                        ? ` · soma das metas de ${importada.pessoas} vendedor(es), importada`
                        : ""}
                      {daLoja.length === 0
                        ? " · nenhum cargo com meta individual nesta loja"
                        : ` · ${formatBRL(fatiaCheia)} para quem trabalha o mês inteiro (${daLoja.length} pessoa(s))`}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                    {SEMANAS.map((i) => (
                      <div key={i}>
                        <label className="block text-[10px] text-muted-foreground">
                          Semana {i + 1}
                        </label>
                        <InputNumero
                          className="h-9"
                          placeholder="—"
                          disabled={!podeGerir || !!importada}
                          value={semanas[i] ?? null}
                          onChange={(n) =>
                            setPorLoja((atual) => {
                              const base =
                                atual[l.id] ?? [null, null, null, null, null, null];
                              const novo = [...base];
                              novo[i] = n;
                              return { ...atual, [l.id]: novo };
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>

                  {daLoja.length > 0 ? (
                    <div className="mt-2 border-t border-border/60 pt-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Quem entra na meta em cada semana
                      </p>
                      <div className="space-y-1">
                        {daLoja.map((f) => {
                          const sem = semanasDe(f.id);
                          const minha = SEMANAS.reduce(
                            (acc, i) =>
                              acc +
                              (sem[i] && semanas[i] && participantes[i] > 0
                                ? semanas[i]! / participantes[i]
                                : 0),
                            0,
                          );
                          return (
                            <div key={f.id} className="flex items-center gap-2 text-xs">
                              <span className="min-w-0 flex-1 truncate">{f.nome}</span>
                              <div className="flex shrink-0 gap-1">
                                {SEMANAS.map((i) => (
                                  <label
                                    key={i}
                                    className="flex w-7 flex-col items-center text-[9px] text-muted-foreground"
                                    title={`Semana ${i + 1}`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="size-3.5"
                                      disabled={!podeGerir}
                                      checked={sem[i]}
                                      onChange={(e) =>
                                        setParticipacao((atual) => {
                                          const base = atual[f.id] ?? [
                                            true, true, true, true, true, true,
                                          ];
                                          const novo = [...base];
                                          novo[i] = e.target.checked;
                                          return { ...atual, [f.id]: novo };
                                        })
                                      }
                                    />
                                    S{i + 1}
                                  </label>
                                ))}
                              </div>
                              <span className="w-24 shrink-0 text-right tnum">
                                {formatBRL(minha)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Desmarque a semana em que a pessoa não trabalha (férias, afastamento). A
                        meta daquela semana se divide entre quem ficou.
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
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
