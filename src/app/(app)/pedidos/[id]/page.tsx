"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  obterPedido,
  associarNf,
  conciliarPedido,
  excluirPedido,
  documentosDoFornecedor,
  listarEmpresas,
  salvarDePara,
  type PedidoCompra,
  type ConcilPedido,
  type NfeDocumento,
} from "@/lib/nfe/repo";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatarData } from "@/lib/utils";
import { ArrowLeft, Plus, X, Scale, Trash2 } from "lucide-react";

const STATUS = {
  ok: { variant: "success" as const, label: "Atendido" },
  sobra: { variant: "warning" as const, label: "Sobra" },
  excesso: { variant: "warning" as const, label: "Excesso" },
  parcial: { variant: "destructive" as const, label: "Faltou" },
  nao_entregue: { variant: "neutral" as const, label: "Não entregue" },
};

export default function PedidoDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { podeAcao } = useAuth();
  const podeEditar = podeAcao("financeiro.baixar");
  const [pedido, setPedido] = useState<PedidoCompra | null | undefined>(undefined);
  const [empresas, setEmpresas] = useState<Record<string, string>>({});
  const [nfsForn, setNfsForn] = useState<NfeDocumento[]>([]);
  const [concil, setConcil] = useState<ConcilPedido | null>(null);
  const [chave, setChave] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const [p, es] = await Promise.all([obterPedido(id), listarEmpresas()]);
    setPedido(p);
    setEmpresas(Object.fromEntries(es.map((e) => [e.id, e.nomeFantasia || e.razaoSocial])));
    if (p?.cnpjFornecedor) {
      documentosDoFornecedor(p.cnpjFornecedor).then(setNfsForn).catch(() => setNfsForn([]));
    }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function associar(ch: string, add: boolean) {
    const digitos = ch.replace(/\D/g, "");
    if (digitos.length !== 44) { setErro("Chave inválida (44 dígitos)."); return; }
    setOcupado("nf:" + digitos);
    setErro(null);
    try {
      await associarNf(id, digitos, add);
      setChave("");
      setConcil(null);
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(null); }
  }
  async function conciliar() {
    setOcupado("concil");
    setErro(null);
    try { setConcil(await conciliarPedido(id)); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(null); }
  }
  // De-para: liga um item da NF (cProd) a um item do pedido e reconcilia.
  async function vincular(nfCProd: string, idxPedido: number) {
    if (!concil || idxPedido < 0) return;
    const it = pedido?.itens?.[idxPedido];
    if (!it) return;
    setOcupado("dp:" + nfCProd);
    setErro(null);
    try {
      await salvarDePara({ chave: concil.chaveFornecedor, nfCProd, codigo: it.codigo, tamanho: it.tamanho ?? "" });
      setConcil(await conciliarPedido(id));
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(null); }
  }
  async function remover() {
    setOcupado("del");
    try { await excluirPedido(id); if (typeof window !== "undefined") window.location.href = "/pedidos"; }
    catch (e) { setErro((e as Error).message); setOcupado(null); }
  }

  if (pedido === undefined) return <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-40" /></div>;
  if (pedido === null) return (
    <div>
      <Link href="/pedidos" className="mb-4 inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft className="size-4" /> Voltar</Link>
      <p className="text-sm text-muted-foreground">Pedido não encontrado.</p>
    </div>
  );

  const nfs = pedido.nfs ?? [];

  return (
    <div>
      <Link href="/pedidos" className="mb-3 inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft className="size-4" /> Pedidos</Link>
      <PageHeader
        title={pedido.fornecedorNome}
        description={`${formatarData(pedido.data)} · ${empresas[pedido.empresaId] ?? pedido.empresaId} · ${pedido.itens?.length ?? 0} itens · ${formatBRL(pedido.totalValor)}${pedido.dataEntrega ? ` · entrega prev. ${formatarData(pedido.dataEntrega)}` : ""}`}
        action={podeEditar ? (
          ocupado === "del" ? <span className="text-xs text-muted-foreground">Excluindo…</span> : (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={remover}><Trash2 className="size-4" /> Excluir</Button>
          )
        ) : undefined}
      />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {/* NFs associadas */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">NFs da entrega</h2>
          {nfs.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma NF associada ainda.</p> : (
            <div className="space-y-1">
              {nfs.map((ch) => (
                <div key={ch} className="flex items-center justify-between gap-2 text-xs">
                  <Link href={`/notas/${ch}`} className="truncate font-mono text-primary hover:underline">{ch}</Link>
                  {podeEditar ? (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={ocupado === "nf:" + ch} onClick={() => associar(ch, false)}><X className="size-4" /></Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {podeEditar ? (
            <>
              <div className="mt-3 flex gap-2">
                <Input value={chave} onChange={(e) => setChave(e.target.value)} placeholder="Colar chave de acesso (44 dígitos)" className="h-9 font-mono text-xs" />
                <Button size="sm" disabled={!!ocupado} onClick={() => associar(chave, true)}><Plus className="size-4" /> Associar</Button>
              </div>
              {nfsForn.length ? (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] text-muted-foreground">NFs desse fornecedor no sistema:</p>
                  <div className="flex flex-wrap gap-1">
                    {nfsForn.filter((n) => n.chNFe && !nfs.includes(n.chNFe)).slice(0, 20).map((n) => (
                      <button key={n.id} onClick={() => associar(n.chNFe as string, true)} className="rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-accent/50">
                        NF {n.nNF ?? "?"} · {formatBRL(n.vNF)} · {formatarData(n.dhEmi)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Conciliação */}
      <div className="mb-3">
        <Button size="sm" disabled={ocupado === "concil" || nfs.length === 0} onClick={conciliar}>
          <Scale className="size-4" /> {ocupado === "concil" ? "Conciliando…" : "Conciliar pedido × NFs"}
        </Button>
        {nfs.length === 0 ? <span className="ml-2 text-xs text-muted-foreground">Associe ao menos uma NF.</span> : null}
      </div>

      {concil ? (
        <>
          {/* Resumo */}
          <Card className={`mb-3 ${concil.resumo.atendidoIntegral ? "border-success/40" : "border-warning/40"}`}>
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[0.95rem] font-semibold tracking-tight">
                  {concil.resumo.atendidoIntegral ? "✓ Pedido atendido" : "⚠ Pedido incompleto"}
                </h2>
                {concil.entrega ? (
                  <Badge variant={concil.entrega.status === "no_prazo" ? "success" : concil.entrega.status === "atrasado" ? "destructive" : "warning"}>
                    {concil.entrega.status === "no_prazo" ? "No prazo" : concil.entrega.status === "atrasado" ? `Atrasado ${concil.entrega.difDias}d` : `Adiantado ${-concil.entrega.difDias}d`}
                  </Badge>
                ) : null}
              </div>
              {concil.entrega ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Entrega prevista {formatarData(concil.entrega.prevista)} · NF {formatarData(concil.entrega.realizada)}
                  {" "}({concil.entrega.difDias > 0 ? "+" : ""}{concil.entrega.difDias} dias)
                </p>
              ) : null}
              {/* Totais pedido → NF + diferença (unidades e valor) */}
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-md border border-border p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Unidades (ped → NF)</p>
                  <p className="mt-0.5 text-sm font-bold tnum">{concil.resumo.totalQtdPedido} → {concil.resumo.totalQtdNf}</p>
                  <p className={`text-[11px] tnum ${concil.resumo.difQtd < 0 ? "text-destructive" : concil.resumo.difQtd > 0 ? "text-warning" : "text-muted-foreground"}`}>
                    dif {concil.resumo.difQtd > 0 ? "+" : ""}{concil.resumo.difQtd}
                  </p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Valor (ped → NF)</p>
                  <p className="mt-0.5 text-sm font-bold tnum">{formatBRL(concil.resumo.totalPedido)} → {formatBRL(concil.resumo.totalNf)}</p>
                  <p className={`text-[11px] tnum ${Math.abs(concil.resumo.difValor) >= 0.01 ? (concil.resumo.difValor < 0 ? "text-destructive" : "text-warning") : "text-muted-foreground"}`}>
                    dif {concil.resumo.difValor > 0 ? "+" : ""}{formatBRL(concil.resumo.difValor)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-success">Atendidos: <b>{concil.resumo.ok}</b></span>
                <span className="text-destructive">Faltou: <b>{concil.resumo.parcial}</b></span>
                <span className="text-warning">Sobra: <b>{concil.resumo.sobra}</b></span>
                <span className="text-warning">Excesso: <b>{concil.resumo.excesso}</b></span>
                <span className="text-muted-foreground">Não entregue: <b>{concil.resumo.naoEntregue}</b></span>
                <span className="text-destructive">Valor difere: <b>{concil.resumo.valorDivergente}</b></span>
                <span className="text-muted-foreground">Não casaram: <b>{concil.resumo.extras}</b></span>
              </div>
            </CardContent>
          </Card>

          {/* Por item */}
          <Card className="mb-3">
            <CardContent className="py-3">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="p-1.5 text-left">Código / nome</th><th className="p-1.5 text-right">Qtd ped→NF</th><th className="p-1.5 text-right">Unit ped/NF</th><th className="p-1.5 text-right">Total ped/NF</th><th className="p-1.5 text-center">Status</th></tr>
                  </thead>
                  <tbody>
                    {concil.linhas.map((l, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-1.5"><span className="font-mono">{l.codigo}</span> <span className="text-muted-foreground">{l.nome}{l.cor ? ` · ${l.cor}` : ""}{l.tamanho ? ` · ${l.tamanho}` : ""}</span></td>
                        <td className="p-1.5 text-right tnum">
                          {l.qtdPedido}→{l.qtdNf}
                          {l.dif !== 0 ? <span className={l.dif < 0 ? "text-destructive" : "text-warning"}> ({l.dif > 0 ? "+" : ""}{l.dif})</span> : null}
                        </td>
                        <td className="p-1.5 text-right tnum">
                          <span className="text-muted-foreground">{formatBRL(l.valorUnitPedido)}/</span><span className={l.unitDiverge ? "font-medium text-destructive" : "text-muted-foreground"}>{formatBRL(l.valorUnitNf)}</span>
                        </td>
                        <td className="p-1.5 text-right tnum">
                          <span className="text-muted-foreground">{formatBRL(l.valorTotalPedido)}/</span><span className={l.totalDiverge ? "font-medium text-destructive" : "text-muted-foreground"}>{formatBRL(l.valorTotalNf)}</span>
                        </td>
                        <td className="p-1.5 text-center"><Badge variant={STATUS[l.status].variant}>{STATUS[l.status].label}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Extras (na NF, não casaram) — com de-para manual */}
          {concil.extras.length ? (
            <Card className="mb-3 border-warning/40">
              <CardContent className="py-3">
                <h3 className="mb-1 text-sm font-semibold">Não casaram com o pedido ({concil.extras.length})</h3>
                <p className="mb-2 text-[11px] text-muted-foreground">Se algum destes é um item do pedido que o app não reconheceu, use &quot;Vincular a&quot; — o de-para fica salvo para esse fornecedor.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground"><tr><th className="p-1.5 text-left">Código / nome</th><th className="p-1.5 text-right">Qtd</th><th className="p-1.5 text-right">Total</th>{podeEditar ? <th className="p-1.5 text-left">Vincular a</th> : null}</tr></thead>
                    <tbody>
                      {concil.extras.map((e, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="p-1.5"><span className="font-mono">{e.codigo}</span> <span className="text-muted-foreground">{e.nome}</span></td>
                          <td className="p-1.5 text-right tnum">{e.qtdNf}</td>
                          <td className="p-1.5 text-right tnum">{formatBRL(e.valorTotalNf)}</td>
                          {podeEditar ? (
                            <td className="p-1.5">
                              <select
                                defaultValue={-1}
                                disabled={ocupado === "dp:" + e.codigo}
                                onChange={(ev) => vincular(e.codigo, Number(ev.target.value))}
                                className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs"
                              >
                                <option value={-1}>— escolher item do pedido —</option>
                                {(pedido.itens ?? []).map((it, j) => (
                                  <option key={j} value={j}>{it.codigo}{it.tamanho ? ` · ${it.tamanho}` : ""} — {it.nome}</option>
                                ))}
                              </select>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* Itens do pedido — só antes de conciliar (a conciliação já mostra por item) */}
      {concil ? null : (
      <Card>
        <CardContent className="py-3">
          <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">Itens do pedido</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr><th className="p-1.5 text-left">Código</th><th className="p-1.5 text-left">Nome</th><th className="p-1.5 text-left">Cor</th><th className="p-1.5 text-left">Tam.</th><th className="p-1.5 text-right">Qtd</th><th className="p-1.5 text-right">Unit</th><th className="p-1.5 text-right">Total</th></tr></thead>
              <tbody>
                {(pedido.itens ?? []).map((it, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-1.5 font-mono">{it.codigo}</td><td className="p-1.5">{it.nome}</td><td className="p-1.5">{it.cor}</td><td className="p-1.5">{it.tamanho}</td>
                    <td className="p-1.5 text-right tnum">{it.qtd}</td><td className="p-1.5 text-right tnum">{formatBRL(it.valorUnit)}</td><td className="p-1.5 text-right tnum">{formatBRL(it.valorTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
