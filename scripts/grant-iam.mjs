// Concede Secret Manager Admin à conta de runtime das Functions, usando a
// sessão já autenticada do Firebase CLI (mesma conta dona do projeto).
// Os tokens NUNCA são impressos.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const candidates = [
  join(homedir(), ".config", "configstore", "firebase-tools.json"),
  join(homedir(), "Library", "Application Support", "configstore", "firebase-tools.json"),
];
let cfg = null;
for (const p of candidates) {
  try { cfg = JSON.parse(readFileSync(p, "utf8")); break; } catch {}
}
if (!cfg) { console.log("NAO_ACHEI_CONFIG_DO_FIREBASE_CLI"); process.exit(0); }
const refresh = cfg.tokens?.refresh_token;
const account = cfg.user?.email || "(desconhecido)";
if (!refresh) { console.log("SEM_REFRESH_TOKEN (conta:", account, ")"); process.exit(0); }

const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const tr = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: refresh, grant_type: "refresh_token",
  }),
});
const tj = await tr.json();
if (!tj.access_token) { console.log("TOKEN_FALHOU:", tj.error, tj.error_description || ""); process.exit(0); }
const access = tj.access_token;

const PROJECT = "central-nfe-1c8d8";
const SA = "serviceAccount:1098789086301-compute@developer.gserviceaccount.com";
const ROLE = "roles/secretmanager.admin";
const base = `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`;
const H = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };

console.log("Conta do Firebase CLI:", account);
const pol = await (await fetch(`${base}:getIamPolicy`, { method: "POST", headers: H, body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }) })).json();
if (pol.error) { console.log("GET_FALHOU:", pol.error.status, "-", pol.error.message); process.exit(0); }
pol.bindings = pol.bindings || [];
let b = pol.bindings.find((x) => x.role === ROLE);
if (b && b.members.includes(SA)) { console.log("JA_TINHA a permissão."); process.exit(0); }
if (!b) { b = { role: ROLE, members: [] }; pol.bindings.push(b); }
b.members.push(SA);
const setj = await (await fetch(`${base}:setIamPolicy`, { method: "POST", headers: H, body: JSON.stringify({ policy: pol }) })).json();
if (setj.error) { console.log("SET_FALHOU:", setj.error.status, "-", setj.error.message); process.exit(0); }
console.log("IAM_OK: Secret Manager Admin concedido à conta de runtime das Functions.");
process.exit(0);
