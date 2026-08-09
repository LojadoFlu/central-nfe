"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  obterResumoVendas,
  listarSales,
  listarRecebiveis,
  pdvnetSincronizarVendas,
  type ResumoVendas,
  type Sale,
  type CardReceivable,
} from "@/lib/nfe/repo";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatarData, formatarDataHora } from "@/lib/utils";
import { ShoppingCart, RefreshCw } from "lucide-react";

const FORMA_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartaoDebito: "Cartão débito",
  cartaoParcelado: "Cartão parcelado",
  cartaoRotativo: "Cartão crédito",
  crediario: "Crediário",
  cheque: "Cheque",
  vale: "Vale",
  duplicata: "Duplicata",
};

export default function VendasPage() {
  const { podeAcao } = useAuth();
  const podeSincronizar = podeAcao("integracoes.sincronizar");
  const [resumo, setResumo] = useState<ResumoVendas | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [receb, setReceb] = useState<CardReceivable[]>([]);
  const [aba, setAba] = useState<"vendas" | "recebiveis">("vendas");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [r, s, rc] = await Promise.all([obterResumoVendas(), listarSales(100), listarRecebiveis(100)]);
      setResumo(r);
      setSales(s);
      setReceb(rc);
    } catch (e) {
      setErro((e as Error).message);
      setSales([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function sincronizar() {
    setSincronizando(true);
    setResultado(null);
    setErro(null);
    try {
      const r = await pdvnetSincronizarVendas(0); // mês corrente
      if (r.ok) {
        setResultado(`${r.vendas ?? 0} venda(s) · ${formatBRL(r.totalVendido)} · ${r.recebiveis ?? 0} recebível(is).`);
        await carregar();
      } else {
        setErro(r.erro ?? "Falha na sincronização.");
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  const formas = useMemo(() => {
    const pf = resumo?.porForma ?? {};
    return Object.entries(pf)
      .filter(([, v]) => (v as number) > 0)
      .sort((a, b) => (b[1] as number) - (a[1] as number));
  }, [resumo]);

  return (
    <div>
      <PageHeader
        title="Vendas (PDV)"
        description="Vendas do PDVnet — formas de pagamento e recebíveis de cartão."
        action={
          podeSincronizar ? (
            <Button size="sm" variant="outline" disabled={sincronizando} onClick={sincronizar}>
              <RefreshCw className={`size-4 ${sincronizando ? "animate-spin" : ""}`} />
              {sincronizando ? "Importando…" : "Sincronizar"}
            </Button>
          ) : undefined
        }
      />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}
      {resultado ? <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{resultado}</p> : null}

      {sales === null ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : !resumo || (resumo.vendas ?? 0) === 0 ? (
        <ModulePlaceholder icon={ShoppingCart} title="Sem vendas ainda" etapa="Etapa 3">
          Configure o PDVnet em Configurações e clique em <strong>Sincronizar</strong> para importar as vendas do mês.
        </ModulePlaceholder>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Vendido no período" value={formatBRL(resumo.totalVendido)} />
            <StatCard label="Cartões a receber" value={formatBRL(resumo.totalRecebiveis)} tone="warning" />
            <StatCard label="Líquido previsto" value={formatBRL(resumo.totalLiquido)} tone="success" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {resumo.vendas} venda(s) · {resumo.lojas} loja(s) · período {formatarData(resumo.periodoInicio)} a{" "}
            {formatarData(resumo.periodoFim)} · última sync {formatarDataHora(resumo.ultimaSync)}.
          </p>

          {/* Por forma de pagamento */}
          {formas.length > 0 ? (
            <Card className="mt-4">
              <CardContent className="py-4">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Por forma de pagamento
                </h2>
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

          {/* Abas: vendas / recebíveis */}
          <div className="my-4 flex gap-2">
            {(["vendas", "recebiveis"] as const).map((a) => (
              <button key={a} onClick={() => setAba(a)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${aba === a ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {a === "vendas" ? "Últimas vendas" : "Recebíveis de cartão"}
              </button>
            ))}
          </div>

          {aba === "vendas" ? (
            <div className="space-y-2">
              {(sales ?? []).map((s) => (
                <Card key={s.id}>
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {s.lojaNome ?? `Loja ${s.lojaId}`}
                        {s.cancelada ? <Badge variant="destructive" className="ml-2">Cancelada</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatarDataHora(s.dataHora)}{s.qtdItens ? ` · ${s.qtdItens} item(ns)` : ""}
                        {s.docChave ? " · c/ cupom" : ""}
                      </p>
                    </div>
                    <p className={`font-bold tnum ${s.cancelada ? "text-muted-foreground line-through" : ""}`}>
                      {formatBRL(s.valorTotal)}
                    </p>
                  </CardContent>
                </Card>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">Mostrando as {sales?.length ?? 0} vendas mais recentes.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {receb.map((r) => (
                <Card key={r.id}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.descricaoCartao ?? "Cartão"}</p>
                        <p className="text-xs text-muted-foreground">
                          Parc. {r.parcela ?? 1} · vence {formatarData(r.dataVencimento)}
                          {r.taxaPct != null ? ` · taxa ${r.taxaPct}%` : ""}
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
              <p className="pt-1 text-xs text-muted-foreground">
                Recebíveis previstos (líquido já com a taxa da adquirente). Viram “recebido” após a conciliação bancária (etapa futura).
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
