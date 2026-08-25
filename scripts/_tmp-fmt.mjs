import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
const key = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(key) });
const API_KEY = "AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY";
const customToken = await getAuth().createCustomToken("7Z7JolU0hqUIIfzbkt85jwyko4l2");
const ex = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) })).json();
const r = await fetch("https://southamerica-east1-central-nfe-1c8d8.cloudfunctions.net/pdvnetItensVenda", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ex.idToken}` }, body: JSON.stringify({ data: { dia: "2026-08-17", ids: ["37134260817100921", "37134260817101228"] } }) });
const j = (await r.json()).result;
const brl = (v) => "R$ " + Number(v ?? 0).toFixed(2);
for (const id of Object.keys(j.achadas)) {
  const v = j.achadas[id];
  console.log("\n==================================================================");
  console.log(`Venda ${id} | ${v.dataHora} | vendedor ${v.vendedorId}`);
  console.log(`total ${brl(v.valorTotal)} | desconto ${brl(v.valorDesconto)}`);
  console.log("seq | variacaoId       | qtd | preço unit | desconto  | líquido | custo(ger)");
  let somaCusto = 0;
  for (const it of v.itens) {
    somaCusto += Number(it.custoGerencial ?? 0) * Number(it.qtd ?? 0);
    console.log(
      `${String(it.seq).padStart(3)} | ${String(it.variacaoId).padEnd(15)} | ${String(it.qtd).padStart(3)} | ${brl(it.preco).padStart(10)} | ${brl(it.desconto).padStart(9)} | ${brl(it.precoLiquido).padStart(7)} | ${brl(it.custoGerencial)}`
    );
  }
  console.log(`>> custo total dos itens (gerencial): ${brl(somaCusto)}`);
}
if (j.faltantes?.length) console.log("\nNÃO ACHADAS:", j.faltantes);
process.exit(0);
