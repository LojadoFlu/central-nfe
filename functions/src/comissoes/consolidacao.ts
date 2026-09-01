// Consolidação das vendas do PDV para a apuração — FUNÇÕES PURAS.
// Entram as linhas já lidas de `sales` (coleção que a sync do PDVnet mantém);
// saem os totais por vendedor e por loja, sem venda cancelada (§2, §17).

export interface VendaBruta {
  id: string;
  lojaId: number | null;
  dia: string; // YYYY-MM-DD
  vendedorId: string | null;
  /**
   * `ValorTotal` do PDVnet. Apesar do nome, ele NÃO tem o desconto do caixa
   * descontado: numa venda de 549,98 com 55,00 de desconto, ele vem 549,98 e o
   * cliente pagou 494,98. Quem comissiona é o valor pago.
   */
  valorTotal: number;
  valorProdutos?: number | null; // bruto (antes dos descontos)
  /** `ValorTotal` cru do PDVnet. Presente = `valorTotal` já está líquido. */
  valorTotalPdv?: number | null;
  valorDesconto?: number | null;
  valorDescontoPromocional?: number | null;
  cancelada?: boolean;
}

/**
 * O que a venda de fato valeu. A sync já grava `valorTotal` líquido e marca a
 * venda com `valorTotalPdv`; venda gravada antes disso ainda vem bruta, e o
 * desconto sai aqui. Sem essa marca, uma das duas seria descontada duas vezes.
 */
export function liquidaDaVenda(v: VendaBruta): number {
  const total = Number(v.valorTotal) || 0;
  if (v.valorTotalPdv != null) return Math.round(total * 100) / 100;
  const desconto = (Number(v.valorDesconto) || 0) + (Number(v.valorDescontoPromocional) || 0);
  return Math.round((total - desconto) * 100) / 100;
}

export interface Totais {
  liquida: number;
  bruta: number;
  qtd: number;
}

export interface Consolidado {
  porVendedor: Map<string, Totais>;
  porLoja: Map<number, Totais>;
  /** Melhor vendedor (maior venda líquida) de cada loja — gatilho de bônus (§14). */
  melhorVendedorPorLoja: Map<number, string>;
  /** Vendas que o PDV não associou a nenhum vendedor (§30). */
  semVendedor: { qtd: number; valor: number; ids: string[] };
  canceladas: { qtd: number; valor: number };
}

function zero(): Totais {
  return { liquida: 0, bruta: 0, qtd: 0 };
}
function soma(t: Totais, v: VendaBruta): void {
  t.liquida += liquidaDaVenda(v);
  t.bruta += Number(v.valorProdutos ?? v.valorTotal) || 0;
  t.qtd += 1;
}
function arredondar(t: Totais): Totais {
  return {
    liquida: Math.round(t.liquida * 100) / 100,
    bruta: Math.round(t.bruta * 100) / 100,
    qtd: t.qtd,
  };
}

/** Consolida um período. Venda cancelada NÃO entra na base de cálculo (§17). */
export function consolidar(vendas: VendaBruta[]): Consolidado {
  const porVendedor = new Map<string, Totais>();
  const porLoja = new Map<number, Totais>();
  const porLojaVendedor = new Map<number, Map<string, number>>();
  const semVendedor = { qtd: 0, valor: 0, ids: [] as string[] };
  const canceladas = { qtd: 0, valor: 0 };

  for (const v of vendas) {
    if (v.cancelada) {
      canceladas.qtd += 1;
      canceladas.valor += liquidaDaVenda(v);
      continue;
    }
    if (v.lojaId != null) {
      const t = porLoja.get(v.lojaId) ?? zero();
      soma(t, v);
      porLoja.set(v.lojaId, t);
    }
    const vid = (v.vendedorId ?? "").trim();
    if (!vid) {
      semVendedor.qtd += 1;
      semVendedor.valor += liquidaDaVenda(v);
      if (semVendedor.ids.length < 200) semVendedor.ids.push(v.id);
      continue;
    }
    const t = porVendedor.get(vid) ?? zero();
    soma(t, v);
    porVendedor.set(vid, t);
    if (v.lojaId != null) {
      const m = porLojaVendedor.get(v.lojaId) ?? new Map<string, number>();
      m.set(vid, (m.get(vid) ?? 0) + liquidaDaVenda(v));
      porLojaVendedor.set(v.lojaId, m);
    }
  }

  const melhorVendedorPorLoja = new Map<number, string>();
  for (const [lojaId, m] of porLojaVendedor) {
    let melhor: string | null = null;
    let maior = -Infinity;
    for (const [vid, valor] of m) {
      if (valor > maior) {
        maior = valor;
        melhor = vid;
      }
    }
    if (melhor) melhorVendedorPorLoja.set(lojaId, melhor);
  }

  for (const [k, t] of porVendedor) porVendedor.set(k, arredondar(t));
  for (const [k, t] of porLoja) porLoja.set(k, arredondar(t));
  semVendedor.valor = Math.round(semVendedor.valor * 100) / 100;
  canceladas.valor = Math.round(canceladas.valor * 100) / 100;

  return { porVendedor, porLoja, melhorVendedorPorLoja, semVendedor, canceladas };
}

/** Soma os totais de várias lojas (grupo do supervisor, §13). */
export function somarLojas(porLoja: Map<number, Totais>, lojas: number[]): Totais {
  const t = zero();
  for (const l of lojas) {
    const x = porLoja.get(l);
    if (!x) continue;
    t.liquida += x.liquida;
    t.bruta += x.bruta;
    t.qtd += x.qtd;
  }
  return arredondar(t);
}

/**
 * Estorno de uma venda que já gerou comissão e depois foi cancelada (§17).
 * Usa o percentual EFETIVO congelado no fechamento — é o único número que
 * reconstrói o que a pessoa realmente recebeu por aquele real vendido.
 */
export function estornoDeVendaCancelada(
  valorVenda: number,
  percentualEfetivo: number,
): number {
  return -(Math.round(((Number(valorVenda) || 0) * (Number(percentualEfetivo) || 0)) / 100 * 100) / 100);
}

/** Competência ("YYYY-MM") de um dia "YYYY-MM-DD". */
export function competenciaDoDia(dia: string): string {
  return (dia ?? "").slice(0, 7);
}

/** Primeiro e último dia (YYYY-MM-DD) de uma competência "YYYY-MM". */
export function limitesDaCompetencia(competencia: string): { de: string; ate: string } {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    de: `${competencia}-01`,
    ate: `${competencia}-${String(ultimo).padStart(2, "0")}`,
  };
}

/**
 * Data em que a folha variável de uma competência sai do caixa.
 * `mesPagamento` "seguinte" (padrão) joga para o mês seguinte.
 */
export function dataPagamentoFolha(
  competencia: string,
  diaPagamento: number,
  mesPagamento: "seguinte" | "mesmo" = "seguinte",
): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const desloc = mesPagamento === "seguinte" ? 1 : 0;
  const dia = Math.min(Math.max(Math.floor(diaPagamento) || 1, 1), 28);
  const d = new Date(Date.UTC(ano, mes - 1 + desloc, dia));
  return d.toISOString().slice(0, 10);
}
