// Importação das metas vindas do Controle de Vez — FUNÇÕES PURAS.
//
// Lá a meta já é semanal e por pessoa; aqui ela só é lida e casada com o
// cadastro. Nada de recalcular: a decisão de quanto cada um tem de vender é
// tomada na operação, e este módulo não opina sobre ela.
//
// A semana NÃO atravessa o mês (definição do Rodrigo), então a data de início
// da semana determina sozinha a competência.

export interface LinhaImport {
  /** Primeiro dia da semana (as datas do arquivo são os limites dela). */
  semanaInicio: string;
  /** Último dia da semana. A semana não atravessa o mês: no fim ela é cortada. */
  semanaFim?: string | null;
  codigoPdv: string | null;
  nome: string | null;
  loja: string | null;
  meta: number;
  /** Linha do arquivo, para apontar o erro onde ele está. */
  linha: number;
}

export interface ResultadoParse {
  linhas: LinhaImport[];
  erros: string[];
}

/** "1.234,56" | "1234.56" | "1234" → número. */
export function valorDoCsv(texto: string): number | null {
  const t = (texto ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!t) return null;
  const normalizado = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** "2026-08-04" | "04/08/2026" | "4/8/26" → yyyy-MM-dd. */
export function dataDoCsv(texto: string): string | null {
  const t = (texto ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let ano = Number(m[3]);
  if (ano < 100) ano += 2000;
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Nome comparável: sem acento, sem pontuação, maiúsculo, espaço único. */
export function normalizarNome(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const CABECALHOS: Record<string, string> = {
  semana: "semanaInicio",
  semana_inicio: "semanaInicio",
  semanainicio: "semanaInicio",
  data: "semanaInicio",
  inicio: "semanaInicio",
  data_inicio: "semanaInicio",
  fim: "semanaFim",
  data_fim: "semanaFim",
  semana_fim: "semanaFim",
  codigo: "codigoPdv",
  codigo_pdv: "codigoPdv",
  codigopdv: "codigoPdv",
  vendedor_id: "codigoPdv",
  nome: "nome",
  vendedor: "nome",
  loja: "loja",
  meta: "meta",
  valor: "meta",
};

function separador(linha: string): string {
  const ponto = (linha.match(/;/g) ?? []).length;
  const virgula = (linha.match(/,/g) ?? []).length;
  const tab = (linha.match(/\t/g) ?? []).length;
  if (tab >= ponto && tab >= virgula) return "\t";
  return ponto >= virgula ? ";" : ",";
}

/**
 * Linha SEM cabeçalho, lida pelo FORMATO dos campos e não pela posição: as
 * datas são reconhecidas como datas, a meta como o número depois delas, o nome
 * como o texto entre as duas coisas e a loja como o texto antes da primeira
 * data.
 *
 * O export do Controle de Vez vem assim:
 *   Flu Laranjeiras;30/08/2026;31/08/2026;Lazlo;4600,00
 *
 * As duas datas são os limites da semana. Ler pelo formato evita quebrar
 * quando alguém acrescentar ou mover uma coluna — e isso vai acontecer.
 */
function lerLinhaSemCabecalho(campos: string[]): Omit<LinhaImport, "linha"> | null {
  const datas: number[] = [];
  campos.forEach((c, i) => {
    if (dataDoCsv(c)) datas.push(i);
  });
  if (datas.length === 0) return null;

  const ultimaData = datas[datas.length - 1];
  let iMeta = -1;
  for (let i = campos.length - 1; i > ultimaData; i--) {
    if (/\d/.test(campos[i]) && valorDoCsv(campos[i]) != null) {
      iMeta = i;
      break;
    }
  }
  if (iMeta < 0) return null;

  let nome: string | null = null;
  let codigoPdv: string | null = null;
  for (let i = ultimaData + 1; i < iMeta; i++) {
    const v = campos[i].trim();
    if (!v) continue;
    if (/^\d{4,}$/.test(v)) codigoPdv = v;
    else if (!nome) nome = v;
  }

  return {
    semanaInicio: dataDoCsv(campos[datas[0]])!,
    semanaFim: datas.length > 1 ? dataDoCsv(campos[ultimaData]) : null,
    codigoPdv,
    nome,
    loja: datas[0] > 0 ? campos[0].trim() || null : null,
    meta: valorDoCsv(campos[iMeta])!,
  };
}

/**
 * Lê o CSV/TSV exportado. Aceita cabeçalho em qualquer ordem e nomes usuais de
 * coluna. Linha sem data ou sem meta vira erro apontando o número da linha —
 * arquivo de meta com linha engolida em silêncio é folha errada no fim do mês.
 */
export function parseCsvMetas(texto: string): ResultadoParse {
  const linhas: LinhaImport[] = [];
  const erros: string[] = [];
  const cruas = (texto ?? "")
    .replace(/^\uFEFF/, "") // BOM que o Excel põe no começo do arquivo
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (cruas.length === 0) return { linhas, erros: ["Arquivo vazio."] };

  const sep = separador(cruas[0]);
  const primeira = cruas[0].split(sep);
  const mapa = primeira.map(
    (c) => CABECALHOS[normalizarNome(c).toLowerCase().replace(/ /g, "_")] ?? null,
  );
  // Cabeçalho é opcional: o export do Controle de Vez vem sem.
  const temCabecalho = mapa.filter(Boolean).length >= 2 && !primeira.some((c) => dataDoCsv(c));

  for (let i = temCabecalho ? 1 : 0; i < cruas.length; i++) {
    const campos = cruas[i].split(sep).map((c) => c.trim());
    const numero = i + 1;

    if (!temCabecalho) {
      const lida = lerLinhaSemCabecalho(campos);
      if (!lida) {
        erros.push(`Linha ${numero}: não reconheci data e meta em "${cruas[i].slice(0, 60)}".`);
        continue;
      }
      if (!lida.codigoPdv && !lida.nome) {
        erros.push(`Linha ${numero}: sem código do PDV nem nome — não dá para saber de quem é.`);
        continue;
      }
      linhas.push({ ...lida, linha: numero });
      continue;
    }

    const registro: Record<string, string> = {};
    mapa.forEach((chave, j) => {
      if (chave) registro[chave] = (campos[j] ?? "").trim();
    });
    const semanaInicio = dataDoCsv(registro.semanaInicio ?? "");
    const meta = valorDoCsv(registro.meta ?? "");
    const codigoPdv = (registro.codigoPdv ?? "").trim() || null;
    const nome = (registro.nome ?? "").trim() || null;

    if (!semanaInicio) {
      erros.push(`Linha ${numero}: data da semana inválida ("${registro.semanaInicio ?? ""}").`);
      continue;
    }
    if (meta == null) {
      erros.push(`Linha ${numero}: meta inválida ("${registro.meta ?? ""}").`);
      continue;
    }
    if (!codigoPdv && !nome) {
      erros.push(`Linha ${numero}: sem código do PDV nem nome — não dá para saber de quem é.`);
      continue;
    }
    linhas.push({
      semanaInicio,
      semanaFim: dataDoCsv(registro.semanaFim ?? "") ?? null,
      codigoPdv,
      nome,
      loja: (registro.loja ?? "").trim() || null,
      meta,
      linha: numero,
    });
  }
  return { linhas, erros };
}

/** Competência ("YYYY-MM") da semana. A semana não atravessa o mês. */
export function competenciaDaSemana(semanaInicio: string): string {
  return semanaInicio.slice(0, 7);
}

/**
 * Índice (0 a 5) da semana dentro da competência, pela ordem das datas.
 * A primeira segunda-feira do arquivo naquele mês é a semana 1.
 */
export function indicesDasSemanas(datas: string[]): Map<string, number> {
  const unicas = [...new Set(datas)].sort();
  const m = new Map<string, number>();
  unicas.forEach((d, i) => m.set(d, i));
  return m;
}

/**
 * Acha a pessoa pelo nome que veio no arquivo. O export manda o nome curto
 * ("Lazlo") e o cadastro tem o completo ("LAZLO SENTO SE") — exigir igualdade
 * não casaria ninguém.
 *
 * A ordem importa: igual > começa com > mesmo primeiro nome. Só vale quando
 * sobra UM candidato; havendo mais de um, devolve todos para alguém decidir,
 * porque chutar aqui é pagar a comissão de um para outro.
 */
export function acharPorNome<T extends { nome: string }>(
  nomeDoArquivo: string,
  candidatos: T[],
): { achado: T | null; ambiguos: T[] } {
  const alvo = normalizarNome(nomeDoArquivo);
  if (!alvo) return { achado: null, ambiguos: [] };

  const tentativas = [
    candidatos.filter((c) => normalizarNome(c.nome) === alvo),
    candidatos.filter((c) => normalizarNome(c.nome).startsWith(`${alvo} `)),
    candidatos.filter((c) => normalizarNome(c.nome).split(" ")[0] === alvo.split(" ")[0]),
  ];
  for (const grupo of tentativas) {
    if (grupo.length === 1) return { achado: grupo[0], ambiguos: [] };
    if (grupo.length > 1) return { achado: null, ambiguos: grupo };
  }
  return { achado: null, ambiguos: [] };
}
