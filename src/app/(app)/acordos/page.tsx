"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarAcordos,
  salvarAcordo,
  excluirAcordo,
  baixarParcelaAcordo,
  listarDocumentos,
  listarParcelas,
  type Acordo,
  type ParcelaAcordo,
} from "@/lib/nfe/repo";
import { useAuth } from "@/lib/auth/auth-provider";
import { podeAlterarFinanceiro } from "@/lib/auth/roles";
import { formatBRL, formatCNPJ, formatarData, diasAte } from "@/lib/utils";
import { Handshake, Plus, Trash2, Check, RotateCcw, X, Pencil, ChevronDown } from "lucide-react";

interface Fornecedor {
  cnpj: string;
  nome: string;
}
interface LinhaParcela {
  valor: string;
  vencimento: string;
}

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Soma `k` meses a uma data YYYY-MM-DD (clampando o dia no fim do mês). */
function addMesesISO(iso: string, k: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1 + k, 1);
  const ultimoDia = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const dia = Math.min(d, ultimoDia);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function resumoAcordo(a: Acordo) {
  const parcelas = a.parcelas ?? [];
  const total = a.valorAcordado ?? parcelas.reduce((s, p) => s + (p.valor ?? 0), 0);
  const pagas = parcelas.filter((p) => p.statusPagamento === "pago");
  const pago = pagas.reduce((s, p) => s + (p.valor ?? 0), 0);
  const pendentes = parcelas.filter((p) => p.statusPagamento !== "pago");
  const proxima = [...pendentes].sort((x, y) => (x.vencimento ?? "").localeCompare(y.vencimento ?? ""))[0] ?? null;
  const quitado = parcelas.length > 0 && pendentes.length === 0;
  return { total, pago, pagasN: pagas.length, totalN: parcelas.length, proxima, quitado };
}

export default function AcordosPage() {
  const { role } = useAuth();
  const podeEditar = podeAlterarFinanceiro(role);
  const [acordos, setAcordos] = useState<Acordo[] | null>(null);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [dividaPorCnpj, setDividaPorCnpj] = useState<Map<string, number>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null); // "acordoId:idx" ou "del:id"

  // Formulário
  const [formAberto, setFormAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fNome, setFNome] = useState("");
  const [fCnpj, setFCnpj] = useState("");
  const [fDescricao, setFDescricao] = useState("");
  const [fObs, setFObs] = useState("");
  const [linhas, setLinhas] = useState<LinhaParcela[]>([{ valor: "", vencimento: hojeISO() }]);
  // Gerador de parcelas
  const [gTotal, setGTotal] = useState("");
  const [gQtd, setGQtd] = useState("");
  const [gPrimeira, setGPrimeira] = useState(hojeISO());

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ac, docs, parcelas] = await Promise.all([listarAcordos(), listarDocumentos(300), listarParcelas(300)]);
      setAcordos(ac);
      // Fornecedores distintos (para sugestão)
      const mapa = new Map<string, string>();
      for (const d of docs) if (d.cnpjEmit && d.xNomeEmit) mapa.set(d.cnpjEmit, d.xNomeEmit);
      setFornecedores([...mapa.entries()].map(([cnpj, nome]) => ({ cnpj, nome })).sort((a, b) => a.nome.localeCompare(b.nome)));
      // Dívida vencida atual por fornecedor (ajuda na renegociação)
      const div = new Map<string, number>();
      for (const p of parcelas) {
        if (p.statusPagamento === "pago" || !p.cnpjEmit) continue;
        const dias = diasAte(p.vencimento);
        if (dias !== null && dias < 0) div.set(p.cnpjEmit, (div.get(p.cnpjEmit) ?? 0) + (p.valor ?? 0));
      }
      setDividaPorCnpj(div);
    } catch (e) {
      setErro((e as Error).message);
      setAcordos([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function resetForm() {
    setEditId(null);
    setFNome("");
    setFCnpj("");
    setFDescricao("");
    setFObs("");
    setLinhas([{ valor: "", vencimento: hojeISO() }]);
    setGTotal("");
    setGQtd("");
    setGPrimeira(hojeISO());
  }

  function abrirNovo() {
    resetForm();
    setFormAberto(true);
  }

  function abrirEdicao(a: Acordo) {
    setEditId(a.id);
    setFNome(a.nomeFornecedor);
    setFCnpj(a.cnpjFornecedor ?? "");
    setFDescricao(a.descricao ?? "");
    setFObs(a.observacao ?? "");
    setLinhas(
      (a.parcelas ?? []).map((p) => ({ valor: String(p.valor ?? ""), vencimento: p.vencimento ?? hojeISO() })),
    );
    setFormAberto(true);
  }

  function onNomeChange(v: string) {
    setFNome(v);
    const match = fornecedores.find((f) => f.nome === v);
    setFCnpj(match?.cnpj ?? "");
  }

  function gerarParcelas() {
    const total = Number(gTotal);
    const qtd = Math.floor(Number(gQtd));
    if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(qtd) || qtd < 1 || qtd > 60) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gPrimeira)) return;
    const centavos = Math.round(total * 100);
    const base = Math.floor(centavos / qtd);
    const resto = centavos - base * qtd;
    const novas: LinhaParcela[] = [];
    for (let i = 0; i < qtd; i++) {
      const c = base + (i === qtd - 1 ? resto : 0); // sobra na última
      novas.push({ valor: (c / 100).toFixed(2), vencimento: addMesesISO(gPrimeira, i) });
    }
    setLinhas(novas);
  }

  const totalLinhas = useMemo(
    () => linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0),
    [linhas],
  );

  async function salvar() {
    if (!fNome.trim()) {
      setErro("Informe o fornecedor.");
      return;
    }
    const parcelas = linhas
      .map((l) => ({ valor: Number(l.valor), vencimento: l.vencimento }))
      .filter((p) => Number.isFinite(p.valor) && p.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.vencimento));
    if (parcelas.length === 0) {
      setErro("Inclua ao menos uma parcela válida (valor e vencimento).");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await salvarAcordo({
        id: editId ?? undefined,
        nomeFornecedor: fNome.trim(),
        cnpjFornecedor: fCnpj || undefined,
        descricao: fDescricao.trim() || undefined,
        observacao: fObs.trim() || undefined,
        parcelas,
      });
      setFormAberto(false);
      resetForm();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarParcela(a: Acordo, idx: number, p: ParcelaAcordo) {
    setOcupado(`${a.id}:${idx}`);
    setErro(null);
    try {
      await baixarParcelaAcordo({ acordoId: a.id, indice: idx, pago: p.statusPagamento !== "pago" });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function remover(a: Acordo) {
    if (!confirm(`Excluir o acordo com ${a.nomeFornecedor}? Esta ação não pode ser desfeita.`)) return;
    setOcupado(`del:${a.id}`);
    setErro(null);
    try {
      await excluirAcordo(a.id);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const dividaSelec = fCnpj ? dividaPorCnpj.get(fCnpj) ?? 0 : 0;

  return (
    <div>
      <PageHeader
        title="Acordos"
        description="Renegociações de dívidas atrasadas com fornecedores."
        action={
          podeEditar && !formAberto ? (
            <Button size="sm" onClick={abrirNovo}>
              <Plus className="size-4" /> Novo acordo
            </Button>
          ) : undefined
        }
      />

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : null}

      {/* Formulário */}
      {formAberto ? (
        <Card className="mb-5">
          <CardContent className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{editId ? "Editar acordo" : "Novo acordo"}</h2>
              <Button size="sm" variant="ghost" onClick={() => { setFormAberto(false); resetForm(); }}>
                <X className="size-4" /> Fechar
              </Button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Fornecedor</label>
              <Input
                list="forn-list"
                placeholder="Nome do fornecedor"
                value={fNome}
                onChange={(e) => onNomeChange(e.target.value)}
              />
              <datalist id="forn-list">
                {fornecedores.map((f) => (
                  <option key={f.cnpj} value={f.nome} />
                ))}
              </datalist>
              {fCnpj ? (
                <p className="text-xs text-muted-foreground">
                  {formatCNPJ(fCnpj)}
                  {dividaSelec > 0 ? ` · dívida vencida atual: ${formatBRL(dividaSelec)}` : ""}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Descrição (opcional)</label>
              <Input
                placeholder="Ex.: Renegociação das NFs em atraso"
                value={fDescricao}
                onChange={(e) => setFDescricao(e.target.value)}
                maxLength={200}
              />
            </div>

            {/* Gerador de parcelas */}
            <div className="rounded-md border border-dashed border-border p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Gerar parcelas iguais (mensais)</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Valor total (R$)</label>
                  <Input type="number" step="0.01" inputMode="decimal" value={gTotal} onChange={(e) => setGTotal(e.target.value)} className="h-9 w-32" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Nº parcelas</label>
                  <Input type="number" inputMode="numeric" value={gQtd} onChange={(e) => setGQtd(e.target.value)} className="h-9 w-24" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">1º vencimento</label>
                  <Input type="date" value={gPrimeira} onChange={(e) => setGPrimeira(e.target.value)} className="h-9 w-40" />
                </div>
                <Button size="sm" variant="outline" type="button" onClick={gerarParcelas}>
                  Gerar
                </Button>
              </div>
            </div>

            {/* Parcelas (editáveis) */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Parcelas do acordo</label>
              {linhas.map((l, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Valor (R$)</span>
                    <Input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={l.valor}
                      onChange={(e) => setLinhas((prev) => prev.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                      className="h-9 w-32"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Vencimento</span>
                    <Input
                      type="date"
                      value={l.vencimento}
                      onChange={(e) => setLinhas((prev) => prev.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)))}
                      className="h-9 w-40"
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    type="button"
                    className="h-9 w-9"
                    disabled={linhas.length === 1}
                    onClick={() => setLinhas((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => setLinhas((prev) => [...prev, { valor: "", vencimento: hojeISO() }])}
              >
                <Plus className="size-4" /> Adicionar parcela
              </Button>
              <p className="pt-1 text-sm">
                Total do acordo: <strong className="tnum">{formatBRL(totalLinhas)}</strong> em {linhas.length} parcela
                {linhas.length > 1 ? "s" : ""}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Observação (opcional)</label>
              <Input
                placeholder="Ex.: acordo verbal com o gerente, boleto por e-mail…"
                value={fObs}
                onChange={(e) => setFObs(e.target.value)}
                maxLength={500}
              />
            </div>

            <div className="flex gap-2">
              <Button size="sm" disabled={salvando} onClick={salvar}>
                <Check className="size-4" /> {salvando ? "Salvando…" : "Salvar acordo"}
              </Button>
              <Button size="sm" variant="ghost" disabled={salvando} onClick={() => { setFormAberto(false); resetForm(); }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Lista */}
      {acordos === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : acordos.length === 0 ? (
        <ModulePlaceholder icon={Handshake} title="Nenhum acordo" etapa="Renegociações">
          Registre aqui os acordos feitos com fornecedores para dívidas em atraso: valores e datas de pagamento.
        </ModulePlaceholder>
      ) : (
        <div className="space-y-3">
          {acordos.map((a) => {
            const r = resumoAcordo(a);
            const aberto = expandido === a.id;
            const proxDias = r.proxima ? diasAte(r.proxima.vencimento) : null;
            return (
              <Card key={a.id}>
                <CardContent className="py-4">
                  <button
                    type="button"
                    onClick={() => setExpandido(aberto ? null : a.id)}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{a.nomeFornecedor}</p>
                        <Badge variant={r.quitado ? "success" : "warning"}>{r.quitado ? "Quitado" : "Ativo"}</Badge>
                      </div>
                      {a.descricao ? <p className="text-xs text-muted-foreground">{a.descricao}</p> : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.pagasN}/{r.totalN} parcelas pagas · {formatBRL(r.pago)} de {formatBRL(r.total)}
                        {!r.quitado && r.proxima
                          ? ` · próx. ${formatarData(r.proxima.vencimento)}${
                              proxDias !== null && proxDias < 0 ? ` (${-proxDias}d atraso)` : ""
                            }`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-bold tnum">{formatBRL(r.total)}</p>
                      <ChevronDown className={`size-4 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {aberto ? (
                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                      {(a.parcelas ?? []).map((p, idx) => {
                        const pago = p.statusPagamento === "pago";
                        const dias = diasAte(p.vencimento);
                        const bz = `${a.id}:${idx}`;
                        return (
                          <div key={idx} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <div className="min-w-0">
                              <span className="text-muted-foreground">
                                Parcela {p.n ?? idx + 1} · venc. {formatarData(p.vencimento)}
                              </span>
                              {pago ? (
                                <span className="ml-2 text-xs text-success">Pago em {formatarData(p.dataPagamento)}</span>
                              ) : dias !== null && dias < 0 ? (
                                <span className="ml-2 text-xs text-destructive">{-dias}d em atraso</span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium tnum">{formatBRL(p.valor)}</span>
                              {pago ? <Badge variant="success">Paga</Badge> : null}
                              {podeEditar ? (
                                <Button
                                  size="sm"
                                  variant={pago ? "ghost" : "outline"}
                                  disabled={ocupado === bz}
                                  onClick={() => alternarParcela(a, idx, p)}
                                >
                                  {pago ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                                  {ocupado === bz ? "…" : pago ? "Reabrir" : "Marcar pago"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}

                      {a.observacao ? (
                        <p className="pt-1 text-xs text-muted-foreground">Obs.: {a.observacao}</p>
                      ) : null}

                      {podeEditar ? (
                        <div className="flex gap-2 pt-2">
                          <Button size="sm" variant="outline" onClick={() => abrirEdicao(a)}>
                            <Pencil className="size-4" /> Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={ocupado === `del:${a.id}`}
                            onClick={() => remover(a)}
                          >
                            <Trash2 className="size-4" /> Excluir
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Os acordos são um registro à parte das notas: você lança as parcelas renegociadas e dá baixa conforme paga.
        Toda alteração é registrada com autor e data (auditoria).
      </p>
    </div>
  );
}
