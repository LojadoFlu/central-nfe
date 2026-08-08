"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { documentosDoFornecedor, type NfeDocumento } from "@/lib/nfe/repo";
import { formatBRL, formatCNPJ, formatarData } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export default function FornecedorDetalhePage() {
  const params = useParams<{ cnpj: string }>();
  const cnpj = decodeURIComponent(params.cnpj);
  const [docs, setDocs] = useState<NfeDocumento[] | null>(null);

  const carregar = useCallback(async () => {
    setDocs(await documentosDoFornecedor(cnpj));
  }, [cnpj]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const resumo = useMemo(() => {
    const lista = docs ?? [];
    const total = lista.reduce((s, d) => s + (d.vNF ?? 0), 0);
    const nome = lista.find((d) => d.xNomeEmit)?.xNomeEmit ?? "Fornecedor";
    return { total, qtd: lista.length, ticket: lista.length ? total / lista.length : 0, nome };
  }, [docs]);

  // Evolução mensal (últimos meses com compras).
  const porMes = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const d of docs ?? []) {
      if (!d.dhEmi) continue;
      const k = d.dhEmi.slice(0, 7); // yyyy-MM
      mapa.set(k, (mapa.get(k) ?? 0) + (d.vNF ?? 0));
    }
    return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [docs]);

  if (docs === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div>
      <Link href="/fornecedores" className="mb-3 inline-flex items-center gap-1 text-sm text-primary">
        <ArrowLeft className="size-4" /> Fornecedores
      </Link>

      <PageHeader title={resumo.nome} description={formatCNPJ(cnpj)} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total comprado" value={formatBRL(resumo.total)} />
        <StatCard label="Notas" value={String(resumo.qtd)} />
        <StatCard label="Ticket médio" value={formatBRL(resumo.ticket)} />
      </div>

      {porMes.length > 0 ? (
        <Card className="mt-4">
          <CardContent className="py-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Evolução mensal
            </h2>
            <div className="divide-y divide-border">
              {porMes.map(([mes, valor]) => (
                <div key={mes} className="flex justify-between py-1.5 text-sm">
                  <span className="text-muted-foreground">
                    {mes.split("-").reverse().join("/")}
                  </span>
                  <span className="font-medium tnum">{formatBRL(valor)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Notas ({docs.length})
      </h2>
      <div className="space-y-3">
        {docs.map((d) => (
          <Card key={d.id} className="transition-colors hover:bg-accent/50">
            <Link href={`/notas/${encodeURIComponent(d.id)}`} className="block">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      NF {d.nNF ?? "—"}
                      {d.serie ? `/${d.serie}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatarData(d.dhEmi)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="font-bold tnum">{formatBRL(d.vNF)}</p>
                    <Badge variant={d.temXmlCompleto ? "success" : "neutral"}>
                      {d.temXmlCompleto ? "Completo" : "Resumo"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
