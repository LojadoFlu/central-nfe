import { readFileSync } from "node:fs";
import crypto from "node:crypto";
const key=JSON.parse(readFileSync("./serviceAccountKey.json","utf8"));const PROJECT=key.project_id;
const b64=(b)=>Buffer.from(b).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const n=Math.floor(Date.now()/1000);const h=b64(JSON.stringify({alg:"RS256",typ:"JWT"}));const c=b64(JSON.stringify({iss:key.client_email,scope:"https://www.googleapis.com/auth/datastore",aud:"https://oauth2.googleapis.com/token",iat:n,exp:n+3600}));const s=crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(key.private_key);
const TOK=(await (await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${h}.${c}.${b64(s)}`})).json()).access_token;
const U=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`;
async function all(cid){const body={structuredQuery:{from:[{collectionId:cid}]}};const r=await fetch(U,{method:"POST",headers:{authorization:`Bearer ${TOK}`,"content-type":"application/json"},body:JSON.stringify(body)});const arr=JSON.parse(await r.text());const out=[];for(const row of arr){if(!row.document)continue;const f=row.document.fields||{};const o={_id:row.document.name.split("/").pop()};for(const k in f){const v=f[k];o[k]=v.stringValue??(v.integerValue!=null?Number(v.integerValue):(v.doubleValue!=null?v.doubleValue:(v.booleanValue!=null?v.booleanValue:null)));}out.push(o);}return out;}
const tx=await all("bank_transactions");
// agrupa por empresa + data + valor + memo
const g=new Map();
for(const t of tx){const k=`${t.empresaId}||${t.data}||${t.valor}||${String(t.memo??"").slice(0,40)}`;const a=g.get(k)??[];a.push(t);g.set(k,a);}
let dupGroups=0, dupExtra=0, dupValor=0;
const ex=[];
for(const [k,a] of g){ if(a.length>1){ dupGroups++; dupExtra+=a.length-1; dupValor += (a.length-1)*Math.abs(Number(a[0].valor)||0); if(ex.length<10) ex.push([k,a]); } }
console.log("Grupos com duplicata (mesma empresa/data/valor/memo):",dupGroups);
console.log("Lançamentos EXCEDENTES (duplicados):",dupExtra,"| impacto |valor|: R$",dupValor.toFixed(2));
console.log("\nExemplos (fitids diferentes p/ mesma transação?):");
for(const [k,a] of ex){ const [emp,data,valor,memo]=k.split("||"); console.log(`  ${data} R$${valor} "${memo}" x${a.length}`); for(const t of a) console.log(`       _id=${t._id}`); }
// checagem: mesmos fitids em empresas diferentes?
const porFitid=new Map();
for(const t of tx){ const fit=t._id.split("_").slice(1).join("_"); const a=porFitid.get(fit)??new Set(); a.add(t.empresaId); porFitid.set(fit,a); }
let fitCross=0; for(const [f,emps] of porFitid) if(emps.size>1) fitCross++;
console.log("\nFITIDs presentes em +1 empresa:",fitCross,"(esperado 0 se cada extrato é de uma conta)");
