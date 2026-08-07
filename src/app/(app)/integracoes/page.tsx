"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listarEmpresas,
  testarConexao,
  sincronizarAgora,
  type ResultadoConexao,
  type ResultadoSync,
} from "@/lib/nfe/repo";
import { formatCNPJ } from "@/lib/utils";
import type { Company } from "@/lib/nfe/types";
import { Plug, RefreshCw, DownloadCloud } from "lucide-react";

export default function IntegracoesPage() {
  const [empresas, setEmpresas] = useState<Company[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conexao, setConexao] = useState<Record<string, ResultadoConexao>>({});
  const [sync, setSync] = useState<Record<string, ResultadoSync>>({});

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
    setBusy(id + ":test");
    try {
      const r = await testarConexao(id);
      setConexao((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setConexao((m) => ({ ...m, [id]: { ok: false, erro: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  async function sincronizar(id: string) {
    setBusy(id + ":sync");
    try {
      const r = await sincronizarAgora(id);
      setSync((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setSync((m) => ({ ...m, [id]: { ok: false, erro: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Integrações" description="NF-e / SEFAZ — conexão e sincronização." />

      {empresas === null ? (
        <Skeleton className="h-24" />
      ) : empresas.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <Plug className="size-6" />
          </div>
          <p className="font-semibold">Nenhuma empresa cadastrada</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Cadastre uma empresa e instale o certificado para conectar à SEFAZ.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {empresas.map((emp) => {
            const c = conexao[emp.id];
            const s = sync[emp.id];
            const semCert = !emp.temCertificado;
            return (
              <Card key={emp.id}>
                <CardContent className="py-4">
                  <p className="truncate font-medium">{emp.razaoSocial}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCNPJ(emp.cnpj)} · {emp.uf} ·{" "}
                    {emp.ambiente === "producao" ? "Produção" : "Homologação"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || semCert}
                      onClick={() => testar(emp.id)}
                      title={semCert ? "Instale o certificado primeiro" : ""}
                    >
                      <RefreshCw className={busy === emp.id + ":test" ? "size-4 animate-spin" : "size-4"} />
                      {busy === emp.id + ":test" ? "Testando…" : "Testar conexão"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy !== null || semCert}
                      onClick={() => sincronizar(emp.id)}
                      title={semCert ? "Instale o certificado primeiro" : ""}
                    >
                      <DownloadCloud className={busy === emp.id + ":sync" ? "size-4 animate-spin" : "size-4"} />
                      {busy === emp.id + ":sync" ? "Sincronizando…" : "Sincronizar agora"}
                    </Button>
                  </div>

                  {c ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
                      {c.ok ? (
                        <>
                          <Badge variant={c.cStat === "137" || c.cStat === "138" ? "success" : "warning"}>
                            Conexão · cStat {c.cStat ?? "—"}
                          </Badge>
                          <span className="ml-2 text-muted-foreground">{c.xMotivo ?? ""}</span>
                        </>
                      ) : (
                        <>
                          <Badge variant="destructive">Falha na conexão</Badge>
                          <p className="mt-1 break-words text-xs text-destructive">{c.erro}</p>
                        </>
                      )}
                    </div>
                  ) : null}

                  {s ? (
                    <div className="mt-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                      {s.ok ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={s.bloqueado ? "warning" : "success"}>
                              {s.bloqueado ? "Recuo (656)" : `${s.novos ?? 0} novos`}
                            </Badge>
                            <span className="text-muted-foreground">{s.xMotivo ?? ""}</span>
                          </div>
                          <p className="tnum text-xs text-muted-foreground">
                            ultNSU {s.ultNSU ?? "—"} · maxNSU {s.maxNSU ?? "—"} · {s.iteracoes ?? 0} lote(s)
                          </p>
                        </div>
                      ) : (
                        <>
                          <Badge variant="destructive">Falha na sincronização</Badge>
                          <p className="mt-1 break-words text-xs text-destructive">{s.erro}</p>
                        </>
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
        <strong>Testar</strong> faz uma consulta única (ultNSU=0, sem gravar).{" "}
        <strong>Sincronizar</strong> percorre os NSU, baixa e guarda os XMLs. Em homologação
        o retorno é sempre "nenhum documento" (cStat 137) — dados reais só em produção.
      </p>
    </div>
  );
}
