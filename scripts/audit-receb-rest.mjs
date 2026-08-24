import { readFileSync } from "node:fs";
import crypto from "node:crypto";
const key = JSON.parse(readFileSync("./serviceAccountKey.json","utf8"));
const PROJECT = key.project_id;
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
async function token() {
  const now = Math.floor(Date.now()/1000);
  const h = b64url(JSON.stringify({ alg:"RS256", typ:"JWT" }));
  const c = b64url(JSON.stringify({ iss:key.client_email, scope:"https://www.googleapis.com/auth/datastore", aud:"https://oauth2.googleapis.com/token", iat:now, exp:now+3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(key.private_key);
  const jwt = `${h}.${c}.${b64url(sig)}`;
  const r = await fetch("https://oauth2.googleapis.com/token",{ method:"POST", headers:{"content-type":"application/x-www-form-urlencoded"}, body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const j = await r.json(); if (!j.access_token) throw new Error("token: "+JSON.stringify(j)); return j.access_token;
}
const TOK = await token();
const URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`;
async function runQuery(collectionId, de, ate, fields) {
  const body = { structuredQuery: { from:[{collectionId}], where:{ compositeFilter:{ op:"AND", filters:[
    {fieldFilter:{field:{fieldPath:"dia"},op:"GREATER_THAN_OR_EQUAL",value:{stringValue:de}}},
    {fieldFilter:{field:{fieldPath:"dia"},op:"LESS_THAN_OR_EQUAL",value:{stringValue:ate}}},
  ]}}, select:{ fields: fields.map(f=>({fieldPath:f})) } } };
  const r = await fetch(URL,{ method:"POST", headers:{ authorization:`Bearer ${TOK}`, "content-type":"application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${collectionId} ${r.status}: ${txt.slice(0,300)}`);
  const arr = JSON.parse(txt);
  const out = [];
  for (const row of arr) { if (!row.document) continue; const f=row.document.fields||{}; const o={ _id: row.document.name.split("/").pop() }; for (const k in f){ const v=f[k]; o[k] = v.stringValue ?? (v.integerValue!=null?Number(v.integerValue):(v.doubleValue!=null?v.doubleValue:(v.booleanValue!=null?v.booleanValue:(v.nullValue!==undefined?null:undefined)))); } out.push(o); }
  return out;
}
const num = (v)=> typeof v==="number"?v:(v==null?0:Number(v)||0);

const DE="2026-08-01", ATE="2026-08-31";
console.log("== Auditoria", DE, "→", ATE, "(projeto", PROJECT+") ==");
const rec = await runQuery("card_receivables", DE, ATE, ["vendaId","valor","parcela","descricaoCartao","dia"]);
const sal = await runQuery("sales", DE, ATE, ["id","valorTotal","cancelada","dia"]);
console.log("docs card_receivables:", rec.length, "| docs sales:", sal.length);

const vendaTotal=new Map(); let totalVendido=0, canc=0;
for (const s of sal){ if (s.cancelada){canc++;continue;} vendaTotal.set(s.id ?? s._id, num(s.valorTotal)); totalVendido+=num(s.valorTotal); }
console.log("Total VENDIDO (não cancelado): R$", totalVendido.toFixed(2), "| canceladas:", canc);

const porVenda=new Map(); let totalReceb=0;
for (const r of rec){ const v=r.vendaId??""; totalReceb+=num(r.valor); const g=porVenda.get(v)??{soma:0,n:0,p:[]}; g.soma+=num(r.valor); g.n++; g.p.push({id:r._id,valor:num(r.valor),parcela:r.parcela,cartao:r.descricaoCartao}); porVenda.set(v,g); }
console.log("TOTAL 'a receber' (card_receivables): R$", totalReceb.toFixed(2));
console.log("Vendas com cartão:", porVenda.size, "| razão receb/vendido:", (totalReceb/totalVendido).toFixed(3));

let imp=0, exc=0; const ex=[];
for (const [v,g] of porVenda){ const vt=vendaTotal.get(v); if (vt==null) continue; if (g.soma>vt+0.5){ imp++; exc+=g.soma-vt; if(ex.length<6) ex.push({v,g,vt}); } }
console.log("\nVendas com SOMA parcelas > valorTotal (impossível → double count):", imp, "| excesso: R$", exc.toFixed(2));
for (const e of ex){ console.log(`  venda ${e.v}: receb R$${e.g.soma.toFixed(2)} vs venda R$${e.vt.toFixed(2)} (${e.g.n} parcelas)`); for(const p of e.g.p) console.log(`     ${p.id} valor=${p.valor} parcela=${p.parcela} ${p.cartao??""}`); }

const dist={}; for (const [,g] of porVenda) dist[g.n]=(dist[g.n]??0)+1;
console.log("\nDistribuição nº parcelas/venda:", JSON.stringify(dist));

// amostra: vendas com 2+ parcelas — Valor é por parcela ou cheio?
console.log("\nAmostra de vendas parceladas (2+ parcelas):");
let shown=0;
for (const [v,g] of porVenda){ if (g.n>=2 && shown<6){ const vt=vendaTotal.get(v); console.log(`  venda ${v} valorTotal=${vt!=null?vt.toFixed(2):"?"} somaParcelas=${g.soma.toFixed(2)} -> ${g.p.map(p=>p.valor).join(" + ")}`); shown++; } }
