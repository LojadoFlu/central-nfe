import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
const key = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(key) });
const uid = "7Z7JolU0hqUIIfzbkt85jwyko4l2";
const API_KEY = "AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY";
const ct = await getAuth().createCustomToken(uid);
const ex = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: ct, returnSecureToken: true }),
})).json();
if (!ex.idToken) { console.log("TOKEN_FAIL", ex.error); process.exit(1); }
const url = "https://southamerica-east1-central-nfe-1c8d8.cloudfunctions.net/nfeManifestar";
const body = { data: { companyId: "59255964000123", chNFe: "35260657655941000180550010000017191445326722", tpEvento: "210210" } };
console.log("Enviando Ciência da Operação...");
const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ex.idToken}` }, body: JSON.stringify(body) });
const txt = await r.text();
console.log("HTTP", r.status);
try { const j = JSON.parse(txt); console.log(JSON.stringify(j.result ?? j, null, 2)); }
catch { console.log(txt.slice(0, 400)); }
process.exit(0);
