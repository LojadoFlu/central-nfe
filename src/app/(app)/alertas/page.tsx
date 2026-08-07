"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { Bell } from "lucide-react";

export default function AlertasPage() {
  return (
    <div>
      <PageHeader title="Alertas" description="Central de avisos configuráveis." />
      <ModulePlaceholder icon={Bell} title="Central de Alertas" etapa="Etapa 13">
        Nova NF-e, NF-e acima de um valor, fornecedor novo, vencimento próximo,
        conta vencida, certificado vencendo, NF-e cancelada, manifestação
        pendente e falha de sincronização.
      </ModulePlaceholder>
    </div>
  );
}
