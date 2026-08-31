// Importação das metas vindas do Controle de Vez — FUNÇÕES PURAS.
//
// Lá a meta já é semanal e por pessoa; aqui ela só é lida e casada com o
// cadastro. Nada de recalcular: a decisão de quanto cada um tem de vender é
// tomada na operação, e este módulo não opina sobre ela.
//
// A semana NÃO atravessa o mês (definição do Rodrigo), então a data de início
// da semana determina sozinha a competência.

export interface LinhaImport {
  /** Segunda-feira da semana, yyyy-MM-dd. */
  semanaInicio: string;
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
 * Lê o CSV/TSV exportado. Aceita cabeçalho em qualquer ordem e nomes usuais de
 * coluna. Linha sem data ou sem meta vira erro apontando o número da linha —
 * arquivo de meta com linha engolida em silêncio é folha errada no fim do mês.
 */
export function parseCsvMetas(texto: string): ResultadoParse {
  const linhas: LinhaImport[] = [];
  const erros: string[] = [];
  const cruas = (texto ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (cruas.length === 0) return { linhas, erros: ["Arquivo vazio."] };

  const sep = separador(cruas[0]);
  const cabecalho = cruas[0]
    .split(sep)
    .map((c) => normalizarNome(c).toLowerCase().replace(/ /g, "_"));
  const mapa = cabecalho.map((c) => CABECALHOS[c] ?? null);
  if (!mapa.includes("semanaInicio") || !mapa.includes("meta")) {
    return {
      linhas,
      erros: [
        'Cabeçalho não reconhecido. Esperado ao menos as colunas "semana_inicio" e "meta" (e "codigo_pdv" ou "nome").',
      ],
    };
  }

  for (let i = 1; i < cruas.length; i++) {
    const campos = cruas[i].split(sep);
    const registro: Record<string, string> = {};
    mapa.forEach((chave, j) => {
      if (chave) registro[chave] = (campos[j] ?? "").trim();
    });

    const semanaInicio = dataDoCsv(registro.semanaInicio ?? "");
    const meta = valorDoCsv(registro.meta ?? "");
    const codigoPdv = (registro.codigoPdv ?? "").trim() || null;
    const nome = (registro.nome ?? "").trim() || null;

    if (!semanaInicio) {
      erros.push(`Linha ${i + 1}: data da semana inválida ("${registro.semanaInicio ?? ""}").`);
      continue;
    }
    if (meta == null) {
      erros.push(`Linha ${i + 1}: meta inválida ("${registro.meta ?? ""}").`);
      continue;
    }
    if (!codigoPdv && !nome) {
      erros.push(`Linha ${i + 1}: sem código do PDV nem nome — não dá para saber de quem é.`);
      continue;
    }
    linhas.push({
      semanaInicio,
      codigoPdv,
      nome,
      loja: (registro.loja ?? "").trim() || null,
      meta,
      linha: i + 1,
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
