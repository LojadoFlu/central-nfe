"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { BarChart3 } from "lucide-react";

export default function RelatoriosPage() {
  return (
    <div>
      <PageHeader title="Relatórios" description="Compras, vencimentos e produtos." />
      <ModulePlaceholder icon={BarChart3} title="Relatórios" etapa="Etapa 12">
        Compras por período/fornecedor/empresa, contas a vencer/vencidas e
        produtos comprados — exportáveis em XLSX, CSV e PDF.
      </ModulePlaceholder>
    </div>
  );
}
