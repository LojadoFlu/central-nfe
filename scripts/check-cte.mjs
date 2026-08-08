import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"))) });
const db = getFirestore();

const docs = await db.collection("cte_documents").get();
const evs = await db.collection("cte_events").get();
console.log(`cte_documents: ${docs.size} | cte_events: ${evs.size}`);
let total = 0;
const amostra = [];
for (const d of docs.docs) {
  const c = d.data();
  total += c.vTPrest ?? 0;
  if (amostra.length < 6) amostra.push({
    ch: (c.chCTe || "").slice(0, 12) + "…",
    emit: c.xNomeEmit,
    vFrete: c.vTPrest,
    dhEmi: c.dhEmi,
    nCT: c.nCT,
    rota: `${c.ufIni || "?"}→${c.ufFim || "?"}`,
    completo: c.temXmlCompleto,
  });
}
console.log("Total em fretes (vTPrest):", total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
console.log(JSON.stringify(amostra, null, 2));
process.exit(0);
