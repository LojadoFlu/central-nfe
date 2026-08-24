import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const KEY = "/Users/rodrigobelluco/Documents/Claude/CRM Loja do Flu/central-nfe/serviceAccountKey.json";
initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, "utf8"))) });
const db = getFirestore();
db.settings({ preferRest: true }); // HTTP em vez de gRPC (não trava no sandbox)

const snap = await db.collection("sale_payments").where("forma", "==", "deposito").get();

const porEmpresa = {};       // onde a venda foi feita
const porConcilia = {};      // conta que recebe (destino do dinheiro)
let total = 0, qtd = 0;
const dias = new Set();
snap.forEach((d) => {
  const x = d.data();
  const v = Number(x.valor ?? 0) || 0;
  total += v; qtd++;
  if (x.dia) dias.add(x.dia);
  const e = x.empresaId ?? "(sem empresaId)";
  const c = x.conciliaEmpresaId ?? x.empresaId ?? "(sem conciliaEmpresaId)";
  porEmpresa[e] = (porEmpresa[e] ?? 0) + v;
  porConcilia[c] = (porConcilia[c] ?? 0) + v;
});

const diasArr = [...dias].sort();
console.log(JSON.stringify({
  qtdRegistros: qtd,
  totalDeposito: Math.round(total * 100) / 100,
  periodo: diasArr.length ? { de: diasArr[0], ate: diasArr[diasArr.length - 1], nDias: diasArr.length } : null,
  porEmpresaId: porEmpresa,
  porConciliaEmpresaId: porConcilia,
}, null, 2));
process.exit(0);
