"use client";

import { useAuth } from "@/lib/auth/auth-provider";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/brand";

export function Topbar() {
  const { user, role, signOutUser } = useAuth();
  return (
    <header className="material sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border/50 px-4">
      {/* Marca só aparece no mobile (no desktop a sidebar já mostra). */}
      <BrandMark compact className="lg:hidden" />
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight">{user?.email ?? "—"}</p>
          {role ? (
            <p className="text-xs text-muted-foreground">{ROLE_LABEL[role]}</p>
          ) : null}
        </div>
        <Button variant="ghost" size="icon" onClick={() => void signOutUser()} title="Sair">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
