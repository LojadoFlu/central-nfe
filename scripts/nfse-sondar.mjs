import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";

const key = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(key) });
const uid = "7Z7JolU0hqUIIfzbkt85jwyko4l2";
const API_KEY = "AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY";
const companyId = "59255964000123";

const ambiente = process.argv[2] || "homologacao"; // homologacao (prod restrita) | producao
const nsu = process.argv[3] || "0";

const customToken = await getAuth().createCustomToken(uid);
const ex = await (
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  })
).json();
if (!ex.idToken) { console.log("TOKEN_FAIL", ex.error); process.exit(1); }

const url = "https://southamerica-east1-central-nfe-1c8d8.cloudfunctions.net/nfseSondarContrato";
console.log(`Sondando ADN NFS-e (${ambiente}, NSU ${nsu})...`);
const r = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${ex.idToken}` },
  body: JSON.stringify({ data: { companyId, ambiente, nsu } }),
});
const j = await r.json();
const res = j.result ?? j;
console.log("HTTP callable:", r.status);
console.log("httpStatus ADN:", res.httpStatus, "| status:", res.status, "| qtd:", res.qtd, "| erro:", res.erro ?? "—");
console.log("campos do item:", JSON.stringify(res.camposItem));
console.log("---- bodyHead ----");
console.log(res.bodyHead ?? res.body ?? "(vazio)");
console.log("---- primeiro XML (decodificado) ----");
console.log(res.primeiroXml ?? "(sem doc)");
process.exit(0);
