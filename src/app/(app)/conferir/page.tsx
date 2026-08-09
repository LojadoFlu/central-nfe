"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { conferirRecebiveis, listarEmpresas, type Conferencia } from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { formatBRL, formatarData } from "@/lib/utils";
import { BadgeCheck, CheckCircle2 } from "lucide-react";

function periodoEsteMes(): Periodo {
  const d = new Date();
  const de = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de, ate: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}` };
}
const pct = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export default function ConferirPage() {
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(periodoEsteMes());
  const [dados, setDados] = useState<Conferencia | null>(null);
  const [carregando, setCarregando] = useState(false);
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
    setDados(null);
    try {
      setDados(await conferirRecebiveis(empresaId, periodo.de, periodo.ate));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo]);

  useEffect(() => { void carregar(); }, [carregar]);

  const r = dados?.resumo;

  return (
    <div>
      <PageHeader
        title="Conferir taxas"
        description="A taxa cobrada em cada venda × a taxa cadastrada. A diferença é cobrança fora do contrato."
      />

      <div className="mb-4 space-y-2">
        {empresas.length > 1 ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
            ))}
          </select>
        ) : null}
        <FiltroPeriodo value={periodo} onChange={setPeriodo} allowClear={false} />
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : dados ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Mini n={r?.taxaOk ?? 0} label="Taxa OK" tone="text-success" />
            <Mini n={r?.divergentes ?? 0} label="Divergentes" tone="text-warning" />
            <Mini n={r?.semCadastro ?? 0} label="Sem cadastro" tone="text-muted-foreground" />
          </div>

          {/* Impacto */}
          <Card className={`mt-3 ${(r?.impactoTotal ?? 0) > 0 ? "border-destructive/40" : ""}`}>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {(r?.impactoTotal ?? 0) >= 0 ? "Cobrado a mais no período" : "Cobrado a menos no período"}
                </p>
                <p className={`text-2xl font-bold tnum ${(r?.impactoTotal ?? 0) > 0 ? "text-destructive" : "text-success"}`}>
                  {formatBRL(Math.abs(r?.impactoTotal ?? 0))}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{r?.conferidos ?? 0} venda(s) de cartão conferida(s)</p>
            </CardContent>
          </Card>

          {(dados.divergencias?.length ?? 0) === 0 ? (
            <div className="mt-4">
              <ModulePlaceholder icon={CheckCircle2} title="Taxas em ordem" etapa="Conferência">
                Nenhuma venda com taxa diferente da cadastrada no período. A maquininha cobrou o combinado.
                {(r?.semCadastro ?? 0) > 0 ? ` (${r?.semCadastro} venda(s) sem taxa cadastrada — cadastre em Taxas de cartão para conferir.)` : ""}
              </ModulePlaceholder>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                {dados.divergencias.length} venda(s) com taxa divergente (maior impacto primeiro):
              </p>
              {dados.divergencias.map((d, i) => (
                <Card key={i} className={d.impacto > 0 ? "border-destructive/30" : undefined}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {d.cartao} <Badge variant="neutral">{d.parcelas <= 1 ? "à vista" : `${d.parcelas}x`}</Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatarData(d.dia)} · cobrada <strong className="text-destructive">{pct(d.cobrada)}</strong> · cadastrada {pct(d.esperada)}
                          {" "}({d.diff > 0 ? "+" : ""}{pct(d.diff)})
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold tnum ${d.impacto > 0 ? "text-destructive" : "text-success"}`}>
                          {d.impacto > 0 ? "+" : "−"}{formatBRL(Math.abs(d.impacto))}
                        </p>
                        <p className="text-[11px] text-muted-foreground tnum">venda {formatBRL(d.valor)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Cada venda de cartão tem taxa constante e depende do total de parcelas. Comparamos a taxa cobrada (recebíveis
            do PDV) com a cadastrada em Taxas de cartão. “Cobrado a mais” = a adquirente cobrou acima do contrato.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Selecione a loja e o período.</p>
      )}
    </div>
  );
}

function Mini({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <Card>
      <CardContent className="py-3 text-center">
        <p className={`text-2xl font-bold tnum ${n > 0 ? tone : "text-muted-foreground"}`}>{n}</p>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
