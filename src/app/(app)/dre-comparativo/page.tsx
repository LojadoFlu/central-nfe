"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { obterDREComparativo, listarEmpresas, type DREComparativo, type DREColuna } from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";

type Eixo = "mes" | "loja";

function periodoUltimosMeses(n: number): Periodo {
  const d = new Date();
  const ate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const ini = new Date(d.getFullYear(), d.getMonth() - (n - 1), 1);
  return { de: `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, "0")}-01`, ate };
}

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function rotuloMes(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return `${MESES_PT[m - 1] ?? ym}/${ym.slice(2, 4)}`;
}
function fmt0(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtPct(v: number): string {
  return `${v.toFixed(1).replace(".", ",")}%`;
}

type NumKey = keyof Omit<DREColuna, "chave" | "rotulo">;
type Row = { label: string; key: NumKey; tipo?: "pos" | "neg" | "res"; forte?: boolean; pct?: boolean; indent?: boolean };
const ROWS: Row[] = [
  { label: "Receita de vendas", key: "receitaVendas", tipo: "pos", forte: true },
  { label: "(−) CMV / Compras", key: "cmv", tipo: "neg" },
  { label: "= Lucro bruto", key: "lucroBruto", forte: true },
  { label: "margem bruta", key: "margemBruta", pct: true, indent: true },
  { label: "(−) Taxas de cartão", key: "taxasCartao", tipo: "neg" },
  { label: "(−) Despesas fixas", key: "despesasFixas", tipo: "neg" },
  { label: "(−) Despesas manuais", key: "despesasManuais", tipo: "neg" },
  { label: "(−) Fretes (CT-e)", key: "fretes", tipo: "neg" },
  { label: "(−) Serviços (NFS-e)", key: "servicos", tipo: "neg" },
  { label: "= Resultado", key: "resultado", tipo: "res", forte: true },
  { label: "margem líquida", key: "margemLiquida", pct: true, indent: true },
];

export default function DreComparativoPage() {
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [eixo, setEixo] = useState<Eixo>("mes");
  const [periodo, setPeriodo] = useState<Periodo>(periodoUltimosMeses(3));
  const [cmvPct, setCmvPct] = useState("");
  const [cmvBase, setCmvBase] = useState<"gerencial" | "aquisicao">("gerencial");
  const [dados, setDados] = useState<DREComparativo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void listarEmpresas().then(setEmpresas).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    if (!periodo.de || !periodo.ate) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await obterDREComparativo(eixo, periodo.de, periodo.ate, eixo === "mes" ? empresaId : "", Number(cmvPct) || 0, cmvBase));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [eixo, empresaId, periodo, cmvPct, cmvBase]);

  useEffect(() => { void carregar(); }, [carregar]);

  function cell(v: number, r: Row): string {
    if (r.pct) return fmtPct(v);
    return fmt0(r.tipo === "neg" ? -v : v);
  }
  function corCell(v: number, r: Row): string {
    if (r.pct) return v >= 0 ? "text-muted-foreground" : "text-destructive";
    if (r.tipo === "neg") return "text-destructive";
    if (r.tipo === "res") return v >= 0 ? "text-success" : "text-destructive";
    if (r.tipo === "pos") return "text-success";
    return "";
  }

  const colunas = dados?.colunas ?? [];

  return (
    <div>
      <PageHeader
        title="DRE comparativo"
        description="A mesma DRE em várias colunas: tendência mês a mês ou lojas lado a lado."
      />

      <div className="mb-4 space-y-2">
        <div className="flex gap-1 rounded-md border border-border p-1">
          {([["mes", "Mês a mês"], ["loja", "Lojas lado a lado"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setEixo(k)}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${eixo === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {label}
            </button>
          ))}
        </div>
        {eixo === "mes" && empresas.length ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todas as lojas (consolidado)</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
          </select>
        ) : null}
        <FiltroPeriodo value={periodo} onChange={setPeriodo} allowClear={false} />
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
          <label className="text-xs text-muted-foreground">Base do custo</label>
          <select value={cmvBase} onChange={(e) => setCmvBase(e.target.value as "gerencial" | "aquisicao")} disabled={Number(cmvPct) > 0}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50">
            <option value="gerencial">Custo gerencial</option>
            <option value="aquisicao">Custo de aquisição</option>
          </select>
          <span className="mx-1 text-border">|</span>
          <label className="text-xs text-muted-foreground">CMV %</label>
          <Input type="number" step="0.1" inputMode="decimal" placeholder="auto" value={cmvPct} onChange={(e) => setCmvPct(e.target.value)} className="h-8 w-20" />
          <span className="text-[11px] text-muted-foreground">{Number(cmvPct) > 0 ? "receita × %" : "custo real dos itens (fallback: compras)"}</span>
        </div>
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <Skeleton className="h-80" />
      ) : dados && colunas.length ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {eixo === "mes" ? "Linha / mês" : "Linha / loja"}
                    </th>
                    {colunas.map((c) => (
                      <th key={c.chave} className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {c.incompleto ? <span title="Receita incompleta neste período (fora da janela de sync de vendas) — margem distorcida">⚠ </span> : null}
                        {eixo === "mes" ? rotuloMes(c.rotulo) : c.rotulo}
                      </th>
                    ))}
                    {colunas.length > 1 ? (
                      <th className="whitespace-nowrap border-l border-border px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-foreground">Total</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="tnum">
                  {ROWS.map((r) => (
                    <tr key={r.label} className={`border-b border-border/50 ${r.tipo === "res" ? "bg-muted/40" : ""}`}>
                      <td className={`sticky left-0 z-10 bg-card px-3 py-1.5 text-left ${r.forte ? "font-semibold" : ""} ${r.indent ? "pl-6 text-[11px] text-muted-foreground" : ""}`}>
                        {r.label}
                      </td>
                      {colunas.map((c) => (
                        <td key={c.chave} className={`whitespace-nowrap px-3 py-1.5 ${r.forte ? "font-semibold" : ""} ${r.indent ? "text-[11px]" : ""} ${corCell(c[r.key] as number, r)}`}>
                          {cell(c[r.key] as number, r)}
                        </td>
                      ))}
                      {colunas.length > 1 ? (
                        <td className={`whitespace-nowrap border-l border-border px-3 py-1.5 ${r.forte ? "font-bold" : "font-medium"} ${r.indent ? "text-[11px]" : ""} ${corCell(dados.total[r.key] as number, r)}`}>
                          {cell(dados.total[r.key] as number, r)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : dados ? (
        <p className="text-sm text-muted-foreground">Sem dados no período.</p>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        Cada coluna é uma DRE completa (mesmos números da tela DRE gerencial, por competência). Valores arredondados ao real.
        No eixo por loja, lojas sem movimento no período são omitidas. Sem CMV%, o custo usa as compras (NF-e) do período.
        <br />
        <strong>⚠ = período com dado incompleto</strong> (margem distorcida): ou receita faltando, ou — usando compras como custo —
        as NF-e de compra fora da janela da SEFAZ (~90 dias), o que infla a margem de meses antigos (aparecem ~100%). O mês corrente
        também é parcial. <strong>Para comparar vários meses na mesma base, informe o CMV %</strong> — aí o custo vem da receita e todo
        mês fica comparável (o ⚠ de compras some).
      </p>
    </div>
  );
}
