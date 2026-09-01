"use client";

// Bônus configuráveis (§14). Gatilho + prêmio + escopo + vigência.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { Bonus as BonusTipo, Cargo, Funcionario, Indicador } from "@/lib/comissoes/tipos";
import type { StorePdv } from "@/lib/nfe/repo";
import { excluirBonus, salvarBonus } from "@/lib/comissoes/repo";
import { Aviso, Campo, InputNumero, Select, competenciaAtual, mesLabel, pctFmt } from "./comum";

const GATILHOS: { valor: BonusTipo["gatilho"]["tipo"]; label: string; usaMinimo: boolean }[] = [
  { valor: "atingimentoIndividual", label: "Bateu a meta individual", usaMinimo: true },
  { valor: "atingimentoLoja", label: "A loja bateu a meta", usaMinimo: true },
  { valor: "atingimentoGrupo", label: "O grupo de lojas bateu a meta", usaMinimo: true },
  { valor: "melhorVendedorLoja", label: "Melhor vendedor da loja", usaMinimo: false },
  { valor: "indicador", label: "Bateu uma meta secundária (PA, VA…)", usaMinimo: false },
  { valor: "sempre", label: "Sempre (sem condição)", usaMinimo: false },
];

const CONDICOES: { valor: NonNullable<BonusTipo["condicao"]>["tipo"]; label: string }[] = [
  { valor: "atingimentoIndividual", label: "a meta individual" },
  { valor: "atingimentoLoja", label: "a meta da loja" },
  { valor: "atingimentoGrupo", label: "a meta do grupo" },
];

function bonusNovo(): BonusTipo {
  return {
    id: "",
    nome: "",
    ativo: true,
    funcionarioId: null,
    cargoId: null,
    lojaId: null,
    gatilho: { tipo: "atingimentoIndividual", minimoPct: 100 },
    premio: { tipo: "percentual", valor: 0, escopoVenda: "individual", baseCalculo: "liquida" },
    vigenciaDe: competenciaAtual(),
    vigenciaAte: null,
  };
}

export function Bonus({
  bonus,
  cargos,
  funcionarios,
  indicadores,
  lojas,
  podeGerir,
  onRecarregar,
}: {
  bonus: BonusTipo[];
  cargos: Cargo[];
  funcionarios: Funcionario[];
  indicadores: Indicador[];
  lojas: StorePdv[];
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [edicao, setEdicao] = useState<BonusTipo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const nomeCargo = useMemo(() => new Map(cargos.map((c) => [c.id, c.nome])), [cargos]);
  const nomeLoja = useMemo(
    () => new Map(lojas.map((l) => [l.id, l.grupoNome || l.nome || `Loja ${l.id}`])),
    [lojas],
  );
  const gatilhoAtual = GATILHOS.find((g) => g.valor === edicao?.gatilho.tipo);
  const nomeIndicador = useMemo(
    () => new Map(indicadores.map((i) => [i.id, i.nome])),
    [indicadores],
  );

  /**
   * Cadastros que quase certamente são engano. O mais traiçoeiro: meta e
   * supermeta do mesmo cargo apontando para escopos diferentes (uma no grupo,
   * outra na venda própria). Aí elas não formam escada nem se substituem — cada
   * uma vive por conta, e a conta sai errada sem nenhum erro na tela.
   */
  const problemas = useMemo(() => {
    const avisos: string[] = [];
    const porCargo = new Map<string, Set<string>>();
    for (const b of bonus) {
      if (!b.ativo) continue;
      if (b.premio.tipo === "percentual" && !b.premio.valor) {
        avisos.push(`"${b.nome}" está com percentual zerado — não paga nada.`);
      }
      if (!b.gatilho.tipo.startsWith("atingimento")) continue;
      const chave = b.cargoId ? (nomeCargo.get(b.cargoId) ?? b.cargoId) : "todos os cargos";
      const atual = porCargo.get(chave) ?? new Set<string>();
      atual.add(b.gatilho.tipo);
      porCargo.set(chave, atual);
    }
    for (const [cargo, tipos] of porCargo) {
      if (tipos.size < 2) continue;
      const nomes = [...tipos].map((t) =>
        t === "atingimentoIndividual" ? "meta individual" : t === "atingimentoLoja" ? "meta da loja" : "meta do grupo",
      );
      avisos.push(
        `Em ${cargo} há bônus medindo coisas diferentes (${nomes.join(" e ")}). Degraus da mesma escada precisam do MESMO gatilho — senão não se substituem e podem pagar juntos.`,
      );
    }
    return avisos;
  }, [bonus, nomeCargo]);

  /**
   * Escada de meta/supermeta: bônus de atingimento no mesmo escopo não
   * acumulam — paga só o degrau mais alto atingido. A tela mostra a escada
   * para conferência, porque o número que a pessoa recebe muda de faixa em
   * faixa e é fácil errar no cadastro.
   */
  const degraus = useMemo(() => {
    const grupos = new Map<string, BonusTipo[]>();
    for (const b of bonus) {
      if (!b.ativo) continue;
      if (!b.gatilho.tipo.startsWith("atingimento")) continue;
      if (b.premio.tipo !== "percentual") continue;
      const chave = [b.cargoId ?? "-", b.lojaId ?? "-", b.funcionarioId ?? "-", b.gatilho.tipo].join("|");
      grupos.set(chave, [...(grupos.get(chave) ?? []), b]);
    }
    return [...grupos.values()]
      .filter((arr) => arr.length > 1)
      .map((arr) => {
        const ordenados = [...arr].sort(
          (a, b) => (a.gatilho.minimoPct ?? 100) - (b.gatilho.minimoPct ?? 100),
        );
        return {
          cargo: ordenados[0].cargoId ? (nomeCargo.get(ordenados[0].cargoId) ?? "") : "todos os cargos",
          faixas: ordenados.map((b) => ({
            de: b.gatilho.minimoPct ?? 100,
            nome: b.nome,
            percentual: b.premio.valor,
          })),
        };
      });
  }, [bonus, nomeCargo]);

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

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      {podeGerir ? (
        <Button size="sm" onClick={() => setEdicao(bonusNovo())} disabled={ocupado}>
          <Plus /> Novo bônus
        </Button>
      ) : null}

      {edicao ? (
        <Card className="border-primary/40">
          <CardContent className="space-y-3 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Nome">
                <Input
                  value={edicao.nome}
                  placeholder="Ex.: Bateu a supermeta"
                  onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })}
                />
              </Campo>
              <Campo label="Situação">
                <Select
                  value={edicao.ativo ? "1" : "0"}
                  onChange={(e) => setEdicao({ ...edicao, ativo: e.target.value === "1" })}
                >
                  <option value="1">Ativo</option>
                  <option value="0">Inativo</option>
                </Select>
              </Campo>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Cargo">
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
              <Campo label="Loja">
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
              <Campo label="Funcionário">
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
              <Campo label="Quando pagar">
                <Select
                  value={edicao.gatilho.tipo}
                  onChange={(e) =>
                    setEdicao({
                      ...edicao,
                      gatilho: {
                        ...edicao.gatilho,
                        tipo: e.target.value as BonusTipo["gatilho"]["tipo"],
                      },
                    })
                  }
                >
                  {GATILHOS.map((g) => (
                    <option key={g.valor} value={g.valor}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </Campo>
              {gatilhoAtual?.usaMinimo ? (
                <Campo label="Atingimento mínimo (%)">
                  <InputNumero
                    value={edicao.gatilho.minimoPct ?? 100}
                    onChange={(n) =>
                      setEdicao({ ...edicao, gatilho: { ...edicao.gatilho, minimoPct: n ?? 0 } })
                    }
                  />
                </Campo>
              ) : null}
              {edicao.gatilho.tipo === "indicador" ? (
                <Campo
                  label="Qual meta secundária"
                  hint={
                    indicadores.length
                      ? "Marcada mês a mês, por pessoa, na aba Metas secundárias."
                      : "Cadastre as metas secundárias na aba Metas secundárias."
                  }
                >
                  <Select
                    value={edicao.gatilho.indicadorId ?? ""}
                    onChange={(e) =>
                      setEdicao({
                        ...edicao,
                        gatilho: { ...edicao.gatilho, indicadorId: e.target.value || null },
                      })
                    }
                  >
                    <option value="">— selecione —</option>
                    {indicadores.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
            </div>

            {/* Exigência extra: é o que prende o PA/VA à supermeta — sem os
                125%, o indicador marcado não paga nada. */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Só paga se também bater">
                <Select
                  value={edicao.condicao?.tipo ?? ""}
                  onChange={(e) =>
                    setEdicao({
                      ...edicao,
                      condicao: e.target.value
                        ? {
                            tipo: e.target.value as NonNullable<BonusTipo["condicao"]>["tipo"],
                            minimoPct: edicao.condicao?.minimoPct ?? 125,
                          }
                        : null,
                    })
                  }
                >
                  <option value="">— nada além do gatilho —</option>
                  {CONDICOES.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Campo>
              {edicao.condicao ? (
                <Campo label="Nesse mínimo (%)">
                  <InputNumero
                    value={edicao.condicao.minimoPct}
                    onChange={(n) =>
                      setEdicao({
                        ...edicao,
                        condicao: { ...edicao.condicao!, minimoPct: n ?? 0 },
                      })
                    }
                  />
                </Campo>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Prêmio">
                <Select
                  value={edicao.premio.tipo}
                  onChange={(e) =>
                    setEdicao({
                      ...edicao,
                      premio: { ...edicao.premio, tipo: e.target.value as "percentual" | "fixo" },
                    })
                  }
                >
                  <option value="percentual">% sobre a venda</option>
                  <option value="fixo">Valor fixo (R$)</option>
                </Select>
              </Campo>
              <Campo label={edicao.premio.tipo === "fixo" ? "Valor (R$)" : "Percentual (%)"}>
                <InputNumero
                  value={edicao.premio.valor}
                  onChange={(n) =>
                    setEdicao({ ...edicao, premio: { ...edicao.premio, valor: n ?? 0 } })
                  }
                />
              </Campo>
              {edicao.premio.tipo === "percentual" ? (
                <Campo label="Sobre a venda">
                  <Select
                    value={edicao.premio.escopoVenda ?? "individual"}
                    onChange={(e) =>
                      setEdicao({
                        ...edicao,
                        premio: {
                          ...edicao.premio,
                          escopoVenda: e.target.value as NonNullable<BonusTipo["premio"]["escopoVenda"]>,
                        },
                      })
                    }
                  >
                    <option value="individual">Própria</option>
                    <option value="loja">Da loja</option>
                    <option value="grupo">Do grupo</option>
                  </Select>
                </Campo>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Vigente a partir de">
                <Input
                  type="month"
                  value={edicao.vigenciaDe}
                  onChange={(e) => setEdicao({ ...edicao, vigenciaDe: e.target.value })}
                />
              </Campo>
              <Campo label="Vigente até" hint="Vazio = em aberto. Use para campanha de período fechado.">
                <Input
                  type="month"
                  value={edicao.vigenciaAte ?? ""}
                  onChange={(e) => setEdicao({ ...edicao, vigenciaAte: e.target.value || null })}
                />
              </Campo>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={ocupado || !edicao.nome.trim()}
                onClick={() =>
                  executar(async () => {
                    await salvarBonus(edicao);
                    setEdicao(null);
                  }, "Bônus salvo.")
                }
              >
                Salvar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdicao(null)} disabled={ocupado}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {problemas.length > 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="space-y-1 py-4 text-xs">
            <p className="text-sm font-semibold text-warning">Confira estes bônus</p>
            {problemas.map((a, i) => (
              <p key={i}>{a}</p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {degraus.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 py-4 text-xs">
            <p className="text-sm font-semibold">Escada de meta e supermeta</p>
            <p className="text-muted-foreground">
              Não acumulam: paga o degrau mais alto que a pessoa alcançar, sobre o total vendido.
            </p>
            {degraus.map((d, i) => (
              <div key={i} className="space-y-0.5">
                <p className="font-medium">{d.cargo}</p>
                {d.faixas.map((f, j) => {
                  const proxima = d.faixas[j + 1];
                  return (
                    <p key={j} className="text-muted-foreground">
                      De {pctFmt(f.de)}
                      {proxima ? ` a ${pctFmt(proxima.de)}` : " em diante"} da meta →{" "}
                      <strong className="text-foreground">{pctFmt(f.percentual)}</strong> do total
                      vendido <span className="text-[10px]">({f.nome})</span>
                    </p>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        {bonus.map((b) => (
          <Card key={b.id}>
            <CardContent className="flex items-start justify-between gap-3 py-3">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => (podeGerir ? setEdicao({ ...bonusNovo(), ...b }) : undefined)}
              >
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {b.nome}
                  {!b.ativo ? <Badge variant="neutral">inativo</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {b.gatilho.tipo === "indicador"
                    ? `Bateu ${nomeIndicador.get(b.gatilho.indicadorId ?? "") ?? "meta secundária"}`
                    : (GATILHOS.find((g) => g.valor === b.gatilho.tipo)?.label ?? b.gatilho.tipo)}
                  {b.gatilho.tipo.startsWith("atingimento")
                    ? ` (${pctFmt(b.gatilho.minimoPct ?? 100)})`
                    : ""}
                  {b.condicao
                    ? ` + ${
                        CONDICOES.find((c) => c.valor === b.condicao?.tipo)?.label ?? "condição"
                      } em ${pctFmt(b.condicao.minimoPct)}`
                    : ""}{" "}
                  ·{" "}
                  {b.cargoId ? (nomeCargo.get(b.cargoId) ?? "cargo") : "todos os cargos"}
                  {b.lojaId != null ? ` · ${nomeLoja.get(b.lojaId) ?? b.lojaId}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  vigente de {mesLabel(b.vigenciaDe)}
                  {b.vigenciaAte ? ` a ${mesLabel(b.vigenciaAte)}` : " em diante"}
                </p>
              </button>
              <div className="shrink-0 text-right">
                <p className="font-semibold tnum">
                  {b.premio.tipo === "fixo" ? formatBRL(b.premio.valor) : pctFmt(b.premio.valor)}
                </p>
                {podeGerir ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => executar(() => excluirBonus(b.id), "Bônus excluído.")}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
        {bonus.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum bônus cadastrado.</p>
        ) : null}
      </div>
    </div>
  );
}
