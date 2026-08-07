import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

/** Região das Functions (mesma dos apps irmãos). */
export const REGIAO = "southamerica-east1";

if (!getApps().length) initializeApp();

export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export type Role = "admin" | "fiscal" | "financeiro" | "consulta";

/** Exige autenticação e (opcionalmente) um dos papéis. Lança HttpsError. */
export function exigirRole(req: CallableRequest, roles: Role[]): {
  uid: string;
  role: Role;
} {
  const uid = req.auth?.uid;
  const role = req.auth?.token?.role as Role | undefined;
  if (!uid) throw new HttpsError("unauthenticated", "Autenticação necessária.");
  if (!role || !roles.includes(role)) {
    throw new HttpsError("permission-denied", "Permissão insuficiente.");
  }
  return { uid, role };
}

/** Só dígitos. */
export function somenteDigitos(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** CNPJ base (8 primeiros dígitos) — chave de autenticação na SEFAZ. */
export function cnpjBase(cnpj: string): string {
  return somenteDigitos(cnpj).slice(0, 8);
}

export function agoraISO(): string {
  return new Date().toISOString();
}
