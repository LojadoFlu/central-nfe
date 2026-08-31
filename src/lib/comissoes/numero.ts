// Leitura de número digitado em pt-BR. Sem dependências — dá para testar direto.

/**
 * Texto digitado (pt-BR) → número. `null` quando vazio.
 *
 * "1.712,50" → 1712.5   (vírgula manda: pontos viram separador de milhar)
 * "1712,5"   → 1712.5
 * "1.712"    → 1712     (ponto com 3 dígitos depois = milhar)
 * "2.5"      → 2.5      (ponto com 1 ou 2 dígitos depois = decimal)
 */
export function parseNumeroBR(texto: string): number | null {
  const t = (texto ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "").replace(/%$/, "");
  if (!t) return null;
  let normalizado: string;
  if (t.includes(",")) {
    normalizado = t.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = t.split(".");
    normalizado = partes.length === 2 && partes[1].length !== 3 ? t : t.replace(/\./g, "");
  }
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Número → texto editável (vírgula, sem separador de milhar). */
export function numeroParaTexto(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}
