"use client";

/**
 * Carimbo do build (commit + hora). Serve para responder, sem adivinhação,
 * "o que está no ar é a versão nova?" — já custou algumas idas e vindas.
 */
export function Versao({ className }: { className?: string }) {
  const ref = process.env.NEXT_PUBLIC_BUILD_REF ?? "local";
  const at = process.env.NEXT_PUBLIC_BUILD_AT;
  const quando = at
    ? new Date(at).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return (
    <p className={className ?? "px-3 py-2 text-[10px] text-muted-foreground"}>
      versão {ref}
      {quando ? ` · ${quando}` : ""}
    </p>
  );
}
