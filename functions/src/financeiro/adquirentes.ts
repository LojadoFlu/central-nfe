// De qual adquirente é cada dinheiro — FUNÇÕES PURAS.
//
// Sem isso a conciliação compara laranja com maçã: soma o esperado de todos os
// adquirentes de um lado e, do outro, um extrato que pode ser de UM só. Foi
// exatamente o que aconteceu com a loja do clube — a conta importada é a Conta
// Stone, e o Mercado Pago, que cai em outra conta, aparecia como diferença.

export type Adquirente = "Stone" | "Mercado Pago" | "Cielo" | "Rede" | "PagSeguro" | "Outros";

const PELO_NOME: [RegExp, Adquirente][] = [
  [/\bstone\b/i, "Stone"],
  [/mercado\s*pago|mercadopago|\bmp\b/i, "Mercado Pago"],
  [/\bcielo\b/i, "Cielo"],
  [/\brede\b|redecard/i, "Rede"],
  [/pagseguro|pagbank/i, "PagSeguro"],
];

/** Adquirente a partir da descrição do cartão no PDV ("STONE CREDITO VISA"). */
export function adquirenteDoPdv(descricao: string | null | undefined): Adquirente {
  const d = String(descricao ?? "");
  for (const [re, nome] of PELO_NOME) if (re.test(d)) return nome;
  return "Outros";
}

/**
 * Adquirente de um lançamento do banco.
 *
 * Duas pistas, nesta ordem: o nome no histórico e, quando ele não diz nada, a
 * INSTITUIÇÃO da conta — numa conta de adquirente (Conta Stone, por exemplo)
 * "Recebimento vendas" só pode ser dela.
 */
export function adquirenteDoBanco(
  memo: string | null | undefined,
  instituicao: string | null | undefined,
): Adquirente {
  const m = String(memo ?? "");
  for (const [re, nome] of PELO_NOME) if (re.test(m)) return nome;
  const org = String(instituicao ?? "");
  for (const [re, nome] of PELO_NOME) if (re.test(org)) return nome;
  return "Outros";
}

/** Ordem de exibição: o que mais movimenta primeiro, "Outros" por último. */
export function ordenarAdquirentes<T extends { adquirente: Adquirente; banco: number; previsto: number }>(
  linhas: T[],
): T[] {
  const peso = (x: T) => Math.max(Math.abs(x.banco), Math.abs(x.previsto));
  return [...linhas].sort((a, b) => {
    if (a.adquirente === "Outros") return 1;
    if (b.adquirente === "Outros") return -1;
    return peso(b) - peso(a);
  });
}
