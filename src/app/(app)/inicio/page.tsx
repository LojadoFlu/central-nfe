"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBRL, formatCNPJ, formatarData, normalizar, diasAte } from "@/lib/utils";
import {
  listarEmpresas,
  listarDocumentos,
  listarParcelas,
  listarNfses,
  pdvnetResumoVendas,
  obterPendencias,
  type NfeDocumento,
  type Parcela,
  type NfseDocumento,
  type ResumoVendasFiltrado,
  type Pendencias,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { FileText, ChevronRight } from "lucide-react";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function mesmoMes(iso: string | null | undefined, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

/** Métrica de apoio dentro do hero — toque com feedback, linka pra tela de origem. */
function HeroMetric({ href, label, value, tone = "default" }: {
  href: string; label: string; value: string; tone?: "default" | "success" | "warning" | "destructive";
}) {
  const cor = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <Link href={href} className="press flex flex-col gap-1 p-4 transition-colors hover:bg-accent/40">
      <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</span>
      <span className={cn("text-base font-bold leading-none tracking-[-0.01em] tnum sm:text-lg", cor)}>{value}</span>
    </Link>
  );
}
function primeiroDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function InicioPage() {
  const { isAdmin, podeModulo } = useAuth();
  const podeFin = isAdmin || podeModulo("financeiro");
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [docs, setDocs] = useState<NfeDocumento[] | null>(null);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [nfses, setNfses] = useState<NfseDocumento[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  // Painel do dono (grupo) — só p/ quem tem o módulo financeiro
  const [vendasMes, setVendasMes] = useState<ResumoVendasFiltrado | null>(null);
  const [pend, setPend] = useState<Pendencias | null>(null);

  const carregar = useCallback(async () => {
    const [emps, ds, ps, ns] = await Promise.all([
      listarEmpresas(),
      listarDocumentos(200),
      listarParcelas(300),
      listarNfses(300),
    ]);
    setEmpresas(emps);
    setDocs(ds);
    setParcelas(ps);
    setNfses(ns);
  }, []);

  const carregarPainel = useCallback(async () => {
    if (!podeFin) return;
    try {
      const [v, p] = await Promise.all([
        pdvnetResumoVendas(primeiroDiaMes(), hojeISO()),
        obterPendencias(),
      ]);
      setVendasMes(v);
      setPend(p);
    } catch { /* sem permissão/dados — silencioso */ }
  }, [podeFin]);

  useEffect(() => {
    void carregar();
    void carregarPainel();
  }, [carregar, carregarPainel]);

  const filtrados = useMemo(() => {
    const termo = normalizar(fornecedor);
    return (docs ?? []).filter((d) => {
      if (empresaId && d.companyId !== empresaId) return false;
      if (termo) {
        const alvo = normalizar(d.xNomeEmit) + " " + (d.cnpjEmit ?? "");
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [docs, empresaId, fornecedor]);

  const resumo = useMemo(() => {
    const agora = new Date();
    const doMes = filtrados.filter((d) => mesmoMes(d.dhEmi, agora));
    const comprasMes = doMes.reduce((s, d) => s + (d.vNF ?? 0), 0);
    let aVencer = 0;
    let vencido = 0;
    const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
    for (const p of parcelas) {
      if (empresaId && p.companyId !== empresaId) continue;
      if (p.statusPagamento === "pago") continue; // já pagas não entram em vencidas/a vencer
      if (p.migradoAcordo) continue;              // migrada p/ acordo: o acordo carrega a dívida (igual ao Financeiro)
      const dias = diasAte(p.vencimento);
      if (dias === null) continue;
      if (dias < 0) vencido += p.valor ?? 0;                                   // vencidas (acumulado)
      else if ((p.vencimento ?? "").slice(0, 7) === mesAtual) aVencer += p.valor ?? 0; // a vencer só deste mês
    }
    // Serviços (NFS-e) do mês — respeita o filtro de empresa.
    let servicosMes = 0;
    for (const n of nfses) {
      if (empresaId && n.companyId !== empresaId) continue;
      if (mesmoMes(n.dhEmi, agora)) servicosMes += n.vServ ?? n.vLiq ?? 0;
    }
    return { comprasMes, notasMes: doMes.length, total: filtrados.length, aVencer, vencido, servicosMes };
  }, [filtrados, parcelas, empresaId, nfses]);

  // A pagar do GRUPO (todas as empresas) — atrasadas em aberto + a vencer NESTE mês.
  // (Antes somava todo o futuro dos parcelados, o que não batia com a visão mensal.)
  const aPagarGrupo = useMemo(() => {
    const ag = new Date();
    const mesAtual = `${ag.getFullYear()}-${String(ag.getMonth() + 1).padStart(2, "0")}`;
    return parcelas.reduce((s, p) => {
      if (p.statusPagamento === "pago" || p.migradoAcordo) return s; // migrada p/ acordo sai (o acordo carrega)
      const dias = diasAte(p.vencimento);
      if (dias === null) return s;
      const noMes = (p.vencimento ?? "").slice(0, 7) === mesAtual;
      return (dias < 0 || noMes) ? s + (p.valor ?? 0) : s; // atrasada OU vence neste mês
    }, 0);
  }, [parcelas]);
  const pendCount = (pend?.resumo.criticas ?? 0) + (pend?.resumo.atencao ?? 0);

  const carregando = docs === null;
  const agora = new Date();
  const saudacao = agora.getHours() < 12 ? "Bom dia" : agora.getHours() < 18 ? "Boa tarde" : "Boa noite";
  const mesAno = `${MESES[agora.getMonth()]} de ${agora.getFullYear()}`;

  return (
    <div>
      {/* Cabeçalho editorial */}
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {saudacao} · {mesAno}
        </p>
        <h1 className="mt-1 text-[1.75rem] font-bold leading-[1.05] tracking-[-0.022em] text-balance sm:text-[2.25rem]">
          {podeFin ? "Seu mês na Loja do Flu" : "Início"}
        </h1>
      </div>

      {/* Painel do dono (grupo) — hero, só p/ módulo financeiro */}
      {podeFin ? (
        <section className="mb-8">
          <div className="relative overflow-hidden rounded-[var(--radius)] border border-border/60 bg-card shadow-float">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent" />
            <Link href="/vendas" className="press relative block p-5 transition-colors hover:bg-accent/30 sm:p-6">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Vendas do mês</p>
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-2 text-[2.3rem] font-bold leading-none tracking-[-0.03em] tnum sm:text-[2.9rem]">
                {vendasMes ? formatBRL(vendasMes.totalVendido) : "…"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">Todas as lojas do grupo · {mesAno}</p>
            </Link>
            <div className="relative grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
              <HeroMetric href="/vendas" label="Cartão a receber" value={vendasMes ? formatBRL(vendasMes.cartaoAReceber ?? vendasMes.totalLiquido) : "…"} tone="warning" />
              <HeroMetric href="/financeiro" label="A pagar no mês" value={carregando ? "…" : formatBRL(aPagarGrupo)} tone="warning" />
              <HeroMetric href="/pendencias" label="Pendências" value={pend ? String(pendCount) : "…"} tone={pendCount > 0 ? "destructive" : "default"} />
            </div>
          </div>
        </section>
      ) : null}

      {/* Fiscal & compras */}
      <h2 className="mb-3 text-[0.95rem] font-semibold tracking-tight">Fiscal & compras</h2>

      {/* Filtros */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Todas as empresas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.razaoSocial}
            </option>
          ))}
        </select>
        <Input
          placeholder="Filtrar por fornecedor…"
          value={fornecedor}
          onChange={(e) => setFornecedor(e.target.value)}
          className="h-11"
        />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Compras do mês" value={carregando ? "…" : formatBRL(resumo.comprasMes)} />
        <Link href="/nfses" className="press block rounded-[var(--radius)]">
          <StatCard label="Serviços do mês" value={carregando ? "…" : formatBRL(resumo.servicosMes)} tone="success" />
        </Link>
        <StatCard label="Notas do mês" value={carregando ? "…" : String(resumo.notasMes)} />
        <StatCard label="A vencer no mês" value={carregando ? "…" : formatBRL(resumo.aVencer)} tone="warning" />
        <StatCard label="Vencidas (em aberto)" value={carregando ? "…" : formatBRL(resumo.vencido)} tone="destructive" />
      </div>

      {/* Últimas notas (filtradas) */}
      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">
            Últimas notas {filtrados.length ? <span className="text-muted-foreground">· {filtrados.length}</span> : null}
          </h2>
          <Link href="/notas" className="press text-sm font-medium text-primary hover:underline">
            Ver todas
          </Link>
        </div>

        {carregando ? (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : filtrados.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <FileText className="size-6" />
            </div>
            <div>
              <p className="font-semibold">
                {docs && docs.length > 0 ? "Nenhuma nota com esses filtros" : "Nenhuma nota ainda"}
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {docs && docs.length > 0
                  ? "Ajuste os filtros de empresa/fornecedor."
                  : "As notas aparecem após a sincronização com a SEFAZ (Integrações → Sincronizar)."}
              </p>
            </div>
            {(!docs || docs.length === 0) && (
              <div className="flex gap-2">
                <Link href="/empresas" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Empresas
                </Link>
                <Link href="/integracoes" className={cn(buttonVariants({ size: "sm" }))}>
                  Sincronizar
                </Link>
              </div>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {filtrados.slice(0, 8).map((d) => (
              <Card key={d.id} className="press overflow-hidden transition-colors hover:bg-accent/40">
                <Link href={`/notas/${encodeURIComponent(d.id)}`} className="block">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.xNomeEmit ?? "Fornecedor não identificado"}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.cnpjEmit ? formatCNPJ(d.cnpjEmit) : "—"}
                          {d.nNF ? ` · NF ${d.nNF}` : ""}
                        </p>
                      </div>
                      <Badge variant={d.temXmlCompleto ? "success" : "neutral"}>
                        {d.temXmlCompleto ? "Completo" : "Resumo"}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-end justify-between">
                      <p className="text-lg font-bold tnum">{formatBRL(d.vNF)}</p>
                      <p className="text-xs text-muted-foreground">{formatarData(d.dhEmi)}</p>
                    </div>
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
