import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"))) });
const db = getFirestore();
const id = "59255964000123";
const st = (await db.collection("nfe_sync_state").doc(id).get()).data() || {};
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const agora = new Date();
console.log("Agora (RJ):        ", agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));
console.log("Última sync:       ", fmt(st.ultimaSync));
console.log("Último cStat:      ", st.ultimoCStat ?? "—");
console.log("Próxima liberação: ", fmt(st.proximaSync));
if (st.proximaSync) {
  const faltaMin = Math.ceil((new Date(st.proximaSync).getTime() - agora.getTime()) / 60000);
  console.log(faltaMin > 0 ? `Faltam ~${faltaMin} min para liberar.` : "LIBERADO — pode sincronizar.");
}
console.log("ultNSU:", st.ultNSU ?? "0", "| maxNSU:", st.maxNSU ?? "0");
process.exit(0);
