// Perfis (RBAC via Firebase custom claims) — princípio do menor privilégio.
export type Role = "admin" | "fiscal" | "financeiro" | "consulta";

export const ROLES: Role[] = ["admin", "fiscal", "financeiro", "consulta"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  fiscal: "Fiscal",
  financeiro: "Financeiro",
  consulta: "Consulta",
};

export function parseRole(claim: unknown): Role | null {
  return typeof claim === "string" && (ROLES as string[]).includes(claim)
    ? (claim as Role)
    : null;
}

/** true se `role` está entre os permitidos (vazio = qualquer autenticado). */
export function podeVer(role: Role | null, permitidos?: Role[]): boolean {
  if (!permitidos || permitidos.length === 0) return true;
  return !!role && permitidos.includes(role);
}

// Capacidades sensíveis: só perfis autorizados.
export function podeManifestar(role: Role | null): boolean {
  return role === "admin" || role === "fiscal";
}
export function podeGerirCertificado(role: Role | null): boolean {
  return role === "admin";
}
export function podeAlterarFinanceiro(role: Role | null): boolean {
  return role === "admin" || role === "financeiro";
}
