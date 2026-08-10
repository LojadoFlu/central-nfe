"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Hero } from "@/components/ui/hero";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { obterConciliacaoSaidas, listarEmpresas, type ConciliacaoSaidas } from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { formatBRL, formatarData } from "@/lib/utils";
import { ArrowDownLeft, AlertTriangle, HelpCircle } from "lucide-react";

function periodoEsteMes(): Periodo {
  const d = new Date();
  const de = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de, ate: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}` };
}

const CATEGORIA_LABEL: Record<string, string> = {
  pagamento: "Pagamentos",
  transferencia: "Transferências",
  tarifa: "Tarifas",
  devolucao: "Devoluções",
  outros: "Outros",
};
const TIPO_LABEL: Record<string, string> = { fornecedor: "Fornecedor", despesa: "Despesa fixa", acordo: "Acordo" };

export default function SaidasPage() {
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(periodoEsteMes());
  const [dados, setDados] = useState<ConciliacaoSaidas | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void listarEmpresas().then((es) => {
      setEmpresas(es);
      if (es.length && !empresaId) setEmpresaId(es[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    if (!empresaId || !periodo.de || !periodo.ate) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await obterConciliacaoSaidas(periodo.de, periodo.ate, empresaId));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo]);

  useEffect(() => { void carregar(); }, [carregar]);

  const cats = dados ? Object.entries(dados.banco.porCategoria).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div>
      <PageHeader
        title="Conciliação de saídas"
        description="O que saiu do banco × o que registramos como pago. As exceções são o que precisa da sua atenção."
      />

      <div className="mb-4 space-y-2">
        {empresas.length > 1 ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
          </select>
        ) : null}
        <FiltroPeriodo value={periodo} onChange={setPeriodo} allowClear={false} />
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : dados ? (
        <>
          <Hero
            eyebrow="Saídas do banco"
            value={formatBRL(dados.banco.totalSaidas)}
            subtitle={`${dados.banco.qtd} lançamento(s) de débito no período`}
            metrics={[
              { label: "Pago (registrado)", value: formatBRL(dados.pagas.total), hint: `${dados.pagas.qtd} conta(s)` },
              {
                label: "Conciliado",
                value: formatBRL(dados.conciliado.valor),
                hint: dados.pagas.qtd ? `${dados.conciliado.qtd}/${dados.pagas.qtd} casadas` : "—",
                tone: dados.conciliado.qtd === dados.pagas.qtd && dados.pagas.qtd > 0 ? "success" : "default",
              },
            ]}
          />

          {/* Exceção 1: pago no sistema, sem débito no banco */}
          <Secao
            icon={AlertTriangle}
            titulo="Pago no sistema, sem débito no banco"
            subtitulo="Contas marcadas como pagas que não têm um débito compatível no extrato — pode ser pagamento em dinheiro, conta/valor errado ou baixa indevida."
            total={dados.pagasSemBancoTotal}
            qtd={dados.pagasSemBanco.length}
            tom="warning"
          >
            {dados.pagasSemBanco.map((p) => (
              <div key={p.ref} className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.descricao}</p>
                  <p className="text-xs text-muted-foreground">{TIPO_LABEL[p.tipo] ?? p.tipo} · pago em {formatarData(p.data)}</p>
                </div>
                <p className="shrink-0 font-bold tnum">{formatBRL(p.valor)}</p>
              </div>
            ))}
          </Secao>

          {/* Exceção 2: débito de pagamento no banco, sem conta */}
          <Secao
            icon={HelpCircle}
            titulo="Saiu do banco, sem conta registrada"
            subtitulo="Débitos de pagamento no extrato que não casaram com nenhuma conta — pode ser uma conta paga mas não lançada, ou um pagamento que falta cadastrar."
            total={dados.debitosSemContaTotal}
            qtd={dados.debitosSemConta.length}
            tom="warning"
          >
            {dados.debitosSemConta.map((dbt) => (
              <div key={dbt.fitid} className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{dbt.memo || "(sem descrição)"}</p>
                  <p className="text-xs text-muted-foreground">{formatarData(dbt.dia)}</p>
                </div>
                <p className="shrink-0 font-bold tnum text-destructive">{formatBRL(dbt.valor)}</p>
              </div>
            ))}
          </Secao>

          {/* Composição das saídas do banco */}
          <Card className="mt-4">
            <CardContent className="py-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Saídas do banco por natureza</h2>
              {cats.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem saídas no período (importe o extrato em Banco).</p>
              ) : (
                <div className="space-y-1">
                  {cats.map(([cat, v]) => (
                    <div key={cat} className="flex items-center justify-between border-b border-border/50 py-1.5 text-sm last:border-0">
                      <span>{CATEGORIA_LABEL[cat] ?? cat}</span>
                      <span className="font-medium tnum">{formatBRL(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="mt-4 text-xs text-muted-foreground">
            <ArrowDownLeft className="mr-1 inline size-3.5 align-[-2px]" />
            Casa cada conta paga (fornecedor, despesa fixa, acordo) com um débito do extrato por valor (±1%) e data (±3 dias).
            Transferências e tarifas do banco são saídas legítimas sem conta e não entram na segunda exceção. &ldquo;Pago&rdquo; nunca é
            inferido do extrato — vem da baixa manual, sempre com autor e data.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Secao({
  icon: Icon, titulo, subtitulo, total, qtd, tom, children,
}: {
  icon: typeof AlertTriangle; titulo: string; subtitulo: string; total: number; qtd: number; tom: "warning"; children: React.ReactNode;
}) {
  return (
    <Card className="mt-4">
      <CardContent className="py-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Icon className={`size-4 ${tom === "warning" ? "text-warning" : ""}`} />
              {titulo}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-bold tnum">{formatBRL(total)}</p>
            <Badge variant={qtd ? "warning" : "success"}>{qtd} item(ns)</Badge>
          </div>
        </div>
        {qtd === 0 ? (
          <p className="text-sm text-success">Tudo casado — nada a investigar aqui. ✓</p>
        ) : (
          <div className="mt-2">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}
