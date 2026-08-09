"use client";

import { cn } from "@/lib/utils";

export interface Periodo {
  /** "YYYY-MM-DD" ou "" (aberto). */
  de: string;
  ate: string;
}

export const PERIODO_VAZIO: Periodo = { de: "", ate: "" };

// ——— utilidades de data (horário local, sem UTC) ———
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hoje(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDias(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
/** Início da semana = segunda-feira. */
function inicioSemana(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  return addDias(d, -dow);
}

interface Preset {
  key: string;
  label: string;
  range: () => Periodo;
}

const PRESETS: Preset[] = [
  { key: "hoje", label: "Hoje", range: () => ({ de: ymd(hoje()), ate: ymd(hoje()) }) },
  {
    key: "estaSemana",
    label: "Esta semana",
    range: () => {
      const i = inicioSemana(hoje());
      return { de: ymd(i), ate: ymd(addDias(i, 6)) };
    },
  },
  {
    key: "semanaPassada",
    label: "Semana passada",
    range: () => {
      const i = addDias(inicioSemana(hoje()), -7);
      return { de: ymd(i), ate: ymd(addDias(i, 6)) };
    },
  },
  {
    key: "esteMes",
    label: "Este mês",
    range: () => {
      const h = hoje();
      return { de: ymd(new Date(h.getFullYear(), h.getMonth(), 1)), ate: ymd(new Date(h.getFullYear(), h.getMonth() + 1, 0)) };
    },
  },
  {
    key: "ultimos30",
    label: "Últimos 30 dias",
    range: () => ({ de: ymd(addDias(hoje(), -29)), ate: ymd(hoje()) }),
  },
];

/** Retorna a chave do preset que casa com o período atual (ou null). */
function presetAtivo(p: Periodo): string | null {
  if (!p.de && !p.ate) return "tudo";
  for (const pr of PRESETS) {
    const r = pr.range();
    if (r.de === p.de && r.ate === p.ate) return pr.key;
  }
  return null; // personalizado
}

/** True se `data` (ISO ou YYYY-MM-DD) cai no período (inclusivo). Vazio = tudo. */
export function noPeriodo(data: string | null | undefined, p: Periodo): boolean {
  if (!p.de && !p.ate) return true;
  if (!data) return false;
  const d = data.slice(0, 10);
  if (p.de && d < p.de) return false;
  if (p.ate && d > p.ate) return false;
  return true;
}

export function FiltroPeriodo({
  value,
  onChange,
  className,
  allowClear = true,
}: {
  value: Periodo;
  onChange: (p: Periodo) => void;
  className?: string;
  /** Mostra os atalhos "Tudo"/"Limpar" (período aberto). Desligue quando um período é obrigatório. */
  allowClear?: boolean;
}) {
  const ativo = presetAtivo(value);
  const chip = (active: boolean) =>
    cn(
      "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent",
    );

  return (
    <div className={cn("rounded-md border border-border bg-card p-2.5", className)}>
      <div className="-mx-0.5 flex flex-wrap gap-1.5">
        {allowClear ? (
          <button type="button" className={chip(ativo === "tudo")} onClick={() => onChange({ de: "", ate: "" })}>
            Tudo
          </button>
        ) : null}
        {PRESETS.map((p) => (
          <button key={p.key} type="button" className={chip(ativo === p.key)} onClick={() => onChange(p.range())}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="date"
          aria-label="Data inicial"
          value={value.de}
          max={value.ate || undefined}
          onChange={(e) => onChange({ ...value, de: e.target.value })}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
        />
        <span className="shrink-0 text-xs text-muted-foreground">até</span>
        <input
          type="date"
          aria-label="Data final"
          value={value.ate}
          min={value.de || undefined}
          onChange={(e) => onChange({ ...value, ate: e.target.value })}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
        />
        {allowClear && (value.de || value.ate) ? (
          <button
            type="button"
            onClick={() => onChange({ de: "", ate: "" })}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Limpar
          </button>
        ) : null}
      </div>
    </div>
  );
}
