"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";
import { AppShell } from "@/components/layout/app-shell";
import { podeVerRota } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Clock, Ban, Lock } from "lucide-react";

/** Portão da área logada: exige usuário autenticado E aprovado (status ativo). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, status, isAdmin, podeModulo, signOutUser, recarregar } = useAuth();

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

  // Conta autenticada mas ainda não liberada por um administrador.
  if (status !== "ativo") {
    const pendente = status === "pendente" || status === null;
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <div
            className={`mx-auto grid size-12 place-items-center rounded-full ${
              pendente ? "bg-warning/15 text-warning" : "bg-destructive/10 text-destructive"
            }`}
          >
            {pendente ? <Clock className="size-6" /> : <Ban className="size-6" />}
          </div>
          <h1 className="mt-4 text-lg font-semibold">
            {pendente ? "Conta aguardando aprovação" : "Acesso desativado"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {pendente
              ? "Sua conta foi criada e está aguardando um administrador liberar o acesso e definir seu perfil."
              : "Seu acesso foi desativado. Fale com um administrador."}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button variant="outline" size="sm" onClick={() => void recarregar()}>
              Já fui aprovado — atualizar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void signOutUser()}>
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Guarda por rota: bloqueia telas fora do perfil, mesmo via URL direta.
  if (!podeVerRota(pathname, { isAdmin, podeModulo })) {
    return (
      <AppShell>
        <div className="grid place-items-center px-4 py-16">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
              <Lock className="size-6" />
            </div>
            <h1 className="mt-4 text-lg font-semibold">Sem acesso a esta tela</h1>
            <p className="mt-2 text-sm text-muted-foreground">Seu perfil não inclui esta tela. Fale com um administrador se precisar de acesso.</p>
            <Button variant="outline" size="sm" className="mt-6" onClick={() => router.push("/inicio")}>Voltar ao início</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return <AppShell>{children}</AppShell>;
}
