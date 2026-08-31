"use client";

// Peças pequenas compartilhadas pelas abas de Comissões.

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { numeroParaTexto, parseNumeroBR } from "@/lib/comissoes/numero";

export { parseNumeroBR };

export const CLASSE_CAMPO =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function Campo({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  return <select className={cn(CLASSE_CAMPO, className)} {...rest} />;
}

/** "2026-08" → "ago/2026". */
export function mesLabel(competencia: string): string {
  const [ano, mes] = (competencia ?? "").split("-").map(Number);
  if (!ano || !mes) return competencia ?? "";
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[mes - 1]}/${ano}`;
}

/** Competência atual no fuso de São Paulo. */
export function competenciaAtual(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
}

/** Lista de competências para o seletor: 18 meses para trás, 2 para frente. */
export function competenciasDisponiveis(): string[] {
  const [ano, mes] = competenciaAtual().split("-").map(Number);
  const out: string[] = [];
  for (let i = 2; i >= -18; i--) {
    const d = new Date(Date.UTC(ano, mes - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Percentual sempre com 2 casas, como todo valor monetário do sistema. */
export function pctFmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** Barra de atingimento da meta (§19). */
export function BarraMeta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-muted-foreground">sem meta</span>;
  const largura = Math.max(0, Math.min(100, pct));
  const tom = pct >= 100 ? "bg-success" : pct >= 80 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tom)} style={{ width: `${largura}%` }} />
      </div>
      <span className="text-xs tnum text-muted-foreground">{pctFmt(pct)}</span>
    </div>
  );
}

/** Aviso curto, no padrão das outras telas. */
export function Aviso({ tipo, children }: { tipo: "erro" | "ok"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "mb-4 rounded-md p-3 text-sm",
        tipo === "erro" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
      )}
    >
      {children}
    </p>
  );
}

/**
 * Campo numérico que aceita vírgula. O `type="number"` do HTML recusa a vírgula
 * em pt-BR e devolve o campo vazio — o valor some enquanto a pessoa digita.
 * Aqui o texto é livre enquanto edita e vira número na saída.
 */
export function InputNumero({
  value,
  onChange,
  className,
  ...props
}: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [texto, setTexto] = React.useState(() => numeroParaTexto(value));

  // Valor mudou por fora (recarregou, trocou de registro): re-sincroniza — mas
  // sem atropelar quem está no meio da digitação ("1712," ainda vale 1712).
  React.useEffect(() => {
    if (parseNumeroBR(texto) !== (value ?? null)) setTexto(numeroParaTexto(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      className={cn("tnum", className)}
      value={texto}
      onChange={(e) => {
        const bruto = e.target.value.replace(/[^\d.,-]/g, "");
        setTexto(bruto);
        onChange(parseNumeroBR(bruto));
      }}
      onBlur={(e) => {
        setTexto(numeroParaTexto(parseNumeroBR(e.target.value)));
        props.onBlur?.(e);
      }}
    />
  );
}
