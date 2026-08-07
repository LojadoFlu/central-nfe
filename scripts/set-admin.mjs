// Define o custom claim de papel (role) de um usuário — necessário para o RBAC.
// Uso:
//   node scripts/set-admin.mjs email@dominio.com            (define role=admin)
//   node scripts/set-admin.mjs email@dominio.com fiscal     (outro papel)
//
// Requer uma chave de service account do projeto Firebase:
//   - defina GOOGLE_APPLICATION_CREDENTIALS com o caminho do JSON, OU
//   - coloque o arquivo em ./serviceAccountKey.json (já está no .gitignore).
// Requer firebase-admin instalado (ex.: `npm i firebase-admin`).
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync, existsSync } from "node:fs";

const email = process.argv[2];
const role = process.argv[3] || "admin";
const validos = ["admin", "fiscal", "financeiro", "consulta"];

if (!email) {
  console.error("Uso: node scripts/set-admin.mjs <email> [admin|fiscal|financeiro|consulta]");
  process.exit(1);
}
if (!validos.includes(role)) {
  console.error(`Papel inválido: ${role}. Use um de: ${validos.join(", ")}`);
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json";
initializeApp(
  existsSync(keyPath)
    ? { credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))) }
    : { credential: applicationDefault() },
);

const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { role });
console.log(`OK: ${email} agora tem role="${role}".`);
console.log("Peça para o usuário sair e entrar de novo (ou recarregar) para o token atualizar.");
process.exit(0);
