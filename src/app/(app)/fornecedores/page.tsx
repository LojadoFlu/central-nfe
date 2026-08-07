"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { Truck } from "lucide-react";

export default function FornecedoresPage() {
  return (
    <div>
      <PageHeader title="Fornecedores" description="Quem mais faturou para o grupo." />
      <ModulePlaceholder icon={Truck} title="Fornecedores" etapa="Etapa 10">
        Total comprado, ticket médio, última compra, histórico mensal e produtos
        adquiridos por fornecedor — agregados a partir das NF-e recebidas.
      </ModulePlaceholder>
    </div>
  );
}
