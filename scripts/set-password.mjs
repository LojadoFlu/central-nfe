// Redefine a senha de um usuário (via Admin SDK), sem precisar do console.
// Uso: node scripts/set-password.mjs email@dominio.com
// Requer serviceAccountKey.json na pasta do projeto (já git-ignored) e firebase-admin.
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync, existsSync } from "node:fs";
import * as readline from "node:readline";

const email = process.argv[2];
if (!email) {
  console.error("Uso: node scripts/set-password.mjs <email>");
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json";
initializeApp(
  existsSync(keyPath)
    ? { credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))) }
    : { credential: applicationDefault() },
);

// Pergunta a senha mascarando com asteriscos.
function perguntarSenha(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (buf) => {
      const s = buf.toString();
      if (s === "\n" || s === "\r" || s === "") {
        process.stdin.removeListener("data", onData);
      } else {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(prompt + "*".repeat(rl.line.length));
      }
    };
    process.stdin.on("data", onData);
    rl.question(prompt, (value) => {
      rl.close();
      process.stdout.write("\n");
      resolve(value);
    });
  });
}

const senha = await perguntarSenha("Nova senha (mínimo 6 caracteres): ");
if (!senha || senha.length < 6) {
  console.error("Senha muito curta (mínimo 6 caracteres).");
  process.exit(1);
}

const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.updateUser(user.uid, { password: senha });
console.log(`OK: senha redefinida para ${email}.`);

// Testa o login com a senha recém-definida (API pública do Firebase Auth).
const API_KEY = "AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY";
try {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
    },
  );
  const j = await r.json();
  if (j.idToken) {
    console.log("✅ Login testado com ESTA senha: FUNCIONA.");
    console.log("   Use exatamente essa senha no site (digitando à mão).");
  } else {
    console.log("⚠️ O teste de login falhou:", j.error?.message);
  }
} catch (e) {
  console.log("(não deu pra testar o login automaticamente:", e.message, ")");
}
process.exit(0);
