// Habilita a Secret Manager API no projeto, usando a sessão do Firebase CLI.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const candidates = [
  join(homedir(), ".config", "configstore", "firebase-tools.json"),
  join(homedir(), "Library", "Application Support", "configstore", "firebase-tools.json"),
];
let cfg = null;
for (const p of candidates) { try { cfg = JSON.parse(readFileSync(p, "utf8")); break; } catch {} }
const refresh = cfg?.tokens?.refresh_token;
if (!refresh) { console.log("SEM_REFRESH_TOKEN"); process.exit(0); }

const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const tj = await (await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
})).json();
if (!tj.access_token) { console.log("TOKEN_FALHOU:", tj.error); process.exit(0); }

const PROJECT = "central-nfe-1c8d8";
const r = await fetch(
  `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/secretmanager.googleapis.com:enable`,
  { method: "POST", headers: { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" }, body: "{}" },
);
const j = await r.json();
if (j.error) { console.log("FALHOU:", j.error.status, "-", j.error.message); process.exit(0); }
console.log("OK: Secret Manager API habilitada. Aguarde ~1-2 min para propagar e tente o certificado de novo.");
process.exit(0);
