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
  listarEmpresas,
  listarVendasManuais,
  salvarVendaManual,
  excluirVendaManual,
  type VendaManual,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatarData } from "@/lib/utils";
import { PencilLine, Plus, Trash2, Check } from "lucide-react";

const FORMAS = [
  { key: "dinheiro", label: "Dinheiro", cartao: false },
  { key: "pix", label: "PIX", cartao: false },
  { key: "cartaoDebito", label: "Cartão débito", cartao: true },
  { key: "cartaoCredito", label: "Cartão crédito", cartao: true },
  { key: "cartaoParcelado", label: "Cartão parcelado", cartao: true },
];
const FORMA_LABEL = Object.fromEntries(FORMAS.map((f) => [f.key, f.label]));

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ManualPage() {
  const { podeAcao } = useAuth();
  const podeEditar = podeAcao("financeiro.baixar");
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [dia, setDia] = useState(hojeISO());
  const [lista, setLista] = useState<VendaManual[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // form
  const [forma, setForma] = useState("dinheiro");
  const [maquina, setMaquina] = useState("");
  const [nParcelas, setNParcelas] = useState("2");
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ehParcelado = forma === "cartaoParcelado";

  const maquinas = useMemo(() => empresas.filter((e) => !e.manual), [empresas]);
  const ehCartaoOuPix = FORMAS.find((f) => f.key === forma)?.cartao || forma === "pix";
  const nomeEmp = (id: string | null) => empresas.find((e) => e.id === id)?.nomeFantasia || empresas.find((e) => e.id === id)?.razaoSocial || (id ?? "—");

  useEffect(() => {
    void listarEmpresas().then((es) => {
      setEmpresas(es);
      // padrão: primeira loja offline se houver; senão a primeira loja
      if (es.length && !empresaId) setEmpresaId((es.find((e) => e.manual) ?? es[0]).id);
    }).catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    if (!empresaId) { setLista([]); return; }
    setErro(null);
    try {
      setLista(await listarVendasManuais(empresaId, dia, dia));
    } catch (e) {
      setErro((e as Error).message);
      setLista([]);
    }
  }, [empresaId, dia]);

  useEffect(() => { setLista(null); void carregar(); }, [carregar]);

  async function adicionar() {
    if (!empresaId) return setErro("Selecione a loja.");
    const v = Number(valor);
    if (!Number.isFinite(v) || v <= 0) return setErro("Informe um valor.");
    const precisaMaquina = forma !== "dinheiro";
    if (precisaMaquina && !maquina) return setErro("Escolha a máquina (loja) por onde passou.");
    setSalvando(true);
    setErro(null);
    try {
      await salvarVendaManual({ empresaId, dia, forma, parcelas: ehParcelado ? Number(nParcelas) || 2 : undefined, maquinaEmpresaId: precisaMaquina ? maquina : undefined, valor: v });
      setValor("");
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  async function remover(id: string) {
    setOcupado(id);
    setErro(null);
    try {
      await excluirVendaManual(id);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const totalDia = (lista ?? []).reduce((s, v) => s + (v.valor ?? 0), 0);

  return (
    <div>
      <PageHeader title="Vendas manuais" description="Lançamento manual de vendas por loja — totais por dia, meio de pagamento e máquina/loja." />

      {empresas.length === 0 ? (
        <ModulePlaceholder icon={PencilLine} title="Nenhuma loja cadastrada" etapa="Vendas manuais">
          Cadastre uma empresa/loja em Empresas para lançar vendas manuais.
        </ModulePlaceholder>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Loja (onde lançar a venda)</span>
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {empresas.map((e) => <option key={e.id} value={e.id}>{(e.nomeFantasia || e.razaoSocial)}{e.manual ? " · offline" : ""}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Dia</span>
              <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="h-10 w-44" />
            </label>
          </div>

          {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

          {/* Form de lançamento */}
          {podeEditar ? (
            <Card className="mb-4">
              <CardContent className="space-y-3 py-4">
                <p className="text-sm font-semibold">Lançar venda em {formatarData(dia)}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <label className="block text-[11px] text-muted-foreground">Meio de pagamento</label>
                    <select value={forma} onChange={(e) => setForma(e.target.value)} className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm">
                      {FORMAS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                  {ehCartaoOuPix ? (
                    <div className="space-y-1">
                      <label className="block text-[11px] text-muted-foreground">Máquina (loja)</label>
                      <select value={maquina} onChange={(e) => setMaquina(e.target.value)} className="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm">
                        <option value="">— escolher —</option>
                        {maquinas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
                      </select>
                    </div>
                  ) : null}
                  {ehParcelado ? (
                    <div className="space-y-1">
                      <label className="block text-[11px] text-muted-foreground">Parcelas</label>
                      <select value={nParcelas} onChange={(e) => setNParcelas(e.target.value)} className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm">
                        {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}x</option>)}
                      </select>
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    <label className="block text-[11px] text-muted-foreground">Valor total (R$)</label>
                    <Input type="number" step="0.01" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className="h-9 w-32" />
                  </div>
                  <Button size="sm" disabled={salvando} onClick={adicionar}>
                    <Plus className="size-4" /> {salvando ? "Salvando…" : "Adicionar"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  O <strong>resultado</strong> vai pra loja escolhida acima; o <strong>dinheiro</strong> do cartão/PIX cai no banco da loja da <strong>máquina</strong>.
                  Ex.: venda do <strong>Maracanã</strong> na máquina da <strong>Barra</strong> → escolha Loja = Maracanã e Máquina = Barra: entra no resultado do Maracanã e na conciliação/taxa da Barra, sem mexer no resultado da Barra.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Lista do dia */}
          {lista === null ? (
            <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lançamento em {formatarData(dia)}.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[0.95rem] font-semibold tracking-tight">Lançamentos de {formatarData(dia)}</p>
                <p className="text-sm font-bold tnum">{formatBRL(totalDia)}</p>
              </div>
              <div className="space-y-2">
                {lista.map((v) => (
                  <Card key={v.id}>
                    <CardContent className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {FORMA_LABEL[v.forma] ?? v.forma}{v.forma === "cartaoParcelado" && v.parcelas ? ` ${v.parcelas}x` : ""}
                          {v.maquinaEmpresaId ? <Badge variant="neutral" className="ml-2">máq. {nomeEmp(v.maquinaEmpresaId)}</Badge> : <Badge variant="neutral" className="ml-2">na loja</Badge>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold tnum">{formatBRL(v.valor)}</p>
                        {podeEditar ? (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" disabled={ocupado === v.id} onClick={() => remover(v.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Lance só os totais do dia por meio de pagamento e por máquina. Cartão/PIX indicam em qual loja a máquina está —
            assim a conciliação daquela loja soma esses valores (o banco recebe tudo junto).
          </p>
        </>
      )}
    </div>
  );
}
