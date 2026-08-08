import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { readFileSync, writeFileSync } from "node:fs";
const sa = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(sa), storageBucket: `${sa.project_id}.firebasestorage.app` });
const db = getFirestore();

const snap = await db.collection("cte_documents").where("temXmlCompleto", "==", true).limit(5).get();
let i = 0;
for (const d of snap.docs) {
  const c = d.data();
  if (!c.storagePath) continue;
  const [buf] = await getStorage().bucket().file(c.storagePath).download();
  const out = `/private/tmp/claude-501/-Users-rodrigobelluco-Documents-Claude-CRM-Loja-do-Flu/6c289316-9c38-4d0a-8552-3c797ca128d0/scratchpad/cte-${i}.xml`;
  writeFileSync(out, buf.toString("utf8"));
  console.log("salvo:", out, "| emit:", c.xNomeEmit, "| frete:", c.vTPrest);
  i++;
}
process.exit(0);
