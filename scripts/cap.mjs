import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json","utf8"))) });
const API_KEY="AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY", base="https://southamerica-east1-central-nfe-1c8d8.cloudfunctions.net";
const ct=await getAuth().createCustomToken("7Z7JolU0hqUIIfzbkt85jwyko4l2");
const ex=await(await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:ct,returnSecureToken:true})})).json();
const texto=readFileSync("/Users/rodrigobelluco/Desktop/despesasfixas.csv","utf8");
let res;
for(let i=0;i<8;i++){const r=await fetch(`${base}/importarContasPagar`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${ex.idToken}`},body:JSON.stringify({data:{texto,dryRun:true}})});if(r.status===200){const j=await r.json();if(j.error){console.log("ERRO",JSON.stringify(j.error));process.exit(1);}res=j.result;break;}console.log("HTTP",r.status);await new Promise(x=>setTimeout(x,15000));}
if(!res){console.log("falhou");process.exit(1);}
const M=n=>"R$ "+n.toLocaleString("pt-BR",{minimumFractionDigits:2});
console.log(`PRÉVIA (dryRun): ${res.resumo.qtd} títulos · ${M(res.resumo.total)} · venc ${res.resumo.periodo.de} → ${res.resumo.periodo.ate} · sem empresa: ${res.resumo.semEmpresa}`);
console.log("\npor categoria:");
res.resumo.porCategoria.forEach(c=>console.log(`  ${c.categoria.padEnd(24)} ${String(c.qtd).padStart(4)} · ${M(c.valor)}`));
console.log("\npor loja:");
res.resumo.porLoja.forEach(c=>console.log(`  ${c.loja.padEnd(20)} ${String(c.qtd).padStart(4)} · ${M(c.valor)}`));
process.exit(0);
