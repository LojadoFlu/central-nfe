import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { readFileSync } from "node:fs";
initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccountKey.json","utf8"))), storageBucket:"central-nfe-1c8d8.firebasestorage.app" });
const db = getFirestore();
const snap = await db.collection("nfe_documents").where("companyId","==","59255964000123").where("temXmlCompleto","==",true).limit(1).get();
const doc = snap.docs[0].data();
const [buf] = await getStorage().bucket().file(doc.storagePath).download();
const xml = buf.toString("utf8");
const sig = (xml.match(/<Signature[\s\S]*?<\/Signature>/)||[])[0]||"(sem assinatura)";
// mostra só a parte estrutural (SignedInfo), sem os valores grandes
const signedInfo = (sig.match(/<SignedInfo[\s\S]*?<\/SignedInfo>/)||[])[0];
console.log("=== SignedInfo da NF-e REAL (aceita pela SEFAZ) ===");
console.log(signedInfo);
console.log("\n=== KeyInfo (estrutura) ===");
console.log((sig.match(/<KeyInfo>[\s\S]*?<X509Certificate>/)||[])[0]);
console.log("\n=== usa prefixo ds:? ===", /<ds:Signature|<ds:SignedInfo/.test(xml));
