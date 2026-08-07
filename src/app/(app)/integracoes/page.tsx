"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { Plug } from "lucide-react";

export default function IntegracoesPage() {
  return (
    <div>
      <PageHeader
        title="Integrações"
        description="NF-e / SEFAZ — sincronização e logs."
      />
      <ModulePlaceholder icon={Plug} title="Integração SEFAZ" etapa="Etapa 3–4">
        Estado de sincronização por CNPJ (ultNSU, maxNSU, última consulta,
        próxima sincronização) e logs de integração. Nunca exibe senha, chave
        privada nem conteúdo do certificado.
      </ModulePlaceholder>
    </div>
  );
}
