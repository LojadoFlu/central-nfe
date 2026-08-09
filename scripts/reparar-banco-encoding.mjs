// Repara o mojibake (UTF-8 lido como Windows-1252) nos bank_transactions já
// importados e recalcula a categoria. Usa REST do Firestore (batch :commit).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cands = [
  join(homedir(), ".config", "configstore", "firebase-tools.json"),
  join(homedir(), "Library", "Application Support", "configstore", "firebase-tools.json"),
];
let cfg = null;
for (const p of cands) { try { cfg = JSON.parse(readFileSync(p, "utf8")); break; } catch {} }
const tj = await (await fetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi", refresh_token: cfg.tokens.refresh_token, grant_type: "refresh_token" }),
})).json();
const auth = { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" };
const PROJ = "central-nfe-1c8d8";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;

const EMP = process.argv[2] || "30623074000145";

function categoriaMemo(memo) {
  const m = (memo || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (m.includes("pix | maquininha")) return "pix_venda";
  if (m.includes("antecipa")) return "cartao_credito";
  if (m.includes("| debito")) return "cartao_debito";
  if (m.includes("devolu")) return "devolucao";
  if (m.includes("mensalidade") || m.includes("tarifa") || m.includes("cobranca")) return "tarifa";
  if (m.includes("transfer")) return "transferencia";
  if (m.includes("pagamento")) return "pagamento";
  return "outros";
}
const repara = (s) => (/[ÃÂ]/.test(s || "") ? Buffer.from(s, "latin1").toString("utf8") : s);

// 1) coleta todos os docs da empresa
const docs = [];
let pageToken = "";
for (;;) {
  const j = await (await fetch(`${DOCS}/bank_transactions?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { headers: auth })).json();
  for (const d of (j.documents || [])) {
    if (d.fields?.empresaId?.stringValue !== EMP) continue;
    docs.push({ name: d.name, memo: d.fields?.memo?.stringValue ?? "" });
  }
  if (!j.nextPageToken) break;
  pageToken = j.nextPageToken;
}
console.log(`docs da empresa ${EMP}:`, docs.length);

// 2) monta writes reparados
const antes = {}, depois = {};
const writes = [];
for (const d of docs) {
  const memoNovo = repara(d.memo);
  const catNova = categoriaMemo(memoNovo);
  antes[categoriaMemo(d.memo)] = (antes[categoriaMemo(d.memo)] || 0) + 1;
  depois[catNova] = (depois[catNova] || 0) + 1;
  writes.push({ update: { name: d.name, fields: { memo: { stringValue: memoNovo }, categoria: { stringValue: catNova } } }, updateMask: { fieldPaths: ["memo", "categoria"] } });
}
console.log("categorias ANTES:", antes);
console.log("categorias DEPOIS:", depois);

// 3) commit em lotes de 400
for (let i = 0; i < writes.length; i += 400) {
  const lote = writes.slice(i, i + 400);
  const r = await fetch(`${DOCS}:commit`, { method: "POST", headers: auth, body: JSON.stringify({ writes: lote }) });
  if (r.status >= 400) { console.log("COMMIT_FALHOU", r.status, (await r.text()).slice(0, 300)); process.exit(1); }
}
// 4) repara org da conta
const acc = await (await fetch(`${DOCS}/bank_accounts/${EMP}`, { headers: auth })).json();
if (acc.fields?.org?.stringValue) {
  await fetch(`${DOCS}/bank_accounts/${EMP}?updateMask.fieldPaths=org`, { method: "PATCH", headers: auth, body: JSON.stringify({ fields: { org: { stringValue: repara(acc.fields.org.stringValue) } } }) });
}
console.log(`OK: ${writes.length} lançamento(s) reparado(s).`);
process.exit(0);
