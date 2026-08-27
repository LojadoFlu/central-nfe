"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { FiltroPeriodo, noPeriodo, PERIODO_VAZIO, type Periodo } from "@/components/ui/filtro-periodo";
import {
  listarEmpresas,
  importarExtrato,
  obterExtrato,
  obterContaBanco,
  obterFluxoCaixa,
  type ExtratoBanco,
  type TxBanco,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";

type TxView = TxBanco & { lojaNome?: string };
type ExtratoView = Omit<ExtratoBanco, "transacoes"> & { transacoes: TxView[] };
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatarData, formatarDataHora } from "@/lib/utils";
import { Landmark, Upload, ArrowUpRight, ArrowDownRight } from "lucide-react";

const CAT_LABEL: Record<string, string> = {
  pix_venda: "PIX (venda)",
  cartao_credito: "Cartão crédito",
  cartao_debito: "Cartão débito",
  transferencia: "Transferência",
  pagamento: "Pagamento",
  tarifa: "Tarifa/Mensalidade",
  devolucao: "Devolução",
  outros: "Outros",
};

export default function BancoPage() {
  const { podeAcao } = useAuth();
  const podeImportar = podeAcao("financeiro.baixar");
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState(""); // "" = Todas as lojas
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_VAZIO);
  const [dados, setDados] = useState<ExtratoView | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [projetado, setProjetado] = useState<{ valor: number; comExtrato: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listarEmpresas().then((es) => {
      setEmpresas(es);
      // 1 loja → seleciona ela (permite importar); várias → começa em "Todas".
      if (es.length === 1) setEmpresaId((prev) => prev || es[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      if (empresaId) {
        setDados(await obterExtrato(empresaId));
      } else if (empresas.length) {
        // Todas as lojas — soma os extratos de todos os bancos numa visão só.
        const rs = await Promise.all(
          empresas.map((e) => obterExtrato(e.id).then((r) => ({ e, r })).catch(() => null)),
        );
        const validos = rs.filter((x): x is { e: Company; r: ExtratoBanco } => !!x && !!x.r?.conta);
        const transacoes: TxView[] = validos
          .flatMap(({ e, r }) => r.transacoes.map((t) => ({ ...t, lojaNome: e.nomeFantasia || e.razaoSocial })))
          .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
        const saldo = validos.reduce((s, { r }) => s + (r.conta?.saldo ?? 0), 0);
        const ultimoImport = validos
          .map(({ r }) => r.conta?.ultimoImport)
          .filter((x): x is string => !!x)
          .sort()
          .pop() ?? null;
        const conta = validos.length
          ? {
              empresaId: "", org: `Todas as lojas · ${validos.length} conta${validos.length > 1 ? "s" : ""}`,
              fid: null, curdef: null, saldo, saldoData: null, dtStart: null, dtEnd: null, ultimoImport,
            }
          : null;
        setDados({ ok: true, conta, creditos: 0, debitos: 0, saldoMov: 0, porCategoria: {}, total: transacoes.length, transacoes });
      } else {
        setDados(null);
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, empresas]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Saldo PROJETADO hoje = saldo do extrato + movimento realizado (recebido − pago) da data
  // do extrato até hoje, pelo fluxo de caixa. Estima o saldo atual entre importações.
  useEffect(() => {
    const lojas = empresaId ? [empresaId] : empresas.map((e) => e.id);
    if (!lojas.length) { setProjetado(null); return; }
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const diaSeguinte = (iso: string) => {
      const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
      const dt = new Date(y, m - 1, d + 1);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    };
    let cancelado = false;
    setProjetado(null);
    void (async () => {
      const partes = await Promise.all(lojas.map(async (id) => {
        const c = await obterContaBanco(id).catch(() => null);
        if (!c || c.saldo == null) return null; // sem conta/saldo importado → fora
        let net = 0;
        if (c.saldoData) {
          const de = diaSeguinte(c.saldoData);
          if (de <= hoje) {
            const fx = await obterFluxoCaixa(de, hoje, id).catch(() => null);
            if (fx?.totais) net = (fx.totais.entradaReal ?? 0) - (fx.totais.saidaReal ?? 0);
          }
        }
        return { saldo: c.saldo, net, temData: !!c.saldoData };
      }));
      if (cancelado) return;
      const validas = partes.filter((p): p is NonNullable<typeof p> => !!p);
      if (!validas.length) { setProjetado(null); return; }
      const valor = validas.reduce((s, p) => s + p.saldo + p.net, 0);
      setProjetado({ valor, comExtrato: validas.every((p) => p.temData) });
    })();
    return () => { cancelado = true; };
  }, [empresaId, empresas]);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void enviar(file);
    if (fileRef.current) fileRef.current.value = "";
  }
  async function enviar(file: File) {
    if (!empresaId) { setErro("Selecione a empresa (conta) antes de importar."); return; }
    setImportando(true);
    setMsg(null);
    setErro(null);
    try {
      // Encoding do OFX varia (UTF-8 ou Windows-1252 apesar do header CHARSET:1252).
      // Tenta UTF-8 estrito; se os bytes não forem UTF-8 válido, cai pra Windows-1252.
      const buf = await file.arrayBuffer();
      let texto: string;
      try {
        texto = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch {
        texto = new TextDecoder("windows-1252").decode(buf);
      }
      const r = await importarExtrato(texto, empresaId);
      setMsg(`${r.transacoes} lançamento(s) importado(s) · ${r.org ?? "conta"}${r.acctId ? ` nº ${r.acctId}` : ""} · saldo ${formatBRL(r.saldo ?? 0)}. Pode importar outra conta desta loja — o saldo soma.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setImportando(false);
    }
  }

  const conta = dados?.conta ?? null;
  const txs = (dados?.transacoes ?? []).filter((t) => noPeriodo(t.data, periodo));
  const totCred = txs.reduce((s, t) => s + (t.valor > 0 ? t.valor : 0), 0);
  const totDeb = txs.reduce((s, t) => s + (t.valor < 0 ? t.valor : 0), 0);
  const cats = Object.entries(
    txs.reduce<Record<string, number>>((acc, t) => {
      acc[t.categoria] = (acc[t.categoria] ?? 0) + t.valor;
      return acc;
    }, {}),
  ).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  return (
    <div>
      <PageHeader
        title="Banco"
        description="Extrato bancário (OFX) — a base para a conciliação."
        action={
          podeImportar ? (
            <Button size="sm" variant="outline" disabled={importando || !empresaId} onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> {importando ? "Importando…" : "Importar OFX"}
            </Button>
          ) : undefined
        }
      />
      <input ref={fileRef} type="file" accept=".ofx" className="hidden" onChange={aoEscolherArquivo} />

      {empresas.length > 1 ? (
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="mb-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas as lojas (consolidado)</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
          ))}
        </select>
      ) : null}

      {!empresaId && empresas.length > 1 && podeImportar ? (
        <p className="mb-3 -mt-1 text-[11px] text-muted-foreground">Para importar um OFX, escolha uma loja específica.</p>
      ) : null}

      {msg ? <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{msg}</p> : null}
      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : !conta ? (
        <ModulePlaceholder icon={Landmark} title="Nenhum extrato importado" etapa="Conciliação bancária">
          Exporte o extrato da conta em <strong>OFX</strong> (Stone, banco, etc.) e clique em
          <strong> Importar OFX</strong>. Os lançamentos entram aqui e viram base para conciliar com o previsto.
        </ModulePlaceholder>
      ) : (
        <>
          {/* Hero — saldo em conta */}
          <div className="relative mb-4 overflow-hidden rounded-[var(--radius)] border border-border/60 bg-card p-5 shadow-float sm:p-6">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent" />
            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Saldo em conta{conta.saldoData ? ` · ${formatarData(conta.saldoData)}` : ""}
              </p>
              <p className="mt-2 text-[2.2rem] font-bold leading-none tracking-[-0.03em] tnum sm:text-[2.7rem]">
                {formatBRL(conta.saldo ?? 0)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {conta.org ?? "Conta"}{conta.ultimoImport ? ` · importado ${formatarDataHora(conta.ultimoImport)}` : ""}
              </p>
            </div>
            {projetado ? (
              <div className="relative mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border/60 pt-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Saldo projetado hoje</p>
                  <p className="text-[10px] text-muted-foreground">extrato − contas pagas + recebimentos desde então</p>
                </div>
                <p className={`text-xl font-bold tnum ${projetado.valor < 0 ? "text-destructive" : "text-foreground"}`}>{formatBRL(projetado.valor)}</p>
              </div>
            ) : null}
          </div>

          {/* Contas da loja (várias por loja) — saldo consolidado acima, detalhe aqui */}
          {(dados?.contas?.length ?? 0) > 1 ? (
            <Card className="mb-4">
              <CardContent className="py-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {dados!.contas!.length} contas nesta loja · saldo consolidado
                </p>
                <div className="divide-y divide-border">
                  {dados!.contas!.map((ct, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {ct.org ?? "Conta"}{ct.acctId ? ` · nº ${ct.acctId}` : ""}
                        {ct.saldoData ? ` · ${formatarData(ct.saldoData)}` : ""}
                      </span>
                      <span className="shrink-0 font-medium tnum">{formatBRL(ct.saldo)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <FiltroPeriodo value={periodo} onChange={setPeriodo} className="mb-3" />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Entradas (crédito)" value={formatBRL(totCred)} tone="success" />
            <StatCard label="Saídas (débito)" value={formatBRL(Math.abs(totDeb))} tone="destructive" />
            <StatCard label="Saldo do movimento" value={formatBRL(totCred + totDeb)} tone={totCred + totDeb < 0 ? "destructive" : "default"} />
          </div>

          {/* Por categoria */}
          {cats.length ? (
            <>
              <h2 className="mb-3 mt-7 text-[0.95rem] font-semibold tracking-tight">Por natureza</h2>
              <Card>
              <CardContent className="py-4">
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {cats.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-1 text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        {v >= 0 ? <ArrowUpRight className="size-3.5 text-success" /> : <ArrowDownRight className="size-3.5 text-destructive" />}
                        {CAT_LABEL[k] ?? k}
                      </span>
                      <span className={`font-medium tnum ${v < 0 ? "text-destructive" : ""}`}>{formatBRL(v)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
              </Card>
            </>
          ) : null}

          {/* Lançamentos */}
          <h2 className="mb-1 mt-7 text-[0.95rem] font-semibold tracking-tight">Lançamentos</h2>
          <div className="space-y-2">
            <p className="mb-2 text-xs text-muted-foreground">
              {txs.length} lançamento(s){dados && dados.total > txs.length ? ` · mostrando os do período (de ${dados.total} carregados)` : ""}
            </p>
            {txs.slice(0, 200).map((t) => (
              <Card key={`${t.lojaNome ?? empresaId}:${t.fitid}`}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.memo || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatarData(t.data)} · <Badge variant="neutral">{CAT_LABEL[t.categoria] ?? t.categoria}</Badge>
                      {t.lojaNome ? <Badge variant="neutral" className="ml-1">{t.lojaNome}</Badge> : null}
                    </p>
                  </div>
                  <p className={`shrink-0 font-bold tnum ${t.valor < 0 ? "text-destructive" : "text-success"}`}>
                    {t.valor >= 0 ? "+" : "−"}{formatBRL(Math.abs(t.valor))}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        O extrato é a fonte da verdade do que entrou/saiu. Próximo passo: conciliar estes lançamentos com o previsto
        (recebíveis de cartão, contas pagas). Importar de novo o mesmo período apenas atualiza (sem duplicar).
      </p>
    </div>
  );
}
