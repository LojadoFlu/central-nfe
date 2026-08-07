import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Estado "em construção" honesto: nada de dados fictícios.
 * Deixa explícito em qual etapa o módulo passa a exibir dados reais.
 */
export function ModulePlaceholder({
  icon: Icon,
  title,
  etapa,
  children,
}: {
  icon: LucideIcon;
  title: string;
  etapa: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-6" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {children ??
            "Este módulo passa a exibir dados reais assim que a sincronização com a SEFAZ estiver ativa."}
        </p>
      </div>
      <Badge variant="neutral">{etapa}</Badge>
    </Card>
  );
}
