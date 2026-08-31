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
  const [porLoja, setPorLoja] = useState<Record<number, (number | null)[]>>({});
  const [porFuncionario, setPorFuncionario] = useState<Record<string, number | null>>({});
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

  const ativos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  /** Quem divide a meta da loja: vende no PDV e não acompanha lojas. */
  const vendedoresPorLoja = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of funcionarios) {
      if (!f.ativo || f.semPdv === true || (f.lojasGrupo ?? []).length) continue;
      if (f.lojaId == null) continue;
      m.set(f.lojaId, (m.get(f.lojaId) ?? 0) + 1);
    }
    return m;
  }, [funcionarios]);
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
            A meta do mês é a soma das semanas. Ela vale para o gerente e o supervisor, e é
            dividida <strong>igualmente entre os vendedores da loja</strong> — quem tiver meta
            própria cadastrada abaixo usa a dela.
          </p>
          <div className="space-y-3">
            {lojas.map((l) => {
              const semanas = porLoja[l.id] ?? [null, null, null, null, null, null];
              const total = somaSemanas(semanas);
              const qtd = vendedoresPorLoja.get(l.id) ?? 0;
              const porVendedor = qtd > 0 && total > 0 ? total / qtd : null;
              return (
                <div key={l.id} className="rounded-md border border-border/60 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{l.grupoNome || l.nome}</span>
                    <span className="text-xs text-muted-foreground tnum">
                      mês {formatBRL(total)}
                      {porVendedor != null
                        ? ` · ${formatBRL(porVendedor)} para cada um dos ${qtd} vendedores`
                        : qtd === 0
                          ? " · sem vendedor cadastrado"
                          : ""}
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
                          disabled={!podeGerir}
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
