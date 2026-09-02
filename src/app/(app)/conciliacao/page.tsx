"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { obterConciliacao, listarEmpresas, type Conciliacao } from "@/lib/nfe/repo";
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
  const [dados, setDados] = useState<Conciliacao | null>(null);
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
      setDados(await obterConciliacao(empresaId, periodo.de, periodo.ate));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo]);

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
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : dados ? (
        <>
          <div className="space-y-3">
            {/* Um card por adquirente: comparar o esperado de todos contra um
                extrato que é de um só transforma dinheiro de outra conta em
                diferença. */}
            {dados.porAdquirente?.length ? (
              dados.porAdquirente.map((a) => (
                <CardAdquirente key={a.adquirente} a={a} />
              ))
            ) : (
              <LinhaConc titulo="Cartões" banco={dados.banco.cartao} previsto={dados.previsto.cartao} dif={dados.dif.cartao} manual={dados.manual?.cartao ?? 0}
                nota="Banco: liquidações de cartão. Esperado = PDV + Maracanã (avulsas nas máquinas desta loja), líquidos na data de crédito." />
            )}
            <LinhaConc titulo="PIX" banco={dados.banco.pix} previsto={dados.previsto.pix} dif={dados.dif.pix} manual={dados.manual?.pix ?? 0}
              nota="Banco: PIX recebido na maquininha. Esperado = PDV + Maracanã (avulsas em PIX nas máquinas desta loja)." />
          </div>

          {dados.stone && dados.stone.diasComArquivo > 0 ? <AgendaStone s={dados.stone} dif={dados.dif} /> : null}

          {dados.taxaCartao && dados.taxaCartao.bruto > 0 ? <TaxaStoneCard t={dados.taxaCartao} /> : null}

          {(dados.manual && (dados.manual.cartao > 0 || dados.manual.pix > 0)) ? (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              A parcela <strong>Maracanã</strong> do esperado são vendas avulsas (lojas offline) que passaram nas máquinas desta loja,
              convertidas de bruto para líquido pela taxa média cadastrada. Lançadas manualmente — se faltar registrar alguma, o esperado fica abaixo do banco.
            </p>
          ) : null}

          {/* Detalhe por dia */}
          {dados.porDia?.length ? (
            <Card className="mt-4">
              <CardContent className="py-4">
                <button type="button" onClick={() => setVerDia((v) => !v)} className="flex w-full items-center justify-between">
                  <h2 className="text-[0.95rem] font-semibold tracking-tight">Detalhe por dia (acumulado)</h2>
                  <span className="text-xs font-medium text-primary">{verDia ? "ocultar" : "ver"}</span>
                </button>
                {verDia ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="border-b border-border text-[10px] uppercase text-muted-foreground">
                          <th className="py-1 pr-2 text-left font-medium">Dia</th>
                          <th className="py-1 px-2 font-medium">Banco (dia)</th>
                          <th className="py-1 px-2 font-medium">Previsto (dia)</th>
                          <th className="py-1 px-2 font-medium">Stone (dia)</th>
                          <th className="py-1 px-2 font-medium">Banco acum.</th>
                          <th className="py-1 px-2 font-medium">Previsto acum.</th>
                          <th className="py-1 pl-2 font-medium" title="Banco acumulado menos previsto acumulado: negativo = faltou no banco">
                            Dif. acum. (banco − previsto)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="tnum">
                        {(() => {
                          let accB = 0, accP = 0;
                          return dados.porDia.map((d) => {
                            const banco = d.bancoCartao + d.bancoPix;
                            const prev = d.previstoCartao + d.previstoPix;
                            accB += banco; accP += prev;
                            const difAcum = accB - accP;
                            return (
                              <tr key={d.dia} className="border-b border-border/50">
                                <td className="py-1 pr-2 text-left font-medium">{formatarData(d.dia)}</td>
                                <td className="py-1 px-2 text-muted-foreground">{formatBRL(banco)}</td>
                                <td className="py-1 px-2 text-muted-foreground">{formatBRL(prev)}</td>
                                <td className="py-1 px-2 text-muted-foreground">
                                  {d.stoneCartao ? formatBRL(d.stoneCartao) : "—"}
                                </td>
                                <td className="py-1 px-2">{formatBRL(accB)}</td>
                                <td className="py-1 px-2">{formatBRL(accP)}</td>
                                <td
                                  className={`py-1 pl-2 font-semibold ${Math.abs(difAcum) > Math.max(200, accP * 0.03) ? "text-warning" : "text-muted-foreground"}`}
                                  title={difAcum < 0 ? "faltou no banco" : "sobrou no banco"}
                                >
                                  {difAcum >= 0 ? "+" : "−"}
                                  {formatBRL(Math.abs(difAcum))}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                      Cartão + PIX juntos. O <strong>dia isolado oscila</strong> porque o previsto usa a data de crédito estimada (D+1, fim de
                      semana → segunda) e a Stone deposita em datas próprias — por isso olhe o <strong>acumulado</strong>, que converge para o
                      total. A diferença acumulada no fim do período = o que ainda não caiu + venda fora do PDV (avulsas) + taxa.
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

/** Um adquirente: o que caiu no banco, o que se esperava e, quando há
 * integração, o que a própria adquirente diz que pagou. */
function CardAdquirente({
  a,
}: {
  a: NonNullable<Conciliacao["porAdquirente"]>[number];
}) {
  // Quem tem agenda é comparado com ela; quem não tem, com a nossa estimativa.
  const referencia = a.agenda ?? a.previsto;
  const dif = a.banco - referencia;
  const d = direcao(dif, Math.max(50, Math.abs(referencia) * 0.02));
  const semExtrato = a.banco === 0 && a.previsto > 0;
  return (
    <Card className={cn("relative overflow-hidden shadow-card", !d.ok && !semExtrato && "border-warning/50")}>
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent", d.ok ? "from-success/[0.07]" : "from-warning/[0.09]")} />
      <CardContent className="relative py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">{a.adquirente}</h2>
          {semExtrato ? (
            <Badge variant="neutral">Cai em outra conta</Badge>
          ) : d.ok ? (
            <Badge variant="success"><CheckCircle2 className="mr-1 size-3.5" /> Confere</Badge>
          ) : (
            <Badge variant="warning"><AlertTriangle className="mr-1 size-3.5" /> {d.texto}</Badge>
          )}
        </div>
        <div className={cn("grid gap-1 divide-x divide-border/50 text-center", a.agenda != null ? "grid-cols-4" : "grid-cols-3")}>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Banco recebeu</p>
            <p className="mt-1 text-[0.95rem] font-bold tnum sm:text-base">{formatBRL(a.banco)}</p>
          </div>
          {a.agenda != null ? (
            <div className="px-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Agenda</p>
              <p className="mt-1 text-[0.95rem] font-bold tnum sm:text-base">{formatBRL(a.agenda)}</p>
              <p className="mt-1 text-[9px] text-muted-foreground">a adquirente diz</p>
            </div>
          ) : null}
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Esperado (PDV)</p>
            <p className="mt-1 text-[0.95rem] font-bold tnum sm:text-base">{formatBRL(a.previsto)}</p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{semExtrato ? "Sem extrato" : d.texto}</p>
            <p className={cn("mt-1 text-[0.95rem] font-bold tnum sm:text-base", !d.ok && !semExtrato && "text-warning")}>
              {semExtrato ? "—" : formatBRL(Math.abs(dif))}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          {semExtrato
            ? "Nenhum crédito deste adquirente no extrato importado — o dinheiro dele cai em outra conta. Enquanto ela não for importada, o esperado aqui não tem com o que ser comparado."
            : a.agenda != null
              ? "Comparado com a agenda da própria adquirente, que sabe a taxa cobrada e a data do crédito. O esperado do PDV fica ao lado, para você ver o quanto a estimativa erra."
              : "Comparado com o esperado do PDV: taxa cadastrada e data de crédito estimada. Sem integração com a adquirente, é o melhor que temos."}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * O sinal sozinho não diz nada: "−1.200" tanto pode ser dinheiro faltando
 * quanto sobrando, dependendo de quem está subtraindo quem. Aqui a direção vem
 * escrita.
 */
function direcao(dif: number, tolerancia = 0.5): { texto: string; falta: boolean; ok: boolean } {
  if (Math.abs(dif) <= tolerancia) return { texto: "Bate", falta: false, ok: true };
  return dif < 0
    ? { texto: "Faltou no banco", falta: true, ok: false }
    : { texto: "Sobrou no banco", falta: false, ok: false };
}

/**
 * A agenda da adquirente é a terceira fonte — e a única que sabe a taxa
 * cobrada e a data em que o dinheiro caiu. As outras duas estimam: o PDV pela
 * taxa cadastrada, o banco pelo que apareceu no extrato.
 */
function AgendaStone({
  s,
  dif,
}: {
  s: NonNullable<Conciliacao["stone"]>;
  dif: Conciliacao["dif"];
}) {
  const difBanco = dif.stoneBanco ?? 0;
  const difPrevisto = dif.stonePrevisto ?? 0;
  const confere = Math.abs(difBanco) <= Math.max(50, s.cartao * 0.02);
  return (
    <Card className="mt-3 shadow-card">
      <CardContent className="py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Agenda da Stone</h2>
          {confere ? (
            <Badge variant="success"><CheckCircle2 className="mr-1 size-3.5" /> Bate com o banco</Badge>
          ) : (
            <Badge variant="warning">
              <AlertTriangle className="mr-1 size-3.5" />
              {difBanco < 0 ? "Faltou no banco" : "Sobrou no banco"}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1 divide-x divide-border/50 text-center">
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              Líquido na agenda
            </p>
            <p className="mt-1 text-[0.95rem] font-bold tnum sm:text-base">{formatBRL(s.cartao)}</p>
            <p className="mt-1 text-[9px] text-muted-foreground">
              {formatBRL(s.liquidado)} já creditado
            </p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              Taxa real
            </p>
            <p className="mt-1 text-[0.95rem] font-bold tnum sm:text-base">
              {s.taxaPct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
            </p>
            <p className="mt-1 text-[9px] text-muted-foreground">{formatBRL(s.taxa)} sobre {formatBRL(s.bruto)}</p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {direcao(difBanco).texto}
            </p>
            <p className={cn("mt-1 text-[0.95rem] font-bold tnum sm:text-base", !direcao(difBanco).ok && "text-warning")}>
              {formatBRL(Math.abs(difBanco))}
            </p>
            <p className="mt-1 text-[9px] leading-tight text-muted-foreground">
              o banco recebeu{" "}
              {difBanco < 0 ? "menos" : difBanco > 0 ? "mais" : "o mesmo"} que a agenda
              {Math.abs(difPrevisto) > 0.5 ? (
                <>
                  <br />
                  agenda {difPrevisto > 0 ? "acima" : "abaixo"} do PDV em{" "}
                  {formatBRL(Math.abs(difPrevisto))}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          Vem do arquivo diário da Stone: taxa efetivamente cobrada e data em que o dinheiro caiu.
          {s.antecipadas > 0 ? ` ${s.antecipadas} parcela(s) antecipada(s) no período.` : ""}{" "}
          {s.diasComArquivo} dia(s) do período já baixados — dia sem arquivo entra como zero.
        </p>
      </CardContent>
    </Card>
  );
}

function LinhaConc({ titulo, banco, previsto, dif, nota, manual = 0 }: { titulo: string; banco: number; previsto: number; dif: number; nota: string; manual?: number }) {
  const tolerancia = Math.max(50, Math.abs(previsto) * 0.02);
  const confere = Math.abs(dif) <= tolerancia;
  const pdv = previsto - manual;
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Esperado</p>
            <p className="mt-1 text-[0.95rem] font-bold leading-none tracking-[-0.01em] tnum sm:text-base">{formatBRL(previsto)}</p>
            {manual > 0 ? (
              <p className="mt-1 text-[9px] leading-tight text-muted-foreground">
                PDV {formatBRL(pdv)}<br />+ Maracanã {formatBRL(manual)}
              </p>
            ) : null}
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {direcao(dif, tolerancia).texto}
            </p>
            <p className={cn("mt-1 text-[0.95rem] font-bold leading-none tracking-[-0.01em] tnum sm:text-base", confere ? "text-muted-foreground" : "text-warning")}>
              {formatBRL(Math.abs(dif))}
            </p>
            <p className="mt-1 text-[9px] leading-tight text-muted-foreground">
              {dif < 0
                ? "o banco recebeu menos que o esperado"
                : dif > 0
                  ? "o banco recebeu mais que o esperado"
                  : "banco e esperado batem"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{nota}</p>
      </CardContent>
    </Card>
  );
}

const pct = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
/** Validação da taxa da Stone (agregada): taxa cadastrada (esperada) × taxa efetiva do repasse. */
function TaxaStoneCard({ t }: { t: NonNullable<Conciliacao["taxaCartao"]> }) {
  const difPP = t.taxaStone - t.taxaApp; // >0 = Stone reteve mais que a cadastrada
  const bate = Math.abs(difPP) <= 0.1;
  return (
    <Card className="mt-4">
      <CardContent className="py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Taxa da Stone × cadastrada</h2>
          {t.confiavel ? (
            bate ? <Badge variant="success"><CheckCircle2 className="mr-1 size-3.5" /> Bate</Badge>
              : <Badge variant="warning"><AlertTriangle className="mr-1 size-3.5" /> Diverge</Badge>
          ) : <Badge variant="neutral">Sem base p/ concluir</Badge>}
        </div>
        <div className="grid grid-cols-3 gap-1 divide-x divide-border/50 text-center">
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Cadastrada (app)</p>
            <p className="mt-1 text-base font-bold tnum">{pct(t.taxaApp)}</p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Efetiva (Stone)</p>
            <p className="mt-1 text-base font-bold tnum">{pct(t.taxaStone)}</p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Diferença</p>
            <p className={cn("mt-1 text-base font-bold tnum", !t.confiavel ? "text-muted-foreground" : bate ? "text-muted-foreground" : "text-warning")}>
              {difPP >= 0 ? "+" : "−"}{pct(Math.abs(difPP))}
            </p>
          </div>
        </div>
        {t.confiavel ? (
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {difPP > 0.1
              ? <>A Stone reteve <strong>~{pct(difPP)} a mais</strong> que a taxa cadastrada no repasse. Vale contestar.</>
              : difPP < -0.1
                ? <>A Stone reteve <strong>menos</strong> que a cadastrada (a seu favor).</>
                : <>O repasse da Stone bate com a taxa cadastrada no app.</>}
          </p>
        ) : (
          <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning">
            Extrato curto ({t.extratoDias || 0} dias de cartão no período) — não dá pra concluir a taxa: a antecipação da Stone
            descasa as datas e distorce janelas curtas. Importe um extrato de <strong>~2 a 3 meses</strong> (aba Banco) e volte aqui;
            aí o total fica confiável (sobre um bruto de {formatBRL(t.bruto)}).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
