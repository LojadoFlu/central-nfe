"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { listarDocumentos, type NfeDocumento } from "@/lib/nfe/repo";
import { formatBRL, formatCNPJ, formatarData } from "@/lib/utils";
import { FileText } from "lucide-react";

export default function NotasPage() {
  const [docs, setDocs] = useState<NfeDocumento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDocs(await listarDocumentos());
    } catch (e) {
      setErro((e as Error).message);
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div>
      <PageHeader title="Notas" description="NF-e emitidas contra as empresas do grupo." />

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : null}

      {docs === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : docs.length === 0 ? (
        <ModulePlaceholder icon={FileText} title="Nenhuma nota ainda" etapa="Aguardando sincronização">
          As notas aparecem aqui após a sincronização com a SEFAZ (Integrações →
          Sincronizar). Em homologação não há documentos reais — os XMLs entram
          quando o ambiente for produção.
        </ModulePlaceholder>
      ) : (
        <div className="space-y-3">
          {docs.map((d) => (
            <Card key={d.id} className="transition-colors hover:bg-accent/50">
              <Link href={`/notas/${encodeURIComponent(d.id)}`} className="block">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.xNomeEmit ?? "Fornecedor não identificado"}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.cnpjEmit ? formatCNPJ(d.cnpjEmit) : "—"}
                      {d.nNF ? ` · NF ${d.nNF}` : ""}
                      {d.serie ? `/${d.serie}` : ""}
                    </p>
                  </div>
                  <Badge variant={d.temXmlCompleto ? "success" : "neutral"}>
                    {d.temXmlCompleto ? "XML completo" : "Resumo"}
                  </Badge>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <p className="text-lg font-bold tnum">{formatBRL(d.vNF)}</p>
                  <p className="text-xs text-muted-foreground">{formatarData(d.dhEmi)}</p>
                </div>
                {d.chNFe ? (
                  <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{d.chNFe}</p>
                ) : null}
              </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
