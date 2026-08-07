"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { listarEmpresas, testarConexao, type ResultadoConexao } from "@/lib/nfe/repo";
import { formatCNPJ } from "@/lib/utils";
import type { Company } from "@/lib/nfe/types";
import { Plug, RefreshCw } from "lucide-react";

export default function IntegracoesPage() {
  const [empresas, setEmpresas] = useState<Company[] | null>(null);
  const [testando, setTestando] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, ResultadoConexao>>({});

  const carregar = useCallback(async () => {
    try {
      setEmpresas(await listarEmpresas());
    } catch {
      setEmpresas([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function testar(id: string) {
    setTestando(id);
    try {
      const r = await testarConexao(id);
      setResultados((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setResultados((m) => ({ ...m, [id]: { ok: false, erro: (e as Error).message } }));
    } finally {
      setTestando(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Integrações"
        description="NF-e / SEFAZ — teste de conexão (NFeDistribuicaoDFe)."
      />

      {empresas === null ? (
        <Skeleton className="h-24" />
      ) : empresas.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <Plug className="size-6" />
          </div>
          <p className="font-semibold">Nenhuma empresa cadastrada</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Cadastre uma empresa e instale o certificado para testar a conexão com a SEFAZ.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {empresas.map((emp) => {
            const r = resultados[emp.id];
            return (
              <Card key={emp.id}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{emp.razaoSocial}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatCNPJ(emp.cnpj)} · {emp.uf} ·{" "}
                        {emp.ambiente === "producao" ? "Produção" : "Homologação"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testando === emp.id || !emp.temCertificado}
                      onClick={() => testar(emp.id)}
                      title={emp.temCertificado ? "" : "Instale o certificado primeiro"}
                    >
                      <RefreshCw className={testando === emp.id ? "size-4 animate-spin" : "size-4"} />
                      {testando === emp.id ? "Testando…" : "Testar conexão"}
                    </Button>
                  </div>

                  {r ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
                      {r.ok ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={r.cStat === "137" || r.cStat === "138" ? "success" : "warning"}>
                              cStat {r.cStat ?? "—"}
                            </Badge>
                            <span className="text-muted-foreground">{r.xMotivo ?? ""}</span>
                          </div>
                          <p className="tnum text-xs text-muted-foreground">
                            ultNSU {r.ultNSU ?? "—"} · maxNSU {r.maxNSU ?? "—"} · HTTP {r.httpStatus ?? "—"}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <Badge variant="destructive">Falha</Badge>
                          <p className="break-words text-xs text-destructive">{r.erro}</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Este teste faz uma única consulta <code>distDFeInt</code> (ultNSU=0) para validar
        certificado + rede + SOAP. Em homologação, o retorno esperado é
        <strong> cStat 137</strong> (nenhum documento) — o que já confirma a conexão.
      </p>
    </div>
  );
}
