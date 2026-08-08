"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  obterDocumento,
  baixarXmlTexto,
  urlDownloadXml,
  itensDoDocumento,
  parcelasDoDocumento,
  manifestar,
  type NfeDocumento,
  type Item,
  type Parcela,
  type ResultadoManifestacao,
} from "@/lib/nfe/repo";
import { gerarDanfe } from "@/lib/nfe/danfe";
import { useAuth } from "@/lib/auth/auth-provider";
import { podeManifestar } from "@/lib/auth/roles";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL, formatCNPJ, formatarData, formatarDataHora } from "@/lib/utils";
import { ArrowLeft, FileCode2, Download, FileText, ShieldCheck } from "lucide-react";

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

export default function NotaDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [doc, setDoc] = useState<NfeDocumento | null | undefined>(undefined);
  const [itens, setItens] = useState<Item[]>([]);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [xml, setXml] = useState<string | null>(null);
  const [carregandoXml, setCarregandoXml] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [erroXml, setErroXml] = useState<string | null>(null);
  const { role } = useAuth();
  const [eventoPendente, setEventoPendente] = useState<string | null>(null);
  const [xJust, setXJust] = useState("");
  const [manifestando, setManifestando] = useState(false);
  const [resManif, setResManif] = useState<ResultadoManifestacao | null>(null);

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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Resumo
          </h2>
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
      {podeManifestar(role) ? (
        <Card className="mb-4">
          <CardContent className="py-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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

      {/* Financeiro (parcelas) */}
      {parcelas.length > 0 ? (
        <Card className="mb-4">
          <CardContent className="py-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Financeiro · {parcelas.length} parcela{parcelas.length > 1 ? "s" : ""}
            </h2>
            <div className="divide-y divide-border">
              {parcelas.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-muted-foreground">
                    Parcela {p.nDup ?? "1"} · venc. {formatarData(p.vencimento)}
                  </span>
                  <span className="font-medium tnum">{formatBRL(p.valor)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Situação de pagamento não é inferida do XML (depende de conciliação futura).
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Produtos (itens) */}
      {itens.length > 0 ? (
        <Card className="mb-4">
          <CardContent className="py-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
