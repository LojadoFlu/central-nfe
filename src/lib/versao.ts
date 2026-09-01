// Decidir se a tela está velha é uma comparação, e comparação se testa.

/** Build que está rodando neste navegador agora. */
export function versaoEmUso(): string {
  return process.env.NEXT_PUBLIC_BUILD_REF ?? "local";
}

/**
 * Há versão nova no ar?
 *
 * "local" (build de desenvolvimento) nunca avisa: senão o aviso apareceria o
 * tempo todo enquanto se trabalha. Resposta vazia ou estranha também não
 * avisa — na dúvida, é melhor calar do que pedir recarga à toa.
 */
export function precisaAtualizar(emUso: string, noAr: unknown): boolean {
  if (typeof noAr !== "string" || !noAr) return false;
  if (emUso === "local" || noAr === "local") return false;
  return emUso !== noAr;
}
