"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { obterDRE, listarEmpresas, type DRE } from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { formatBRL } from "@/lib/utils";

function periodoEsteMes(): Periodo {
  const d = new Date();
  const de = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de, ate: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}` };
}

const fmtPct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

function cmvTitulo(d: DRE): string {
  if (d.cmvOrigem === "percentual") return `(−) CMV (${fmtPct(d.cmvPct)} da receita)`;
  if (d.cmvOrigem === "real_gerencial") return "(−) CMV real (custo gerencial)";
  if (d.cmvOrigem === "real_aquisicao") return "(−) CMV real (custo de aquisição)";
  return "(−) Compras de mercadoria (NF-e)";
}
function cmvNota(d: DRE): string | undefined {
  if (d.cmvOrigem === "real_gerencial" || d.cmvOrigem === "real_aquisicao") {
    return `custo real dos itens vendidos · ${fmtPct(d.custoCobertura * 100)} dos itens com custo`;
  }
  if (d.cmvOrigem === "compras") return "custo real indisponível no período → usando NF-e de compra (proxy)";
  return undefined;
}

export default function DrePage() {
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(periodoEsteMes());
  const [cmvPct, setCmvPct] = useState("");
  const [cmvBase, setCmvBase] = useState<"gerencial" | "aquisicao">("gerencial");
  const [dados, setDados] = useState<DRE | null>(null);
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
      setDados(await obterDRE(periodo.de, periodo.ate, empresaId, Number(cmvPct) || 0, cmvBase));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo, cmvPct, cmvBase]);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div>
      <PageHeader
        title="DRE gerencial"
        description="Resultado por competência: o que a operação gera de lucro, não só o que entra no caixa."
      />

      <div className="mb-4 space-y-2">
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas as lojas (consolidado)</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
          ))}
        </select>
        <FiltroPeriodo value={periodo} onChange={setPeriodo} allowClear={false} />
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
          <label className="text-xs text-muted-foreground">Base do custo</label>
          <select value={cmvBase} onChange={(e) => setCmvBase(e.target.value as "gerencial" | "aquisicao")} disabled={Number(cmvPct) > 0}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50">
            <option value="gerencial">Custo gerencial (médio)</option>
            <option value="aquisicao">Custo de aquisição</option>
          </select>
          <span className="mx-1 text-border">|</span>
          <label className="text-xs text-muted-foreground">CMV %</label>
          <Input type="number" step="0.1" inputMode="decimal" placeholder="auto"
            value={cmvPct} onChange={(e) => setCmvPct(e.target.value)} className="h-8 w-20" />
          <span className="text-[11px] text-muted-foreground">
            {Number(cmvPct) > 0 ? "custo = receita × %" : "custo real dos itens vendidos (fallback: compras)"}
          </span>
        </div>
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
      ) : dados ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Receita de vendas" value={formatBRL(dados.receitaVendas)} />
            <StatCard label="Lucro bruto" value={formatBRL(dados.lucroBruto)} hint={`margem ${fmtPct(dados.margemBruta)}`} tone={dados.lucroBruto >= 0 ? "success" : "destructive"} />
            <StatCard
              label="Resultado do período"
              value={formatBRL(dados.resultado)}
              hint={`margem ${fmtPct(dados.margemLiquida)}`}
              tone={dados.resultado >= 0 ? "success" : "destructive"}
            />
          </div>

          <Card className="mt-4">
            <CardContent className="py-2">
              <table className="w-full text-sm">
                <tbody className="tnum">
                  <Linha titulo="Receita de vendas" valor={dados.receitaVendas} tom="pos" forte
                    nota={dados.receitaManual > 0 ? `inclui ${formatBRL(dados.receitaManual)} de vendas manuais` : undefined} />
                  <Linha titulo={cmvTitulo(dados)} valor={-dados.cmv} tom="neg" nota={cmvNota(dados)} />
                  <Linha titulo="= Lucro bruto" valor={dados.lucroBruto} forte destaque
                    nota={`margem bruta ${fmtPct(dados.margemBruta)}`} />
                  <Linha titulo="(−) Taxas de cartão" valor={-dados.taxasCartao} tom="neg" />
                  <Linha titulo="(−) Despesas fixas" valor={-dados.despesasFixas} tom="neg" />
                  <Linha titulo="(−) Fretes (CT-e)" valor={-dados.fretes} tom="neg" />
                  <Linha titulo="(−) Serviços (NFS-e)" valor={-dados.servicos} tom="neg" />
                  <Linha titulo="= Resultado do período" valor={dados.resultado} forte destaque
                    nota={`margem líquida ${fmtPct(dados.margemLiquida)}`} />
                  {dados.cmvOrigem !== "compras" ? (
                    <Linha titulo="Memo: compras de mercadoria no período" valor={dados.compras} tom="memo" />
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="mt-4 text-xs text-muted-foreground">
            Competência (data do fato, não do pagamento). Fontes reais: vendas (PDV + manual), recebíveis de cartão, NF-e de
            compra, despesas fixas, CT-e e NFS-e. <strong>Acordos ficam de fora</strong> (são quitação de dívida, não despesa nova).
            O <strong>CMV real</strong> vem do custo de cada item vendido no PDV (gerencial = custo médio; aquisição = última compra);
            onde não houver custo, cai para as compras (NF-e). Informe um CMV % para forçar uma base fixa. Vendas manuais entram na
            receita mas não têm custo no PDV.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Linha({
  titulo, valor, tom = "neutro", forte = false, destaque = false, nota,
}: {
  titulo: string; valor: number; tom?: "pos" | "neg" | "neutro" | "memo"; forte?: boolean; destaque?: boolean; nota?: string;
}) {
  const cor = tom === "neg" ? "text-destructive" : tom === "pos" ? "text-success" : tom === "memo" ? "text-muted-foreground" : "";
  return (
    <tr className={`border-b border-border/50 ${destaque ? "bg-muted/40" : ""}`}>
      <td className="py-2 pr-2">
        <span className={forte ? "font-semibold" : ""}>{titulo}</span>
        {nota ? <span className="block text-[11px] font-normal text-muted-foreground">{nota}</span> : null}
      </td>
      <td className={`py-2 pl-2 text-right ${forte ? "font-bold" : ""} ${cor}`}>{formatBRL(valor)}</td>
    </tr>
  );
}
