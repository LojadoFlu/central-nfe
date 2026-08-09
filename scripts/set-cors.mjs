// Configura CORS no bucket do Storage para permitir o app (Netlify + localhost)
// ler os XMLs. Usa a sessão autenticada do Firebase CLI.
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

const bucket = "central-nfe-1c8d8.firebasestorage.app";
const cors = [
  {
    origin: ["https://financeirolojadoflu.netlify.app", "https://arquiveiflu.netlify.app", "http://localhost:3000"],
    method: ["GET", "HEAD"],
    responseHeader: ["Content-Type", "Content-Length", "Content-Disposition"],
    maxAgeSeconds: 3600,
  },
];
const r = await fetch(
  `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?fields=cors`,
  { method: "PATCH", headers: { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ cors }) },
);
const j = await r.json();
if (r.status >= 400) { console.log("FALHOU", r.status, JSON.stringify(j)); process.exit(0); }
console.log("OK: CORS aplicado no bucket.");
console.log(JSON.stringify(j));
process.exit(0);
