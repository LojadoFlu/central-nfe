// Desconto de falta e suspensão — FUNÇÕES PURAS.
//
// A prática consolidada para mensalista: o dia vale salário ÷ 30, e a falta
// INJUSTIFICADA faz perder também o descanso semanal remunerado (DSR) daquela
// semana (Lei 605/1949, art. 6º). Suspensão disciplinar segue o mesmo caminho:
// dia não trabalhado e sem remuneração.
//
// O que NÃO é automático aqui, e continua sendo decisão de quem lança:
//   • falta com atestado ou abonada não se lança — ela não desconta;
//   • feriado na semana e escala diferente de segunda a sábado mudam o DSR;
//   • o divisor (30) e o desconto do DSR ficam na configuração, porque acordo
//     coletivo pode dizer outra coisa.
//
// ESPELHO de functions/src/comissoes/faltas.ts — mexeu num, mexa no outro. O teste
// tests/faltas.test.ts compara os dois.

export interface ParametrosFalta {
  /** Dias não trabalhados, em "YYYY-MM-DD". Repetidos contam uma vez só. */
  dias: string[];
  /** Salário do mês sobre o qual o dia é calculado (aqui, o piso do cargo). */
  base: number;
  /** Divisor do mês. 30 por lei para o mensalista; acordo pode mudar. */
  diasBaseMes?: number;
  /** Perde o DSR da semana em que faltou. */
  descontarDsr?: boolean;
}

export interface DescontoFalta {
  /** Dias não trabalhados, sem repetição. */
  dias: number;
  /** DSRs perdidos — um por semana em que houve falta. */
  dsr: number;
  valorDia: number;
  valor: number;
}

const cent = (n: number) => Math.round(n * 100) / 100;

/**
 * Segunda-feira da semana do dia, em "YYYY-MM-DD". O DSR cai no fim da semana,
 * então é a semana de segunda a domingo que interessa para saber se ele se
 * perdeu.
 */
export function semanaDoDia(dia: string): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  const data = new Date(Date.UTC(ano, (mes ?? 1) - 1, d ?? 1));
  const domingoZero = data.getUTCDay(); // 0 = domingo
  const desdeSegunda = (domingoZero + 6) % 7; // segunda = 0 … domingo = 6
  data.setUTCDate(data.getUTCDate() - desdeSegunda);
  return data.toISOString().slice(0, 10);
}

/** Dias válidos, sem repetição e em ordem. */
export function diasValidos(dias: string[]): string[] {
  const real = (d: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    // "2026-13-40" passa no formato mas não é dia nenhum: só é válido se a
    // data voltar igual ao que entrou.
    const [a, m, dd] = d.split("-").map(Number);
    const data = new Date(Date.UTC(a, m - 1, dd));
    return data.toISOString().slice(0, 10) === d;
  };
  return [...new Set((dias ?? []).filter(real))].sort();
}

export function calcularDescontoFalta(p: ParametrosFalta): DescontoFalta {
  const dias = diasValidos(p.dias);
  const divisor = Number(p.diasBaseMes) > 0 ? Number(p.diasBaseMes) : 30;
  const base = Number(p.base) || 0;
  const valorDia = cent(base / divisor);
  const dsr = p.descontarDsr === false ? 0 : new Set(dias.map(semanaDoDia)).size;
  return {
    dias: dias.length,
    dsr: dias.length > 0 ? dsr : 0,
    valorDia,
    valor: cent(valorDia * (dias.length + (dias.length > 0 ? dsr : 0))),
  };
}

/** Texto do motivo, para ficar na memória de cálculo e no histórico. */
export function descricaoDesconto(d: DescontoFalta, rotulo: string): string {
  const partes = [`${d.dias} dia${d.dias === 1 ? "" : "s"} de ${rotulo}`];
  if (d.dsr > 0) partes.push(`${d.dsr} DSR`);
  return `${partes.join(" + ")} × ${d.valorDia.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })}`;
}
