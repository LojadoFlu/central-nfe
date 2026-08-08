// Adaptador NFS-e Nacional (serviços) — ADN (Ambiente de Dados Nacional), REST.
// Distribuição ao contribuinte por NSU. mTLS com e-CNPJ (mesmo A1). NT/Manual
// Contribuintes ADN v1.0 (12/02/2026).
//
// Endpoints oficiais (confirmados no portal nfse.gov.br):
//   Produção:          https://adn.nfse.gov.br/contribuintes
//   Produção restrita: https://adn.producaorestrita.nfse.gov.br/contribuintes
//   GET /DFe/{NSU}                  -> documentos a partir do NSU
//   GET /NFSe/{chave}/Eventos       -> eventos por chave de acesso

import * as https from "node:https";
import * as zlib from "node:zlib";
import { URL } from "node:url";

/** ArquivoXml vem em base64 de um gzip (H4sI…). Decodifica p/ XML. */
export function decodeArquivoXml(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  try {
    return zlib.gunzipSync(buf).toString("utf8");
  } catch {
    return buf.toString("utf8");
  }
}

export function urlAdnNfse(ambiente: "homologacao" | "producao"): string {
  return ambiente === "producao"
    ? "https://adn.nfse.gov.br/contribuintes"
    : "https://adn.producaorestrita.nfse.gov.br/contribuintes";
}

export interface RespostaHttp {
  httpStatus: number;
  body: string;
}

/** GET com mTLS + Accept: application/json (a API do ADN é REST/JSON). */
export function getJsonComCert(
  url: string,
  tls: { key: string; cert: string },
): Promise<RespostaHttp> {
  const u = new URL(url);
  const options: https.RequestOptions = {
    host: u.hostname,
    path: u.pathname + u.search,
    port: 443,
    method: "GET",
    key: tls.key,
    cert: tls.cert,
    minVersion: "TLSv1.2",
    headers: { Accept: "application/json" },
    timeout: 30000,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () =>
        resolve({ httpStatus: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("timeout", () => req.destroy(new Error("Timeout na conexão com o ADN NFS-e.")));
    req.on("error", reject);
    req.end();
  });
}

/** Consulta crua de DFe por NSU (para inspeção do contrato antes do parser). */
export async function consultarDFeNfseRaw(params: {
  ambiente: "homologacao" | "producao";
  nsu: string | number;
  key: string;
  cert: string;
}): Promise<{ httpStatus: number; body: string }> {
  const url = `${urlAdnNfse(params.ambiente)}/DFe/${params.nsu}`;
  return getJsonComCert(url, { key: params.key, cert: params.cert });
}

// ---- Parsing ----

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

export interface DocDFe {
  nsu: string;
  chave: string;
  tipo: string; // "NFSE" | "EVENTO" | ...
  dhGer: string | null;
  xml: string;
}

export interface RespostaDFe {
  httpStatus: number;
  status: string | null; // StatusProcessamento
  docs: DocDFe[];
  maxNsuLote: number; // maior NSU do lote (0 se vazio)
}

/** Interpreta a resposta JSON do ADN e decodifica os ArquivoXml. */
export function parseRespostaDFe(httpStatus: number, body: string): RespostaDFe {
  let j: {
    StatusProcessamento?: string;
    LoteDFe?: Array<Record<string, unknown>>;
  } = {};
  try {
    j = JSON.parse(body);
  } catch {
    // corpo não-JSON
  }
  const lote = Array.isArray(j.LoteDFe) ? j.LoteDFe : [];
  const docs: DocDFe[] = [];
  let maxNsu = 0;
  for (const it of lote) {
    const nsuNum = Number(it.NSU ?? it.nsu ?? 0);
    if (Number.isFinite(nsuNum) && nsuNum > maxNsu) maxNsu = nsuNum;
    const b64 = (it.ArquivoXml ?? it.arquivoXml) as string | undefined;
    if (!b64) continue;
    docs.push({
      nsu: String(it.NSU ?? it.nsu ?? ""),
      chave: String(it.ChaveAcesso ?? it.chaveAcesso ?? ""),
      tipo: String(it.TipoDocumento ?? it.tipoDocumento ?? "NFSE"),
      dhGer: (it.DataHoraGeracao ?? it.dataHoraGeracao ?? null) as string | null,
      xml: decodeArquivoXml(b64),
    });
  }
  return { httpStatus, status: j.StatusProcessamento ?? null, docs, maxNsuLote: maxNsu };
}

export interface NfseParsed {
  chNFSe: string | null;
  cnpjPrest: string | null; // prestador (emitente) = quem cobrou de nós
  xNomePrest: string | null;
  vServ: number | null; // valor do serviço
  vLiq: number | null; // valor líquido
  dhEmi: string | null;
  nNFSe: string | null;
  municipio: string | null;
  xTribNac: string | null; // natureza do serviço
  xDescServ: string | null; // discriminação
  tomaCnpj: string | null;
  cStat: string | null;
}

/** Extrai metadados de uma NFS-e nacional (layout SNNFSe, ns sped.fazenda). */
export function parseNfse(xml: string): NfseParsed {
  const idMatch = xml.match(/Id="NFS(\d{40,60})"/);
  const emit = bloco(xml, "emit");
  const toma = bloco(xml, "toma");
  return {
    chNFSe: idMatch ? idMatch[1] : pick(xml, "chNFSe"),
    cnpjPrest: emit ? pick(emit, "CNPJ") || pick(emit, "CPF") : null,
    xNomePrest: emit ? pick(emit, "xNome") : null,
    vServ: num(pick(xml, "vServ")),
    vLiq: num(pick(xml, "vLiq")),
    dhEmi: pick(xml, "dhEmi") || pick(xml, "dhProc"),
    nNFSe: pick(xml, "nNFSe"),
    municipio: pick(xml, "xLocPrestacao") || pick(xml, "xLocEmi"),
    xTribNac: pick(xml, "xTribNac"),
    xDescServ: pick(xml, "xDescServ"),
    tomaCnpj: toma ? pick(toma, "CNPJ") || pick(toma, "CPF") : null,
    cStat: pick(xml, "cStat"),
  };
}

export function normalizarBusca(s: string | null | undefined): string {
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

// ---- Sincronização ----

import * as crypto from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { db, somenteDigitos } from "../lib/base";

const MAX_ITER = 30;

export interface ResultadoSyncNfse {
  novos: number;
  iteracoes: number;
  status: string | null;
  ultNSU: string;
}

/** Sincroniza as NFS-e (serviços) de uma empresa via ADN. NSU próprio. */
export async function sincronizarNfse(
  emp: { id: string; cnpj: string; ambiente?: string },
  key: string,
  cert: string,
): Promise<ResultadoSyncNfse> {
  const companyId = emp.id;
  const cnpj = somenteDigitos(emp.cnpj);
  const ambiente = emp.ambiente === "producao" ? "producao" : "homologacao";
  const stateRef = db.collection("nfse_sync_state").doc(companyId);
  const st = (await stateRef.get()).data() as { ultNSU?: string } | undefined;

  let ultNSU = Number(st?.ultNSU || "0");
  let novos = 0;
  let iter = 0;
  let status: string | null = null;

  while (iter < MAX_ITER) {
    iter++;
    const r = await getJsonComCert(`${urlAdnNfse(ambiente)}/DFe/${ultNSU}`, { key, cert });
    const parsed = parseRespostaDFe(r.httpStatus, r.body);
    status = parsed.status;

    if (parsed.docs.length === 0) break; // NENHUM_DOCUMENTO_LOCALIZADO ou vazio

    for (const d of parsed.docs) {
      try {
        await salvarDocNfse(companyId, cnpj, d);
        novos++;
      } catch (e) {
        console.error("Falha ao salvar NFS-e NSU", d.nsu, (e as Error).message);
      }
    }

    if (parsed.maxNsuLote <= ultNSU) break; // não avançou
    ultNSU = parsed.maxNsuLote;

    await stateRef.set(
      {
        companyId, cnpj, ultNSU: String(ultNSU),
        status: "ok", ultimoStatus: status,
        ultimaSync: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  await stateRef.set(
    { companyId, cnpj, ultNSU: String(ultNSU), status: "ok", ultimoStatus: status, ultimaSync: new Date().toISOString() },
    { merge: true },
  );
  await db.collection("nfse_sync_logs").add({
    companyId, cnpj, ambiente, ultNSU: String(ultNSU), novos, iteracoes: iter, status,
    at: new Date().toISOString(),
  });

  return { novos, iteracoes: iter, status, ultNSU: String(ultNSU) };
}

async function salvarDocNfse(companyId: string, cnpj: string, d: DocDFe): Promise<void> {
  const hash = crypto.createHash("sha256").update(d.xml).digest("hex");
  const p = parseNfse(d.xml);
  const chave = d.chave || p.chNFSe || `nsu_${d.nsu}`;

  const base = p.dhEmi ? new Date(p.dhEmi) : new Date();
  const ano = String(base.getUTCFullYear());
  const mes = String(base.getUTCMonth() + 1).padStart(2, "0");
  const storagePath = `nfse/${cnpj}/${ano}/${mes}/${chave}_${d.nsu}.xml`;

  await getStorage()
    .bucket()
    .file(storagePath)
    .save(Buffer.from(d.xml, "utf8"), { contentType: "application/xml", resumable: false });

  const now = new Date().toISOString();

  if ((d.tipo || "").toUpperCase().includes("EVENTO")) {
    await db.collection("nfse_events").doc(`${chave}_${d.nsu}`).set(
      {
        companyId, chNFSe: chave, tipo: d.tipo, nsu: d.nsu, storagePath, hashSha256: hash,
        dhGer: d.dhGer, cStat: p.cStat, updatedAt: now, createdAt: now,
      },
      { merge: true },
    );
    return;
  }

  await db.collection("nfse_documents").doc(chave).set(
    {
      companyId,
      chNFSe: chave,
      cnpjPrest: p.cnpjPrest ? somenteDigitos(p.cnpjPrest) : null,
      xNomePrest: p.xNomePrest,
      xNomeBusca: normalizarBusca(p.xNomePrest),
      vServ: p.vServ,
      vLiq: p.vLiq,
      dhEmi: p.dhEmi,
      nNFSe: p.nNFSe,
      municipio: p.municipio,
      xTribNac: p.xTribNac,
      xDescServ: p.xDescServ,
      cStat: p.cStat,
      tipo: d.tipo,
      nsu: d.nsu,
      storagePath,
      hashSha256: hash,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true },
  );
}
