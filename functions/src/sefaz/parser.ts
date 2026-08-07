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
    situacao: null,
    tpEvento: null,
    descEvento: null,
  };
}

/** Normaliza texto para busca (sem acento/caixa) — usado em xNomeEmit. */
export function normalizarBusca(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
