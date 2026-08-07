"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { FileText } from "lucide-react";

export default function NotasPage() {
  return (
    <div>
      <PageHeader title="Notas" description="NF-e emitidas contra as empresas do grupo." />
      <ModulePlaceholder icon={FileText} title="Lista de notas" etapa="Etapa 7">
        A tela de notas (cards no mobile, tabela no desktop) com filtros por
        período, fornecedor, valor, vencimento e busca textual global entra na
        Etapa 7 — alimentada pelos XMLs baixados na Etapa 3.
      </ModulePlaceholder>
    </div>
  );
}
