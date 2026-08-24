"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { Hero } from "@/components/ui/hero";
import { listarEmpresas, obterResumoAvulsas, type ResumoAvulsas } from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { formatBRL, formatarData } from "@/lib/utils";
import { Trophy } from "lucide-react";

function periodoEsteMes(): Periodo {
  const d = new Date();
  const de = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de, ate: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}` };
}
const FORMA_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro", pix: "PIX", cartaoDebito: "Cartão débito", cartaoCredito: "Cartão crédito", cartaoParcelado: "Cartão parcelado",
};

export default function MaracanaPage() {
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(periodoEsteMes());
  const [dados, setDados] = useState<ResumoAvulsas | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const offline = useMemo(() => empresas.filter((e) => e.manual), [empresas]);
  const nomeEmp = (id: string) => empresas.find((e) => e.id === id)?.nomeFantasia || empresas.find((e) => e.id === id)?.razaoSocial || id;

  useEffect(() => {
    void listarEmpresas().then((es) => {
      setEmpresas(es);
      const off = es.filter((e) => e.manual);
      const mar = off.find((e) => /maracan/i.test(e.nomeFantasia ?? e.razaoSocial ?? e.id)) ?? off[0] ?? es[0];
      if (mar && !empresaId) setEmpresaId(mar.id);
    }).catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    if (!empresaId || !periodo.de || !periodo.ate) return;
    setErro(null);
    try {
      setDados(await obterResumoAvulsas(empresaId, periodo.de, periodo.ate));
    } catch (e) { setErro((e as Error).message); setDados(null); }
  }, [empresaId, periodo]);
  useEffect(() => { setDados(null); void carregar(); }, [carregar]);

  const t = dados?.total;
  const rotulo = (chave: string) => (chave.startsWith("(") ? chave : nomeEmp(chave));

  return (
    <div>
      <PageHeader
        title="Maracanã"
        description="Controle das vendas avulsas do Maracanã (fora do PDV) — lançadas em Vendas manuais, caem no banco das máquinas da Barra/Tijuca."
      />

      <div className="mb-4 space-y-2">
        {offline.length > 1 ? (
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Loja (resultado)</span>
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              {offline.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
            </select>
          </label>
        ) : null}
        <FiltroPeriodo value={periodo} onChange={setPeriodo} allowClear={false} />
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {dados === null ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : (t?.qtd ?? 0) === 0 ? (
        <ModulePlaceholder icon={Trophy} title="Sem vendas avulsas no período" etapa="Maracanã">
          Lance as vendas do Maracanã em <strong>Vendas manuais</strong> (Loja = Maracanã, Máquina = Barra/Tijuca). Elas aparecem aqui e na
          conciliação bancária da loja da máquina, sem entrar no resultado da Barra/Tijuca.
        </ModulePlaceholder>
      ) : (
        <>
          <Hero
            eyebrow="Vendas avulsas no período"
            value={formatBRL(t?.bruto)}
            subtitle={`${t?.qtd ?? 0} lançamento(s) · ${formatarData(periodo.de)} a ${formatarData(periodo.ate)}`}
            metrics={[
              { label: "Líquido (após taxa)", value: formatBRL(t?.liquido), tone: "success" },
              { label: "Taxa estimada", value: formatBRL(t?.taxas), tone: "destructive" },
            ]}
          />
          <p className="mt-2 px-1 text-[11px] text-muted-foreground">
            Em cartão/PIX (cai no banco): <strong>{formatBRL(t?.cartaoPix)}</strong> · em dinheiro (fica na loja): {formatBRL(t?.dinheiro)}.
            Líquido pela taxa cadastrada da máquina (forma/parcelas).
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">Por meio de pagamento</h2>
              <Card><CardContent className="py-2">
                <TabelaAg linhas={dados.porForma.map((g) => ({ ...g, rot: FORMA_LABEL[g.chave] ?? g.chave }))} />
              </CardContent></Card>
            </div>
            <div>
              <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">Por máquina (onde o dinheiro cai)</h2>
              <Card><CardContent className="py-2">
                <TabelaAg linhas={dados.porMaquina.map((g) => ({ ...g, rot: rotulo(g.chave) }))} />
              </CardContent></Card>
            </div>
          </div>

          <h2 className="mb-2 mt-6 text-[0.95rem] font-semibold tracking-tight">Por dia</h2>
          <Card><CardContent className="py-2">
            <TabelaAg linhas={dados.porDia.map((g) => ({ ...g, rot: formatarData(g.chave) }))} />
          </CardContent></Card>

          <p className="mt-4 text-xs text-muted-foreground">
            Resultado do Maracanã (não entra no resultado da Barra/Tijuca). O cartão/PIX cai no banco da loja da máquina e aparece na
            conciliação e na taxa dela. Lançamento em <strong>Vendas manuais</strong>. A taxa é a média cadastrada da forma (o manual não informa a bandeira).
          </p>
        </>
      )}
    </div>
  );
}

function TabelaAg({ linhas }: { linhas: Array<{ rot: string; n: number; bruto: number; liquido: number }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead>
          <tr className="text-[10px] uppercase text-muted-foreground">
            <th className="py-1.5 pl-1 text-left font-medium"> </th>
            <th className="py-1.5 px-2 font-medium">Bruto</th>
            <th className="py-1.5 pl-2 font-medium">Líquido</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {linhas.map((l, i) => (
            <tr key={i} className="border-t border-border/60">
              <td className="py-1.5 pl-1 text-left text-muted-foreground">{l.rot} <span className="text-[11px]">· {l.n}</span></td>
              <td className="py-1.5 px-2 font-medium">{formatBRL(l.bruto)}</td>
              <td className="py-1.5 pl-2 text-success">{formatBRL(l.liquido)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
