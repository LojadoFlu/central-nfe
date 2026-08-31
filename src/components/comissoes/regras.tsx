"use client";

// Regras de comissão — faixas, modelo de cálculo, escopo e vigência (§7, §8, §35, §36).
// Nenhum percentual mora no código: tudo o que se vê aqui vira documento no banco.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/utils";
import type { Cargo, Componente, Funcionario, Regra } from "@/lib/comissoes/tipos";
import type { StorePdv } from "@/lib/nfe/repo";
import { excluirRegra, salvarRegra } from "@/lib/comissoes/repo";
import { Aviso, Campo, InputNumero, Select, competenciaAtual, mesLabel, pctFmt } from "./comum";

function componenteNovo(i: number): Componente {
  return {
    id: `c${i}`,
    rotulo: i === 1 ? "Venda própria" : `Componente ${i}`,
    escopoVenda: "individual",
    baseCalculo: "liquida",
    baseFaixa: "valor",
    modelo: "integral",
    faixas: [{ de: 0, percentual: 0, rotulo: null }],
    condicao: null,
  };
}

function regraNova(): Regra {
  return {
    id: "",
    nome: "",
    ativo: true,
    funcionarioId: null,
    cargoId: null,
    lojaId: null,
    componentes: [componenteNovo(1)],
    vigenciaDe: competenciaAtual(),
    vigenciaAte: null,
  };
}

function resumoEscopo(
  r: Regra,
  nomeCargo: Map<string, string>,
  nomeLoja: Map<number, string>,
  nomeFunc: Map<string, string>,
): string {
  const partes: string[] = [];
  if (r.funcionarioId) partes.push(nomeFunc.get(r.funcionarioId) ?? "funcionário");
  if (r.cargoId) partes.push(nomeCargo.get(r.cargoId) ?? "cargo");
  if (r.lojaId != null) partes.push(nomeLoja.get(r.lojaId) ?? `loja ${r.lojaId}`);
  return partes.length ? partes.join(" · ") : "Todos (regra geral)";
}

export function Regras({
  regras,
  cargos,
  funcionarios,
  lojas,
  podeGerir,
  onRecarregar,
}: {
  regras: Regra[];
  cargos: Cargo[];
  funcionarios: Funcionario[];
  lojas: StorePdv[];
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [edicao, setEdicao] = useState<Regra | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const nomeCargo = useMemo(() => new Map(cargos.map((c) => [c.id, c.nome])), [cargos]);
  const nomeLoja = useMemo(
    () => new Map(lojas.map((l) => [l.id, l.grupoNome || l.nome || `Loja ${l.id}`])),
    [lojas],
  );
  const nomeFunc = useMemo(() => new Map(funcionarios.map((f) => [f.id, f.nome])), [funcionarios]);

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

  function alterarComponente(idx: number, patch: Partial<Componente>) {
    if (!edicao) return;
    const componentes = edicao.componentes.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setEdicao({ ...edicao, componentes });
  }

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      {podeGerir ? (
        <Button size="sm" onClick={() => setEdicao(regraNova())} disabled={ocupado}>
          <Plus /> Nova regra
        </Button>
      ) : null}

      {edicao ? (
        <Card className="border-primary/40">
          <CardContent className="space-y-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Nome da regra">
                <Input
                  value={edicao.nome}
                  placeholder="Ex.: Vendedor padrão 2026"
                  onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })}
                />
              </Campo>
              <Campo label="Situação">
                <Select
                  value={edicao.ativo ? "1" : "0"}
                  onChange={(e) => setEdicao({ ...edicao, ativo: e.target.value === "1" })}
                >
                  <option value="1">Ativa</option>
                  <option value="0">Inativa</option>
                </Select>
              </Campo>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Cargo" hint="Vazio = qualquer cargo">
                <Select
                  value={edicao.cargoId ?? ""}
                  onChange={(e) => setEdicao({ ...edicao, cargoId: e.target.value || null })}
                >
                  <option value="">Todos</option>
                  {cargos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo label="Loja" hint="Vazio = todas as lojas">
                <Select
                  value={edicao.lojaId == null ? "" : String(edicao.lojaId)}
                  onChange={(e) =>
                    setEdicao({ ...edicao, lojaId: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">Todas</option>
                  {lojas.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.grupoNome || l.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo label="Funcionário" hint="Preencha só para um acordo individual">
                <Select
                  value={edicao.funcionarioId ?? ""}
                  onChange={(e) => setEdicao({ ...edicao, funcionarioId: e.target.value || null })}
                >
                  <option value="">— nenhum —</option>
                  {funcionarios.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Vigente a partir de" hint="Meses anteriores continuam com a regra antiga.">
                <Input
                  type="month"
                  value={edicao.vigenciaDe}
                  onChange={(e) => setEdicao({ ...edicao, vigenciaDe: e.target.value })}
                />
              </Campo>
              <Campo label="Vigente até" hint="Vazio = em aberto">
                <Input
                  type="month"
                  value={edicao.vigenciaAte ?? ""}
                  onChange={(e) => setEdicao({ ...edicao, vigenciaAte: e.target.value || null })}
                />
              </Campo>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[0.95rem] font-semibold tracking-tight">Componentes do cálculo</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEdicao({
                      ...edicao,
                      componentes: [...edicao.componentes, componenteNovo(edicao.componentes.length + 1)],
                    })
                  }
                >
                  <Plus /> Componente
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Um vendedor costuma ter só o primeiro (venda própria). Um gerente pode ter dois: a
                venda dele e um percentual sobre a loja quando ela bate a meta.
              </p>

              {edicao.componentes.map((c, idx) => (
                <Card key={idx} className="bg-muted/30">
                  <CardContent className="space-y-3 py-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={c.rotulo}
                        onChange={(e) => alterarComponente(idx, { rotulo: e.target.value })}
                        className="h-9"
                      />
                      {edicao.componentes.length > 1 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEdicao({
                              ...edicao,
                              componentes: edicao.componentes.filter((_, i) => i !== idx),
                            })
                          }
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      ) : null}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-4">
                      <Campo label="Incide sobre">
                        <Select
                          value={c.escopoVenda}
                          onChange={(e) =>
                            alterarComponente(idx, {
                              escopoVenda: e.target.value as Componente["escopoVenda"],
                            })
                          }
                        >
                          <option value="individual">Venda própria</option>
                          <option value="loja">Venda da loja</option>
                          <option value="grupo">Grupo de lojas</option>
                        </Select>
                      </Campo>
                      <Campo label="Base">
                        <Select
                          value={c.baseCalculo}
                          onChange={(e) =>
                            alterarComponente(idx, {
                              baseCalculo: e.target.value as Componente["baseCalculo"],
                            })
                          }
                        >
                          <option value="liquida">Venda líquida</option>
                          <option value="bruta">Venda bruta</option>
                        </Select>
                      </Campo>
                      <Campo label="Faixas medidas em">
                        <Select
                          value={c.baseFaixa}
                          onChange={(e) =>
                            alterarComponente(idx, {
                              baseFaixa: e.target.value as Componente["baseFaixa"],
                            })
                          }
                        >
                          <option value="valor">R$ vendidos</option>
                          <option value="percentualMeta">% da meta</option>
                        </Select>
                      </Campo>
                      <Campo label="Modelo">
                        <Select
                          value={c.modelo}
                          onChange={(e) =>
                            alterarComponente(idx, { modelo: e.target.value as Componente["modelo"] })
                          }
                        >
                          <option value="integral">Integral</option>
                          <option value="progressivo">Progressivo</option>
                        </Select>
                      </Campo>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {c.modelo === "integral"
                        ? "Integral: a faixa atingida vale para tudo o que foi vendido no mês."
                        : "Progressivo: cada fatia da venda usa o percentual da sua própria faixa."}
                    </p>

                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        Faixas ({c.baseFaixa === "percentualMeta" ? "% da meta" : "R$"} → % de comissão)
                      </p>
                      {c.faixas.map((f, fi) => (
                        <div key={fi} className="flex items-center gap-2">
                          <InputNumero
                            className="h-9"
                            placeholder="a partir de"
                            value={f.de}
                            onChange={(n) =>
                              alterarComponente(idx, {
                                faixas: c.faixas.map((x, i) => (i === fi ? { ...x, de: n ?? 0 } : x)),
                              })
                            }
                          />
                          <InputNumero
                            className="h-9"
                            placeholder="%"
                            value={f.percentual}
                            onChange={(n) =>
                              alterarComponente(idx, {
                                faixas: c.faixas.map((x, i) =>
                                  i === fi ? { ...x, percentual: n ?? 0 } : x,
                                ),
                              })
                            }
                          />
                          <Input
                            className="h-9"
                            placeholder="rótulo (Meta…)"
                            value={f.rotulo ?? ""}
                            onChange={(e) =>
                              alterarComponente(idx, {
                                faixas: c.faixas.map((x, i) =>
                                  i === fi ? { ...x, rotulo: e.target.value || null } : x,
                                ),
                              })
                            }
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={c.faixas.length === 1}
                            onClick={() =>
                              alterarComponente(idx, { faixas: c.faixas.filter((_, i) => i !== fi) })
                            }
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          alterarComponente(idx, {
                            faixas: [...c.faixas, { de: 0, percentual: 0, rotulo: null }],
                          })
                        }
                      >
                        <Plus /> Faixa
                      </Button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Campo label="Só paga se" hint="Deixe em “sem condição” para pagar sempre.">
                        <Select
                          value={c.condicao?.tipo ?? ""}
                          onChange={(e) =>
                            alterarComponente(idx, {
                              condicao: e.target.value
                                ? {
                                    tipo: e.target.value as NonNullable<Componente["condicao"]>["tipo"],
                                    minimoPct: c.condicao?.minimoPct ?? 100,
                                  }
                                : null,
                            })
                          }
                        >
                          <option value="">Sem condição</option>
                          <option value="atingimentoIndividual">Bateu a meta individual</option>
                          <option value="atingimentoLoja">A loja bateu a meta</option>
                          <option value="atingimentoGrupo">O grupo bateu a meta</option>
                        </Select>
                      </Campo>
                      {c.condicao ? (
                        <Campo label="Atingimento mínimo (%)">
                          <InputNumero
                            value={c.condicao.minimoPct}
                            onChange={(n) =>
                              alterarComponente(idx, {
                                condicao: { ...c.condicao!, minimoPct: n ?? 0 },
                              })
                            }
                          />
                        </Campo>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={ocupado || !edicao.nome.trim()}
                onClick={() =>
                  executar(async () => {
                    await salvarRegra(edicao);
                    setEdicao(null);
                  }, "Regra salva.")
                }
              >
                Salvar regra
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdicao(null)} disabled={ocupado}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        {regras.map((r) => (
          <Card key={r.id}>
            <CardContent className="py-3">
              <button
                className="w-full text-left"
                onClick={() => (podeGerir ? setEdicao({ ...regraNova(), ...r }) : undefined)}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  {r.nome}
                  {!r.ativo ? <Badge variant="neutral">inativa</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {resumoEscopo(r, nomeCargo, nomeLoja, nomeFunc)} · vigente de {mesLabel(r.vigenciaDe)}
                  {r.vigenciaAte ? ` a ${mesLabel(r.vigenciaAte)}` : " em diante"}
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {r.componentes.map((c) => (
                    <p key={c.id} className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{c.rotulo}</span> ·{" "}
                      {c.escopoVenda === "individual"
                        ? "venda própria"
                        : c.escopoVenda === "loja"
                          ? "venda da loja"
                          : "grupo de lojas"}{" "}
                      · {c.modelo === "integral" ? "integral" : "progressivo"} ·{" "}
                      {c.faixas
                        .map(
                          (f) =>
                            `${c.baseFaixa === "percentualMeta" ? pctFmt(f.de) : formatBRL(f.de)} → ${pctFmt(f.percentual)}`,
                        )
                        .join("  ")}
                      {c.condicao ? ` · só com ${pctFmt(c.condicao.minimoPct)} da meta` : ""}
                    </p>
                  ))}
                </div>
              </button>
              {podeGerir ? (
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => executar(() => excluirRegra(r.id), "Regra excluída.")}
                  >
                    <Trash2 className="text-destructive" /> Excluir
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {regras.length === 0 ? (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="space-y-2 py-4 text-xs">
              <p className="text-sm font-semibold text-warning">Nenhuma regra cadastrada</p>
              <p>
                Sem regra, a comissão base de todo mundo é zero. É aqui que entram{" "}
                <strong>meta e supermeta</strong>: como faixas de um mesmo componente.
              </p>
              <p className="text-muted-foreground">
                Numa faixa, só a atingida vale — quem faz 125% da meta recebe o percentual da
                supermeta sobre a venda, e nada mais. Bônus é outra coisa: ele{" "}
                <strong>soma</strong> ao que já existe. Dois bônus (um de meta e um de supermeta)
                pagam os dois juntos quando a pessoa passa dos 125%.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
