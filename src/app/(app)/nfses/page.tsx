"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarNfses,
  listarEmpresas,
  sincronizarNfseAgora,
  obterNfseSyncState,
  baixarXmlTexto,
  urlDownloadXml,
  type NfseDocumento,
  type SyncEstado,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { FiltroPeriodo, noPeriodo, PERIODO_VAZIO, type Periodo } from "@/components/ui/filtro-periodo";
import { gerarDanfse } from "@/lib/nfe/danfse";
import { formatBRL, formatCNPJ, formatarData, formatarDataHora, normalizar } from "@/lib/utils";
import { Wrench, ChevronDown, RefreshCw, FileCode2, Download, FileText } from "lucide-react";

export default function NfsesPage() {
  const { podeAcao } = useAuth();
  const podeSincronizar = podeAcao("integracoes.sincronizar");
  const [nfses, setNfses] = useState<NfseDocumento[] | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_VAZIO);
  const [estado, setEstado] = useState<SyncEstado | null>(null);
  const [busca, setBusca] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [xmls, setXmls] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [lista, emps] = await Promise.all([listarNfses(300), listarEmpresas()]);
      setNfses(lista);
      setEmpresas(emps);
    } catch (e) {
      setErro((e as Error).message);
      setNfses([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const focusId = empresaId || (empresas.length === 1 ? empresas[0]?.id : "");
  useEffect(() => {
    if (!focusId) { setEstado(null); return; }
    void obterNfseSyncState(focusId).then(setEstado);
  }, [focusId]);

  async function sincronizar() {
    const alvos = empresaId
      ? empresas.filter((e) => e.id === empresaId)
      : empresas.filter((e) => e.temCertificado);
    if (alvos.length === 0) {
      setErro("Nenhuma empresa com certificado para sincronizar.");
      return;
    }
    setSincronizando(true);
    setResultado(null);
    setErro(null);
    try {
      let novos = 0;
      for (const emp of alvos) {
        const r = await sincronizarNfseAgora(emp.id);
        if (r.ok) novos += r.novos ?? 0;
        else setErro(r.erro ?? "Falha na sincronização.");
      }
      setResultado(`${novos} nova(s) em ${alvos.length} empresa(s).`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  async function verXml(c: NfseDocumento) {
    if (!c.storagePath || xmls[c.id]) return;
    try {
      const txt = await baixarXmlTexto(c.storagePath);
      setXmls((p) => ({ ...p, [c.id]: txt }));
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  async function baixarXml(c: NfseDocumento) {
    if (!c.storagePath) return;
    try {
      window.open(await urlDownloadXml(c.storagePath), "_blank");
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  async function gerarDanfsePdf(c: NfseDocumento) {
    if (!c.storagePath) return;
    setErro(null);
    try {
      const xml = xmls[c.id] ?? (await baixarXmlTexto(c.storagePath));
      if (!xmls[c.id]) setXmls((p) => ({ ...p, [c.id]: xml }));
      gerarDanfse(xml, `DANFSe-${c.chNFSe ?? c.id}.pdf`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const base = useMemo(
    () => (nfses ?? []).filter((c) => (!empresaId || c.companyId === empresaId) && noPeriodo(c.dhEmi, periodo)),
    [nfses, empresaId, periodo],
  );

  const lista = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return base;
    return base.filter((c) =>
      normalizar(`${c.xNomePrest ?? ""} ${c.nNFSe ?? ""} ${c.xTribNac ?? ""} ${c.xDescServ ?? ""}`).includes(termo),
    );
  }, [base, busca]);

  const totais = useMemo(
    () => ({ qtd: base.length, total: base.reduce((s, c) => s + (c.vServ ?? c.vLiq ?? 0), 0) }),
    [base],
  );

  return (
    <div>
      <PageHeader
        title="Serviços (NFS-e)"
        description="Notas de serviço recebidas, via NFS-e Nacional (ADN)."
        action={
          podeSincronizar ? (
            <Button size="sm" variant="outline" disabled={sincronizando} onClick={sincronizar}>
              <RefreshCw className={`size-4 ${sincronizando ? "animate-spin" : ""}`} />
              {sincronizando ? "Sincronizando…" : "Sincronizar"}
            </Button>
          ) : undefined
        }
      />

      {empresas.length > 1 ? (
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="mb-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas as empresas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
          ))}
        </select>
      ) : null}

      <FiltroPeriodo value={periodo} onChange={setPeriodo} className="mb-3" />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}
      {resultado ? <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{resultado}</p> : null}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="NFS-e recebidas" value={nfses === null ? "…" : String(totais.qtd)} />
        <StatCard label="Total em serviços" value={nfses === null ? "…" : formatBRL(totais.total)} />
      </div>

      {estado?.ultimaSync ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Última sincronização: {formatarDataHora(estado.ultimaSync)} · a automática roda a cada 6h.
        </p>
      ) : null}

      <Input
        placeholder="Buscar prestador, nº, serviço…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="mb-4 mt-4 h-11"
      />

      {nfses === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : lista.length === 0 ? (
        <ModulePlaceholder icon={Wrench} title="Nenhuma NFS-e" etapa="Serviços">
          As notas de serviço aparecem após a sincronização com o ADN (NFS-e Nacional). Só chegam as
          emitidas pelo padrão nacional (municípios aderidos).
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
                      <p className="truncate font-medium">{c.xNomePrest ?? "Prestador"}</p>
                      <p className="text-xs text-muted-foreground">
                        NFS-e {c.nNFSe ?? "—"} · {formatarData(c.dhEmi)}
                        {c.xTribNac ? ` · ${c.xTribNac.slice(0, 40)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-bold tnum">{formatBRL(c.vServ ?? c.vLiq)}</p>
                      <ChevronDown className={`size-4 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {aberto ? (
                    <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                      <Linha rotulo="Prestador" valor={`${c.xNomePrest ?? "—"}${c.cnpjPrest ? ` · ${formatCNPJ(c.cnpjPrest)}` : ""}`} />
                      <Linha rotulo="Natureza" valor={c.xTribNac ?? "—"} />
                      <Linha rotulo="Município" valor={c.municipio ?? "—"} />
                      <Linha rotulo="Valor do serviço" valor={formatBRL(c.vServ)} />
                      {c.vLiq != null && c.vLiq !== c.vServ ? (
                        <Linha rotulo="Valor líquido" valor={formatBRL(c.vLiq)} />
                      ) : null}
                      {c.xDescServ ? (
                        <div className="py-1">
                          <p className="text-muted-foreground">Discriminação</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-xs">{c.xDescServ}</p>
                        </div>
                      ) : null}
                      <Linha rotulo="Chave" valor={c.chNFSe ? <span className="break-all font-mono text-xs">{c.chNFSe}</span> : "—"} />

                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button size="sm" variant="outline" onClick={() => verXml(c)} disabled={!c.storagePath}>
                          <FileCode2 className="size-4" /> Ver XML
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => baixarXml(c)} disabled={!c.storagePath}>
                          <Download className="size-4" /> Baixar XML
                        </Button>
                        <Button size="sm" onClick={() => gerarDanfsePdf(c)} disabled={!c.storagePath}>
                          <FileText className="size-4" /> DANFSe (PDF)
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
        Fonte: ADN — NFS-e Nacional (padrão gov.br). O XML original é sempre preservado.
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
