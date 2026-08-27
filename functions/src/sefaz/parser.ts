// Parser dos documentos retornados pela distribuição. Extrai os campos de
// cabeçalho para o Firestore. O XML original é sempre preservado no Storage —
// aqui só derivamos metadados para busca/listagem. Regex tolerante a namespaces.

function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}

function bloco(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

export type TipoDoc = "nfe" | "evento" | "desconhecido";

export interface DocParsed {
  tipo: TipoDoc;
  chNFe: string | null;
  cnpjEmit: string | null;
  xNomeEmit: string | null;
  vNF: number | null;
  dhEmi: string | null;
  nNF: string | null;
  serie: string | null;
  finNFe: string | null;   // finalidade: 1=Normal 2=Complementar 3=Ajuste 4=Devolução (só no XML completo)
  natOp: string | null;    // natureza da operação (texto)
  situacao: string | null; // cSitNFe (resumo) ou cStat do protocolo
  tpEvento: string | null; // eventos
  descEvento: string | null;
}

export function parseDoc(xml: string, schema: string): DocParsed {
  const s = (schema || "").toLowerCase();
  const isEvento = s.includes("evento");
  const isNfe = s.includes("resnfe") || s.includes("procnfe") || (!isEvento && xml.includes("<NFe"));

  // chave de acesso: tag <chNFe> ou o Id="NFe<44>"
  const chFromTag = pick(xml, "chNFe");
  const chFromId = (xml.match(/Id="NFe(\d{44})"/) || [])[1] || null;
  const chNFe = chFromTag || chFromId;

  if (isEvento) {
    return {
      tipo: "evento",
      chNFe,
      cnpjEmit: null,
      xNomeEmit: null,
      vNF: null,
      dhEmi: pick(xml, "dhEvento"),
      nNF: null,
      serie: null,
      finNFe: null,
      natOp: null,
      situacao: pick(xml, "cStat"),
      tpEvento: pick(xml, "tpEvento"),
      descEvento: pick(xml, "xEvento") || pick(xml, "descEvento"),
    };
  }

  if (isNfe) {
    // emitente: dentro de <emit> (procNFe) ou tags de topo (resNFe)
    const emit = bloco(xml, "emit");
    const cnpjEmit = emit ? pick(emit, "CNPJ") : pick(xml, "CNPJ");
    const xNomeEmit = emit ? pick(emit, "xNome") : pick(xml, "xNome");
    const vNFstr = pick(xml, "vNF");
    return {
      tipo: "nfe",
      chNFe,
      cnpjEmit,
      xNomeEmit,
      vNF: vNFstr ? Number(vNFstr) : null,
      dhEmi: pick(xml, "dhEmi"),
      nNF: pick(xml, "nNF"),
      serie: pick(xml, "serie"),
      finNFe: pick(xml, "finNFe"), // só presente no XML completo (procNFe)
      natOp: pick(xml, "natOp"),
      // resNFe traz cSitNFe; procNFe autorizada traz protocolo cStat 100
      situacao: pick(xml, "cSitNFe") || pick(xml, "cStat"),
      tpEvento: null,
      descEvento: null,
    };
  }

  return {
    tipo: "desconhecido",
    chNFe,
    cnpjEmit: null,
    xNomeEmit: null,
    vNF: null,
    dhEmi: null,
    nNF: null,
    serie: null,
    finNFe: null,
    natOp: null,
    situacao: null,
    tpEvento: null,
    descEvento: null,
  };
}

function num(s: string | null): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface ItemParsed {
  nItem: string;
  cProd: string | null;
  cEAN: string | null;
  xProd: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  uCom: string | null;
  qCom: number | null;
  vUnCom: number | null;
  vProd: number | null;
}

/** Extrai os itens (<det><prod>) de uma NF-e completa (procNFe). */
export function parseItens(xml: string): ItemParsed[] {
  const out: ItemParsed[] = [];
  const re = /<det\b[^>]*nItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const prod = bloco(m[2], "prod") ?? m[2];
    out.push({
      nItem: m[1],
      cProd: pick(prod, "cProd"),
      cEAN: pick(prod, "cEAN"),
      xProd: pick(prod, "xProd"),
      ncm: pick(prod, "NCM"),
      cest: pick(prod, "CEST"),
      cfop: pick(prod, "CFOP"),
      uCom: pick(prod, "uCom"),
      qCom: num(pick(prod, "qCom")),
      vUnCom: num(pick(prod, "vUnCom")),
      vProd: num(pick(prod, "vProd")),
    });
  }
  return out;
}

export interface ParcelaParsed {
  nDup: string | null;
  dVenc: string | null; // yyyy-MM-dd
  vDup: number | null;
}

/** Extrai as duplicatas/parcelas (<cobr><dup>) de uma NF-e completa. */
export function parseParcelas(xml: string): ParcelaParsed[] {
  const out: ParcelaParsed[] = [];
  const re = /<dup>([\s\S]*?)<\/dup>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({
      nDup: pick(m[1], "nDup"),
      dVenc: pick(m[1], "dVenc"),
      vDup: num(pick(m[1], "vDup")),
    });
  }
  return out;
}

/** Normaliza texto para busca (sem acento/caixa) — usado em xNomeEmit. */
export function normalizarBusca(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
