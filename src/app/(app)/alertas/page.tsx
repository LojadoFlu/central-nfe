"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  TrendingUp,
  FileQuestion,
  CloudOff,
  BellOff,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listarCertificados,
  listarParcelas,
  listarDocumentos,
  listarSyncStates,
  type Parcela,
  type NfeDocumento,
  type SyncEstado,
} from "@/lib/nfe/repo";
import { situacaoCertificado, type CertificateMeta } from "@/lib/nfe/types";
import { FiltroPeriodo, noPeriodo, PERIODO_VAZIO, type Periodo } from "@/components/ui/filtro-periodo";
import { formatBRL, formatarData, diasAte } from "@/lib/utils";

type Sev = "destructive" | "warning" | "info";
interface Alerta {
  sev: Sev;
  icon: LucideIcon;
  titulo: string;
  desc: string;
  href?: string;
  cta?: string;
}

const CORES: Record<Sev, string> = {
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-primary/10 text-primary",
};

export default function AlertasPage() {
  const [certs, setCerts] = useState<CertificateMeta[] | null>(null);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [docs, setDocs] = useState<NfeDocumento[]>([]);
  const [sync, setSync] = useState<SyncEstado[]>([]);
  const [limite, setLimite] = useState(50000);
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_VAZIO);

  useEffect(() => {
    const v = Number(localStorage.getItem("nfe_alerta_limite") || "50000");
    if (Number.isFinite(v) && v > 0) setLimite(v);
  }, []);
  function salvarLimite(v: number) {
    setLimite(v);
    localStorage.setItem("nfe_alerta_limite", String(v));
  }

  const carregar = useCallback(async () => {
    const [c, p, d, s] = await Promise.all([
      listarCertificados(),
      listarParcelas(300),
      listarDocumentos(300),
      listarSyncStates(),
    ]);
    setCerts(c);
    setParcelas(p);
    setDocs(d);
    setSync(s);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alertas = useMemo(() => {
    const out: Alerta[] = [];
    // O período escopa os alertas baseados em data: contas (por vencimento) e NF-e (por emissão).
    const parcelasP = parcelas.filter((p) => noPeriodo(p.vencimento, periodo));
    const docsP = docs.filter((d) => noPeriodo(d.dhEmi, periodo));

    // Certificado vencendo/vencido
    for (const c of certs ?? []) {
      const { situacao, diasRestantes } = situacaoCertificado(c.validadeFim);
      if (situacao === "vencido") {
        out.push({
          sev: "destructive",
          icon: ShieldAlert,
          titulo: "Certificado vencido",
          desc: `${c.razaoSocial ?? c.cnpj} — venceu em ${formatarData(c.validadeFim)}.`,
          href: "/certificado",
          cta: "Renovar",
        });
      } else if (situacao === "vencendo") {
        out.push({
          sev: "warning",
          icon: ShieldAlert,
          titulo: "Certificado vencendo",
          desc: `${c.razaoSocial ?? c.cnpj} — ${diasRestantes} dias restantes.`,
          href: "/certificado",
          cta: "Ver",
        });
      }
    }

    // Contas vencidas e a vencer (7 dias)
    let vencidasN = 0;
    let vencidasV = 0;
    let proxN = 0;
    let proxV = 0;
    for (const p of parcelasP) {
      if (p.statusPagamento === "pago") continue; // baixada — fora dos alertas
      const dias = diasAte(p.vencimento);
      if (dias === null) continue;
      if (dias < 0) {
        vencidasN++;
        vencidasV += p.valor ?? 0;
      } else if (dias <= 7) {
        proxN++;
        proxV += p.valor ?? 0;
      }
    }
    if (vencidasN > 0) {
      out.push({
        sev: "destructive",
        icon: AlertTriangle,
        titulo: `${vencidasN} conta(s) vencida(s)`,
        desc: `Total em atraso: ${formatBRL(vencidasV)}.`,
        href: "/financeiro",
        cta: "Ver contas",
      });
    }
    if (proxN > 0) {
      out.push({
        sev: "warning",
        icon: Clock,
        titulo: `${proxN} conta(s) vencem em 7 dias`,
        desc: `Total a vencer: ${formatBRL(proxV)}.`,
        href: "/financeiro",
        cta: "Ver contas",
      });
    }

    // NF-e acima do limite
    const acima = docsP.filter((d) => (d.vNF ?? 0) >= limite);
    if (acima.length > 0) {
      out.push({
        sev: "info",
        icon: TrendingUp,
        titulo: `${acima.length} NF-e acima de ${formatBRL(limite)}`,
        desc: `Maior: ${formatBRL(Math.max(...acima.map((d) => d.vNF ?? 0)))}.`,
        href: "/notas",
        cta: "Ver notas",
      });
    }

    // Manifestação pendente (notas resumo)
    const resumo = docsP.filter((d) => !d.temXmlCompleto);
    if (resumo.length > 0) {
      out.push({
        sev: "info",
        icon: FileQuestion,
        titulo: `${resumo.length} nota(s) sem XML completo`,
        desc: "Manifeste (Ciência) para destravar o XML completo.",
        href: "/notas",
        cta: "Ver notas",
      });
    }

    // Falha/bloqueio de sincronização
    for (const s of sync) {
      if (s.status === "bloqueado" || s.status === "erro") {
        out.push({
          sev: s.status === "erro" ? "destructive" : "warning",
          icon: CloudOff,
          titulo: s.status === "erro" ? "Falha de sincronização" : "Sincronização em recuo (656)",
          desc: `${s.cnpj ?? s.companyId ?? ""} — ${s.ultimaMensagem ?? "verifique as integrações"}.`,
          href: "/integracoes",
          cta: "Integrações",
        });
      }
    }

    return out;
  }, [certs, parcelas, docs, sync, limite, periodo]);

  return (
    <div>
      <PageHeader title="Alertas" description="Central de avisos da operação." />

      <FiltroPeriodo value={periodo} onChange={setPeriodo} className="mb-1" />
      <p className="mb-4 px-1 text-[11px] text-muted-foreground">
        O período filtra contas (por vencimento) e NF-e (por emissão). Certificado e sincronização aparecem sempre.
      </p>

      {/* Config do limite */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="limite">Alertar NF-e acima de (R$)</Label>
            <Input
              id="limite"
              type="number"
              inputMode="numeric"
              value={limite}
              onChange={(e) => salvarLimite(Number(e.target.value) || 0)}
              className="h-10 w-40"
            />
          </div>
          <p className="text-xs text-muted-foreground">O limite fica salvo neste dispositivo.</p>
        </CardContent>
      </Card>

      {certs === null ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : alertas.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-success/15 text-success">
            <BellOff className="size-6" />
          </div>
          <p className="font-semibold">Nenhum alerta</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Tudo em ordem: sem contas vencidas, certificado válido e sincronização ok.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {alertas.map((a, i) => {
            const Icon = a.icon;
            return (
              <Card key={i}>
                <CardContent className="flex items-center gap-3 py-4">
                  <div className={`grid size-10 shrink-0 place-items-center rounded-full ${CORES[a.sev]}`}>
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.titulo}</p>
                    <p className="text-sm text-muted-foreground">{a.desc}</p>
                  </div>
                  {a.href ? (
                    <Link href={a.href} className="shrink-0 text-sm font-medium text-primary hover:underline">
                      {a.cta ?? "Ver"}
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
