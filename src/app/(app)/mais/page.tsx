"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { SECONDARY_NAV, filtrarPorRole } from "@/lib/nav";
import { useAuth } from "@/lib/auth/auth-provider";

/** Tela "Mais" do bottom-nav mobile: agrupa os itens secundários. */
export default function MaisPage() {
  const { role } = useAuth();
  const itens = filtrarPorRole(SECONDARY_NAV, role);

  return (
    <div>
      <PageHeader title="Mais" description="Empresas, relatórios, alertas e configurações." />
      <Card className="divide-y divide-border">
        {itens.map((i) => {
          const Icon = i.icon;
          return (
            <Link
              key={i.href}
              href={i.href}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent"
            >
              <Icon className="size-5 text-primary" />
              <span className="flex-1 text-sm font-medium">{i.label}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          );
        })}
      </Card>
    </div>
  );
}
