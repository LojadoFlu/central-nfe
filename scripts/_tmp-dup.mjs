import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json","utf8"))) });
const db = getFirestore();
const fun = (await db.collection("com_funcionarios").get()).docs.map(d=>({id:d.id,...d.data()}));
const donoDoCodigo = new Map();
for (const f of fun) for (const c of f.pdvVendedorIds ?? []) if (c !== f.pdvVendedorId) donoDoCodigo.set(c, f);
const dups = fun.filter(f => f.pdvVendedorId && donoDoCodigo.has(f.pdvVendedorId) && donoDoCodigo.get(f.pdvVendedorId).id !== f.id);
for (const d of dups) {
  const metas = (await db.collection("com_metas").where("funcionarioId","==",d.id).get()).size;
  const aj = (await db.collection("com_ajustes").where("funcionarioId","==",d.id).get()).size;
  console.log(`${d.nome} (${d.id}) cod=${d.pdvVendedorId} cargo=${d.cargoId} criadoEm=${d.atualizadoEm} metas=${metas} ajustes=${aj} → duplicata de ${donoDoCodigo.get(d.pdvVendedorId).nome}`);
}
const fech = (await db.collection("com_fechamentos").get()).docs.map(d=>({id:d.id,status:d.data().status}));
console.log("fechamentos:", JSON.stringify(fech));
if (process.argv[2] === "--apagar") {
  for (const d of dups) await db.collection("com_funcionarios").doc(d.id).delete();
  console.log("apagados:", dups.length);
}
process.exit(0);
