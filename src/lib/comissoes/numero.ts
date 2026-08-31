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

/**
 * Número → texto para o campo, sempre com 2 casas ("1.712,50").
 *
 * Sem isso, ao sair do campo "1712,50" virava "1712,5" e "1712,00" virava
 * "1712" — o valor gravado está certo, mas quem digitou jura que perdeu os
 * centavos. Usado só quando o campo perde o foco; enquanto se digita, o texto
 * é livre.
 */
export function numeroParaTexto(n: number | null | undefined, casas = 2): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
