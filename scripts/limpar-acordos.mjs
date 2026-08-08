import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"))) });
const db = getFirestore();
const snap = await db.collection("nfe_agreements").get();
console.log(`Acordos encontrados: ${snap.size}`);
for (const d of snap.docs) {
  const a = d.data();
  console.log(` - ${d.id}: ${a.nomeFornecedor} / ${a.valorAcordado}`);
  await d.ref.delete();
}
console.log("Todos os acordos foram removidos.");
process.exit(0);
