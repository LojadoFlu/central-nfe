"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
/** Domingo da semana de uma data YYYY-MM-DD. */
function domingoDaSemana(iso: string): string {
  const [y, m, d] = segundaDaSemana(iso).split("-").map(Number);
  return ymd(new Date(y, m - 1, d + 6));
}
/** Quantos dias (inclusivo) entre de e ate. */
function diasNoIntervalo(de: string, ate: string): number {
  const a = new Date(`${de}T00:00:00`).getTime();
  const b = new Date(`${ate}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}
/** Lista todos os dias YYYY-MM-DD de [de, ate] (inclusivo, teto de segurança). */
function enumerarDias(de: string, ate: string): string[] {
  const out: string[] = [];
  const [y, m, d] = de.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  let guard = 0;
  while (ymd(dt) <= ate && guard++ < 400) { out.push(ymd(dt)); dt.setDate(dt.getDate() + 1); }
  return out;
}
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function mesLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${y}`;
}

// Atalhos rápidos de período (segmentado). "dia"=hoje, "semana"=esta semana, "mes"=este mês.
const PERIODOS_RAPIDOS = [
  { key: "dia", label: "Hoje" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
] as const;
// Projeções mais longas (pulldown).
const PROJECOES = [
  { key: "30", label: "Próximos 30 dias" },
  { key: "60", label: "Próximos 60 dias" },
  { key: "90", label: "Próximos 90 dias" },
  { key: "custom", label: "Personalizado…" },
];
/** Agrupamento automático conforme o tamanho do intervalo. */
function agrupamentoPara(de: string, ate: string): "dia" | "semana" | "mes" {
  const n = diasNoIntervalo(de, ate);
  if (n <= 10) return "dia";
  if (n <= 62) return "semana";
  return "mes";
}

const ORIGEM_LABEL: Record<string, string> = {
  cartao: "Cartões (líquido)", avista: "PIX + dinheiro",
  nfe: "Contas a pagar (NF-e)", despesas: "Despesas fixas", despesasManuais: "Despesas manuais", acordos: "Acordos",
  comissoes: "Comissões (provisão)",
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

/** Valor compacto p/ eixo: 1.250.000 → "1,2M"; 42.000 → "42k". */
function valorCompacto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")}M`;
  if (a >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}
/** Escala "redonda" para o eixo Y: bordas e passo em números limpos. */
function escalaY(min: number, max: number, alvo = 4): { lo: number; hi: number; ticks: number[] } {
  const span = (max - min) || 1;
  const bruto = span / (alvo - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const norm = bruto / mag;
  const passo = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / passo) * passo;
  const hi = Math.ceil(max / passo) * passo;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + passo / 2; v += passo) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

/** Gráfico do saldo acumulado dia a dia — verde acima de zero, vermelho abaixo, com eixos + hover. */
function GraficoCaixa({ serie }: { serie: { dia: string; saldo: number }[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hoverI, setHoverI] = useState<number | null>(null);
  const W = 320, H = 168, padL = 34, padR = 6, padT = 10, padB = 22;
  const vals = serie.map((s) => s.saldo);
  const { lo, hi, ticks } = escalaY(Math.min(0, ...vals), Math.max(0, ...vals));
  const n = serie.length;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / ((hi - lo) || 1)) * (H - padT - padB);
  const zeroY = y(0);

  const apontar = (clientX: number) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = (clientX - r.left) / (r.width || 1);
    const i = Math.round(((frac * W - padL) / (W - padL - padR)) * (n - 1));
    setHoverI(Math.max(0, Math.min(n - 1, i)));
  };

  if (n < 2) return null;
  const pts = serie.map((s, i) => `${x(i).toFixed(1)},${y(s.saldo).toFixed(1)}`);
  const lineD = `M${pts.join(" L")}`;
  const areaD = `M${x(0).toFixed(1)},${zeroY.toFixed(1)} L${pts.join(" L")} L${x(n - 1).toFixed(1)},${zeroY.toFixed(1)} Z`;
  let minI = 0;
  for (let i = 1; i < n; i++) if (serie[i].saldo < serie[minI].saldo) minI = i;
  const ddmm = (iso: string) => formatarData(iso).slice(0, 5);
  // ticks do eixo X: no máx. 5 rótulos, sempre com o primeiro e o último.
  const maxX = Math.min(5, n);
  const passoX = Math.max(1, Math.ceil((n - 1) / (maxX - 1)));
  const idxX = Array.from(new Set([...Array.from({ length: n }, (_, i) => i).filter((i) => i % passoX === 0), n - 1]));

  const hv = hoverI != null ? serie[hoverI] : null;
  const hvCor = hv ? (hv.saldo < 0 ? "destructive" : "success") : "success";

  return (
    <div
      ref={boxRef}
      className="relative touch-none"
      onMouseMove={(e) => apontar(e.clientX)}
      onMouseLeave={() => setHoverI(null)}
      onTouchStart={(e) => apontar(e.touches[0].clientX)}
      onTouchMove={(e) => apontar(e.touches[0].clientX)}
      onTouchEnd={() => setHoverI(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projeção de saldo diário">
        <defs>
          <clipPath id="fluxoPos"><rect x="0" y="0" width={W} height={zeroY} /></clipPath>
          <clipPath id="fluxoNeg"><rect x="0" y={zeroY} width={W} height={Math.max(0, H - zeroY)} /></clipPath>
        </defs>
        {/* Grade + rótulos do eixo Y */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="hsl(var(--border))" strokeWidth={0.5} strokeOpacity={t === 0 ? 0 : 0.6} />
            <text x={padL - 3} y={y(t) + 2.5} fontSize={7.5} textAnchor="end" fill="hsl(var(--muted-foreground))">{valorCompacto(t)}</text>
          </g>
        ))}
        {/* Áreas e linha (dois tons no zero) */}
        <path d={areaD} fill="hsl(var(--success))" fillOpacity={0.14} clipPath="url(#fluxoPos)" />
        <path d={areaD} fill="hsl(var(--destructive))" fillOpacity={0.16} clipPath="url(#fluxoNeg)" />
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="3 3" />
        <path d={lineD} fill="none" stroke="hsl(var(--success))" strokeWidth={1.5} clipPath="url(#fluxoPos)" vectorEffect="non-scaling-stroke" />
        <path d={lineD} fill="none" stroke="hsl(var(--destructive))" strokeWidth={1.5} clipPath="url(#fluxoNeg)" vectorEffect="non-scaling-stroke" />
        <circle cx={x(minI)} cy={y(serie[minI].saldo)} r={2.6} fill={`hsl(var(--${serie[minI].saldo < 0 ? "destructive" : "success"}))`} />
        {/* Rótulos do eixo X */}
        {idxX.map((i) => (
          <text key={i} x={x(i)} y={H - 6} fontSize={7.5} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fill="hsl(var(--muted-foreground))">{ddmm(serie[i].dia)}</text>
        ))}
        {/* Hover: linha-guia + ponto */}
        {hv ? (
          <g>
            <line x1={x(hoverI as number)} x2={x(hoverI as number)} y1={padT} y2={H - padB} stroke="hsl(var(--muted-foreground))" strokeWidth={0.6} strokeDasharray="2 2" />
            <circle cx={x(hoverI as number)} cy={y(hv.saldo)} r={3} fill="hsl(var(--card))" stroke={`hsl(var(--${hvCor}))`} strokeWidth={1.5} />
          </g>
        ) : null}
      </svg>
      {/* Tooltip */}
      {hv ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-center shadow-md"
          style={{ left: `${(x(hoverI as number) / W) * 100}%`, top: `calc(${(y(hv.saldo) / H) * 100}% - 6px)` }}
        >
          <p className="text-[10px] text-muted-foreground">{formatarData(hv.dia)}</p>
          <p className={`text-[11px] font-bold tnum text-${hvCor}`}>{formatBRL(hv.saldo)}</p>
        </div>
      ) : null}
    </div>
  );
}

export default function FluxoPage() {
  const [dados, setDados] = useState<FluxoCaixa | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState("mes"); // dia | semana | mes | 30 | 60 | 90 | custom
  const [de, setDe] = useState(primeiroDiaMes());
  const [ate, setAte] = useState(ultimoDiaMes());
  const [saldos, setSaldos] = useState<Record<string, number>>({}); // override manual de saldo inicial por empresa
  const [bancos, setBancos] = useState<Record<string, { saldo: number | null; saldoData: string | null }>>({}); // saldo real do extrato por empresa
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const agrup = useMemo(() => agrupamentoPara(de, ate), [de, ate]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("nfe_fluxo_saldos");
      if (raw) setSaldos(JSON.parse(raw));
    } catch { /* ignore */ }
    void listarEmpresas().then(setEmpresas).catch(() => {});
  }, []);

  // Saldo do banco (real, do extrato) de todas as empresas — base da posição de caixa.
  useEffect(() => {
    if (!empresas.length) return;
    void Promise.all(
      empresas.map((e) => obterContaBanco(e.id).then((c) => [e.id, c] as const).catch(() => [e.id, null] as const)),
    ).then((pares) => {
      const map: Record<string, { saldo: number | null; saldoData: string | null }> = {};
      for (const [id, c] of pares) if (c) map[id] = c;
      setBancos(map);
    });
  }, [empresas]);

  // Saldo do banco atual (empresa selecionada, ou soma de todas).
  const saldoBanco = empresaId
    ? bancos[empresaId]?.saldo ?? null
    : (empresas.some((e) => bancos[e.id]?.saldo != null)
      ? empresas.reduce((s, e) => s + (bancos[e.id]?.saldo ?? 0), 0)
      : null);
  const dataSaldoBanco = empresaId ? bancos[empresaId]?.saldoData ?? null : null;

  // Saldo inicial da projeção: usa o override manual se houver; senão o saldo do banco.
  const editavelSaldo = !!empresaId || empresas.length <= 1;
  const chaveSaldo = empresaId || empresas[0]?.id || "global";
  const overrideManual = editavelSaldo
    ? saldos[chaveSaldo]
    : (empresas.some((e) => saldos[e.id] != null) ? empresas.reduce((s, e) => s + (saldos[e.id] ?? 0), 0) : undefined);
  const saldoInicial = overrideManual ?? saldoBanco ?? 0;

  function salvarSaldo(v: number) {
    const next = { ...saldos, [chaveSaldo]: v };
    setSaldos(next);
    try { localStorage.setItem("nfe_fluxo_saldos", JSON.stringify(next)); } catch { /* ignore */ }
  }

  // período → de/ate (exceto custom, que usa os inputs)
  useEffect(() => {
    if (periodo === "custom") return;
    if (periodo === "dia") { setDe(hojeISO()); setAte(hojeISO()); return; }
    if (periodo === "semana") { setDe(segundaDaSemana(hojeISO())); setAte(domingoDaSemana(hojeISO())); return; }
    if (periodo === "mes") { setDe(primeiroDiaMes()); setAte(ultimoDiaMes()); return; }
    setDe(hojeISO());
    setAte(maisDias(Number(periodo)));
  }, [periodo]);

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

  // Saldo acumulado dia a dia no período (base do gráfico e do menor saldo).
  const serieSaldo = useMemo(() => {
    const mov = new Map<string, number>();
    for (const l of dados?.linhas ?? []) mov.set(l.dia, (mov.get(l.dia) ?? 0) + (l.entrada - l.saida));
    let acc = saldoInicial;
    return enumerarDias(de, ate).map((dia) => { acc += mov.get(dia) ?? 0; return { dia, saldo: acc }; });
  }, [dados, de, ate, saldoInicial]);

  // Menor saldo projetado no período: revela se o caixa fica negativo em algum
  // dia, mesmo quando começa positivo.
  const menorSaldo = useMemo(() => {
    let menor = { valor: saldoInicial, dia: dados?.hoje ?? hojeISO() };
    for (const p of serieSaldo) if (p.saldo < menor.valor) menor = { valor: p.saldo, dia: p.dia };
    return menor;
  }, [serieSaldo, saldoInicial, dados]);
  const caixaEstoura = menorSaldo.valor < 0;
  const diasNegativos = useMemo(() => serieSaldo.filter((p) => p.saldo < 0).length, [serieSaldo]);

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
          <div className="flex flex-1 rounded-md border border-border p-0.5 text-sm sm:flex-none">
            {PERIODOS_RAPIDOS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriodo(p.key)}
                className={`flex-1 rounded px-3.5 py-1.5 font-medium transition-colors sm:flex-none ${periodo === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={PROJECOES.some((h) => h.key === periodo) ? periodo : ""}
            onChange={(e) => { if (e.target.value) setPeriodo(e.target.value); }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground"
          >
            <option value="">Projeção…</option>
            {PROJECOES.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
          </select>
        </div>

        {periodo === "custom" ? (
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

          {/* Posição de caixa: banco hoje → menor saldo previsto → saldo ao fim */}
          <Card className="mt-3">
            <CardContent className="py-4">
              <h2 className="mb-3 text-[0.95rem] font-semibold tracking-tight">Posição de caixa</h2>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">No banco hoje</p>
                  <p className="mt-1 text-base font-bold tnum sm:text-lg">{saldoBanco != null ? formatBRL(saldoBanco) : "—"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {saldoBanco == null ? "sem extrato" : dataSaldoBanco ? formatarData(dataSaldoBanco) : "soma das lojas"}
                  </p>
                </div>
                <div className="border-x border-border">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Menor saldo previsto</p>
                  <p className={`mt-1 text-base font-bold tnum sm:text-lg ${caixaEstoura ? "text-destructive" : "text-success"}`}>{formatBRL(menorSaldo.valor)}</p>
                  <p className="text-[10px] text-muted-foreground">em {formatarData(menorSaldo.dia)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Saldo ao fim</p>
                  <p className={`mt-1 text-base font-bold tnum sm:text-lg ${saldoFinal < 0 ? "text-destructive" : "text-foreground"}`}>{formatBRL(saldoFinal)}</p>
                  <p className="text-[10px] text-muted-foreground">{formatarData(ate)}</p>
                </div>
              </div>

              {/* Veredito de caixa */}
              {saldoBanco == null && overrideManual == null ? (
                <p className="mt-3 rounded-md bg-muted/60 p-2.5 text-[12px] text-muted-foreground">
                  Importe o extrato do banco (em <strong>Banco</strong>) para projetar a partir do saldo real — ou informe um saldo inicial abaixo.
                </p>
              ) : caixaEstoura ? (
                <p className="mt-3 rounded-md bg-destructive/10 p-2.5 text-[12px] font-medium text-destructive">
                  ⚠️ O caixa fica negativo em {formatarData(menorSaldo.dia)} ({formatBRL(menorSaldo.valor)}). Será preciso aporte ou antecipar recebíveis para cobrir as saídas.
                </p>
              ) : (totais?.saldo ?? 0) < 0 ? (
                <p className="mt-3 rounded-md bg-success/10 p-2.5 text-[12px] font-medium text-success">
                  ✓ Mesmo com saída líquida de {formatBRL(Math.abs(totais?.saldo ?? 0))} no período, o caixa se mantém positivo (mínimo {formatBRL(menorSaldo.valor)} em {formatarData(menorSaldo.dia)}).
                </p>
              ) : null}

              {/* Ajuste do saldo inicial (opcional) */}
              <details className="mt-3 border-t border-border pt-3">
                <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">Ajustar saldo inicial</summary>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={editavelSaldo ? saldos[chaveSaldo] ?? "" : ""}
                    onChange={editavelSaldo ? (e) => salvarSaldo(Number(e.target.value) || 0) : undefined}
                    readOnly={!editavelSaldo}
                    placeholder={saldoBanco != null ? formatBRL(saldoBanco) : "0,00"}
                    className={`h-9 w-36 ${!editavelSaldo ? "bg-muted text-muted-foreground" : ""}`}
                  />
                  {editavelSaldo && saldos[chaveSaldo] != null ? (
                    <button type="button" onClick={() => salvarSaldo(saldoBanco ?? 0)} className="text-[12px] font-medium text-primary hover:underline">
                      voltar ao saldo do banco
                    </button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {!editavelSaldo
                    ? "Selecione uma loja para editar o saldo dela."
                    : overrideManual != null
                    ? "Usando um saldo inicial informado por você (sobrescreve o banco)."
                    : "A projeção começa do saldo do banco. Edite aqui para simular outro ponto de partida."}
                </p>
              </details>
            </CardContent>
          </Card>

          {semMovimento ? (
            <div className="mt-4">
              <ModulePlaceholder icon={LineChart} title="Sem movimento no período" etapa="Fluxo de caixa">
                Troque o período, ou sincronize as vendas e cadastre contas para ver o fluxo projetado.
              </ModulePlaceholder>
            </div>
          ) : (
            <>
              {/* Gráfico do saldo projetado dia a dia */}
              {serieSaldo.length >= 2 ? (
                <Card className="mt-3">
                  <CardContent className="py-4">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <h2 className="text-[0.95rem] font-semibold tracking-tight">Saldo projetado</h2>
                      <span className={`text-[12px] font-medium ${diasNegativos > 0 ? "text-destructive" : "text-success"}`}>
                        {diasNegativos > 0 ? `${diasNegativos} ${diasNegativos === 1 ? "dia negativo" : "dias negativos"}` : "sempre positivo"}
                      </span>
                    </div>
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      Saldo do banco dia a dia. Abaixo da linha tracejada (zero), em vermelho, o caixa fica negativo.
                    </p>
                    <GraficoCaixa serie={serieSaldo} />
                  </CardContent>
                </Card>
              ) : null}

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
