"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";
import { AppShell } from "@/components/layout/app-shell";

/** Portão da área logada: exige usuário autenticado. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
