"use client";

import { useState } from "react";
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

/** Chave do preset que casa com o período atual: "tudo" | key | null (personalizado). */
function presetAtivo(p: Periodo): string | null {
  if (!p.de && !p.ate) return "tudo";
  for (const pr of PRESETS) {
    const r = pr.range();
    if (r.de === p.de && r.ate === p.ate) return pr.key;
  }
  return null;
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
  /** Mostra a opção "Todo o período" (intervalo aberto). Desligue quando um período é obrigatório. */
  allowClear?: boolean;
}) {
  const ativo = presetAtivo(value);
  const [custom, setCustom] = useState(ativo === null);
  const personalizado = custom || ativo === null;
  const selecionado = personalizado ? "personalizado" : ativo ?? "personalizado";

  function aoSelecionar(v: string) {
    if (v === "personalizado") {
      setCustom(true);
      return; // mantém as datas atuais; usuário ajusta no calendário
    }
    setCustom(false);
    if (v === "tudo") {
      onChange({ de: "", ate: "" });
      return;
    }
    const p = PRESETS.find((x) => x.key === v);
    if (p) onChange(p.range());
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <span className="hidden shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:inline">
          Período
        </span>
        <select
          value={selecionado}
          onChange={(e) => aoSelecionar(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {allowClear ? <option value="tudo">Todo o período</option> : null}
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="personalizado">Personalizado…</option>
        </select>
      </div>

      {personalizado ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-card p-2">
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
        </div>
      ) : null}
    </div>
  );
}
