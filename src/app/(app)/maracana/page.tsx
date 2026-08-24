"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import { Hero } from "@/components/ui/hero";
import { listarEmpresas, listarVendasManuais, type VendaManual } from "@/lib/nfe/repo";
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
  const [lista, setLista] = useState<VendaManual[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Lojas offline (Maracanã é uma delas). Só elas fazem sentido aqui.
  const offline = useMemo(() => empresas.filter((e) => e.manual), [empresas]);
  const nomeEmp = (id: string | null) => empresas.find((e) => e.id === id)?.nomeFantasia || empresas.find((e) => e.id === id)?.razaoSocial || (id ?? "—");

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
      setLista(await listarVendasManuais(empresaId, periodo.de, periodo.ate));
    } catch (e) { setErro((e as Error).message); setLista([]); }
  }, [empresaId, periodo]);
  useEffect(() => { setLista(null); void carregar(); }, [carregar]);

  const resumo = useMemo(() => {
    const vs = lista ?? [];
    const total = vs.reduce((s, v) => s + (v.valor ?? 0), 0);
    const emDinheiro = vs.filter((v) => v.forma === "dinheiro").reduce((s, v) => s + (v.valor ?? 0), 0);
    const noBanco = total - emDinheiro; // cartão/PIX (cai na conta da máquina)
    const porForma = new Map<string, { n: number; valor: number }>();
    const porMaquina = new Map<string, number>();
    const porDia = new Map<string, number>();
    for (const v of vs) {
      const f = porForma.get(v.forma) ?? { n: 0, valor: 0 }; f.n++; f.valor += v.valor ?? 0; porForma.set(v.forma, f);
      const mk = v.forma === "dinheiro" ? "(dinheiro na loja)" : (v.maquinaEmpresaId ?? "(sem máquina)");
      porMaquina.set(mk, (porMaquina.get(mk) ?? 0) + (v.valor ?? 0));
      porDia.set(v.dia, (porDia.get(v.dia) ?? 0) + (v.valor ?? 0));
    }
    return {
      total, emDinheiro, noBanco, qtd: vs.length,
      porForma: [...porForma.entries()].sort((a, b) => b[1].valor - a[1].valor),
      porMaquina: [...porMaquina.entries()].sort((a, b) => b[1] - a[1]),
      porDia: [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0])),
    };
  }, [lista]);

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

      {lista === null ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : lista.length === 0 ? (
        <ModulePlaceholder icon={Trophy} title="Sem vendas avulsas no período" etapa="Maracanã">
          Lance as vendas do Maracanã em <strong>Vendas manuais</strong> (Loja = Maracanã, Máquina = Barra/Tijuca). Elas aparecem aqui e na
          conciliação bancária da loja da máquina, sem entrar no resultado da Barra/Tijuca.
        </ModulePlaceholder>
      ) : (
        <>
          <Hero
            eyebrow="Vendas avulsas no período"
            value={formatBRL(resumo.total)}
            subtitle={`${resumo.qtd} lançamento(s) · ${formatarData(periodo.de)} a ${formatarData(periodo.ate)}`}
            metrics={[
              { label: "Em cartão/PIX (banco)", value: formatBRL(resumo.noBanco), tone: "warning" },
              { label: "Em dinheiro (na loja)", value: formatBRL(resumo.emDinheiro), tone: "success" },
            ]}
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">Por meio de pagamento</h2>
              <Card><CardContent className="py-3">
                <div className="divide-y divide-border text-sm">
                  {resumo.porForma.map(([f, g]) => (
                    <div key={f} className="flex items-center justify-between py-1.5">
                      <span className="text-muted-foreground">{FORMA_LABEL[f] ?? f} <span className="text-[11px]">· {g.n}</span></span>
                      <span className="font-medium tnum">{formatBRL(g.valor)}</span>
                    </div>
                  ))}
                </div>
              </CardContent></Card>
            </div>
            <div>
              <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">Por máquina (onde o dinheiro cai)</h2>
              <Card><CardContent className="py-3">
                <div className="divide-y divide-border text-sm">
                  {resumo.porMaquina.map(([mk, v]) => (
                    <div key={mk} className="flex items-center justify-between py-1.5">
                      <span className="text-muted-foreground">{mk.startsWith("(") ? mk : nomeEmp(mk)}</span>
                      <span className="font-medium tnum">{formatBRL(v)}</span>
                    </div>
                  ))}
                </div>
              </CardContent></Card>
            </div>
          </div>

          <h2 className="mb-2 mt-6 text-[0.95rem] font-semibold tracking-tight">Por dia</h2>
          <Card><CardContent className="py-3">
            <div className="divide-y divide-border text-sm">
              {resumo.porDia.map(([d, v]) => (
                <div key={d} className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">{formatarData(d)}</span>
                  <span className="font-medium tnum">{formatBRL(v)}</span>
                </div>
              ))}
            </div>
          </CardContent></Card>

          <p className="mt-4 text-xs text-muted-foreground">
            Estes valores são o resultado do Maracanã (não entram no resultado da Barra/Tijuca). O cartão/PIX cai no banco da loja da
            máquina e aparece na conciliação bancária e na taxa dela. Para lançar, use <strong>Vendas manuais</strong>.
          </p>
        </>
      )}
    </div>
  );
}
