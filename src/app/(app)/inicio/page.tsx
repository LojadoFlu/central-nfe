"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileText, RefreshCw } from "lucide-react";

/**
 * Dashboard mobile-first. Os valores só ficam reais depois da Etapa 3
 * (sincronização SEFAZ). Enquanto não há dados, mostramos "—" — nunca números
 * fictícios — deixando claro o estado do sistema.
 */
export default function InicioPage() {
  const semDados = "—";

  return (
    <div>
      <PageHeader
        title="Início"
        description="Visão geral das compras e contas do mês."
        action={
          <Button variant="outline" size="sm" disabled title="Disponível na Etapa 3">
            <RefreshCw className="size-4" />
            Sincronizar
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Compras do mês" value={semDados} />
        <StatCard label="Notas recebidas" value={semDados} />
        <StatCard label="A vencer" value={semDados} tone="warning" />
        <StatCard label="Vencidas" value={semDados} tone="destructive" />
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Últimas notas
          </h2>
          <Link href="/notas" className="text-sm font-medium text-primary hover:underline">
            Ver todas
          </Link>
        </div>
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <FileText className="size-6" />
          </div>
          <div>
            <p className="font-semibold">Nenhuma nota ainda</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              As notas aparecem aqui após a primeira sincronização com a SEFAZ
              (Etapa 3). Cadastre a empresa e o certificado para começar.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/empresas"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Cadastrar empresa
            </Link>
            <Link href="/certificado" className={cn(buttonVariants({ size: "sm" }))}>
              Instalar certificado
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
