"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Hero } from "@/components/ui/hero";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { obterFluxoCaixa, listarEmpresas, obterContaBanco, type FluxoCaixa, type FluxoDia } from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { formatBRL, formatarData, diaSemana } from "@/lib/utils";
import { LineChart, ArrowDownRight, ArrowUpRight } from "lucide-react";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hojeISO(): string {
  return ymd(new Date());
}
function maisDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function primeiroDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function ultimoDiaMes(): string {
  const d = new Date();
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return ymd(u);
}
/** Segunda-feira da semana de uma data YYYY-MM-DD. */
function segundaDaSemana(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  return ymd(dt);
}
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function mesLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${y}`;
}

const HORIZONTES = [
  { key: "30", label: "Próximos 30 dias" },
  { key: "60", label: "Próximos 60 dias" },
  { key: "90", label: "Próximos 90 dias" },
  { key: "mes", label: "Este mês" },
  { key: "custom", label: "Personalizado…" },
];

const ORIGEM_LABEL: Record<string, string> = {
  cartao: "Cartões (líquido)", avista: "PIX + dinheiro",
  nfe: "Contas a pagar (NF-e)", despesas: "Despesas fixas", acordos: "Acordos",
};

interface Grupo {
  key: string;
  label: string;
  entrada: number;
  saida: number;
  saldo: number;
  acumulado: number;
  futuro: boolean;
}

export default function FluxoPage() {
  const [dados, setDados] = useState<FluxoCaixa | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [horizonte, setHorizonte] = useState("30");
  const [de, setDe] = useState(hojeISO());
  const [ate, setAte] = useState(maisDias(30));
  const [agrup, setAgrup] = useState<"dia" | "semana" | "mes">("semana");
  const [saldos, setSaldos] = useState<Record<string, number>>({}); // saldo inicial por empresa
  const [contaBanco, setContaBanco] = useState<{ saldo: number | null; saldoData: string | null } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("nfe_fluxo_saldos");
      if (raw) setSaldos(JSON.parse(raw));
    } catch { /* ignore */ }
    void listarEmpresas().then(setEmpresas).catch(() => {});
  }, []);

  // Saldo inicial é por loja (empresa). "Todas" soma; edita-se com uma loja selecionada.
  const editavelSaldo = !!empresaId || empresas.length <= 1;
  const chaveSaldo = empresaId || empresas[0]?.id || "global";
  const saldoInicial = editavelSaldo
    ? saldos[chaveSaldo] ?? 0
    : empresas.reduce((s, e) => s + (saldos[e.id] ?? 0), 0);

  function salvarSaldo(v: number) {
    const next = { ...saldos, [chaveSaldo]: v };
    setSaldos(next);
    try { localStorage.setItem("nfe_fluxo_saldos", JSON.stringify(next)); } catch { /* ignore */ }
  }

  // horizonte → de/ate (exceto custom, que usa os inputs)
  useEffect(() => {
    if (horizonte === "custom") return;
    if (horizonte === "mes") { setDe(primeiroDiaMes()); setAte(ultimoDiaMes()); return; }
    setDe(hojeISO());
    setAte(maisDias(Number(horizonte)));
  }, [horizonte]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await obterFluxoCaixa(de, ate, empresaId));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [de, ate, empresaId]);

  useEffect(() => { void carregar(); }, [carregar]);

  // saldo do banco da loja selecionada (para oferecer como saldo inicial)
  useEffect(() => {
    if (!empresaId) { setContaBanco(null); return; }
    void obterContaBanco(empresaId).then(setContaBanco).catch(() => setContaBanco(null));
  }, [empresaId]);

  const grupos = useMemo<Grupo[]>(() => {
    const linhas: FluxoDia[] = dados?.linhas ?? [];
    const hoje = dados?.hoje ?? hojeISO();
    const m = new Map<string, { label: string; entrada: number; saida: number }>();
    for (const l of linhas) {
      let key: string, label: string;
      if (agrup === "dia") { key = l.dia; label = formatarData(l.dia); }
      else if (agrup === "mes") { key = l.dia.slice(0, 7); label = mesLabel(key); }
      else { key = segundaDaSemana(l.dia); label = `Semana de ${formatarData(key)}`; }
      const g = m.get(key) ?? { label, entrada: 0, saida: 0 };
      g.entrada += l.entrada;
      g.saida += l.saida;
      m.set(key, g);
    }
    let acc = saldoInicial;
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, g]) => {
        const saldo = g.entrada - g.saida;
        acc += saldo;
        return { key, label: g.label, entrada: g.entrada, saida: g.saida, saldo, acumulado: acc, futuro: key >= hoje };
      });
  }, [dados, agrup, saldoInicial]);

  const totais = dados?.totais;
  const saldoFinal = saldoInicial + (totais?.saldo ?? 0);
  const semMovimento = !carregando && dados && (dados.linhas?.length ?? 0) === 0;

  return (
    <div>
      <PageHeader
        title="Fluxo de caixa"
        description="Entradas e saídas projetadas — do PDV, das NF-e, despesas e acordos."
      />

      {/* Filtros */}
      <div className="mb-4 space-y-2">
        {empresas.length > 1 ? (
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas as empresas</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
            ))}
          </select>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={horizonte}
            onChange={(e) => setHorizonte(e.target.value)}
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm sm:flex-none sm:w-56"
          >
            {HORIZONTES.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
          </select>
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            {(["dia", "semana", "mes"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAgrup(a)}
                className={`rounded px-2.5 py-1 font-medium capitalize transition-colors ${agrup === a ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {a === "mes" ? "mês" : a}
              </button>
            ))}
          </div>
        </div>

        {horizonte === "custom" ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-9 min-w-0 flex-1" />
            <span className="shrink-0 text-xs text-muted-foreground">até</span>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-9 min-w-0 flex-1" />
          </div>
        ) : null}
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : (
        <>
          <Hero
            eyebrow="Saldo do período"
            value={formatBRL(totais?.saldo)}
            valueTone={(totais?.saldo ?? 0) < 0 ? "destructive" : "default"}
            tone={(totais?.saldo ?? 0) < 0 ? "destructive" : "primary"}
            subtitle="Entradas − saídas previstas no período"
            metrics={[
              { label: "Entradas", value: formatBRL(totais?.entrada), tone: "success" },
              { label: "Saídas", value: formatBRL(totais?.saida), tone: "destructive" },
            ]}
          />

          {/* Saldo inicial + projetado */}
          <Card className="mt-3">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="space-y-1">
                <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                  Saldo inicial {editavelSaldo ? "(por loja)" : "(soma das lojas)"}
                </label>
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={editavelSaldo ? saldos[chaveSaldo] || "" : saldoInicial}
                  onChange={editavelSaldo ? (e) => salvarSaldo(Number(e.target.value) || 0) : undefined}
                  readOnly={!editavelSaldo}
                  placeholder="0,00"
                  className={`h-9 w-36 ${!editavelSaldo ? "bg-muted text-muted-foreground" : ""}`}
                />
                {!editavelSaldo ? (
                  <p className="text-[11px] text-muted-foreground">Selecione uma loja para editar o saldo dela.</p>
                ) : contaBanco?.saldo != null ? (
                  <button
                    type="button"
                    onClick={() => salvarSaldo(contaBanco.saldo as number)}
                    className="text-left text-[11px] font-medium text-primary hover:underline"
                  >
                    Usar saldo do banco: {formatBRL(contaBanco.saldo)}
                    {contaBanco.saldoData ? ` (${formatarData(contaBanco.saldoData)})` : ""}
                  </button>
                ) : null}
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo projetado ao fim</p>
                <p className={`text-xl font-bold tnum ${saldoFinal < 0 ? "text-destructive" : "text-success"}`}>{formatBRL(saldoFinal)}</p>
              </div>
            </CardContent>
          </Card>

          {semMovimento ? (
            <div className="mt-4">
              <ModulePlaceholder icon={LineChart} title="Sem movimento no período" etapa="Fluxo de caixa">
                Ajuste o horizonte, ou sincronize as vendas e cadastre contas para ver o fluxo projetado.
              </ModulePlaceholder>
            </div>
          ) : (
            <>
              {/* Por origem */}
              {dados?.porOrigem ? (
                <Card className="mt-3">
                  <CardContent className="py-4">
                    <h2 className="mb-2 text-[0.95rem] font-semibold tracking-tight">Composição</h2>
                    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {Object.entries(dados.porOrigem)
                        .filter(([, v]) => v > 0)
                        .map(([k, v]) => {
                          const entrada = k === "cartao" || k === "avista";
                          return (
                            <div key={k} className="flex items-center justify-between py-1 text-sm">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                {entrada ? <ArrowUpRight className="size-3.5 text-success" /> : <ArrowDownRight className="size-3.5 text-destructive" />}
                                {ORIGEM_LABEL[k] ?? k}
                              </span>
                              <span className="font-medium tnum">{formatBRL(v)}</span>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* Próximos créditos de cartão (quando cai — regra D+1 / fim de semana → segunda) */}
              {dados?.proximosCartao?.length ? (
                <Card className="mt-3">
                  <CardContent className="py-4">
                    <h2 className="mb-1 text-[0.95rem] font-semibold tracking-tight">Próximos créditos de cartão</h2>
                    <p className="mb-2 text-[11px] text-muted-foreground">Quando o cartão já vendido vai cair na conta. Fins de semana caem na segunda.</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {dados.proximosCartao.slice(0, 14).map((c) => {
                        const ds = diaSemana(c.dia);
                        const fds = ds === "seg";
                        return (
                          <div key={c.dia} className={`min-w-[92px] shrink-0 rounded-md border p-2 text-center ${fds ? "border-success/40 bg-success/5" : "border-border"}`}>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{ds} · {formatarData(c.dia).slice(0, 5)}</p>
                            <p className="mt-0.5 text-sm font-bold tnum text-success">{formatBRL(c.valor)}</p>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* Linha do tempo */}
              <div className="mt-4 space-y-2">
                {grupos.map((g) => (
                  <Card key={g.key} className={g.acumulado < 0 ? "border-destructive/40" : undefined}>
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-medium">
                            {g.label}
                            {g.futuro ? <Badge variant="neutral">previsto</Badge> : null}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            <span className="text-success">+{formatBRL(g.entrada)}</span>{" "}
                            <span className="text-destructive">−{formatBRL(g.saida)}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold tnum ${g.saldo < 0 ? "text-destructive" : "text-foreground"}`}>
                            {g.saldo >= 0 ? "+" : "−"}{formatBRL(Math.abs(g.saldo))}
                          </p>
                          <p className={`text-[11px] tnum ${g.acumulado < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            saldo {formatBRL(g.acumulado)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Entradas: recebíveis de cartão pelo valor <strong>líquido</strong> na data de liquidação + PIX/dinheiro na venda.
            Saídas: contas a pagar das NF-e, despesas fixas previstas e acordos. “Previsto” = ainda não pago/liquidado.
            Tudo vem de dados sincronizados — nada é estimado.
          </p>
        </>
      )}
    </div>
  );
}
