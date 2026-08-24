import { readFileSync } from "node:fs";
import crypto from "node:crypto";
const key=JSON.parse(readFileSync("./serviceAccountKey.json","utf8"));const PROJECT=key.project_id;
const b64=(b)=>Buffer.from(b).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const n=Math.floor(Date.now()/1000);const h=b64(JSON.stringify({alg:"RS256",typ:"JWT"}));const c=b64(JSON.stringify({iss:key.client_email,scope:"https://www.googleapis.com/auth/datastore",aud:"https://oauth2.googleapis.com/token",iat:n,exp:n+3600}));const s=crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(key.private_key);
const TOK=(await (await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${h}.${c}.${b64(s)}`})).json()).access_token;
const U=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`;
async function all(cid){const body={structuredQuery:{from:[{collectionId:cid}]}};const r=await fetch(U,{method:"POST",headers:{authorization:`Bearer ${TOK}`,"content-type":"application/json"},body:JSON.stringify(body)});const arr=JSON.parse(await r.text());const out=[];for(const row of arr){if(!row.document)continue;const f=row.document.fields||{};const o={_id:row.document.name.split("/").pop()};for(const k in f){const v=f[k];o[k]=v.stringValue??(v.integerValue!=null?Number(v.integerValue):(v.doubleValue!=null?v.doubleValue:(v.booleanValue!=null?v.booleanValue:null)));}out.push(o);}return out;}
const tx=await all("bank_transactions");
// bank_accounts p/ ver quantas contas/imports
const acc=await all("bank_accounts");
console.log("bank_accounts docs:",acc.length);
for(const a of acc) console.log("  ",a._id,"| empresaId:",a.empresaId,"| banco:",a.banco??a.org??"?","| período:",a.dtStart??"?","→",a.dtEnd??"?","| saldo:",a.saldo,"| transacoes:",a.transacoes??a.total??"?");
// cross-empresa fitids
const porFitid=new Map();
for(const t of tx){ const fit=t._id.split("_").slice(1).join("_"); const a=porFitid.get(fit)??[]; a.push(t); porFitid.set(fit,a); }
let shown=0;
console.log("\nExemplos de MESMO FITID em empresas diferentes:");
for(const [f,a] of porFitid){ const emps=new Set(a.map(x=>x.empresaId)); if(emps.size>1 && shown<6){ shown++; console.log(`  fitid ${f.slice(0,30)} em ${emps.size} empresas:`); for(const t of a) console.log(`     empresa=${t.empresaId} ${t.data} R$${t.valor} | ${String(t.memo??"").slice(0,45)}`); } }
// distribuição de nº de empresas por fitid
const dist={}; for(const [,a] of porFitid){const e=new Set(a.map(x=>x.empresaId)).size; dist[e]=(dist[e]??0)+1;}
console.log("\nfitids por nº de empresas:",JSON.stringify(dist));
