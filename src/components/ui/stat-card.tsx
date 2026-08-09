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
    <Card className="min-w-0 p-3 sm:p-4">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
        {label}
      </p>
      <p className={cn("mt-1 text-lg font-bold leading-tight tnum sm:text-2xl", toneText[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">{hint}</p> : null}
    </Card>
  );
}
