"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { obterConciliacao, obterConciliacaoTaxas, listarEmpresas, type Conciliacao, type ConcilTaxas } from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { cn, formatBRL, formatarData } from "@/lib/utils";
import { CheckCircle2, AlertTriangle } from "lucide-react";

function periodoEsteMes(): Periodo {
  const d = new Date();
  const de = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de, ate: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}` };
}

export default function ConciliacaoPage() {
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(periodoEsteMes());
  const [modo, setModo] = useState<"receb" | "taxas">("receb");
  const [dados, setDados] = useState<Conciliacao | null>(null);
  const [taxas, setTaxas] = useState<ConcilTaxas | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [verDia, setVerDia] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void listarEmpresas().then((es) => {
      setEmpresas(es);
      if (es.length && !empresaId) setEmpresaId(es[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    if (!empresaId || !periodo.de || !periodo.ate) return;
    setCarregando(true);
    setErro(null);
    try {
      if (modo === "taxas") setTaxas(await obterConciliacaoTaxas(empresaId, periodo.de, periodo.ate));
      else setDados(await obterConciliacao(empresaId, periodo.de, periodo.ate));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo, modo]);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div>
      <PageHeader
        title="Conciliação"
        description="O que o banco recebeu × o que o PDV previa. A diferença é a exceção a investigar."
      />

      <div className="mb-4 space-y-2">
        {empresas.length > 1 ? (
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
            ))}
          </select>
        ) : null}
        <FiltroPeriodo value={periodo} onChange={setPeriodo} allowClear={false} />
        <div className="flex gap-2 text-sm">
          {([["receb", "Recebimentos"], ["taxas", "Taxa da Stone"]] as const).map(([k, lb]) => (
            <button key={k} onClick={() => setModo(k)} className={`rounded-full px-3 py-1 font-medium ${modo === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{lb}</button>
          ))}
        </div>
        <p className="px-1 text-[11px] text-muted-foreground">
          {modo === "receb"
            ? "Recebimentos: tudo que o banco recebeu (cartão + PIX) × o que o PDV previa (líquido pela taxa do app)."
            : "Taxa da Stone: o líquido esperado (bruto × taxa do app) × o que a Stone realmente depositou — confere se a taxa aplicada no repasse é a cadastrada."}
        </p>
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {modo === "taxas" ? (
        carregando && !taxas ? (
          <div className="space-y-3"><Skeleton className="h-40" /></div>
        ) : taxas ? (
          <TaxasView taxas={taxas} />
        ) : (
          <p className="text-sm text-muted-foreground">Selecione a empresa e o período.</p>
        )
      ) : carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : dados ? (
        <>
          <div className="space-y-3">
            <LinhaConc titulo="Cartões" banco={dados.banco.cartao} previsto={dados.previsto.cartao} dif={dados.dif.cartao}
              nota="Banco: liquidações de cartão. PDV: recebíveis líquidos na data de crédito — com antecipação, D+1 (fim de semana → segunda); sem antecipação, na data de vencimento (parcelado cai mês a mês)." />
            <LinhaConc titulo="PIX" banco={dados.banco.pix} previsto={dados.previsto.pix} dif={dados.dif.pix}
              nota="Banco: PIX recebido na maquininha. PDV: vendas em PIX." />
          </div>

          {(dados.manual && (dados.manual.cartao > 0 || dados.manual.pix > 0)) ? (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Inclui vendas manuais (lojas offline) que passaram nas máquinas desta loja, convertidas de bruto para líquido pela taxa média cadastrada:{" "}
              {dados.manual.cartao > 0 ? <strong>{formatBRL(dados.manual.cartao)} em cartão</strong> : null}
              {dados.manual.cartao > 0 && dados.manual.pix > 0 ? " e " : null}
              {dados.manual.pix > 0 ? <strong>{formatBRL(dados.manual.pix)} em PIX</strong> : null}.
            </p>
          ) : null}

          {/* Detalhe por dia */}
          {dados.porDia?.length ? (
            <Card className="mt-4">
              <CardContent className="py-4">
                <button type="button" onClick={() => setVerDia((v) => !v)} className="flex w-full items-center justify-between">
                  <h2 className="text-[0.95rem] font-semibold tracking-tight">Detalhe por dia</h2>
                  <span className="text-xs font-medium text-primary">{verDia ? "ocultar" : "ver onde diverge"}</span>
                </button>
                {verDia ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="border-b border-border text-[10px] uppercase text-muted-foreground">
                          <th className="py-1 pr-2 text-left font-medium">Dia</th>
                          <th className="py-1 px-2 font-medium">Cart. banco</th>
                          <th className="py-1 px-2 font-medium">Cart. prev.</th>
                          <th className="py-1 px-2 font-medium">Cart. dif.</th>
                          <th className="py-1 px-2 font-medium">PIX banco</th>
                          <th className="py-1 px-2 font-medium">PIX prev.</th>
                          <th className="py-1 pl-2 font-medium">PIX dif.</th>
                        </tr>
                      </thead>
                      <tbody className="tnum">
                        {dados.porDia.map((d) => {
                          const diverge = Math.abs(d.difCartao) + Math.abs(d.difPix) > 100;
                          return (
                            <tr key={d.dia} className={`border-b border-border/50 ${diverge ? "bg-warning/5" : ""}`}>
                              <td className="py-1 pr-2 text-left font-medium">{formatarData(d.dia)}</td>
                              <td className="py-1 px-2">{formatBRL(d.bancoCartao)}</td>
                              <td className="py-1 px-2 text-muted-foreground">{formatBRL(d.previstoCartao)}</td>
                              <td className={`py-1 px-2 ${Math.abs(d.difCartao) > 100 ? "font-semibold text-warning" : "text-muted-foreground"}`}>{formatBRL(d.difCartao)}</td>
                              <td className="py-1 px-2">{formatBRL(d.bancoPix)}</td>
                              <td className="py-1 px-2 text-muted-foreground">{formatBRL(d.previstoPix)}</td>
                              <td className={`py-1 pl-2 ${Math.abs(d.difPix) > 100 ? "font-semibold text-warning" : "text-muted-foreground"}`}>{formatBRL(d.difPix)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Cartões: banco e PDV pela data em que o dinheiro cai (crédito). Dias destacados = onde a diferença se concentra
                      (ex.: fim do período, quando o recebível ainda não caiu).
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Contexto do banco */}
          <h2 className="mb-3 mt-7 text-[0.95rem] font-semibold tracking-tight">Também no extrato</h2>
          <Card>
            <CardContent className="py-4">
              <div className="divide-y divide-border text-sm">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Outras entradas</span>
                  <span className="font-medium tnum text-success">{formatBRL(dados.banco.outrasEntradas)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Saídas (pagamentos, transferências, tarifas)</span>
                  <span className="font-medium tnum text-destructive">{formatBRL(dados.banco.saidas)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="mt-4 text-xs text-muted-foreground">
            Diferença ≈ 0 = bate. Diferenças podem ser: vendas ainda não sincronizadas no período, taxas/ajustes,
            estornos, ou lançamentos de outra natureza. A conciliação depende de o período estar coberto dos dois lados
            (vendas do PDV sincronizadas + extrato importado cobrindo as datas de {formatarData(dados.de)} a {formatarData(dados.ate)}).
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Selecione a empresa e o período. Importe o extrato em Banco antes.</p>
      )}
    </div>
  );
}

function LinhaConc({ titulo, banco, previsto, dif, nota }: { titulo: string; banco: number; previsto: number; dif: number; nota: string }) {
  const tolerancia = Math.max(50, Math.abs(previsto) * 0.02);
  const confere = Math.abs(dif) <= tolerancia;
  return (
    <Card className={cn("relative overflow-hidden shadow-card", !confere && "border-warning/50")}>
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent", confere ? "from-success/[0.07]" : "from-warning/[0.09]")} />
      <CardContent className="relative py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">{titulo}</h2>
          {confere ? (
            <Badge variant="success"><CheckCircle2 className="mr-1 size-3.5" /> Confere</Badge>
          ) : (
            <Badge variant="warning"><AlertTriangle className="mr-1 size-3.5" /> Diverge</Badge>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1 divide-x divide-border/50 text-center">
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Banco recebeu</p>
            <p className="mt-1 text-[0.95rem] font-bold leading-none tracking-[-0.01em] tnum sm:text-base">{formatBRL(banco)}</p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">PDV previa</p>
            <p className="mt-1 text-[0.95rem] font-bold leading-none tracking-[-0.01em] tnum sm:text-base">{formatBRL(previsto)}</p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Diferença</p>
            <p className={cn("mt-1 text-[0.95rem] font-bold leading-none tracking-[-0.01em] tnum sm:text-base", confere ? "text-muted-foreground" : "text-warning")}>
              {dif >= 0 ? "+" : "−"}{formatBRL(Math.abs(dif))}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{nota}</p>
      </CardContent>
    </Card>
  );
}

const pct = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
function TaxasView({ taxas }: { taxas: ConcilTaxas }) {
  const okStone = Math.abs(taxas.dif) <= Math.max(50, taxas.esperado * 0.005); // tolerância 0,5%
  return (
    <>
      <Card className={cn("mb-4 relative overflow-hidden", !okStone && "border-warning/50")}>
        <CardContent className="py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">A Stone aplicou a taxa cadastrada?</h2>
            {okStone ? (
              <Badge variant="success"><CheckCircle2 className="mr-1 size-3.5" /> Bate</Badge>
            ) : (
              <Badge variant="warning"><AlertTriangle className="mr-1 size-3.5" /> Diverge</Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1 divide-x divide-border/50 text-center">
            <div className="px-1">
              <p className="text-[10px] uppercase text-muted-foreground">Esperado (taxa app)</p>
              <p className="mt-1 text-base font-bold tnum">{formatBRL(taxas.esperado)}</p>
              <p className="text-[11px] text-muted-foreground">{pct(taxas.taxaApp)}</p>
            </div>
            <div className="px-1">
              <p className="text-[10px] uppercase text-muted-foreground">Stone depositou</p>
              <p className="mt-1 text-base font-bold tnum">{formatBRL(taxas.recebido)}</p>
              <p className="text-[11px] text-muted-foreground">{pct(taxas.taxaStone)}</p>
            </div>
            <div className="px-1">
              <p className="text-[10px] uppercase text-muted-foreground">Diferença</p>
              <p className={cn("mt-1 text-base font-bold tnum", okStone ? "text-muted-foreground" : "text-warning")}>
                {taxas.dif >= 0 ? "+" : "−"}{formatBRL(Math.abs(taxas.dif))}
              </p>
              <p className="text-[11px] text-muted-foreground">bruto {formatBRL(taxas.bruto)}</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {taxas.dif < -0.5
              ? <>A Stone depositou <strong>menos</strong> que o esperado — reteve ~{pct(taxas.taxaStone - taxas.taxaApp)} a mais que a taxa cadastrada. Vale contestar.</>
              : taxas.dif > 0.5
                ? <>A Stone depositou <strong>mais</strong> que o esperado (taxa efetiva menor que a cadastrada, ou vendas de fora do período).</>
                : <>O repasse da Stone bate com a taxa cadastrada no APP.</>}
          </p>
        </CardContent>
      </Card>

      {taxas.clampado ? (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
          Comparando só o período coberto pelo extrato: <strong>{formatarData(taxas.de)} a {formatarData(taxas.ate)}</strong>
          {taxas.periodoExtrato?.de ? ` (extrato de ${formatarData(taxas.periodoExtrato.de)} a ${formatarData(taxas.periodoExtrato.ate ?? "")})` : ""}.
        </p>
      ) : null}

      {!taxas.temCadastro ? (
        <p className="mb-4 rounded-md bg-warning/10 p-3 text-sm text-warning">
          Esta loja não tem taxas cadastradas em <strong>Taxas</strong> — sem elas o esperado fica igual ao bruto. Cadastre as taxas por bandeira.
        </p>
      ) : null}

      {taxas.porDia.length ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-muted-foreground">
                <th className="py-2 pl-3 pr-2 text-left font-medium">Dia (crédito)</th>
                <th className="py-2 px-2 font-medium">Esperado</th>
                <th className="py-2 px-2 font-medium">Stone depositou</th>
                <th className="py-2 pl-2 pr-3 font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {taxas.porDia.map((d) => {
                const diverge = Math.abs(d.dif) > 100;
                return (
                  <tr key={d.dia} className={`border-b border-border/50 ${diverge ? "bg-warning/5" : ""}`}>
                    <td className="py-1.5 pl-3 pr-2 text-left font-medium">{formatarData(d.dia)}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{formatBRL(d.esperado)}</td>
                    <td className="py-1.5 px-2">{formatBRL(d.recebido)}</td>
                    <td className={`py-1.5 pl-2 pr-3 ${diverge ? "font-semibold text-warning" : "text-muted-foreground"}`}>
                      {d.dif >= 0 ? "+" : "−"}{formatBRL(Math.abs(d.dif))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        <strong>Esperado</strong> = bruto do PDV × taxa cadastrada no APP, na data de crédito (D+1 / fds→seg).
        <strong> Stone depositou</strong> = créditos de cartão no extrato. Depende do período estar coberto dos dois lados
        (vendas sincronizadas + extrato importado). O crédito da antecipação vem somado, então a leitura mais confiável é o total do período.
      </p>
    </>
  );
}
