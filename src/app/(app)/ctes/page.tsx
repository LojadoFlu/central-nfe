"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarCTes,
  sincronizarCTeAgora,
  obterCteSyncState,
  baixarXmlTexto,
  urlDownloadXml,
  type CteDocumento,
  type SyncEstado,
  type ResultadoSync,
} from "@/lib/nfe/repo";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatCNPJ, formatarData, formatarDataHora, normalizar } from "@/lib/utils";
import { Container, ChevronDown, RefreshCw, FileCode2, Download } from "lucide-react";

const COMPANY_ID = "59255964000123";
const TP_CTE: Record<string, string> = { "0": "Normal", "1": "Complemento", "2": "Anulação", "3": "Substituto" };

export default function CtesPage() {
  const { role } = useAuth();
  const podeSincronizar = role === "admin" || role === "fiscal";
  const [ctes, setCtes] = useState<CteDocumento[] | null>(null);
  const [estado, setEstado] = useState<SyncEstado | null>(null);
  const [busca, setBusca] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [xmls, setXmls] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [lista, st] = await Promise.all([listarCTes(300), obterCteSyncState(COMPANY_ID)]);
      setCtes(lista);
      setEstado(st);
    } catch (e) {
      setErro((e as Error).message);
      setCtes([]);
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
      const r: ResultadoSync = await sincronizarCTeAgora(COMPANY_ID);
      if (r.ok) {
        setResultado(
          r.bloqueado
            ? `Em recuo da SEFAZ (656). ${r.xMotivo ?? ""}`
            : `${r.novos ?? 0} novo(s). cStat ${r.cStat ?? "—"}.`,
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

  async function verXml(c: CteDocumento) {
    if (!c.storagePath || xmls[c.id]) return;
    try {
      const txt = await baixarXmlTexto(c.storagePath);
      setXmls((p) => ({ ...p, [c.id]: txt }));
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  async function baixarXml(c: CteDocumento) {
    if (!c.storagePath) return;
    try {
      window.open(await urlDownloadXml(c.storagePath), "_blank");
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const lista = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return ctes ?? [];
    return (ctes ?? []).filter((c) =>
      normalizar(`${c.xNomeEmit ?? ""} ${c.nCT ?? ""} ${c.xNomeRem ?? ""} ${c.xNomeDest ?? ""}`).includes(termo),
    );
  }, [ctes, busca]);

  const totais = useMemo(() => {
    const arr = ctes ?? [];
    return { qtd: arr.length, total: arr.reduce((s, c) => s + (c.vTPrest ?? 0), 0) };
  }, [ctes]);

  return (
    <div>
      <PageHeader
        title="Fretes (CT-e)"
        description="Conhecimentos de Transporte recebidos, via SEFAZ."
        action={
          podeSincronizar ? (
            <Button size="sm" variant="outline" disabled={sincronizando} onClick={sincronizar}>
              <RefreshCw className={`size-4 ${sincronizando ? "animate-spin" : ""}`} />
              {sincronizando ? "Sincronizando…" : "Sincronizar"}
            </Button>
          ) : undefined
        }
      />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}
      {resultado ? <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{resultado}</p> : null}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="CT-e recebidos" value={ctes === null ? "…" : String(totais.qtd)} />
        <StatCard label="Total em fretes" value={ctes === null ? "…" : formatBRL(totais.total)} />
      </div>

      {estado?.ultimaSync ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Última sincronização: {formatarDataHora(estado.ultimaSync)} · cStat {estado.ultimoCStat ?? "—"}
          {estado.status === "bloqueado" ? " · em recuo (656)" : ""}
        </p>
      ) : null}

      <Input
        placeholder="Buscar transportadora, nº, remetente…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="mb-4 mt-4 h-11"
      />

      {ctes === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : lista.length === 0 ? (
        <ModulePlaceholder icon={Container} title="Nenhum CT-e" etapa="Fretes">
          Os conhecimentos de transporte aparecem após a sincronização com a SEFAZ (CTeDistribuicaoDFe).
        </ModulePlaceholder>
      ) : (
        <div className="space-y-3">
          {lista.map((c) => {
            const aberto = expandido === c.id;
            return (
              <Card key={c.id}>
                <CardContent className="py-4">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandido(aberto ? null : c.id);
                      if (!aberto) void verXml(c);
                    }}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.xNomeEmit ?? "Transportadora"}</p>
                      <p className="text-xs text-muted-foreground">
                        CT-e {c.nCT ?? "—"}
                        {c.serie ? `/${c.serie}` : ""} · {formatarData(c.dhEmi)}
                        {c.ufIni && c.ufFim ? ` · ${c.ufIni}→${c.ufFim}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-bold tnum">{formatBRL(c.vTPrest)}</p>
                      <ChevronDown className={`size-4 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {aberto ? (
                    <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                      <Linha rotulo="Transportadora" valor={`${c.xNomeEmit ?? "—"}${c.cnpjEmit ? ` · ${formatCNPJ(c.cnpjEmit)}` : ""}`} />
                      <Linha rotulo="Tipo" valor={TP_CTE[c.tpCTe ?? ""] ?? c.tpCTe ?? "—"} />
                      <Linha rotulo="Remetente" valor={c.xNomeRem ?? "—"} />
                      <Linha rotulo="Destinatário" valor={c.xNomeDest ?? "—"} />
                      <Linha rotulo="Valor do frete" valor={formatBRL(c.vTPrest)} />
                      <Linha rotulo="Chave" valor={c.chCTe ? <span className="break-all font-mono text-xs">{c.chCTe}</span> : "—"} />

                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button size="sm" variant="outline" onClick={() => verXml(c)} disabled={!c.storagePath}>
                          <FileCode2 className="size-4" /> Ver XML
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => baixarXml(c)} disabled={!c.storagePath}>
                          <Download className="size-4" /> Baixar XML
                        </Button>
                      </div>

                      {xmls[c.id] ? (
                        <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-tight">
                          {xmls[c.id]}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Fonte: CTeDistribuicaoDFe (Ambiente Nacional). O XML original é sempre preservado.
      </p>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-medium">{valor ?? "—"}</span>
    </div>
  );
}
