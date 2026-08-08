import {
  LayoutDashboard,
  FileText,
  Wallet,
  Truck,
  MoreHorizontal,
  Building2,
  ShieldCheck,
  BarChart3,
  Bell,
  Plug,
  Settings,
  Handshake,
  Receipt,
  Container,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "./auth/roles";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Perfis que enxergam o item (vazio = todos autenticados). */
  roles?: Role[];
}

/** Itens principais — viram a BOTTOM NAV no mobile (máx. 4 + "Mais"). */
export const PRIMARY_NAV: NavItem[] = [
  { label: "Início", href: "/inicio", icon: LayoutDashboard },
  { label: "Notas", href: "/notas", icon: FileText },
  { label: "Financeiro", href: "/financeiro", icon: Wallet },
  { label: "Fornecedores", href: "/fornecedores", icon: Truck },
];

/** Itens secundários — ficam em "Mais" (mobile) e na sidebar (desktop). */
export const SECONDARY_NAV: NavItem[] = [
  { label: "Fretes (CT-e)", href: "/ctes", icon: Container },
  { label: "Serviços (NFS-e)", href: "/nfses", icon: Wrench },
  { label: "Acordos", href: "/acordos", icon: Handshake, roles: ["admin", "financeiro"] },
  { label: "Despesas fixas", href: "/despesas", icon: Receipt, roles: ["admin", "financeiro"] },
  { label: "Empresas", href: "/empresas", icon: Building2, roles: ["admin"] },
  { label: "Relatórios", href: "/relatorios", icon: BarChart3 },
  { label: "Alertas", href: "/alertas", icon: Bell },
  { label: "Integrações", href: "/integracoes", icon: Plug, roles: ["admin", "fiscal"] },
  { label: "Certificado", href: "/certificado", icon: ShieldCheck, roles: ["admin"] },
  { label: "Configurações", href: "/configuracoes", icon: Settings, roles: ["admin"] },
];

/** Item "Mais" do bottom-nav mobile. */
export const MAIS_ITEM: NavItem = { label: "Mais", href: "/mais", icon: MoreHorizontal };

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

export function filtrarPorRole(itens: NavItem[], role: Role | null): NavItem[] {
  return itens.filter((i) => !i.roles || (role && i.roles.includes(role)));
}
