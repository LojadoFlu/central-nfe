import { UF_IBGE, urlDistribuicao } from "./endpoints";
import { postSoap } from "./soap";

const NS_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";
const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const SOAP_ACTION = `${NS_WSDL}/nfeDistDFeInteresse`;

/** Extrai o primeiro valor de uma tag simples (top-level do retorno). */
function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<${nome}[^>]*>([^<]*)</${nome}>`));
  return m ? m[1] : null;
}

export interface ResultadoDistribuicao {
  httpStatus: number;
  cStat: string | null;
  xMotivo: string | null;
  ultNSU: string | null;
  maxNSU: string | null;
  verAplic: string | null;
  /** Trecho do XML de resposta (para diagnóstico; sem dados sensíveis do cert). */
  raw: string;
}

/**
 * Consulta a distribuição por NSU (modo distNSU), NT 2014.002.
 * distDFeInt versao="1.01". Retorna os campos de cabeçalho do retorno.
 * (O processamento dos docZip entra em milestone posterior.)
 */
export async function consultarDistribuicaoNSU(params: {
  ambiente: "homologacao" | "producao";
  uf: string;
  cnpj: string; // 14 dígitos
  ultNSU: string;
  pfx: Buffer;
  senha: string;
}): Promise<ResultadoDistribuicao> {
  const tpAmb = params.ambiente === "producao" ? "1" : "2";
  const cUF = UF_IBGE[(params.uf || "").toUpperCase()] || "";
  const ultNSU15 = String(params.ultNSU || "0").replace(/\D/g, "").padStart(15, "0");

  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap:Body>` +
    `<nfeDistDFeInteresse xmlns="${NS_WSDL}">` +
    `<nfeDadosMsg>` +
    `<distDFeInt xmlns="${NS_NFE}" versao="1.01">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>${cUF}</cUFAutor>` +
    `<CNPJ>${params.cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${ultNSU15}</ultNSU></distNSU>` +
    `</distDFeInt>` +
    `</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>` +
    `</soap:Body>` +
    `</soap:Envelope>`;

  const resp = await postSoap(
    urlDistribuicao(params.ambiente),
    envelope,
    params.pfx,
    params.senha,
    SOAP_ACTION,
  );

  return {
    httpStatus: resp.httpStatus,
    cStat: tag(resp.body, "cStat"),
    xMotivo: tag(resp.body, "xMotivo"),
    ultNSU: tag(resp.body, "ultNSU"),
    maxNSU: tag(resp.body, "maxNSU"),
    verAplic: tag(resp.body, "verAplic"),
    raw: resp.body.slice(0, 1500),
  };
}
