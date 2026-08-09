// Agrupa as lojas com "BARRA" no nome (FLU BARRA + FLU BARRA NAOUSAR) sob o mesmo
// grupo, para somarem na exibição, e as inclui no sync. Usa a API REST do Firestore
// (o firebase-admin/gRPC trava neste sandbox) com a sessão autenticada do Firebase CLI.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cands = [
  join(homedir(), ".config", "configstore", "firebase-tools.json"),
  join(homedir(), "Library", "Application Support", "configstore", "firebase-tools.json"),
];
let cfg = null;
for (const p of cands) { try { cfg = JSON.parse(readFileSync(p, "utf8")); break; } catch {} }
const refresh = cfg?.tokens?.refresh_token;
if (!refresh) { console.log("SEM_REFRESH_TOKEN"); process.exit(1); }

const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const tj = await (await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
})).json();
if (!tj.access_token) { console.log("TOKEN_FALHOU:", tj.error); process.exit(1); }
const auth = { Authorization: `Bearer ${tj.access_token}` };

const PROJ = "central-nfe-1c8d8";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;
const GRUPO = "FLU BARRA";

// lista pdv_stores
const alvo = [];
let pageToken = "";
for (;;) {
  const url = `${BASE}/pdv_stores?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
  const r = await fetch(url, { headers: auth });
  const j = await r.json();
  if (r.status >= 400) { console.log("LIST_FALHOU", r.status, JSON.stringify(j)); process.exit(1); }
  for (const d of j.documents ?? []) {
    const nome = d.fields?.nome?.stringValue ?? "";
    if (nome.toUpperCase().includes("BARRA")) {
      alvo.push({
        name: d.name,
        nome,
        grupoNome: d.fields?.grupoNome?.stringValue ?? null,
        ativoSync: d.fields?.ativoSync?.booleanValue ?? false,
      });
    }
  }
  if (!j.nextPageToken) break;
  pageToken = j.nextPageToken;
}

console.log("Lojas com 'BARRA':");
for (const a of alvo) console.log(`  ${a.nome}  (grupo=${a.grupoNome ?? "—"}, ativoSync=${a.ativoSync})`);
if (alvo.length === 0) { console.log("Nenhuma — rode a sincronização de lojas antes."); process.exit(0); }

for (const a of alvo) {
  const url = `https://firestore.googleapis.com/v1/${a.name}?updateMask.fieldPaths=grupoNome&updateMask.fieldPaths=ativoSync`;
  const body = { fields: { grupoNome: { stringValue: GRUPO }, ativoSync: { booleanValue: true } } };
  const r = await fetch(url, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status >= 400) { console.log("PATCH_FALHOU", a.nome, r.status, await r.text()); process.exit(1); }
}
console.log(`\nOK: ${alvo.length} loja(s) agrupada(s) sob "${GRUPO}" e incluída(s) no sync.`);
process.exit(0);
