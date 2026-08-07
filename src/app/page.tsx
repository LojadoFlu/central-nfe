"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";

/** Raiz: manda para o app se logado, senão para o login. */
export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/inicio" : "/login");
  }, [user, loading, router]);

  return (
    <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
      Carregando…
    </div>
  );
}
