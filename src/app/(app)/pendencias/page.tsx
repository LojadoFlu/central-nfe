"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Hero } from "@/components/ui/hero";
import { obterPendencias, listarEmpresas, type Pendencias } from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { formatBRL } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Clock, Info, ChevronRight } from "lucide-react";

const SEV = {
  critico: { cor: "bg-destructive/10 text-destructive", icon: AlertTriangle, label: "Crítico" },
  atencao: { cor: "bg-warning/15 text-warning", icon: Clock, label: "Atenção" },
  info: { cor: "bg-primary/10 text-primary", icon: Info, label: "Info" },
} as const;

export default function PendenciasPage() {
  const [dados, setDados] = useState<Pendencias | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void listarEmpresas().then(setEmpresas).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await obterPendencias(empresaId));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const lista = dados?.pendencias ?? [];

  return (
    <div>
      <PageHeader
        title="Pendências"
        description="O que precisa da sua atenção — cruzando PDV, NF-e e contas."
      />

      {empresas.length > 1 ? (
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="mb-4 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas as empresas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
          ))}
        </select>
      ) : null}

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : lista.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-6" />
          </div>
          <p className="font-semibold">Tudo em ordem</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Sem contas vencidas, recebíveis atrasados ou acordos em atraso. O “normal” está automatizado —
            quando surgir uma exceção, ela aparece aqui.
          </p>
        </Card>
      ) : (
        <>
          {/* Resumo por severidade */}
          <div className="mb-4">
            <Hero
              eyebrow="Pendências críticas"
              value={String(dados?.resumo.criticas ?? 0)}
              valueTone={(dados?.resumo.criticas ?? 0) > 0 ? "destructive" : "default"}
              tone={(dados?.resumo.criticas ?? 0) > 0 ? "destructive" : (dados?.resumo.atencao ?? 0) > 0 ? "warning" : "success"}
              subtitle="Exceções que precisam da sua atenção agora"
              metrics={[
                { label: "Atenção", value: String(dados?.resumo.atencao ?? 0), tone: "warning" },
                { label: "Info", value: String(dados?.resumo.info ?? 0) },
              ]}
            />
          </div>

          <div className="space-y-3">
            {lista.map((p) => {
              const s = SEV[p.severidade];
              const Icon = s.icon;
              return (
                <Card key={p.chave} className={p.severidade === "critico" ? "border-destructive/40" : undefined}>
                  <Link href={p.href} className="block">
                    <CardContent className="flex items-center gap-3 py-4">
                      <div className={`grid size-10 shrink-0 place-items-center rounded-full ${s.cor}`}>
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{p.titulo}</p>
                        <p className="text-sm text-muted-foreground">{p.descricao}</p>
                        {p.valor > 0 ? (
                          <p className="mt-0.5 text-sm font-semibold tnum">{formatBRL(p.valor)}</p>
                        ) : null}
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Link>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Tudo calculado de dados sincronizados (PDV, SEFAZ e lançamentos). Toque numa pendência para ir à tela de origem e resolver.
      </p>
    </div>
  );
}

