// Normaliza `sales.valorTotal` para o LÍQUIDO (sem o desconto do caixa).
//
// O `ValorTotal` do PDVnet vem sem o desconto descontado: venda de 549,98 com
// 55,00 de desconto chega 549,98, e o cliente pagou 494,98. A sync passou a
// gravar o líquido e a guardar o cru em `valorTotalPdv`; este script arruma as
// vendas gravadas antes disso.
//
// Idempotente: quem já tem `valorTotalPdv` não é tocado.
//
//   node scripts/normalizar-vendas-desconto.mjs           (simulação)
//   node scripts/normalizar-vendas-desconto.mjs --gravar  (grava)

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"))) });
const db = getFirestore();
const gravar = process.argv.includes("--gravar");
const cent = (n) => Math.round(n * 100) / 100;

const snap = await db.collection("sales").get();
let jaOk = 0;
let mudam = 0;
let antes = 0;
let depois = 0;
let batch = db.batch();
let ops = 0;
const porMes = new Map();

for (const doc of snap.docs) {
  const s = doc.data();
  if (s.valorTotalPdv != null) {
    jaOk++;
    continue;
  }
  const total = Number(s.valorTotal) || 0;
  const desconto = (Number(s.valorDesconto) || 0) + (Number(s.valorDescontoPromocional) || 0);
  const liquido = cent(total - desconto);
  antes += total;
  depois += liquido;
  if (desconto !== 0) {
    const mes = String(s.dia ?? "").slice(0, 7);
    porMes.set(mes, cent((porMes.get(mes) ?? 0) + desconto));
    mudam++;
  }
  if (gravar) {
    batch.set(doc.ref, { valorTotal: liquido, valorTotalPdv: total }, { merge: true });
    ops++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
}
if (gravar && ops > 0) await batch.commit();

console.log(`vendas: ${snap.size} · já normalizadas: ${jaOk} · com desconto a tirar: ${mudam}`);
console.log(`total antes: ${cent(antes)} · depois: ${cent(depois)} · diferença: ${cent(antes - depois)}`);
for (const [mes, v] of [...porMes].sort()) console.log(`  ${mes}: -${v}`);
console.log(gravar ? "GRAVADO." : "simulação — rode com --gravar para aplicar.");
process.exit(0);
