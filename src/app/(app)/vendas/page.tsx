"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hero } from "@/components/ui/hero";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  pdvnetResumoVendas,
  pdvnetSincronizarVendas,
  listarSales,
  listarRecebiveis,
  listarStores,
  type ResumoVendasFiltrado,
  type Sale,
  type CardReceivable,
  type StorePdv,
} from "@/lib/nfe/repo";
import { useAuth } from "@/lib/auth/auth-provider";
import { FiltroPeriodo } from "@/components/ui/filtro-periodo";
import { formatBRL, formatarData, formatarDataHora } from "@/lib/utils";
import { ShoppingCart, RefreshCw } from "lucide-react";

const FORMA_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro", pix: "PIX", cartaoDebito: "Cartão débito",
  cartaoParcelado: "Cartão parcelado", cartaoRotativo: "Cartão crédito",
  crediario: "Crediário", cheque: "Cheque", vale: "Vale", duplicata: "Duplicata",
};

function primeiroDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function ultimoDiaMes(): string {
  const d = new Date();
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}`;
}

export default function VendasPage() {
  const { podeAcao } = useAuth();
  const podeSincronizar = podeAcao("integracoes.sincronizar");
  const [de, setDe] = useState(primeiroDiaMes());
  const [ate, setAte] = useState(ultimoDiaMes());
  const [grupo, setGrupo] = useState("");
  const [resumo, setResumo] = useState<ResumoVendasFiltrado | null>(null);
  const [carregandoResumo, setCarregandoResumo] = useState(true);
  const [sales, setSales] = useState<Sale[]>([]);
  const [receb, setReceb] = useState<CardReceivable[]>([]);
  const [stores, setStores] = useState<StorePdv[]>([]);
  const [aba, setAba] = useState<"vendas" | "recebiveis">("vendas");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // grupo de cada loja (p/ filtrar as listas no cliente)
  const grupoDaLoja = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of stores) m.set(s.id, s.grupoNome || s.nome || String(s.id));
    return m;
  }, [stores]);

  const carregarResumo = useCallback(async () => {
    setCarregandoResumo(true);
    setErro(null);
    try {
      const r = await pdvnetResumoVendas(de, ate, grupo);
      setResumo(r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregandoResumo(false);
    }
  }, [de, ate, grupo]);

  const carregarListas = useCallback(async () => {
    try {
      const [s, rc, st] = await Promise.all([listarSales(200), listarRecebiveis(200), listarStores()]);
      setSales(s);
      setReceb(rc);
      setStores(st);
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => { void carregarListas(); }, [carregarListas]);
  useEffect(() => { void carregarResumo(); }, [carregarResumo]);

  async function sincronizar() {
    setSincronizando(true);
    setResultado(null);
    setErro(null);
    try {
      const r = await pdvnetSincronizarVendas(0);
      if (r.ok) {
        setResultado(`${r.vendas ?? 0} venda(s) · ${formatBRL(r.totalVendido)} importado(s).`);
        await Promise.all([carregarResumo(), carregarListas()]);
      } else setErro(r.erro ?? "Falha na sincronização.");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  const formas = useMemo(
    () => Object.entries(resumo?.porForma ?? {}).filter(([, v]) => (v as number) > 0).sort((a, b) => (b[1] as number) - (a[1] as number)),
    [resumo],
  );

  // Taxa média REAL de cartão = (bruto − líquido) / bruto, do período/loja filtrado.
  const taxaCartao = useMemo(() => {
    const bruto = resumo?.totalRecebiveis ?? 0;
    const liq = resumo?.totalLiquido ?? 0;
    if (bruto <= 0) return null;
    return { pct: (1 - liq / bruto) * 100, taxas: bruto - liq, bruto };
  }, [resumo]);

  // listas filtradas por grupo + período (cliente)
  const noFiltro = (lojaId?: number, dia?: string) => {
    if (grupo && grupoDaLoja.get(lojaId ?? -1) !== grupo) return false;
    if (dia && (dia < de || dia > ate)) return false;
    return true;
  };
  const salesFiltradas = useMemo(
    () => sales.filter((s) => noFiltro(s.lojaId, (s.dataHora ?? "").slice(0, 10))),
    [sales, grupo, de, ate, grupoDaLoja],
  );
  const recebFiltrados = useMemo(
    () => receb.filter((r) => noFiltro(r.lojaId, (r.dataVencimento ?? "").slice(0, 10) || undefined)),
    [receb, grupo, grupoDaLoja],
  );

  const semDados = !carregandoResumo && resumo && resumo.count === 0 && (resumo.totalVendido ?? 0) === 0;

  return (
    <div>
      <PageHeader
        title="Vendas (PDV)"
        description="Vendas do PDVnet — por loja e período. Sincroniza automaticamente todo dia às 6h."
        action={
          podeSincronizar ? (
            <Button size="sm" variant="outline" disabled={sincronizando} onClick={sincronizar}>
              <RefreshCw className={`size-4 ${sincronizando ? "animate-spin" : ""}`} />
              {sincronizando ? "Importando…" : "Sincronizar"}
            </Button>
          ) : undefined
        }
      />

      {/* Filtros */}
      <div className="mb-4 space-y-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">Loja</label>
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64">
            <option value="">Todas as lojas</option>
            {(resumo?.grupos ?? []).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <FiltroPeriodo
          value={{ de, ate }}
          onChange={(p) => { setDe(p.de); setAte(p.ate); }}
          allowClear={false}
        />
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}
      {resultado ? <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{resultado}</p> : null}

      {carregandoResumo && !resumo ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : semDados ? (
        <ModulePlaceholder icon={ShoppingCart} title="Sem vendas no filtro" etapa="Vendas">
          Ajuste o período/loja, ou clique em <strong>Sincronizar</strong> para importar as vendas do mês.
        </ModulePlaceholder>
      ) : (
        <>
          <Hero
            eyebrow="Vendido no período"
            value={formatBRL(resumo?.totalVendido)}
            subtitle="Vendas do PDV no período/loja selecionados"
            metrics={[
              { label: "Cartões a receber", value: formatBRL(resumo?.totalRecebiveis), tone: "warning" },
              { label: "Líquido previsto", value: formatBRL(resumo?.totalLiquido), tone: "success" },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {resumo?.count ?? 0} venda(s){grupo ? ` · ${grupo}` : " · todas as lojas"} · {formatarData(de)} a {formatarData(ate)}
            {carregandoResumo ? " · atualizando…" : ""}
          </p>

          {taxaCartao ? (
            <Card className="mt-3">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Taxa média de cartão (real)</p>
                  <p className="text-2xl font-bold tnum text-destructive">
                    {taxaCartao.pct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p><span className="font-medium text-destructive tnum">{formatBRL(taxaCartao.taxas)}</span> em taxas</p>
                  <p>sobre {formatBRL(taxaCartao.bruto)} em cartões</p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {formas.length > 0 ? (
            <Card className="mt-4">
              <CardContent className="py-4">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Por forma de pagamento</h2>
                <div className="divide-y divide-border">
                  {formas.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-muted-foreground">{FORMA_LABEL[k] ?? k}</span>
                      <span className="font-medium tnum">{formatBRL(v as number)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="my-4 flex gap-2">
            {(["vendas", "recebiveis"] as const).map((a) => (
              <button key={a} onClick={() => setAba(a)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${aba === a ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {a === "vendas" ? "Vendas recentes" : "Recebíveis"}
              </button>
            ))}
          </div>

          {aba === "vendas" ? (
            <div className="space-y-2">
              {salesFiltradas.slice(0, 100).map((s) => (
                <Card key={s.id}>
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {grupoDaLoja.get(s.lojaId ?? -1) ?? s.lojaNome ?? `Loja ${s.lojaId}`}
                        {s.cancelada ? <Badge variant="destructive" className="ml-2">Cancelada</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatarDataHora(s.dataHora)}{s.qtdItens ? ` · ${s.qtdItens} item(ns)` : ""}{s.docChave ? " · c/ cupom" : ""}
                      </p>
                    </div>
                    <p className={`font-bold tnum ${s.cancelada ? "text-muted-foreground line-through" : ""}`}>{formatBRL(s.valorTotal)}</p>
                  </CardContent>
                </Card>
              ))}
              {salesFiltradas.length === 0 ? <p className="text-sm text-muted-foreground">Sem vendas recentes neste filtro.</p> : null}
            </div>
          ) : (
            <div className="space-y-2">
              {recebFiltrados.slice(0, 100).map((r) => (
                <Card key={r.id}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.descricaoCartao ?? "Cartão"}</p>
                        <p className="text-xs text-muted-foreground">
                          Parc. {r.parcela ?? 1} · vence {formatarData(r.dataVencimento)}{r.taxaPct != null ? ` · taxa ${r.taxaPct}%` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold tnum text-success">{formatBRL(r.liquido ?? r.valor)}</p>
                        <p className="text-[11px] text-muted-foreground tnum">bruto {formatBRL(r.valor)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {recebFiltrados.length === 0 ? <p className="text-sm text-muted-foreground">Sem recebíveis recentes neste filtro.</p> : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
