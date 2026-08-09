import {
  LayoutDashboard,
  FileText,
  Wallet,
  Truck,
  MoreHorizontal,
  ShoppingCart,
  LineChart,
  ClipboardCheck,
  Landmark,
  Scale,
  CreditCard,
  BadgeCheck,
  Store,
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
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Chave do módulo (permissoes.ts). Vazio = sempre visível para autenticado. */
  modulo?: string;
  /** Só administradores enxergam. */
  adminOnly?: boolean;
}

/** Itens principais — viram a BOTTOM NAV no mobile. */
export const PRIMARY_NAV: NavItem[] = [
  { label: "Início", href: "/inicio", icon: LayoutDashboard },
  { label: "Notas", href: "/notas", icon: FileText, modulo: "notas" },
  { label: "Financeiro", href: "/financeiro", icon: Wallet, modulo: "financeiro" },
  { label: "Fornecedores", href: "/fornecedores", icon: Truck, modulo: "fornecedores" },
];

/** Itens secundários — ficam em "Mais" (mobile) e na sidebar (desktop). */
export const SECONDARY_NAV: NavItem[] = [
  { label: "Pendências", href: "/pendencias", icon: ClipboardCheck, modulo: "financeiro" },
  { label: "Fluxo de caixa", href: "/fluxo", icon: LineChart, modulo: "financeiro" },
  { label: "Banco", href: "/banco", icon: Landmark, modulo: "financeiro" },
  { label: "Conciliação", href: "/conciliacao", icon: Scale, modulo: "financeiro" },
  { label: "Taxas de cartão", href: "/taxas", icon: CreditCard, modulo: "financeiro" },
  { label: "Conferir taxas", href: "/conferir", icon: BadgeCheck, modulo: "financeiro" },
  { label: "Vendas (PDV)", href: "/vendas", icon: ShoppingCart, modulo: "vendas" },
  { label: "Fretes (CT-e)", href: "/ctes", icon: Container, modulo: "ctes" },
  { label: "Serviços (NFS-e)", href: "/nfses", icon: Wrench, modulo: "nfses" },
  { label: "Acordos", href: "/acordos", icon: Handshake, modulo: "acordos" },
  { label: "Despesas fixas", href: "/despesas", icon: Receipt, modulo: "despesas" },
  { label: "Relatórios", href: "/relatorios", icon: BarChart3, modulo: "relatorios" },
  { label: "Alertas", href: "/alertas", icon: Bell, modulo: "alertas" },
  { label: "Integrações", href: "/integracoes", icon: Plug, modulo: "integracoes" },
  { label: "Empresas", href: "/empresas", icon: Building2, modulo: "empresas" },
  { label: "Lojas (PDV)", href: "/lojas", icon: Store, adminOnly: true },
  { label: "Certificado", href: "/certificado", icon: ShieldCheck, modulo: "certificado" },
  { label: "Usuários e perfis", href: "/usuarios", icon: Users, adminOnly: true },
  { label: "Configurações", href: "/configuracoes", icon: Settings, modulo: "configuracoes" },
];

/** Item "Mais" do bottom-nav mobile. */
export const MAIS_ITEM: NavItem = { label: "Mais", href: "/mais", icon: MoreHorizontal };

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

export interface PermCtx {
  isAdmin: boolean;
  podeModulo: (key: string) => boolean;
}

/** Filtra itens conforme as permissões do usuário (módulo + adminOnly). */
export function filtrarPorPermissao(itens: NavItem[], ctx: PermCtx): NavItem[] {
  return itens.filter((i) => {
    if (i.adminOnly) return ctx.isAdmin;
    if (!i.modulo) return true; // Início e afins
    return ctx.podeModulo(i.modulo);
  });
}
