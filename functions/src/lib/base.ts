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

/**
 * Autoriza uma AÇÃO: aceita papel legado (admin/fiscal/…) OU um perfil custom
 * aprovado (claim status=ativo + roleId) cujo perfil (nfe_roles) contenha a ação.
 * Admin sempre passa. Lança HttpsError se não autorizado.
 */
export async function exigirAcao(
  req: CallableRequest,
  acao: string,
  legacyRoles: Role[],
): Promise<{ uid: string }> {
  const uid = req.auth?.uid;
  const role = req.auth?.token?.role as Role | undefined;
  if (!uid) throw new HttpsError("unauthenticated", "Autenticação necessária.");
  if (role === "admin") return { uid };
  if (role && legacyRoles.includes(role)) return { uid };
  const status = req.auth?.token?.status as string | undefined;
  const roleId = req.auth?.token?.roleId as string | undefined;
  if (status === "ativo" && roleId) {
    const snap = await db.collection("nfe_roles").doc(roleId).get();
    const acoes = (snap.data()?.acoes ?? []) as string[];
    if (acoes.includes(acao)) return { uid };
  }
  throw new HttpsError("permission-denied", "Permissão insuficiente.");
}

/** Autoriza leitura de um MÓDULO (admin, role legada, ou perfil ativo com o módulo). */
export async function exigirModulo(
  req: CallableRequest,
  modulo: string,
  legacyRoles: Role[],
): Promise<{ uid: string }> {
  const uid = req.auth?.uid;
  const role = req.auth?.token?.role as Role | undefined;
  if (!uid) throw new HttpsError("unauthenticated", "Autenticação necessária.");
  if (role === "admin") return { uid };
  if (role && legacyRoles.includes(role)) return { uid };
  const status = req.auth?.token?.status as string | undefined;
  const roleId = req.auth?.token?.roleId as string | undefined;
  if (status === "ativo" && roleId) {
    const snap = await db.collection("nfe_roles").doc(roleId).get();
    const modulos = (snap.data()?.modulos ?? []) as string[];
    if (modulos.includes(modulo)) return { uid };
  }
  throw new HttpsError("permission-denied", "Permissão insuficiente.");
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
