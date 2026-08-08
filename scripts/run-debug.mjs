import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync, writeFileSync } from "node:fs";
initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json","utf8"))) });
const API_KEY="AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY";
const ct=await getAuth().createCustomToken("7Z7JolU0hqUIIfzbkt85jwyko4l2");
const ex=await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:ct,returnSecureToken:true})})).json();
const r=await fetch("https://southamerica-east1-central-nfe-1c8d8.cloudfunctions.net/nfeDebugFetch",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${ex.idToken}`},body:JSON.stringify({data:{companyId:"59255964000123",url:"https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx?wsdl"}})});
console.log("HTTP", r.status);
const txt=await r.text();
try { const j=JSON.parse(txt); const b=(j.result??j).body||""; writeFileSync("/tmp/evt.wsdl",b); console.log("WSDL salvo,", b.length, "chars"); }
catch { console.log("nao-JSON:", txt.slice(0,150)); }
