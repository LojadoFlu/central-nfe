import { Card } from "./card";
import { cn } from "@/lib/utils";

type Tone = "default" | "success" | "warning" | "destructive";

const toneText: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <Card className="min-w-0 p-3.5 sm:p-4">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1.5 text-[1.35rem] font-bold leading-none tracking-[-0.02em] tnum sm:text-[1.6rem]", toneText[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">{hint}</p> : null}
    </Card>
  );
}
