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
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1.5 text-2xl font-bold tnum", toneText[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}
