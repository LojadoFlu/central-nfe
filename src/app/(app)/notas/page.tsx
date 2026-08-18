"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarDocumentos,
  listarEmpresas,
  sincronizarAgora,
  listarSyncStates,
  pagamentosPendentes,
  definirPagamentoLoteEmissao,
  manifestar,
  type NfeDocumento,
  type SyncEstado,
  type ResultadoSync,
  type NotaPendente,
  type ResultadoManifestacao,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { FiltroPeriodo, noPeriodo, PERIODO_VAZIO, type Periodo } from "@/components/ui/filtro-periodo";
import { formatBRL, formatCNPJ, formatarData, formatarDataHora } from "@/lib/utils";
import { FileText, RefreshCw, AlertCircle } from "lucide-react";

/** Recusa uma NF direto na SEFAZ pela chave (sem importar): não cria nota, pagamento nem pendência. */
function RecusarPorChave({ empresas }: { empresas: Company[] }) {
  const [chave, setChave] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [tp, setTp] = useState("210220");
  const [just, setJust] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [res, setRes] = useState<ResultadoManifestacao | null>(null);
  const [erroR, setErroR] = useState<string | null>(null);
  const digitos = chave.replace(/\D/g, "");
  const precisaJust = tp === "210240";

  async function enviar() {
    setErroR(null); setRes(null);
    if (digitos.length !== 44) { setErroR("A chave deve ter 44 dígitos."); return; }
    if (!empresaId) { setErroR("Escolha a empresa (destinatário da NF)."); return; }
    if (precisaJust && just.trim().length < 15) { setErroR("Justificativa de 15 a 255 caracteres."); return; }
    setEnviando(true);
    try {
      const r = await manifestar({ companyId: empresaId, chNFe: digitos, tpEvento: tp, xJust: precisaJust ? just.trim() : undefined });
      setRes(r);
      if (r.ok) { setChave(""); setJust(""); }
    } catch (e) { setErroR((e as Error).message); }
    finally { setEnviando(false); }
  }

  return (
    <details className="mb-3 rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Recusar NF por chave (sem importar)</summary>
      <div className="space-y-3 border-t border-border p-3">
        <p className="text-xs text-muted-foreground">
          Envia a recusa direto à SEFAZ pela chave de acesso — <strong>não cria nota, pagamento nem pendência</strong>.
          Use quando a nota não está na base. Evento <strong>conclusivo</strong> (definitivo).
        </p>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Chave de acesso (44 dígitos)</span>
          <Input value={chave} onChange={(e) => setChave(e.target.value)} inputMode="numeric" placeholder="4226 0601 …" className="h-9 font-mono" />
          <span className="text-[10px] text-muted-foreground">{digitos.length}/44</span>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Empresa (destinatário da NF)</span>
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="">— escolher —</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Tipo de recusa</span>
          <select value={tp} onChange={(e) => setTp(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="210220">Desconhecimento da Operação</option>
            <option value="210240">Operação não Realizada</option>
          </select>
        </label>
        {precisaJust ? (
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">Justificativa (15 a 255)</span>
            <textarea value={just} onChange={(e) => setJust(e.target.value)} maxLength={255} rows={2} className="w-full rounded-md border border-input bg-background p-2 text-sm" />
            <span className="text-[10px] text-muted-foreground">{just.length}/255</span>
          </label>
        ) : null}
        {erroR ? <p className="text-xs text-destructive">{erroR}</p> : null}
        {res ? (
          res.ok
            ? <p className="text-xs text-success">✓ Recusa registrada na SEFAZ (cStat {res.cStatEvento}). {res.xMotivoEvento}</p>
            : <p className="break-words text-xs text-destructive">Falha{res.cStatEvento ? ` (cStat ${res.cStatEvento})` : ""}: {res.erro ?? res.xMotivoEvento}</p>
        ) : null}
        <Button size="sm" disabled={enviando} onClick={enviar}>{enviando ? "Enviando…" : "Enviar recusa à SEFAZ"}</Button>
      </div>
    </details>
  );
}

export default function NotasPage() {
  const { podeAcao } = useAuth();
  const podeSincronizar = podeAcao("integracoes.sincronizar");
  const podeFinanceiro = podeAcao("financeiro.baixar");
  const podeManifestar = podeAcao("nfe.manifestar");
  const [docs, setDocs] = useState<NfeDocumento[] | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [syncStates, setSyncStates] = useState<SyncEstado[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [emitente, setEmitente] = useState(""); // cnpjEmit; "" = todos
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [varredura, setVarredura] = useState(false);
  const [pendentes, setPendentes] = useState<NotaPendente[] | null>(null);
  const [carregandoPend, setCarregandoPend] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lote, setLote] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ds, emps, sts] = await Promise.all([listarDocumentos(1500), listarEmpresas(), listarSyncStates()]);
      setDocs(ds);
      setEmpresas(emps);
      setSyncStates(sts);
    } catch (e) {
      setErro((e as Error).message);
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

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
        const r: ResultadoSync = await sincronizarAgora(emp.id);
        if (r.ok) novos += r.novos ?? 0;
        else setErro(r.erro ?? "Falha na sincronização.");
      }
      setResultado(`${novos} nova(s) nota(s)/evento(s) em ${alvos.length} empresa(s).`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  const focusId = empresaId || (empresas.length === 1 ? empresas[0]?.id : "");
  const estado = syncStates.find((s) => s.id === focusId) ?? null;
  const nomeEmpresa = useCallback(
    (id?: string) => {
      const e = empresas.find((x) => x.id === id);
      return e?.nomeFantasia || e?.razaoSocial || id || "—";
    },
    [empresas],
  );
  // Emitentes (fornecedores) distintos presentes nas notas, ordenados por nome.
  const emitentes = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs ?? []) {
      if (!d.cnpjEmit) continue;
      if (!m.has(d.cnpjEmit)) m.set(d.cnpjEmit, d.xNomeEmit || d.cnpjEmit);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [docs]);
  const visiveis = useMemo(
    () => (docs ?? []).filter(
      (d) => (!empresaId || d.companyId === empresaId)
        && (!emitente || d.cnpjEmit === emitente)
        && noPeriodo(d.dhEmi, periodo),
    ),
    [docs, empresaId, emitente, periodo],
  );

  // Varredura: carrega as NF-e sem pagamento definido (respeita empresa; emitente/período no cliente).
  useEffect(() => {
    if (!varredura) return;
    setCarregandoPend(true);
    setPendentes(null);
    setSel(new Set());
    pagamentosPendentes(empresaId)
      .then(setPendentes)
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregandoPend(false));
  }, [varredura, empresaId]);

  const pendentesVisiveis = useMemo(
    () => (pendentes ?? []).filter(
      (d) => (!emitente || d.cnpjEmit === emitente) && noPeriodo(d.dhEmi, periodo),
    ),
    [pendentes, emitente, periodo],
  );

  const chavesSelecionaveis = useMemo(
    () => pendentesVisiveis.map((p) => p.chNFe).filter((c): c is string => !!c),
    [pendentesVisiveis],
  );
  const todosSel = chavesSelecionaveis.length > 0 && chavesSelecionaveis.every((c) => sel.has(c));
  const nSel = chavesSelecionaveis.filter((c) => sel.has(c)).length;

  function alternarSel(ch: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(ch)) n.delete(ch); else n.add(ch);
      return n;
    });
  }
  function alternarTodos() {
    setSel(todosSel ? new Set() : new Set(chavesSelecionaveis));
  }
  async function marcarLoteEmissao() {
    const chaves = chavesSelecionaveis.filter((c) => sel.has(c));
    if (chaves.length === 0) return;
    setLote(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await definirPagamentoLoteEmissao(chaves);
      setResultado(
        `${r.criadas} nota(s) marcada(s) como paga(s) na emissão`
        + (r.puladas ? ` · ${r.puladas} já tinham pagamento` : "")
        + (r.semValor ? ` · ${r.semValor} sem valor/data` : "") + ".",
      );
      setSel(new Set());
      setPendentes(await pagamentosPendentes(empresaId));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLote(false);
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

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        {empresas.length > 1 ? (
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Empresa recebedora</span>
            <select
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todas as recebedoras</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
              ))}
            </select>
          </label>
        ) : null}
        {emitentes.length > 1 ? (
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Emitente (fornecedor)</span>
            <select
              value={emitente}
              onChange={(e) => setEmitente(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos os emitentes</option>
              {emitentes.map(([cnpj, nome]) => (
                <option key={cnpj} value={cnpj}>{nome}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <FiltroPeriodo value={periodo} onChange={setPeriodo} className="mb-3" />

      {podeFinanceiro ? (
        <button
          onClick={() => setVarredura((v) => !v)}
          className={`mb-3 flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${varredura ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-accent/50"}`}
        >
          <AlertCircle className="size-4" />
          {varredura ? "Mostrando: sem pagamento definido" : "Varredura: notas sem pagamento definido"}
          {varredura && pendentes ? ` (${pendentesVisiveis.length})` : ""}
        </button>
      ) : null}

      {podeManifestar ? <RecusarPorChave empresas={empresas} /> : null}

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

      {varredura ? (
        carregandoPend || pendentes === null ? (
          <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        ) : pendentesVisiveis.length === 0 ? (
          <ModulePlaceholder icon={FileText} title="Tudo com pagamento definido" etapa="Varredura">
            Nenhuma nota sem pagamento no filtro atual. Toque no botão acima para voltar à lista.
          </ModulePlaceholder>
        ) : (
          <div className="space-y-3">
            {/* Cabeçalho de seleção + ação em lote */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={todosSel} onChange={alternarTodos} />
                Selecionar todas ({chavesSelecionaveis.length})
              </label>
              {nSel > 0 ? (
                <Button size="sm" disabled={lote} onClick={marcarLoteEmissao}>
                  {lote ? "Marcando…" : `Marcar ${nSel} paga(s) na emissão`}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Selecione e use <strong>Marcar paga(s) na emissão</strong> (à vista, quitada na data de emissão da NF),
              ou toque numa nota para definir parcelas.
            </p>
            {pendentesVisiveis.map((d) => {
              const ch = d.chNFe;
              return (
                <Card key={d.id} className="border-primary/30">
                  <CardContent className="flex items-start gap-3 py-4">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0"
                      disabled={!ch}
                      checked={!!ch && sel.has(ch)}
                      onChange={() => ch && alternarSel(ch)}
                    />
                    <Link href={`/notas/${encodeURIComponent(d.id)}`} className="block min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{d.xNomeEmit ?? "Fornecedor não identificado"}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.cnpjEmit ? formatCNPJ(d.cnpjEmit) : "—"}
                            {d.nNF ? ` · NF ${d.nNF}` : ""}
                            {d.serie ? `/${d.serie}` : ""}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">Recebida por {nomeEmpresa(d.companyId ?? undefined)}</p>
                        </div>
                        <Badge variant="warning">Sem pagamento</Badge>
                      </div>
                      <div className="mt-2 flex items-end justify-between">
                        <p className="text-lg font-bold tnum">{formatBRL(d.vNF)}</p>
                        <p className="text-xs text-muted-foreground">{formatarData(d.dhEmi)}</p>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : docs === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : visiveis.length === 0 ? (
        <ModulePlaceholder icon={FileText} title="Nenhuma nota" etapa="Aguardando sincronização">
          As notas aparecem após a sincronização com a SEFAZ. Use o botão
          <strong> Sincronizar</strong> acima. A sincronização automática roda a cada 6h.
        </ModulePlaceholder>
      ) : (
        <div className="space-y-3">
          {visiveis.map((d) => (
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
                    {!empresaId ? (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">Recebida por {nomeEmpresa(d.companyId)}</p>
                    ) : null}
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
