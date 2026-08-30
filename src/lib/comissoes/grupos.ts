"use client";

// Agrupamento de lojas no cliente — ESPELHO de functions/src/comissoes/grupos.ts.
// Duas filiais do PDV que a operação trata como uma loja só (a Barra é 582 +
// 912) aparecem aqui como UMA opção, com o id da loja canônica (a de menor id).
// Mexeu num arquivo, mexa no outro: o servidor grava pelo mesmo critério.

import type { StorePdv } from "@/lib/nfe/repo";

function chave(l: StorePdv): string {
  const g = (l.grupoNome ?? "").trim();
  if (g) return g.toUpperCase();
  const n = (l.nome ?? "").trim();
  return n ? n.toUpperCase() : `LOJA ${l.id}`;
}

export interface LojaAgrupada extends StorePdv {
  /** Filiais do PDV que compõem esta loja. */
  membros: number[];
}

/**
 * Uma linha por loja da operação. Passe TODAS as lojas (inclusive as inativas):
 * o id canônico precisa bater com o que o servidor calcula, e ele olha todas.
 * Grupos sem nenhuma filial sincronizando ficam de fora.
 */
export function agruparLojas(todas: StorePdv[]): LojaAgrupada[] {
  const porChave = new Map<string, StorePdv[]>();
  for (const l of todas) {
    const k = chave(l);
    porChave.set(k, [...(porChave.get(k) ?? []), l]);
  }

  const out: LojaAgrupada[] = [];
  for (const [, arr] of porChave) {
    if (!arr.some((l) => l.ativoSync !== false)) continue;
    const ordenadas = [...arr].sort((a, b) => a.id - b.id);
    const principal = ordenadas[0];
    out.push({
      ...principal,
      grupoNome: (principal.grupoNome ?? "").trim() || principal.nome || `Loja ${principal.id}`,
      membros: ordenadas.map((l) => l.id),
    });
  }
  return out.sort((a, b) => (a.grupoNome ?? "").localeCompare(b.grupoNome ?? ""));
}
