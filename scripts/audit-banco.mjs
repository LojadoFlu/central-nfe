import { readFileSync } from "node:fs";
import crypto from "node:crypto";
const key=JSON.parse(readFileSync("./serviceAccountKey.json","utf8"));const PROJECT=key.project_id;
const b64=(b)=>Buffer.from(b).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const n=Math.floor(Date.now()/1000);const h=b64(JSON.stringify({alg:"RS256",typ:"JWT"}));const c=b64(JSON.stringify({iss:key.client_email,scope:"https://www.googleapis.com/auth/datastore",aud:"https://oauth2.googleapis.com/token",iat:n,exp:n+3600}));const s=crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(key.private_key);
const TOK=(await (await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${h}.${c}.${b64(s)}`})).json()).access_token;
const U=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`;
// pega TODOS os bank_transactions (sem filtro de data)
async function all(cid){const body={structuredQuery:{from:[{collectionId:cid}]}};const r=await fetch(U,{method:"POST",headers:{authorization:`Bearer ${TOK}`,"content-type":"application/json"},body:JSON.stringify(body)});const arr=JSON.parse(await r.text());const out=[];for(const row of arr){if(!row.document)continue;const f=row.document.fields||{};const o={_id:row.document.name.split("/").pop()};for(const k in f){const v=f[k];o[k]=v.stringValue??(v.integerValue!=null?Number(v.integerValue):(v.doubleValue!=null?v.doubleValue:(v.booleanValue!=null?v.booleanValue:null)));}out.push(o);}return out;}
const num=(v)=>typeof v==="number"?v:(v==null?0:Number(v)||0);
const tx=await all("bank_transactions");
console.log("total bank_transactions:",tx.length);
const porEmp=new Map();
for(const t of tx){const e=t.empresaId??"?";const g=porEmp.get(e)??{n:0,cred:0,deb:0,zero:0,min:"9999",max:"0"};g.n++;const v=num(t.valor);if(v>0)g.cred+=v;else if(v<0)g.deb+=v;else g.zero++;const d=String(t.data??"");if(d&&d<g.min)g.min=d;if(d>g.max)g.max=d;porEmp.set(e,g);}
for(const [e,g] of porEmp){console.log(`\nempresa ${e}: ${g.n} lançamentos | ${g.min}→${g.max}`);console.log(`  créditos R$ ${g.cred.toFixed(2)} | débitos R$ ${g.deb.toFixed(2)} | saldoMov R$ ${(g.cred+g.deb).toFixed(2)} | ZERADOS: ${g.zero}`);}
// amostra
console.log("\nAmostra (10):");
for(const t of tx.slice(0,10)) console.log(`  ${t.data} valor=${t.valor} tipo=${t.tipo} cat=${t.categoria} | ${String(t.memo??"").slice(0,50)}`);
// maiores valores absolutos
console.log("\nTop 8 por |valor|:");
for(const t of [...tx].sort((a,b)=>Math.abs(num(b.valor))-Math.abs(num(a.valor))).slice(0,8)) console.log(`  ${t.data} valor=${t.valor} | ${String(t.memo??"").slice(0,55)}`);
