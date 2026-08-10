import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Wash tintado do hero conforme a natureza do número principal. */
const WASH: Record<string, string> = {
  primary: "from-primary/[0.08]",
  success: "from-success/[0.09]",
  warning: "from-warning/[0.09]",
  destructive: "from-destructive/[0.09]",
  neutral: "from-transparent",
};
const VALUE_TONE: Record<string, string> = {
  success: "text-success",
  destructive: "text-destructive",
  default: "",
};
const METRIC_TONE: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  default: "text-foreground",
};

export interface HeroMetricItem {
  label: string;
  value: string;
  tone?: "success" | "warning" | "destructive" | "default";
  hint?: string;
  href?: string;
}

/**
 * Cartão-herói editorial (linguagem Apple): sobrelinha, número em display,
 * subtítulo e uma linha de métricas de apoio com divisórias. Reutilizado nas telas.
 */
export function Hero({
  eyebrow,
  value,
  valueTone = "default",
  subtitle,
  tone = "primary",
  metrics,
  href,
}: {
  eyebrow: string;
  value: string;
  valueTone?: "success" | "destructive" | "default";
  subtitle?: ReactNode;
  tone?: "primary" | "success" | "warning" | "destructive" | "neutral";
  metrics?: HeroMetricItem[];
  href?: string;
}) {
  const topInner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{eyebrow}</p>
        {href ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      <p className={cn("mt-2 text-[2.2rem] font-bold leading-none tracking-[-0.03em] tnum sm:text-[2.7rem]", VALUE_TONE[valueTone])}>
        {value}
      </p>
      {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
    </>
  );

  return (
    <div className="relative overflow-hidden rounded-[var(--radius)] border border-border/60 bg-card shadow-float">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent", WASH[tone])} />
      {href ? (
        <Link href={href} className="press relative block p-5 transition-colors hover:bg-accent/30 sm:p-6">
          {topInner}
        </Link>
      ) : (
        <div className="relative p-5 sm:p-6">{topInner}</div>
      )}

      {metrics && metrics.length ? (
        <div className={cn("relative grid divide-x divide-border/60 border-t border-border/60", metrics.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
          {metrics.map((m) => {
            const inner = (
              <>
                <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{m.label}</span>
                <span className={cn("mt-1 text-base font-bold leading-none tracking-[-0.01em] tnum sm:text-lg", METRIC_TONE[m.tone ?? "default"])}>
                  {m.value}
                </span>
                {m.hint ? <span className="mt-1 text-[11px] leading-snug text-muted-foreground">{m.hint}</span> : null}
              </>
            );
            return m.href ? (
              <Link key={m.label} href={m.href} className="press flex flex-col p-4 transition-colors hover:bg-accent/40">
                {inner}
              </Link>
            ) : (
              <div key={m.label} className="flex flex-col p-4">{inner}</div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
