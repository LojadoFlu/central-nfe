import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { readFileSync } from "node:fs";
import parser from "../functions/lib/sefaz/parser.js";
const { parseItens, parseParcelas, normalizarBusca } = parser;

const key = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(key), storageBucket: "central-nfe-1c8d8.firebasestorage.app" });
const db = getFirestore();
const companyId = "59255964000123";

const snap = await db.collection("nfe_documents").where("companyId", "==", companyId).get();
let docs = 0, itens = 0, parcelas = 0, erros = 0;
for (const d of snap.docs) {
  const data = d.data();
  if (!data.temXmlCompleto || !data.storagePath || !data.chNFe) continue;
  try {
    const [buf] = await getStorage().bucket().file(data.storagePath).download();
    const xml = buf.toString("utf8");
    const its = parseItens(xml);
    const pcs = parseParcelas(xml);
    const now = new Date().toISOString();
    const cnpjEmit = (data.cnpjEmit || "").replace(/\D/g, "") || null;
    const batch = db.batch();
    for (const it of its) {
      batch.set(db.collection("nfe_items").doc(`${data.chNFe}_${it.nItem}`), {
        companyId, chNFe: data.chNFe, cnpjEmit, xNomeEmit: data.xNomeEmit ?? null, dhEmi: data.dhEmi ?? null,
        descricao: it.xProd, descricaoBusca: normalizarBusca(it.xProd), cProd: it.cProd, ean: it.cEAN,
        ncm: it.ncm, cest: it.cest, cfop: it.cfop, unidade: it.uCom, quantidade: it.qCom,
        valorUnitario: it.vUnCom, valorTotal: it.vProd, updatedAt: now,
      }, { merge: true });
    }
    for (const pc of pcs) {
      const nDup = pc.nDup || "1";
      batch.set(db.collection("nfe_installments").doc(`${data.chNFe}_${nDup}`), {
        companyId, chNFe: data.chNFe, cnpjEmit, xNomeEmit: data.xNomeEmit ?? null,
        nDup, vencimento: pc.dVenc, valor: pc.vDup, statusPagamento: "nao_informado", updatedAt: now,
      }, { merge: true });
    }
    if (its.length || pcs.length) await batch.commit();
    docs++; itens += its.length; parcelas += pcs.length;
  } catch (e) {
    erros++;
    console.error("falhou", d.id, e.message);
  }
}
console.log(JSON.stringify({ docs, itens, parcelas, erros }));
process.exit(0);
