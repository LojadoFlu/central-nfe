"use client";

// Metas secundárias (PA, VA…). Duas coisas na mesma tela porque sempre se usam
// juntas: quais indicadores existem e quem bateu cada um no mês.
//
// Elas não saem de venda — não há de onde calcular. Por isso são MARCADAS a
// cada competência, e um bônus com gatilho "indicador" as transforma em
// dinheiro.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import type { Bonus, Cargo, Funcionario, Indicador } from "@/lib/comissoes/tipos";
import { excluirIndicador, marcarIndicadores, salvarIndicador } from "@/lib/comissoes/repo";
import { Aviso, Select, mesLabel, pctFmt } from "./comum";

export function Indicadores({
  competencia,
  indicadores,
  atingidos,
  funcionarios,
  cargos,
  bonus,
  podeGerir,
  onRecarregar,
}: {
  competencia: string;
  indicadores: Indicador[];
  /** funcionarioId → ids dos indicadores batidos na competência. */
  atingidos: Map<string, string[]>;
  funcionarios: Funcionario[];
  cargos: Cargo[];
  bonus: Bonus[];
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [novo, setNovo] = useState("");
  const [cargoFiltro, setCargoFiltro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Cópia local para a grade responder ao clique sem esperar o servidor.
  const [marcas, setMarcas] = useState<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    setMarcas(new Map([...atingidos].map(([id, lista]) => [id, new Set(lista)])));
  }, [atingidos]);

  const nomeCargo = useMemo(() => new Map(cargos.map((c) => [c.id, c.nome])), [cargos]);

  const equipe = useMemo(
    () =>
      funcionarios
        .filter((f) => f.ativo && (!cargoFiltro || f.cargoId === cargoFiltro))
        .sort(
          (a, b) =>
            (nomeCargo.get(a.cargoId ?? "") ?? "").localeCompare(nomeCargo.get(b.cargoId ?? "") ?? "") ||
            a.nome.localeCompare(b.nome),
        ),
    [funcionarios, cargoFiltro, nomeCargo],
  );

  /** Quanto cada indicador paga, para a tela dizer o que está em jogo. */
  const premioDe = useMemo(() => {
    const m = new Map<string, Bonus[]>();
    for (const b of bonus) {
      if (!b.ativo || b.gatilho.tipo !== "indicador" || !b.gatilho.indicadorId) continue;
      m.set(b.gatilho.indicadorId, [...(m.get(b.gatilho.indicadorId) ?? []), b]);
    }
    return m;
  }, [bonus]);

  const totalPorIndicador = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of equipe) {
      for (const id of marcas.get(f.id) ?? []) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [equipe, marcas]);

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

  async function alternar(funcionarioId: string, indicadorId: string) {
    const atual = new Set(marcas.get(funcionarioId) ?? []);
    if (atual.has(indicadorId)) atual.delete(indicadorId);
    else atual.add(indicadorId);
    setMarcas(new Map(marcas).set(funcionarioId, atual));
    setErro(null);
    try {
      await marcarIndicadores({ competencia, funcionarioId, indicadores: [...atual] });
      await onRecarregar();
    } catch (e) {
      // Não gravou: desfaz para a tela não mentir sobre o que está no banco.
      setMarcas(new Map(marcas));
      setErro((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      <Card>
        <CardContent className="space-y-3 py-4">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Metas secundárias</h2>
          <p className="text-xs text-muted-foreground">
            PA, VA e afins: não saem de venda, então são marcadas a cada mês. Para virarem
            dinheiro, crie um bônus com o gatilho <strong>&quot;Bateu uma meta secundária&quot;</strong> — e,
            se ela só valer para quem bateu a supermeta, preencha ali o campo{" "}
            <strong>&quot;Só paga se também bater&quot;</strong>.
          </p>

          <div className="divide-y divide-border">
            {indicadores.map((i) => {
              const premios = premioDe.get(i.id) ?? [];
              return (
                <div key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {i.nome}
                      {i.ativo === false ? <Badge variant="neutral">inativa</Badge> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {premios.length === 0
                        ? "Nenhum bônus usa esta meta ainda — marcá-la não paga nada."
                        : premios
                            .map(
                              (b) =>
                                `${b.nome}: ${
                                  b.premio.tipo === "fixo"
                                    ? `R$ ${b.premio.valor}`
                                    : pctFmt(b.premio.valor)
                                }`,
                            )
                            .join(" · ")}
                    </p>
                  </div>
                  {podeGerir ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado}
                      onClick={() => executar(() => excluirIndicador(i.id), "Meta secundária excluída.")}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {indicadores.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                Nenhuma meta secundária cadastrada.
              </p>
            ) : null}
          </div>

          {podeGerir ? (
            <div className="flex gap-2">
              <Input
                className="h-9 max-w-xs"
                value={novo}
                placeholder="Ex.: PA"
                onChange={(e) => setNovo(e.target.value)}
              />
              <Button
                size="sm"
                disabled={ocupado || !novo.trim()}
                onClick={() =>
                  executar(async () => {
                    await salvarIndicador({ nome: novo.trim(), ordem: indicadores.length + 1 });
                    setNovo("");
                  }, "Meta secundária criada.")
                }
              >
                <Plus /> Criar
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {indicadores.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[0.95rem] font-semibold tracking-tight">
                Quem bateu em {mesLabel(competencia)}
              </h2>
              <Select
                value={cargoFiltro}
                onChange={(e) => setCargoFiltro(e.target.value)}
                className="h-9 w-auto"
                aria-label="Filtrar por cargo"
              >
                <option value="">Todos os cargos</option>
                {cargos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Funcionário</th>
                    {indicadores.map((i) => (
                      <th key={i.id} className="w-20 py-2 text-center font-medium">
                        {i.nome}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {equipe.map((f) => (
                    <tr key={f.id} className="border-b border-border/60">
                      <td className="py-1.5 pr-3">
                        <span className="block truncate">{f.nome}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {nomeCargo.get(f.cargoId ?? "") ?? "sem cargo"}
                        </span>
                      </td>
                      {indicadores.map((i) => (
                        <td key={i.id} className="py-1.5 text-center">
                          <input
                            type="checkbox"
                            className="size-4"
                            aria-label={`${f.nome} bateu ${i.nome}`}
                            disabled={!podeGerir}
                            checked={marcas.get(f.id)?.has(i.id) === true}
                            onChange={() => void alternar(f.id, i.id)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-xs text-muted-foreground">
                    <td className="py-2">Bateram</td>
                    {indicadores.map((i) => (
                      <td key={i.id} className="py-2 text-center tnum">
                        {totalPorIndicador.get(i.id) ?? 0} de {equipe.length}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Cada clique já grava. Competência fechada não aceita marcação — reabra antes.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
