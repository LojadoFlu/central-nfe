import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";

const key = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(key) });

const uid = "7Z7JolU0hqUIIfzbkt85jwyko4l2"; // lojafluminense@outlook.com (admin)
const API_KEY = "AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY";
const companyId = "59255964000123";

const customToken = await getAuth().createCustomToken(uid);
const ex = await (
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  })
).json();
if (!ex.idToken) { console.log("TOKEN_FAIL", ex.error); process.exit(1); }

const url = "https://southamerica-east1-central-nfe-1c8d8.cloudfunctions.net/nfeSincronizarAgora";
console.log("Disparando sincronização em PRODUÇÃO...");
const r = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${ex.idToken}` },
  body: JSON.stringify({ data: { companyId } }),
});
const j = await r.json();
console.log("HTTP", r.status);
console.log(JSON.stringify(j.result ?? j, null, 2));
process.exit(0);
