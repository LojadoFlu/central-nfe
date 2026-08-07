"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { Wallet } from "lucide-react";

export default function FinanceiroPage() {
  return (
    <div>
      <PageHeader
        title="Financeiro"
        description="Parcelas e vencimentos informados nas NF-e."
      />
      <ModulePlaceholder icon={Wallet} title="Contas a vencer e vencidas" etapa="Etapa 9">
        Duplicatas/parcelas extraídas do XML, com status “A vencer”, “Vencida” e
        “Sem vencimento”. Importante: “Pago” nunca é inferido do XML — depende de
        conciliação futura (bancos / contas a pagar).
      </ModulePlaceholder>
    </div>
  );
}
