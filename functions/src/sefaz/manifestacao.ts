import { SignedXml } from "xml-crypto";
import { urlRecepcaoEvento } from "./endpoints";
import { postSoap } from "./soap";

const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const NS_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";
const SOAP_ACTION = `${NS_WSDL}/nfeRecepcaoEvento`;

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

export type TpEvento = "210210" | "210200" | "210220" | "210240";

export const DESC_EVENTO: Record<TpEvento, string> = {
  "210210": "Ciencia da Operacao",
  "210200": "Confirmacao da Operacao",
  "210220": "Desconhecimento da Operacao",
  "210240": "Operacao nao Realizada",
};

export const EVENTO_CONCLUSIVO: Record<TpEvento, boolean> = {
  "210210": false, // Ciência é provisória
  "210200": true,
  "210220": true,
  "210240": true,
};

function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<${nome}[^>]*>([^<]*)</${nome}>`));
  return m ? m[1] : null;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** dhEvento no fuso de Brasília (-03:00, sem horário de verão desde 2019). */
function dhEvento(): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, "-03:00");
}

/** Assina o elemento infEvento (dentro do envEvento) com XML-DSig (RSA-SHA1). */
function assinar(envEventoXml: string, key: string, cert: string): string {
  const sig = new SignedXml({
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
  });
  sig.computeSignature(envEventoXml, {
    location: { reference: "//*[local-name(.)='infEvento']", action: "after" },
  });
  return sig.getSignedXml();
}

export interface ResultadoManifestacao {
  httpStatus: number;
  cStatLote: string | null;
  xMotivoLote: string | null;
  cStatEvento: string | null;
  xMotivoEvento: string | null;
  nProt: string | null;
  dhRegEvento: string | null;
  ok: boolean; // 135/136
  raw: string;
}

export async function enviarManifestacao(params: {
  ambiente: "homologacao" | "producao";
  cnpj: string; // 14 dígitos (destinatário)
  chNFe: string; // 44 dígitos
  tpEvento: TpEvento;
  nSeqEvento?: number;
  xJust?: string;
  key: string;
  cert: string;
}): Promise<ResultadoManifestacao> {
  const tpAmb = params.ambiente === "producao" ? "1" : "2";
  const seq = params.nSeqEvento ?? 1;
  const seq2 = String(seq).padStart(2, "0");
  const id = `ID${params.tpEvento}${params.chNFe}${seq2}`;
  const descEvento = DESC_EVENTO[params.tpEvento];
  const detExtra =
    params.tpEvento === "210240" ? `<xJust>${esc(params.xJust ?? "")}</xJust>` : "";

  // Sem indentação entre tags (evita diferença de digest).
  const envEvento =
    `<envEvento xmlns="${NS_NFE}" versao="1.00">` +
    `<idLote>1</idLote>` +
    `<evento versao="1.00">` +
    `<infEvento Id="${id}">` +
    `<cOrgao>91</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${params.cnpj}</CNPJ>` +
    `<chNFe>${params.chNFe}</chNFe>` +
    `<dhEvento>${dhEvento()}</dhEvento>` +
    `<tpEvento>${params.tpEvento}</tpEvento>` +
    `<nSeqEvento>${seq}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>${descEvento}</descEvento>` +
    detExtra +
    `</detEvento>` +
    `</infEvento>` +
    `</evento>` +
    `</envEvento>`;

  const envAssinado = assinar(envEvento, params.key, params.cert);

  const soap =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="${NS_WSDL}">` +
    envAssinado +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`;

  const resp = await postSoap(
    urlRecepcaoEvento(params.ambiente),
    soap,
    { key: params.key, cert: params.cert },
    SOAP_ACTION,
  );

  // retEnvEvento tem cStat do lote; retEvento/infEvento tem cStat do evento.
  const body = resp.body;
  const cStatLote = tag(body, "cStat");
  const xMotivoLote = tag(body, "xMotivo");
  // O segundo cStat/xMotivo (dentro de retEvento) é o do evento.
  const segundo = (nome: string): string | null => {
    const re = new RegExp(`<${nome}[^>]*>([^<]*)</${nome}>`, "g");
    const ms = [...body.matchAll(re)];
    return ms[1] ? ms[1][1] : ms[0] ? ms[0][1] : null;
  };
  const cStatEvento = segundo("cStat");
  const xMotivoEvento = segundo("xMotivo");
  const nProt = tag(body, "nProt");
  const dhRegEvento = tag(body, "dhRegEvento");

  return {
    httpStatus: resp.httpStatus,
    cStatLote,
    xMotivoLote,
    cStatEvento,
    xMotivoEvento,
    nProt,
    dhRegEvento,
    ok: cStatEvento === "135" || cStatEvento === "136",
    raw: body.slice(0, 1500),
  };
}
