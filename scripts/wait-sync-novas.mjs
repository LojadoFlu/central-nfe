import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const sa = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const API_KEY = "AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY";
const uid = "7Z7JolU0hqUIIfzbkt85jwyko4l2";
const NOVAS = ["30623074000145", "54224772000136"]; // 4 Flu (Laranjeiras), 4 de Novembro (Tijuca)

async function token() {
  const ct = await getAuth().createCustomToken(uid);
  const ex = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: ct, returnSecureToken: true }),
  })).json();
  return ex.idToken;
}
async function chamar(fn, idToken, companyId) {
  const r = await fetch(`https://southamerica-east1-central-nfe-1c8d8.cloudfunctions.net/${fn}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: { companyId } }),
  });
  const j = await r.json();
  return j.result ?? j;
}

// Espera o recuo 656 passar (polling).
const alvoLiberar = async () => {
  for (const id of NOVAS) {
    const st = (await db.collection("nfe_sync_state").doc(id).get()).data() || {};
    if (st.proximaSync && new Date(st.proximaSync).getTime() > Date.now()) return false;
  }
  return true;
};

let esperas = 0;
while (!(await alvoLiberar()) && esperas < 45) {
  esperas++;
  await new Promise((r) => setTimeout(r, 120000)); // 2 min
}
console.log("Recuo liberado. Sincronizando as novas lojas...");

const idToken = await token();
for (const companyId of NOVAS) {
  const nfe = await chamar("nfeSincronizarAgora", idToken, companyId);
  const cte = await chamar("cteSincronizarAgora", idToken, companyId);
  const nfse = await chamar("nfseSincronizarAgora", idToken, companyId);
  console.log(`\n=== ${companyId} ===`);
  console.log("  NF-e :", JSON.stringify(nfe));
  console.log("  CT-e :", JSON.stringify(cte));
  console.log("  NFS-e:", JSON.stringify(nfse));
}
process.exit(0);
