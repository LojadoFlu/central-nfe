"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Escudo oficial do Fluminense.
 * O arquivo deve estar em /public/escudo-flu.png (uso autorizado).
 * Enquanto o arquivo não existir, cai no fallback tricolor.
 */
export function Escudo({ className }: { className?: string }) {
  const [erro, setErro] = useState(false);
  if (erro) {
    return (
      <span
        className={cn(
          "grid place-items-center rounded-md bg-primary text-[0.6em] font-bold text-primary-foreground",
          className,
        )}
        aria-label="Fluminense"
      >
        FLU
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/escudo-flu.png"
      alt="Fluminense Football Club"
      className={cn("object-contain", className)}
      onError={() => setErro(true)}
    />
  );
}

/** Escudo + nome do app. `compact` usa o nome curto. */
export function BrandMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Escudo className="size-8 shrink-0" />
      <span className="text-lg font-bold leading-tight tracking-tight">
        {compact ? "Financeiro Flu" : "Financeiro Loja do Flu"}
      </span>
    </span>
  );
}
