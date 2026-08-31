"use client";

// Bônus configuráveis (§14). Gatilho + prêmio + escopo + vigência.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { Bonus as BonusTipo, Cargo, Funcionario } from "@/lib/comissoes/tipos";
import type { StorePdv } from "@/lib/nfe/repo";
import { excluirBonus, salvarBonus } from "@/lib/comissoes/repo";
import { Aviso, Campo, InputNumero, Select, competenciaAtual, mesLabel, pctFmt } from "./comum";

const GATILHOS: { valor: BonusTipo["gatilho"]["tipo"]; label: string; usaMinimo: boolean }[] = [
  { valor: "atingimentoIndividual", label: "Bateu a meta individual", usaMinimo: true },
  { valor: "atingimentoLoja", label: "A loja bateu a meta", usaMinimo: true },
  { valor: "atingimentoGrupo", label: "O grupo de lojas bateu a meta", usaMinimo: true },
  { valor: "melhorVendedorLoja", label: "Melhor vendedor da loja", usaMinimo: false },
  { valor: "sempre", label: "Sempre (sem condição)", usaMinimo: false },
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
  lojas,
  podeGerir,
  onRecarregar,
}: {
  bonus: BonusTipo[];
  cargos: Cargo[];
  funcionarios: Funcionario[];
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

  /**
   * Bônus que pagam JUNTOS. Dois bônus de atingimento no mesmo escopo somam a
   * partir do gatilho mais alto — quem quis "meta OU supermeta" acaba pagando
   * as duas. Faixa de regra é que substitui; bônus acumula.
   */
  const empilhados = useMemo(() => {
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
          apartirDe: ordenados[ordenados.length - 1].gatilho.minimoPct ?? 100,
          nomes: ordenados.map((b) => `${b.nome} (${pctFmt(b.premio.valor)})`),
          soma: ordenados.reduce((s, b) => s + b.premio.valor, 0),
          cargo: ordenados[0].cargoId ? (nomeCargo.get(ordenados[0].cargoId) ?? "") : "todos os cargos",
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

      {empilhados.length > 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="space-y-2 py-4 text-xs">
            <p className="text-sm font-semibold text-warning">Estes bônus pagam juntos</p>
            {empilhados.map((e, i) => (
              <p key={i}>
                Em {e.cargo}: a partir de {pctFmt(e.apartirDe)} da meta, {e.nomes.join(" + ")} somam{" "}
                <strong>{pctFmt(e.soma)}</strong> sobre a venda.
              </p>
            ))}
            <p className="text-muted-foreground">
              Se a intenção era que a supermeta <em>substituísse</em> a meta, isso não se faz com
              dois bônus — se faz com duas faixas do mesmo componente, na aba Regras. Lá, só a
              faixa atingida vale.
            </p>
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
                  {GATILHOS.find((g) => g.valor === b.gatilho.tipo)?.label ?? b.gatilho.tipo}
                  {b.gatilho.tipo.startsWith("atingimento")
                    ? ` (${pctFmt(b.gatilho.minimoPct ?? 100)})`
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
