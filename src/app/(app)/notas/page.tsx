"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarDocumentos,
  sincronizarAgora,
  obterSyncState,
  type NfeDocumento,
  type SyncEstado,
  type ResultadoSync,
} from "@/lib/nfe/repo";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatCNPJ, formatarData, formatarDataHora } from "@/lib/utils";
import { FileText, RefreshCw } from "lucide-react";

const COMPANY_ID = "59255964000123";

export default function NotasPage() {
  const { role } = useAuth();
  const podeSincronizar = role === "admin" || role === "fiscal";
  const [docs, setDocs] = useState<NfeDocumento[] | null>(null);
  const [estado, setEstado] = useState<SyncEstado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ds, st] = await Promise.all([listarDocumentos(), obterSyncState(COMPANY_ID)]);
      setDocs(ds);
      setEstado(st);
    } catch (e) {
      setErro((e as Error).message);
      setDocs([]);
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
      const r: ResultadoSync = await sincronizarAgora(COMPANY_ID);
      if (r.ok) {
        setResultado(
          r.bloqueado
            ? `Em recuo da SEFAZ (656). ${r.xMotivo ?? ""}`
            : `${r.novos ?? 0} nova(s) nota(s)/evento(s). cStat ${r.cStat ?? "—"}.`,
        );
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

  return (
    <div>
      <PageHeader
        title="Notas"
        description="NF-e emitidas contra as empresas do grupo."
        action={
          podeSincronizar ? (
            <Button size="sm" variant="outline" disabled={sincronizando} onClick={sincronizar}>
              <RefreshCw className={`size-4 ${sincronizando ? "animate-spin" : ""}`} />
              {sincronizando ? "Sincronizando…" : "Sincronizar"}
            </Button>
          ) : undefined
        }
      />

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : null}
      {resultado ? (
        <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{resultado}</p>
      ) : null}

      {estado?.ultimaSync ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Última sincronização: {formatarDataHora(estado.ultimaSync)} · cStat {estado.ultimoCStat ?? "—"}
          {estado.status === "bloqueado" ? " · em recuo (656)" : ""} · a automática roda a cada 6h.
        </p>
      ) : null}

      {docs === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : docs.length === 0 ? (
        <ModulePlaceholder icon={FileText} title="Nenhuma nota ainda" etapa="Aguardando sincronização">
          As notas aparecem aqui após a sincronização com a SEFAZ. Use o botão
          <strong> Sincronizar</strong> acima. A sincronização automática roda a cada 6h.
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
