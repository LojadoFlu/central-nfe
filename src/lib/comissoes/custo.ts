// Como a folha se divide: quanto é piso e quanto é comissão.
//
// Um lugar só para essa conta, porque ela aparece em dois papéis que precisam
// contar a mesma história — o dashboard e o PDF por loja.
//
// A regra é a do pagamento: o valor devido já é o MAIOR entre piso e comissão
// (nunca a soma), e o desconto de folha sai depois. Então, para cada pessoa:
//   piso     = o piso dela, limitado ao que ela tem a receber
//   comissão = o que passou do piso
//   total    = piso + comissão − descontos  (= o valor devido)

import type { LinhaApuracao } from "./tipos";

export interface CustoDaFolha {
  /** Fixo garantido — inclui quem não comissiona e só tem piso. */
  piso: number;
  /** O que a comissão gerou acima do piso. */
  comissao: number;
  /** Retirada de produto, falta, suspensão. */
  desconto: number;
  /** O que a empresa paga de fato. */
  total: number;
}

const cent = (n: number) => Math.round(n * 100) / 100;

export function custoDaLinha(l: LinhaApuracao): CustoDaFolha {
  const desconto = cent(l.descontosTotal ?? 0);
  // O desconto volta para a conta antes de separar piso de comissão: ele sai
  // do que a pessoa recebe, não do que ela gerou.
  const bruto = cent(l.valorDevido + desconto);
  const piso = cent(Math.min(l.piso ?? 0, bruto));
  return { piso, comissao: cent(bruto - piso), desconto, total: cent(l.valorDevido) };
}

export function custoDaFolha(linhas: LinhaApuracao[]): CustoDaFolha {
  const t = { piso: 0, comissao: 0, desconto: 0, total: 0 };
  for (const l of linhas) {
    const c = custoDaLinha(l);
    t.piso += c.piso;
    t.comissao += c.comissao;
    t.desconto += c.desconto;
    t.total += c.total;
  }
  return { piso: cent(t.piso), comissao: cent(t.comissao), desconto: cent(t.desconto), total: cent(t.total) };
}
