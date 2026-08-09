"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebase } from "@/lib/firebase/client";
import { registrarUsuario } from "@/lib/nfe/repo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Escudo } from "@/components/brand";

type Modo = "entrar" | "criar";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, configured, signIn } = useAuth();
  const [modo, setModo] = useState<Modo>("entrar");
  const [nome, setNome] = useState("");
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
      if (modo === "entrar") {
        await signIn(email.trim(), senha);
        router.replace("/inicio");
      } else {
        const fb = getFirebase();
        if (!fb) throw new Error("Firebase não configurado.");
        const cred = await createUserWithEmailAndPassword(fb.auth, email.trim(), senha);
        if (nome.trim()) await updateProfile(cred.user, { displayName: nome.trim() });
        await registrarUsuario(nome.trim());
        // A conta entra como "pendente"; a área logada mostra o aviso de aprovação.
        router.replace("/inicio");
      }
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (modo === "entrar") {
        setErro("E-mail ou senha inválidos.");
      } else if (code.includes("email-already-in-use")) {
        setErro("Este e-mail já tem conta. Use “Entrar”.");
      } else if (code.includes("weak-password")) {
        setErro("Senha fraca — use ao menos 6 caracteres.");
      } else if (code.includes("invalid-email")) {
        setErro("E-mail inválido.");
      } else {
        setErro("Não foi possível criar a conta. Tente novamente.");
      }
    } finally {
      setEnviando(false);
    }
  }

  const criar = modo === "criar";

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Escudo className="mb-3 size-20" />
          <h1 className="text-2xl font-bold tracking-tight">Financeiro Loja do Flu</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fiscal · Financeiro · Compras</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {!configured ? (
              <p className="rounded-md bg-warning/15 p-3 text-sm text-warning">
                Firebase ainda não configurado.
              </p>
            ) : (
              <>
                {/* alternador entrar / criar */}
                <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
                  <button
                    type="button"
                    onClick={() => { setModo("entrar"); setErro(null); }}
                    className={`rounded-md py-1.5 transition-colors ${!criar ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                  >
                    Entrar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setModo("criar"); setErro(null); }}
                    className={`rounded-md py-1.5 transition-colors ${criar ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                  >
                    Criar conta
                  </button>
                </div>

                <form onSubmit={onSubmit} className="space-y-4">
                  {criar ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="nome">Nome completo</Label>
                      <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="email">E-mail</Label>
                    <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="senha">Senha</Label>
                    <Input id="senha" type="password" autoComplete={criar ? "new-password" : "current-password"} value={senha} onChange={(e) => setSenha(e.target.value)} required />
                  </div>
                  {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
                  <Button type="submit" className="w-full" disabled={enviando}>
                    {enviando ? (criar ? "Criando…" : "Entrando…") : criar ? "Criar conta" : "Entrar"}
                  </Button>
                  {criar ? (
                    <p className="text-center text-xs text-muted-foreground">
                      Sua conta ficará <strong>pendente</strong> até um administrador liberar o acesso.
                    </p>
                  ) : null}
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
