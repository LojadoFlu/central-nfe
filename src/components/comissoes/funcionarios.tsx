"use client";

// Cadastro de funcionários, cargos e vínculo com o PDV (§4, §2, §31).

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/utils";
import { Plus, RefreshCw, Search, Trash2, UserPlus } from "lucide-react";
import type {
  Cargo,
  ConfigComissoes,
  Funcionario,
  ResultadoSyncQuadro,
  VendedorPdv,
} from "@/lib/comissoes/tipos";
import type { StorePdv } from "@/lib/nfe/repo";
import {
  excluirCargo,
  excluirFuncionario,
  importarVendedores,
  marcarVendedor,
  salvarCargo,
  procurarVendedorPdv,
  salvarFuncionario,
  sincronizarVendedoresPdv,
  type AchadoPdv,
} from "@/lib/comissoes/repo";
import { numeroParaTexto } from "@/lib/comissoes/numero";
import { pisoEfetivo } from "@/lib/comissoes/piso";
import { Aviso, Campo, InputNumero, Select } from "./comum";

const VAZIO: Funcionario = {
  id: "",
  nome: "",
  cpf: null,
  cargoId: null,
  lojaId: null,
  pdvVendedorId: null,
  semPdv: false,
  lojasGrupo: [],
  pisoGarantido: null,
  admissao: null,
  ativo: true,
};

export function Funcionarios({
  cargos,
  funcionarios,
  vendedores,
  lojas,
  config,
  podeGerir,
  onRecarregar,
}: {
  cargos: Cargo[];
  funcionarios: Funcionario[];
  vendedores: VendedorPdv[];
  lojas: StorePdv[];
  config: ConfigComissoes;
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [edicao, setEdicao] = useState<Funcionario | null>(null);
  const [novoCargo, setNovoCargo] = useState("");
  const [novoPiso, setNovoPiso] = useState<number | null>(null);
  const [nomesCargo, setNomesCargo] = useState<Record<string, string>>({});
  const [pisosCargo, setPisosCargo] = useState<Record<string, number | null>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [cargoImport, setCargoImport] = useState("");
  const [mostrarCargos, setMostrarCargos] = useState(false);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [resultadoSync, setResultadoSync] = useState<ResultadoSyncQuadro | null>(null);
  const [buscaPdv, setBuscaPdv] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  const [achadosPdv, setAchadosPdv] = useState<AchadoPdv[] | null>(null);

  const nomeLoja = useMemo(
    () => new Map(lojas.map((l) => [l.id, l.grupoNome || l.nome || `Loja ${l.id}`])),
    [lojas],
  );
  const nomeCargo = useMemo(() => new Map(cargos.map((c) => [c.id, c.nome])), [cargos]);
  const vinculados = useMemo(
    () => new Set(funcionarios.map((f) => f.pdvVendedorId).filter(Boolean)),
    [funcionarios],
  );
  const pisoDoCargoSelecionado = useMemo(() => {
    const c = edicao?.cargoId ? cargos.find((x) => x.id === edicao.cargoId) : undefined;
    return c?.pisoGarantido ?? null;
  }, [edicao?.cargoId, cargos]);
  const semCadastro = useMemo(
    () => vendedores.filter((v) => !v.ignorado && !vinculados.has(v.id) && (v.nome || v.apelido)),
    [vendedores, vinculados],
  );
  const naoSaoPessoas = useMemo(() => vendedores.filter((v) => v.ignorado), [vendedores]);
  const ativos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  const inativos = useMemo(() => funcionarios.filter((f) => !f.ativo), [funcionarios]);

  // Abrir o formulário no meio de uma lista de 34 pessoas não adianta se ele
  // ficar fora da tela — no celular isso passa por "o botão não faz nada".
  useEffect(() => {
    if (edicao && !edicao.id) formRef.current?.scrollIntoView({ block: "center" });
  }, [edicao]);

  async function executar(fn: () => Promise<unknown>, mensagem: string) {
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      await fn();
      await onRecarregar();
      setNomesCargo({});
      setPisosCargo({});
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
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEdicao({ ...VAZIO })} disabled={ocupado}>
            <Plus /> Novo vendedor (com código do PDV)
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEdicao({ ...VAZIO, semPdv: true })}
            disabled={ocupado}
          >
            <UserPlus /> Novo funcionário fora do PDV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              executar(async () => {
                const r = await sincronizarVendedoresPdv();
                if (!r.ok) throw new Error(r.erro ?? "Falha ao sincronizar.");
                setResultadoSync(r);
              }, "Quadro sincronizado com o PDV.")
            }
          >
            <RefreshCw className={ocupado ? "animate-spin" : ""} /> Sincronizar com o PDV
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMostrarCargos((v) => !v)}>
            Cargos ({cargos.length})
          </Button>
        </div>
      ) : null}

      <Card className="bg-muted/30">
        <CardContent className="space-y-1 py-3 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">O quadro segue o PDV.</strong>{" "}
            {config.sincronizarFuncionarios
              ? "Vendedor novo lá vira funcionário aqui sozinho (todo dia, às 7h); quem sai é inativado, nunca excluído — o histórico e os meses fechados dependem disso."
              : "A sincronização automática está DESLIGADA nas Configurações: hoje o cadastro só muda no botão acima ou na mão."}
          </p>
          <p>
            O PDV manda no nome e na loja. Cargo, piso e lojas do supervisor são nossos — a
            sincronização não mexe neles depois de definidos.
          </p>
          {resultadoSync ? (
            <p className="text-foreground">
              Última sincronização: {resultadoSync.criados ?? 0} criado(s) ·{" "}
              {resultadoSync.atualizados ?? 0} atualizado(s) · {resultadoSync.inativados ?? 0}{" "}
              inativado(s) · {resultadoSync.gravados ?? 0} código(s) no espelho.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {naoSaoPessoas.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">
              Códigos que não são pessoas
            </h2>
            <p className="text-xs text-muted-foreground">
              Códigos institucionais da loja (a venda foi feita sem vendedor identificado). Não
              geram comissão nem piso para ninguém — se gerassem, a loja receberia.
            </p>
            {naoSaoPessoas.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">
                  {v.nome ?? v.apelido} <span className="text-muted-foreground">· {v.id}</span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-muted-foreground tnum">{formatBRL(v.totalPeriodo)}</span>
                  {podeGerir ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado}
                      onClick={() =>
                        executar(() => marcarVendedor(v.id, false), "Marcado como pessoa de verdade.")
                      }
                    >
                      É uma pessoa
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {podeGerir ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            <h2 className="flex items-center gap-1.5 text-[0.95rem] font-semibold tracking-tight">
              <Search className="size-4" /> Procurar pessoa no PDV
            </h2>
            <p className="text-xs text-muted-foreground">
              A sincronização só enxerga quem está <strong>lotado</strong> numa das nossas lojas no
              PDV. Quem estiver lotado em outra filial não aparece — procure aqui pelo nome e use o
              código encontrado no cadastro.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Nome (ao menos 3 letras)"
                value={buscaPdv}
                onChange={(e) => setBuscaPdv(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={ocupado || buscaPdv.trim().length < 3}
                onClick={() =>
                  executar(async () => {
                    const r = await procurarVendedorPdv(buscaPdv.trim(), true);
                    setAchadosPdv(r.achados);
                  }, "Busca concluída.")
                }
              >
                <Search /> Procurar
              </Button>
            </div>
            {achadosPdv ? (
              achadosPdv.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Ninguém com esse nome nas equipes do PDV. Se a pessoa não é cadastrada lá, use{" "}
                  <strong>Novo funcionário</strong> e marque &ldquo;não vende no PDV&rdquo;.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {achadosPdv.map((a) => (
                    <div key={a.codigo} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate">
                        <strong>{a.nome}</strong>{" "}
                        <span className="text-muted-foreground">
                          · {a.codigo} · lotado em {a.lojaNome}
                          {a.lojaAtiva ? "" : " (loja fora do nosso escopo)"}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado || vinculados.has(a.codigo ?? "")}
                        onClick={() =>
                          setEdicao({
                            ...VAZIO,
                            nome: a.nome ?? "",
                            cpf: a.cpf ?? null,
                            pdvVendedorId: a.codigo,
                            cargoId: cargos[0]?.id ?? null,
                          })
                        }
                      >
                        {vinculados.has(a.codigo ?? "") ? "já cadastrado" : "Cadastrar"}
                      </Button>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {mostrarCargos ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Cargos e piso garantido</h2>
            <p className="text-xs text-muted-foreground">
              O piso é definido aqui, por cargo — vale para todo mundo do cargo. Só quem tiver
              acordo diferente precisa de piso próprio na ficha. Marque{" "}
              <strong>meta individual</strong> nos cargos que dividem a meta da loja entre si
              (vendedor, subgerente); gerente e supervisor são medidos pela loja ou pelo grupo.
            </p>
            <div className="divide-y divide-border">
              {cargos.map((c) => {
                const nome = nomesCargo[c.id] ?? c.nome;
                const piso = c.id in pisosCargo ? pisosCargo[c.id] : (c.pisoGarantido ?? null);
                const mudou = nome !== c.nome || piso !== (c.pisoGarantido ?? null);
                return (
                  <div key={c.id} className="flex items-center gap-2 py-2">
                    <Input
                      className="h-9 min-w-0 flex-1"
                      value={nome}
                      disabled={!podeGerir}
                      onChange={(e) => setNomesCargo({ ...nomesCargo, [c.id]: e.target.value })}
                    />
                    <InputNumero
                      className="h-9 w-32"
                      placeholder="piso R$"
                      value={piso}
                      disabled={!podeGerir}
                      onChange={(n) => setPisosCargo((atual) => ({ ...atual, [c.id]: n }))}
                    />
                    {podeGerir ? (
                      <>
                        <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            className="size-3.5"
                            checked={c.recebeMetaIndividual === true}
                            disabled={ocupado}
                            onChange={(e) =>
                              executar(
                                () =>
                                  salvarCargo({
                                    id: c.id,
                                    nome: c.nome,
                                    ordem: c.ordem,
                                    pisoGarantido: c.pisoGarantido ?? null,
                                    recebeMetaIndividual: e.target.checked,
                                  }),
                                "Cargo salvo.",
                              )
                            }
                          />
                          meta individual
                        </label>
                        <Button
                          size="sm"
                          variant={mudou ? "default" : "outline"}
                          disabled={ocupado || !mudou || !nome.trim()}
                          onClick={() =>
                            executar(
                              () =>
                                salvarCargo({
                                  id: c.id,
                                  nome: nome.trim(),
                                  ordem: c.ordem,
                                  pisoGarantido: piso,
                                  recebeMetaIndividual: c.recebeMetaIndividual === true,
                                }),
                              "Cargo salvo.",
                            )
                          }
                        >
                          Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={ocupado}
                          onClick={() => executar(() => excluirCargo(c.id), "Cargo excluído.")}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                );
              })}
              {cargos.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">Nenhum cargo cadastrado ainda.</p>
              ) : null}
            </div>
            {podeGerir ? (
              <div className="flex gap-2 pt-1">
                <Input
                  className="min-w-0 flex-1"
                  placeholder="Ex.: Vendedor, Subgerente, Gerente, Supervisor"
                  value={novoCargo}
                  onChange={(e) => setNovoCargo(e.target.value)}
                />
                <InputNumero
                  className="w-32"
                  placeholder="piso R$"
                  value={novoPiso}
                  onChange={setNovoPiso}
                />
                <Button
                  size="sm"
                  disabled={ocupado || !novoCargo.trim()}
                  onClick={() =>
                    executar(async () => {
                      await salvarCargo({
                        nome: novoCargo.trim(),
                        ordem: cargos.length + 1,
                        pisoGarantido: novoPiso,
                      });
                      setNovoCargo("");
                      setNovoPiso(null);
                    }, "Cargo criado.")
                  }
                >
                  Adicionar
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {edicao ? (
        <Card className="border-primary/40" ref={formRef}>
          <CardContent className="space-y-3 py-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">
              {edicao.id
                ? `Editando ${edicao.nome}`
                : edicao.semPdv
                  ? "Novo funcionário fora do PDV"
                  : "Novo funcionário"}
            </h2>
            {edicao.semPdv ? (
              <p className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
                Sem código de vendedor: esta pessoa não tem venda própria. A comissão dela sai da
                regra do <strong>cargo</strong>, sobre a venda das <strong>lojas</strong> marcadas
                abaixo. A sincronização com o PDV não mexe neste cadastro.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Nome">
                <Input value={edicao.nome} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} />
              </Campo>
              <Campo label="CPF">
                <Input
                  value={edicao.cpf ?? ""}
                  onChange={(e) => setEdicao({ ...edicao, cpf: e.target.value })}
                />
              </Campo>
              <Campo label="Cargo">
                <Select
                  value={edicao.cargoId ?? ""}
                  onChange={(e) => setEdicao({ ...edicao, cargoId: e.target.value || null })}
                >
                  <option value="">— selecione —</option>
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
                  <option value="">— selecione —</option>
                  {lojas.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.grupoNome || l.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo
                label="Vende no PDV?"
                hint="Gerente, supervisor, caixa e contratações de fora normalmente não vendem — comissionam pela loja ou pelo grupo, na regra do cargo."
              >
                <Select
                  value={edicao.semPdv ? "0" : "1"}
                  onChange={(e) =>
                    setEdicao({
                      ...edicao,
                      semPdv: e.target.value === "0",
                      pdvVendedorId: e.target.value === "0" ? null : edicao.pdvVendedorId,
                    })
                  }
                >
                  <option value="1">Sim, tem código de vendedor</option>
                  <option value="0">Não vende no PDV</option>
                </Select>
              </Campo>
              {!edicao.semPdv ? (
                <Campo
                  label="Código no PDV"
                  hint="É o código que aparece na venda. Sem ele, o sistema não sabe quais vendas são desta pessoa."
                >
                  <Select
                    value={edicao.pdvVendedorId ?? ""}
                    onChange={(e) => setEdicao({ ...edicao, pdvVendedorId: e.target.value || null })}
                  >
                    <option value="">— sem vínculo —</option>
                    {edicao.pdvVendedorId &&
                    !vendedores.some((v) => v.id === edicao.pdvVendedorId) ? (
                      <option value={edicao.pdvVendedorId}>
                        {edicao.pdvVendedorId} · (código de fora das nossas lojas)
                      </option>
                    ) : null}
                    {vendedores
                      .filter((v) => !vinculados.has(v.id) || v.id === edicao.pdvVendedorId)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.id} · {v.nome ?? v.apelido ?? "sem nome"}
                          {v.lojaId != null ? ` · ${nomeLoja.get(v.lojaId) ?? v.lojaId}` : ""}
                        </option>
                      ))}
                  </Select>
                </Campo>
              ) : null}
              <Campo
                label="Piso individual (R$)"
                hint={
                  pisoDoCargoSelecionado == null
                    ? "Só preencha se esta pessoa tem acordo diferente. O piso normal vem do cargo."
                    : `Vazio = usa o piso do cargo (${formatBRL(pisoDoCargoSelecionado)}). Preencha só para acordo individual.`
                }
              >
                <InputNumero
                  placeholder={
                    pisoDoCargoSelecionado == null
                      ? "—"
                      : numeroParaTexto(pisoDoCargoSelecionado)
                  }
                  value={edicao.pisoGarantido ?? null}
                  onChange={(n) => setEdicao({ ...edicao, pisoGarantido: n })}
                />
              </Campo>
              <Campo label="Admissão">
                <Input
                  type="date"
                  value={edicao.admissao ?? ""}
                  onChange={(e) => setEdicao({ ...edicao, admissao: e.target.value || null })}
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

            <Campo
              label="Lojas deste funcionário"
              hint="Marque as lojas pelas quais ele responde — gerente de duas lojas, supervisor, ou quem não vende no PDV. A meta dele vira a SOMA das metas destas lojas e a comissão incide sobre a venda somada. Vazio = só a loja principal acima."
            >
              <div className="flex flex-wrap gap-1.5">
                {lojas.map((l) => {
                  const marcada = (edicao.lojasGrupo ?? []).includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() =>
                        setEdicao({
                          ...edicao,
                          lojasGrupo: marcada
                            ? (edicao.lojasGrupo ?? []).filter((x) => x !== l.id)
                            : [...(edicao.lojasGrupo ?? []), l.id],
                        })
                      }
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        marcada ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {l.grupoNome || l.nome}
                    </button>
                  );
                })}
              </div>
            </Campo>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                disabled={ocupado || !edicao.nome.trim()}
                onClick={() =>
                  executar(async () => {
                    await salvarFuncionario(edicao);
                    setEdicao(null);
                  }, "Funcionário salvo.")
                }
              >
                Salvar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdicao(null)} disabled={ocupado}>
                Cancelar
              </Button>
              {edicao.id ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ocupado}
                  onClick={() =>
                    executar(async () => {
                      await excluirFuncionario(edicao.id);
                      setEdicao(null);
                    }, "Funcionário excluído.")
                  }
                >
                  <Trash2 className="text-destructive" /> Excluir
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {semCadastro.length > 0 && podeGerir ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="space-y-2 py-4">
            <p className="text-sm font-semibold text-warning">
              {semCadastro.length} vendedor(es) do PDV sem cadastro
            </p>
            <p className="text-xs text-muted-foreground">
              Enquanto não tiverem cadastro, as vendas deles não geram comissão para ninguém.
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {semCadastro.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    {v.nome ?? v.apelido} <span className="text-muted-foreground">· {v.id}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground tnum">{formatBRL(v.totalPeriodo)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado}
                      onClick={() =>
                        executar(() => marcarVendedor(v.id, true), "Marcado como código da loja.")
                      }
                    >
                      Não é pessoa
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <Campo label="Cargo dos importados" className="w-48">
                <Select value={cargoImport} onChange={(e) => setCargoImport(e.target.value)}>
                  <option value="">— sem cargo —</option>
                  {cargos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Button
                size="sm"
                disabled={ocupado}
                onClick={() =>
                  executar(
                    () => importarVendedores({ cargoId: cargoImport || null }),
                    "Vendedores importados. Defina o piso de cada um.",
                  )
                }
              >
                <UserPlus /> Importar todos
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        {funcionarios.map((f) => (
          <Card key={f.id}>
            <CardContent className="flex items-center justify-between gap-3 py-3">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => (podeGerir ? setEdicao({ ...VAZIO, ...f }) : undefined)}
              >
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {f.nome}
                  {!f.ativo ? <Badge variant="neutral">inativo</Badge> : null}
                  {f.semPdv ? (
                    <Badge variant="neutral">não vende no PDV</Badge>
                  ) : !f.pdvVendedorId ? (
                    <Badge variant="destructive">sem PDV</Badge>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.cargoId ? (nomeCargo.get(f.cargoId) ?? "cargo removido") : "sem cargo"} ·{" "}
                  {f.lojaId != null ? (nomeLoja.get(f.lojaId) ?? `Loja ${f.lojaId}`) : "sem loja"}
                  {f.lojasGrupo?.length ? ` · ${f.lojasGrupo.length} lojas no grupo` : ""}
                </p>
              </button>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">
                  {pisoEfetivo(f, cargos).origem === "funcionario" ? "piso próprio" : "piso"}
                </p>
                <p
                  className={`font-semibold tnum ${
                    pisoEfetivo(f, cargos).valor == null ? "text-destructive" : ""
                  }`}
                >
                  {pisoEfetivo(f, cargos).valor == null
                    ? "—"
                    : formatBRL(pisoEfetivo(f, cargos).valor!)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
        {funcionarios.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum funcionário cadastrado. Comece criando os cargos, depois clique em{" "}
            <strong>Buscar vendedores no PDV</strong> e importe a equipe.
          </p>
        ) : null}
      </div>
    </div>
  );
}
