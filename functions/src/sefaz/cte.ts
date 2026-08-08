// Adaptador CT-e (Conhecimento de Transporte Eletrônico) — Distribuição DFe.
// Espelha o motor da NF-e (distDFeInt/NSU/docZip/656), mas no Ambiente Nacional
// do CT-e (CTeDistribuicaoDFe, NT 2015.002). MESMO certificado A1.
//
// Endpoint oficial confirmado no portal cte.fazenda.gov.br (AN, versão 1.00):
//   Produção:    https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx
//   Homologação: https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx
// (o portal lista só produção; hom1 segue o mesmo padrão da NF-e — validar no 1º uso.)

import * as zlib from "node:zlib";
import * as crypto from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { db, somenteDigitos } from "../lib/base";
import { UF_IBGE } from "./endpoints";
import { postSoap } from "./soap";
import { normalizarBusca } from "./parser";

const NS_WSDL = "http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe";
const NS_CTE = "http://www.portalfiscal.inf.br/cte";
const SOAP_ACTION = `${NS_WSDL}/cteDistDFeInteresse`;

const MAX_ITER_POR_RUN = 20;
const RECUO_656_MS = 60 * 60 * 1000; // 1h de recuo no consumo indevido

export function urlDistribuicaoCTe(ambiente: "homologacao" | "producao"): string {
  return ambiente === "producao"
    ? "https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx"
    : "https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx";
}

function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<${nome}[^>]*>([^<]*)</${nome}>`));
  return m ? m[1] : null;
}
function pick(xml: string, t: string): string | null {
  const m = xml.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`));
  return m ? m[1].trim() : null;
}
function bloco(xml: string, t: string): string | null {
  const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
  return m ? m[1] : null;
}
function num(s: string | null): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface DocZip {
  nsu: string;
  schema: string;
  xml: string;
}

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
      out.push({ nsu, schema, xml: zlib.gunzipSync(buf).toString("utf8") });
    } catch {
      // docZip malformado — ignora; o NSU segue no avanço.
    }
  }
  return out;
}

export interface ResultadoDistribuicao {
  httpStatus: number;
  cStat: string | null;
  xMotivo: string | null;
  ultNSU: string | null;
  maxNSU: string | null;
  verAplic: string | null;
  docs: DocZip[];
  raw: string;
}

/** Consulta distribuição do CT-e por NSU (cteDistDFeInteresse, distDFeInt v1.00). */
export async function consultarDistribuicaoCTeNSU(params: {
  ambiente: "homologacao" | "producao";
  uf: string;
  cnpj: string;
  ultNSU: string;
  key: string;
  cert: string;
}): Promise<ResultadoDistribuicao> {
  const tpAmb = params.ambiente === "producao" ? "1" : "2";
  const cUF = UF_IBGE[(params.uf || "").toUpperCase()] || "";
  const ultNSU15 = String(params.ultNSU || "0").replace(/\D/g, "").padStart(15, "0");

  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap:Body>` +
    `<cteDistDFeInteresse xmlns="${NS_WSDL}">` +
    `<cteDadosMsg>` +
    `<distDFeInt xmlns="${NS_CTE}" versao="1.00">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>${cUF}</cUFAutor>` +
    `<CNPJ>${params.cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${ultNSU15}</ultNSU></distNSU>` +
    `</distDFeInt>` +
    `</cteDadosMsg>` +
    `</cteDistDFeInteresse>` +
    `</soap:Body>` +
    `</soap:Envelope>`;

  const resp = await postSoap(
    urlDistribuicaoCTe(params.ambiente),
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

export interface CteParsed {
  tipo: "cte" | "evento" | "desconhecido";
  chCTe: string | null;
  cnpjEmit: string | null;
  xNomeEmit: string | null;
  vTPrest: number | null; // valor total da prestação (frete)
  dhEmi: string | null;
  nCT: string | null;
  serie: string | null;
  tpCTe: string | null;
  ufIni: string | null;
  ufFim: string | null;
  xNomeRem: string | null;
  xNomeDest: string | null;
  situacao: string | null;
  tpEvento: string | null;
  descEvento: string | null;
}

/** Extrai metadados de um documento CT-e (procCTe/resCTe/evento). */
export function parseCTe(xml: string, schema: string): CteParsed {
  const s = (schema || "").toLowerCase();
  const isEvento = s.includes("evento");
  const isCte = s.includes("proccte") || s.includes("rescte") || (!isEvento && xml.includes("<CTe"));

  const chFromTag = pick(xml, "chCTe");
  const chFromId = (xml.match(/Id="CTe(\d{44})"/) || [])[1] || null;
  const chCTe = chFromTag || chFromId;

  if (isEvento) {
    return {
      tipo: "evento",
      chCTe,
      cnpjEmit: null,
      xNomeEmit: null,
      vTPrest: null,
      dhEmi: pick(xml, "dhEvento"),
      nCT: null,
      serie: null,
      tpCTe: null,
      ufIni: null,
      ufFim: null,
      xNomeRem: null,
      xNomeDest: null,
      situacao: pick(xml, "cStat"),
      tpEvento: pick(xml, "tpEvento"),
      descEvento: pick(xml, "xEvento") || pick(xml, "descEvento"),
    };
  }

  if (isCte) {
    const emit = bloco(xml, "emit");
    const rem = bloco(xml, "rem");
    const dest = bloco(xml, "dest");
    return {
      tipo: "cte",
      chCTe,
      cnpjEmit: emit ? pick(emit, "CNPJ") : pick(xml, "CNPJ"),
      xNomeEmit: emit ? pick(emit, "xNome") : null,
      vTPrest: num(pick(xml, "vTPrest")),
      dhEmi: pick(xml, "dhEmi"),
      nCT: pick(xml, "nCT"),
      serie: pick(xml, "serie"),
      tpCTe: pick(xml, "tpCTe"),
      ufIni: pick(xml, "UFIni"),
      ufFim: pick(xml, "UFFim"),
      xNomeRem: rem ? pick(rem, "xNome") : null,
      xNomeDest: dest ? pick(dest, "xNome") : null,
      // resCTe traz cSitCTe; procCTe autorizado traz protocolo cStat 100
      situacao: pick(xml, "cSitCTe") || pick(xml, "cStat"),
      tpEvento: null,
      descEvento: null,
    };
  }

  return {
    tipo: "desconhecido",
    chCTe,
    cnpjEmit: null,
    xNomeEmit: null,
    vTPrest: null,
    dhEmi: null,
    nCT: null,
    serie: null,
    tpCTe: null,
    ufIni: null,
    ufFim: null,
    xNomeRem: null,
    xNomeDest: null,
    situacao: null,
    tpEvento: null,
    descEvento: null,
  };
}

export interface ResultadoSyncCTe {
  novos: number;
  iteracoes: number;
  cStat: string | null;
  xMotivo: string | null;
  ultNSU: string;
  maxNSU: string;
  bloqueado: boolean;
}

function menorQue(a: string, b: string): boolean {
  try { return BigInt(a) < BigInt(b); } catch { return false; }
}

/** Sincroniza os CT-e de uma empresa (loop distNSU até esgotar). NSU próprio (cte_sync_state). */
export async function sincronizarCTe(
  emp: { id: string; cnpj: string; uf: string; ambiente?: string },
  key: string,
  cert: string,
): Promise<ResultadoSyncCTe> {
  const companyId = emp.id;
  const cnpj = somenteDigitos(emp.cnpj);
  const ambiente = emp.ambiente === "producao" ? "producao" : "homologacao";
  const stateRef = db.collection("cte_sync_state").doc(companyId);
  const st = (await stateRef.get()).data() as
    | { ultNSU?: string; maxNSU?: string; proximaSync?: string | null; ultimoCStat?: string }
    | undefined;

  if (st?.proximaSync && new Date(st.proximaSync).getTime() > Date.now()) {
    return {
      novos: 0,
      iteracoes: 0,
      cStat: st.ultimoCStat ?? "656",
      xMotivo: `Em recuo até ${new Date(st.proximaSync).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Aguarde antes de nova consulta (regra da SEFAZ).`,
      ultNSU: st.ultNSU || "0",
      maxNSU: st.maxNSU || "0",
      bloqueado: true,
    };
  }

  let ultNSU = st?.ultNSU || "0";
  let maxNSU = st?.maxNSU || "0";
  let cStat: string | null = null;
  let xMotivo: string | null = null;
  let novos = 0;
  let iter = 0;
  let bloqueado = false;

  while (iter < MAX_ITER_POR_RUN) {
    iter++;
    const r = await consultarDistribuicaoCTeNSU({ ambiente, uf: emp.uf, cnpj, ultNSU, key, cert });
    cStat = r.cStat;
    xMotivo = r.xMotivo;
    if (r.maxNSU) maxNSU = r.maxNSU;

    if (r.cStat === "656") {
      bloqueado = true;
      await stateRef.set(
        {
          companyId, cnpj, ultNSU, maxNSU,
          status: "bloqueado", ultimoCStat: r.cStat, ultimaMensagem: r.xMotivo,
          ultimaSync: new Date().toISOString(),
          proximaSync: new Date(Date.now() + RECUO_656_MS).toISOString(),
        },
        { merge: true },
      );
      break;
    }

    for (const d of r.docs) {
      try {
        await salvarDocCTe(companyId, cnpj, d);
        novos++;
      } catch (e) {
        console.error("Falha ao salvar CT-e NSU", d.nsu, (e as Error).message);
      }
    }

    if (r.ultNSU) ultNSU = r.ultNSU;

    await stateRef.set(
      {
        companyId, cnpj, ultNSU, maxNSU,
        status: "ok", ultimoCStat: r.cStat, ultimaMensagem: r.xMotivo,
        ultimaSync: new Date().toISOString(), proximaSync: null,
      },
      { merge: true },
    );

    if (r.cStat === "137") break;
    if (r.docs.length === 0) break;
    if (!menorQue(ultNSU, maxNSU)) break;
  }

  await db.collection("cte_sync_logs").add({
    companyId, cnpj, ambiente, ultNSU, maxNSU, novos, iteracoes: iter, cStat, xMotivo,
    at: new Date().toISOString(),
  });

  return { novos, iteracoes: iter, cStat, xMotivo, ultNSU, maxNSU, bloqueado };
}

/** Salva o XML cru no Storage e os metadados no Firestore (idempotente). */
async function salvarDocCTe(companyId: string, cnpj: string, d: DocZip): Promise<void> {
  const p = parseCTe(d.xml, d.schema);
  const hash = crypto.createHash("sha256").update(d.xml).digest("hex");

  const base = p.dhEmi ? new Date(p.dhEmi) : new Date();
  const ano = String(base.getUTCFullYear());
  const mes = String(base.getUTCMonth() + 1).padStart(2, "0");
  const nomeArq = `${p.chCTe || "nsu"}_${d.nsu}.xml`;
  const storagePath = `cte/${cnpj}/${ano}/${mes}/${nomeArq}`;

  await getStorage()
    .bucket()
    .file(storagePath)
    .save(Buffer.from(d.xml, "utf8"), { contentType: "application/xml", resumable: false });

  const now = new Date().toISOString();

  if (p.tipo === "evento") {
    const id = `${p.chCTe || "nsu"}_${p.tpEvento || "ev"}_${d.nsu}`;
    await db.collection("cte_events").doc(id).set(
      {
        companyId, chCTe: p.chCTe, tpEvento: p.tpEvento, descEvento: p.descEvento,
        cStat: p.situacao, nsu: d.nsu, schema: d.schema, storagePath, hashSha256: hash,
        dhEvento: p.dhEmi, updatedAt: now, createdAt: now,
      },
      { merge: true },
    );
    return;
  }

  const id = p.chCTe || `nsu_${d.nsu}`;
  const completo = (d.schema || "").toLowerCase().includes("proccte");
  await db.collection("cte_documents").doc(id).set(
    {
      companyId,
      chCTe: p.chCTe,
      cnpjEmit: p.cnpjEmit ? somenteDigitos(p.cnpjEmit) : null,
      xNomeEmit: p.xNomeEmit,
      xNomeBusca: normalizarBusca(p.xNomeEmit),
      vTPrest: p.vTPrest,
      dhEmi: p.dhEmi,
      nCT: p.nCT,
      serie: p.serie,
      tpCTe: p.tpCTe,
      ufIni: p.ufIni,
      ufFim: p.ufFim,
      xNomeRem: p.xNomeRem,
      xNomeDest: p.xNomeDest,
      situacao: p.situacao,
      schema: d.schema,
      temXmlCompleto: completo,
      nsu: d.nsu,
      storagePath,
      hashSha256: hash,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true },
  );
}
