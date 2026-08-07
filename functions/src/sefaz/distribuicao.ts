import * as zlib from "node:zlib";
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

export interface DocZip {
  nsu: string;
  schema: string;
  xml: string; // já descompactado (gzip+base64 → XML)
}

export interface ResultadoDistribuicao {
  httpStatus: number;
  cStat: string | null;
  xMotivo: string | null;
  ultNSU: string | null;
  maxNSU: string | null;
  verAplic: string | null;
  docs: DocZip[];
  /** Trecho do XML de resposta (para diagnóstico; sem dados sensíveis do cert). */
  raw: string;
}

/** Extrai e descompacta cada <docZip> (gzip + base64) do lote de retorno. */
function extrairDocs(xml: string): DocZip[] {
  const out: DocZip[] = [];
  const re = /<docZip\b([^>]*)>([\s\S]*?)<\/docZip>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const nsu = (attrs.match(/NSU="(\d+)"/) || [])[1] || "";
    const schema = (attrs.match(/schema="([^"]*)"/) || [])[1] || "";
    try {
      const buf = Buffer.from(m[2].trim(), "base64");
      const doc = zlib.gunzipSync(buf).toString("utf8");
      out.push({ nsu, schema, xml: doc });
    } catch {
      // docZip malformado — ignora, o NSU segue registrado no avanço.
    }
  }
  return out;
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
  key: string; // PEM da chave privada
  cert: string; // PEM do certificado (folha + cadeia)
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
    { key: params.key, cert: params.cert },
    SOAP_ACTION,
  );

  return {
    httpStatus: resp.httpStatus,
    cStat: tag(resp.body, "cStat"),
    xMotivo: tag(resp.body, "xMotivo"),
    ultNSU: tag(resp.body, "ultNSU"),
    maxNSU: tag(resp.body, "maxNSU"),
    verAplic: tag(resp.body, "verAplic"),
    docs: extrairDocs(resp.body),
    raw: resp.body.slice(0, 1500),
  };
}
