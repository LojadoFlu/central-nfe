"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  obterDocumento,
  baixarXmlTexto,
  urlDownloadXml,
  itensDoDocumento,
  parcelasDoDocumento,
  manifestar,
  baixarParcela,
  listarEmpresas,
  definirPagamento,
  type NfeDocumento,
  type Item,
  type Parcela,
  type ResultadoManifestacao,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { gerarDanfe } from "@/lib/nfe/danfe";
import { useAuth } from "@/lib/auth/auth-provider";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL, formatCNPJ, formatarData, formatarDataHora } from "@/lib/utils";
import { ArrowLeft, FileCode2, Download, FileText, ShieldCheck, Check, RotateCcw } from "lucide-react";

const EVENTOS: { tp: string; label: string; conclusivo: boolean }[] = [
  { tp: "210210", label: "Ciência da Operação", conclusivo: false },
  { tp: "210200", label: "Confirmação da Operação", conclusivo: true },
  { tp: "210220", label: "Desconhecimento da Operação", conclusivo: true },
  { tp: "210240", label: "Operação não Realizada", conclusivo: true },
];

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-medium">{valor ?? "—"}</span>
    </div>
  );
}

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
}
function addMeses(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return ymd(new Date(y, m - 1 + n, d));
}
type Periodicidade = "mensal" | "quinzenal" | "semanal";
function gerarDatas(base: string, n: number, p: Periodicidade): string[] {
  return Array.from({ length: n }, (_, i) => (p === "mensal" ? addMeses(base, i) : addDias(base, i * (p === "quinzenal" ? 15 : 7))));
}

/** Formulário para definir o pagamento de uma NF sem parcelas no XML. */
function DefinirPagamento({ chNFe, total, dhEmi, companyId, empresas, onSaved }: { chNFe: string; total: number; dhEmi?: string | null; companyId?: string | null; empresas: Company[]; onSaved: () => void }) {
  const emissao = dhEmi && /^\d{4}-\d{2}-\d{2}/.test(dhEmi) ? dhEmi.slice(0, 10) : hojeISO();
  const [modo, setModo] = useState<"avista" | "parcelado">("avista");
  // À vista — padrão na data de emissão da NF.
  const [avistaData, setAvistaData] = useState(emissao);
  const [avistaQuitado, setAvistaQuitado] = useState(true);
  const [contaPg, setContaPg] = useState(companyId ?? ""); // conta de onde saiu o pagamento (default = empresa da NF)
  // Parcelado
  const [numParc, setNumParc] = useState(2);
  const [base, setBase] = useState(addDias(hojeISO(), 30));
  const [period, setPeriod] = useState<Periodicidade>("mensal");
  const [igual, setIgual] = useState(true);
  const [rows, setRows] = useState<{ venc: string; valor: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // (Re)gera as parcelas quando os parâmetros mudam. Divisão igual com ajuste no último centavo.
  useEffect(() => {
    if (modo !== "parcelado") return;
    const n = Math.max(1, Math.min(60, numParc || 1));
    const datas = gerarDatas(base, n, period);
    const cent = Math.round(total * 100);
    const b = Math.floor(cent / n);
    const val = Array.from({ length: n }, (_, i) => ((i === n - 1 ? cent - b * (n - 1) : b) / 100));
    setRows(datas.map((venc, i) => ({ venc, valor: val[i].toFixed(2) })));
  }, [modo, numParc, base, period, total, igual]);

  const soma = rows.reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const dif = Math.round((soma - total) * 100) / 100;

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const parcelas = modo === "avista"
        ? [{ vencimento: avistaData, valor: total, pago: avistaQuitado, dataPagamento: avistaQuitado ? avistaData : undefined, contaPagamento: avistaQuitado ? (contaPg || undefined) : undefined }]
        : rows.map((r) => ({ vencimento: r.venc, valor: Number(r.valor) }));
      await definirPagamento({ chNFe, parcelas });
      onSaved();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="mb-4 border-primary/30">
      <CardContent className="py-4">
        <h2 className="mb-1 text-[0.95rem] font-semibold tracking-tight">Definir pagamento</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Esta nota veio <strong>sem parcelas</strong> no XML. Informe como ela será paga para entrar no contas a pagar e no fluxo de caixa.
        </p>

        {/* Modo */}
        <div className="mb-3 flex rounded-md border border-border p-0.5 text-sm">
          {([["avista", "À vista"], ["parcelado", "Parcelado"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setModo(k)}
              className={`flex-1 rounded px-3 py-1.5 font-medium transition-colors ${modo === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {modo === "avista" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Data</span>
                <Input type="date" value={avistaData} onChange={(e) => setAvistaData(e.target.value)} className="h-9 w-44" />
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" className="size-4" checked={avistaQuitado} onChange={(e) => setAvistaQuitado(e.target.checked)} />
                Já quitado
              </label>
              {avistaQuitado ? (
                <label className="space-y-1">
                  <span className="block text-[11px] text-muted-foreground">Pago pela conta de</span>
                  <select value={contaPg} onChange={(e) => setContaPg(e.target.value)} className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm">
                    {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {avistaQuitado
                ? `Registra 1 pagamento de ${formatBRL(total)} já pago em ${formatarData(avistaData)}.`
                : `Registra 1 conta de ${formatBRL(total)} a vencer em ${formatarData(avistaData)}.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Quantas parcelas</span>
                <Input type="number" min={2} max={60} value={numParc} onChange={(e) => setNumParc(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} className="h-9 w-24" />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">1º vencimento</span>
                <Input type="date" value={base} onChange={(e) => setBase(e.target.value)} className="h-9 w-44" />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">A cada</span>
                <select value={period} onChange={(e) => setPeriod(e.target.value as Periodicidade)} className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="mensal">Mês</option>
                  <option value="quinzenal">15 dias</option>
                  <option value="semanal">Semana</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={igual} onChange={(e) => setIgual(e.target.checked)} />
              Dividir igual pelo número de parcelas
            </label>

            <div className="space-y-1.5">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-xs text-muted-foreground">{i + 1}.</span>
                  <Input type="date" value={r.venc} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, venc: e.target.value } : x)))} className="h-9 flex-1" />
                  <Input
                    type="number" step="0.01" inputMode="decimal" value={r.valor}
                    readOnly={igual}
                    onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                    className={`h-9 w-28 ${igual ? "bg-muted text-muted-foreground" : ""}`}
                  />
                </div>
              ))}
            </div>
            <p className={`text-xs ${Math.abs(dif) >= 0.01 ? "text-destructive" : "text-muted-foreground"}`}>
              Soma {formatBRL(soma)} · nota {formatBRL(total)}
              {Math.abs(dif) >= 0.01 ? ` · diferença ${formatBRL(dif)}` : " · confere"}
            </p>
          </div>
        )}

        {erro ? <p className="mt-3 text-xs text-destructive">{erro}</p> : null}
        <div className="mt-3">
          <Button size="sm" disabled={salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar pagamento"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function NotaDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [doc, setDoc] = useState<NfeDocumento | null | undefined>(undefined);
  const [itens, setItens] = useState<Item[]>([]);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [xml, setXml] = useState<string | null>(null);
  const [carregandoXml, setCarregandoXml] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [erroXml, setErroXml] = useState<string | null>(null);
  const { podeAcao } = useAuth();
  const [eventoPendente, setEventoPendente] = useState<string | null>(null);
  const [xJust, setXJust] = useState("");
  const [manifestando, setManifestando] = useState(false);
  const [resManif, setResManif] = useState<ResultadoManifestacao | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [pagando, setPagando] = useState<string | null>(null); // parcela escolhendo a conta pagadora
  const [contaPg, setContaPg] = useState("");                   // empresa de onde saiu o pagamento
  const podeBaixar = podeAcao("financeiro.baixar");

  const nomeEmpresa = (id?: string | null) => {
    if (!id) return null;
    const e = empresas.find((x) => x.id === id);
    return e?.nomeFantasia || e?.razaoSocial || id;
  };

  // Abre o seletor de conta (default = empresa que recebeu a NF).
  function iniciarPagamento(p: Parcela) {
    setPagando(p.id);
    setContaPg(doc?.companyId ?? "");
  }

  async function confirmarPagamento(p: Parcela) {
    setBaixando(p.id);
    try {
      await baixarParcela({
        parcelaId: p.id,
        pago: true,
        valorPago: p.valor ?? undefined,
        contasPagamento: contaPg ? [{ empresaId: contaPg, valor: p.valor ?? 0 }] : undefined,
      });
      setPagando(null);
      await carregar();
    } finally {
      setBaixando(null);
    }
  }

  async function reabrir(p: Parcela) {
    setBaixando(p.id);
    try {
      await baixarParcela({ parcelaId: p.id, pago: false });
      await carregar();
    } finally {
      setBaixando(null);
    }
  }

  const carregar = useCallback(async () => {
    const [d, its, pcs] = await Promise.all([
      obterDocumento(id),
      itensDoDocumento(id),
      parcelasDoDocumento(id),
    ]);
    setDoc(d);
    setItens(its);
    setParcelas(pcs);
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    void listarEmpresas().then(setEmpresas).catch(() => {});
  }, []);

  const nomeRecebedora = doc?.companyId
    ? (() => {
        const e = empresas.find((x) => x.id === doc.companyId);
        return e?.nomeFantasia || e?.razaoSocial || doc.companyId;
      })()
    : null;

  async function verXml() {
    if (!doc?.storagePath) return;
    setCarregandoXml(true);
    setErroXml(null);
    try {
      setXml(await baixarXmlTexto(doc.storagePath));
    } catch (e) {
      setErroXml((e as Error).message);
    } finally {
      setCarregandoXml(false);
    }
  }

  async function baixarXml() {
    if (!doc?.storagePath) return;
    try {
      const url = await urlDownloadXml(doc.storagePath);
      window.open(url, "_blank");
    } catch (e) {
      setErroXml((e as Error).message);
    }
  }

  async function enviarManif(tp: string) {
    if (!doc?.companyId || !doc?.chNFe) return;
    setManifestando(true);
    setResManif(null);
    try {
      const r = await manifestar({
        companyId: doc.companyId,
        chNFe: doc.chNFe,
        tpEvento: tp,
        xJust: tp === "210240" ? xJust : undefined,
      });
      setResManif(r);
      if (r.ok) {
        setEventoPendente(null);
        setXJust("");
        await carregar();
      }
    } catch (e) {
      setResManif({ ok: false, erro: (e as Error).message });
    } finally {
      setManifestando(false);
    }
  }

  async function baixarDanfe() {
    if (!doc?.storagePath) return;
    setGerandoPdf(true);
    setErroXml(null);
    try {
      const conteudo = xml ?? (await baixarXmlTexto(doc.storagePath));
      if (!xml) setXml(conteudo);
      gerarDanfe(conteudo, `DANFE-${doc.chNFe ?? doc.id}.pdf`);
    } catch (e) {
      setErroXml((e as Error).message);
    } finally {
      setGerandoPdf(false);
    }
  }

  if (doc === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (doc === null) {
    return (
      <div>
        <Link href="/notas" className="mb-4 inline-flex items-center gap-1 text-sm text-primary">
          <ArrowLeft className="size-4" /> Voltar
        </Link>
        <p className="text-sm text-muted-foreground">Nota não encontrada.</p>
      </div>
    );
  }

  return (
    <div>
      <Link href="/notas" className="mb-3 inline-flex items-center gap-1 text-sm text-primary">
        <ArrowLeft className="size-4" /> Notas
      </Link>

      <PageHeader
        title={doc.xNomeEmit ?? "Fornecedor não identificado"}
        description={doc.cnpjEmit ? formatCNPJ(doc.cnpjEmit) : undefined}
        action={
          <Badge variant={doc.temXmlCompleto ? "success" : "neutral"}>
            {doc.temXmlCompleto ? "XML completo" : "Resumo"}
          </Badge>
        }
      />

      {/* Destaque do valor (mobile-first) */}
      <Card className="mb-4">
        <CardContent className="py-5 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Valor da nota</p>
          <p className="mt-1 text-3xl font-bold tnum">{formatBRL(doc.vNF)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Emissão: {formatarDataHora(doc.dhEmi)}
          </p>
        </CardContent>
      </Card>

      {/* Resumo */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">
            Resumo
          </h2>
          <Linha rotulo="Recebida por" valor={nomeRecebedora ?? "—"} />
          <Linha rotulo="Número / Série" valor={doc.nNF ? `${doc.nNF}${doc.serie ? "/" + doc.serie : ""}` : "—"} />
          <Linha rotulo="Situação" valor={doc.situacao ?? "—"} />
          <Linha rotulo="NSU" valor={doc.nsu ?? "—"} />
          <Linha
            rotulo="Chave de acesso"
            valor={doc.chNFe ? <span className="break-all font-mono text-xs">{doc.chNFe}</span> : "—"}
          />
        </CardContent>
      </Card>

      {/* Manifestação (admin/fiscal) */}
      {podeAcao("nfe.manifestar") ? (
        <Card className="mb-4">
          <CardContent className="py-4">
            <h2 className="mb-2 flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight">
              <ShieldCheck className="size-4" /> Manifestação
            </h2>
            {doc.manifestStatus ? (
              <div className="mb-2">
                <Badge variant="success">Manifestado: {doc.manifestStatus}</Badge>
              </div>
            ) : null}
            <p className="mb-2 text-xs text-muted-foreground">
              Evento oficial enviado à SEFAZ. A <strong>Ciência</strong> libera o XML completo; os
              demais são <strong>conclusivos</strong>.
            </p>

            {!eventoPendente ? (
              <div className="flex flex-wrap gap-2">
                {EVENTOS.map((e) => (
                  <Button
                    key={e.tp}
                    size="sm"
                    variant={e.conclusivo ? "outline" : "default"}
                    onClick={() => {
                      setResManif(null);
                      setEventoPendente(e.tp);
                    }}
                  >
                    {e.label}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-border p-3">
                <p className="text-sm font-medium">
                  Enviar “{EVENTOS.find((e) => e.tp === eventoPendente)?.label}” à SEFAZ?
                </p>
                {EVENTOS.find((e) => e.tp === eventoPendente)?.conclusivo ? (
                  <p className="mt-1 text-xs text-destructive">
                    ⚠️ Evento conclusivo e definitivo — não pode ser desfeito.
                  </p>
                ) : null}
                {eventoPendente === "210240" ? (
                  <div className="mt-2">
                    <Textarea
                      placeholder="Justificativa (15 a 255 caracteres)"
                      value={xJust}
                      onChange={(e) => setXJust(e.target.value)}
                      maxLength={255}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {xJust.length}/255 (mín. 15)
                    </p>
                  </div>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    disabled={manifestando || (eventoPendente === "210240" && xJust.trim().length < 15)}
                    onClick={() => enviarManif(eventoPendente)}
                  >
                    {manifestando ? "Enviando…" : "Confirmar e enviar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={manifestando}
                    onClick={() => {
                      setEventoPendente(null);
                      setXJust("");
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {resManif ? (
              <div className="mt-3 text-sm">
                {resManif.ok ? (
                  <p className="text-success">
                    ✓ Registrado (cStat {resManif.cStatEvento}). {resManif.xMotivoEvento}
                  </p>
                ) : (
                  <p className="break-words text-destructive">
                    Falha{resManif.cStatEvento ? ` (cStat ${resManif.cStatEvento})` : ""}:{" "}
                    {resManif.erro ?? resManif.xMotivoEvento}
                  </p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Definir pagamento — quando a NF não trouxe parcelas no XML */}
      {parcelas.length === 0 && doc.chNFe && podeBaixar ? (
        <DefinirPagamento chNFe={doc.chNFe} total={doc.vNF ?? 0} dhEmi={doc.dhEmi} companyId={doc.companyId} empresas={empresas} onSaved={carregar} />
      ) : null}

      {/* Financeiro (parcelas) */}
      {parcelas.length > 0 ? (
        <Card className="mb-4">
          <CardContent className="py-4">
            <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">
              Financeiro · {parcelas.length} parcela{parcelas.length > 1 ? "s" : ""}
            </h2>
            <div className="divide-y divide-border">
              {parcelas.map((p) => {
                const paga = p.statusPagamento === "pago";
                const ocupado = baixando === p.id;
                const contaPaga = p.contasPagamento?.[0]?.empresaId ?? null;
                const escolhendo = pagando === p.id;
                return (
                  <div key={p.id} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-muted-foreground">
                          Parcela {p.nDup ?? "1"} · venc. {formatarData(p.vencimento)}
                        </span>
                        {paga ? (
                          <span className="ml-2 text-xs text-success">
                            Pago em {formatarData(p.dataPagamento)}
                            {contaPaga ? <> · por {nomeEmpresa(contaPaga)}</> : null}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium tnum">{formatBRL(p.valor)}</span>
                        {paga ? <Badge variant="success">Paga</Badge> : null}
                        {podeBaixar && !escolhendo ? (
                          <Button
                            size="sm"
                            variant={paga ? "ghost" : "outline"}
                            disabled={ocupado}
                            onClick={() => (paga ? reabrir(p) : iniciarPagamento(p))}
                          >
                            {paga ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                            {ocupado ? "…" : paga ? "Reabrir" : "Marcar pago"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {escolhendo ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
                        <label className="text-xs text-muted-foreground">Pago pela conta de</label>
                        <select
                          value={contaPg}
                          onChange={(e) => setContaPg(e.target.value)}
                          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {empresas.map((e) => (
                            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
                          ))}
                        </select>
                        <Button size="sm" disabled={ocupado} onClick={() => confirmarPagamento(p)}>
                          <Check className="size-4" />{ocupado ? "…" : "Confirmar"}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setPagando(null)}>
                          Cancelar
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              “Pago” nunca é inferido do XML — é uma baixa manual, registrada com autor e data.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Produtos (itens) */}
      {itens.length > 0 ? (
        <Card className="mb-4">
          <CardContent className="py-4">
            <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">
              Produtos · {itens.length} {itens.length > 1 ? "itens" : "item"}
            </h2>
            <div className="space-y-2">
              {itens.map((it) => (
                <div key={it.id} className="rounded-md border border-border p-2.5 text-sm">
                  <p className="font-medium">{it.descricao ?? "—"}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tnum">
                    <span>
                      {it.quantidade ?? "—"} {it.unidade ?? ""} × {formatBRL(it.valorUnitario)}
                    </span>
                    <span className="font-medium text-foreground">{formatBRL(it.valorTotal)}</span>
                    {it.ncm ? <span>NCM {it.ncm}</span> : null}
                    {it.cfop ? <span>CFOP {it.cfop}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Documento (XML / DANFE) */}
      <Card>
        <CardContent className="py-4">
          <h2 className="mb-3 text-[0.95rem] font-semibold tracking-tight">
            Documento
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={verXml} disabled={!doc.storagePath || carregandoXml}>
              <FileCode2 className="size-4" />
              {carregandoXml ? "Carregando…" : "Ver XML"}
            </Button>
            <Button size="sm" variant="outline" onClick={baixarXml} disabled={!doc.storagePath}>
              <Download className="size-4" />
              Baixar XML
            </Button>
            <Button
              size="sm"
              onClick={baixarDanfe}
              disabled={!doc.temXmlCompleto || gerandoPdf}
              title={doc.temXmlCompleto ? "" : "Requer XML completo (manifeste a nota primeiro)"}
            >
              <FileText className="size-4" />
              {gerandoPdf ? "Gerando…" : "DANFE (PDF)"}
            </Button>
          </div>

          {erroXml ? <p className="mt-3 text-xs text-destructive">{erroXml}</p> : null}

          {xml ? (
            <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-tight">
              {xml}
            </pre>
          ) : null}

          {!doc.temXmlCompleto ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Esta nota veio como <strong>resumo</strong>. O XML completo e o DANFE ficam
              disponíveis após a <strong>manifestação</strong> (Ciência/Confirmação) e nova
              sincronização.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
