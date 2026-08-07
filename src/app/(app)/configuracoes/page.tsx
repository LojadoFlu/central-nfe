"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { Settings } from "lucide-react";

export default function ConfiguracoesPage() {
  return (
    <div>
      <PageHeader title="Configurações" description="Ambiente, usuários e preferências." />
      <ModulePlaceholder icon={Settings} title="Configurações gerais" etapa="Etapa 1–2">
        Ambiente (homologação/produção), usuários e papéis (RBAC). Empresas e
        Certificado têm telas próprias no menu.
      </ModulePlaceholder>
    </div>
  );
}
