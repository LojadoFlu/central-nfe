import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"))) });
const db = getFirestore();
const alvo = "59255964000123";
const snap = await db.collection("nfe_companies").get();
for (const d of snap.docs) {
  const c = d.data();
  if ((c.cnpj || "").replace(/\D/g, "") === alvo) {
    await d.ref.set({ ambiente: "producao", updatedAt: new Date().toISOString() }, { merge: true });
    await db.collection("nfe_sync_state").doc(d.id).set({ proximaSync: null }, { merge: true });
    console.log(`OK: empresa ${d.id} (${c.razaoSocial}) -> ambiente=producao; recuo limpo.`);
  }
}
process.exit(0);
