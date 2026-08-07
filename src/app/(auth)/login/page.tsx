"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, configured, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/inicio");
  }, [user, loading, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await signIn(email.trim(), senha);
      router.replace("/inicio");
    } catch {
      setErro("E-mail ou senha inválidos.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Central NF-e</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Central Fiscal, Financeira e de Compras
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {!configured ? (
              <p className="rounded-md bg-warning/15 p-3 text-sm text-warning">
                Firebase ainda não configurado. Preencha <code>.env.local</code>.
              </p>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="senha">Senha</Label>
                  <Input
                    id="senha"
                    type="password"
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    required
                  />
                </div>
                {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
                <Button type="submit" className="w-full" disabled={enviando}>
                  {enviando ? "Entrando…" : "Entrar"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
