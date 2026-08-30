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
  PencilLine,
  Trophy,
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
  PackageCheck,
  TrendingUp,
  ArrowDownLeft,
  Coins,
  Target,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Chave(s) do módulo (permissoes.ts). Array = visível se tiver QUALQUER um. Vazio = sempre visível. */
  modulo?: string | string[];
  /** Só administradores enxergam. */
  adminOnly?: boolean;
}

/** Itens principais — viram a BOTTOM NAV no mobile. */
export const PRIMARY_NAV: NavItem[] = [
  { label: "Início", href: "/inicio", icon: LayoutDashboard },
  { label: "DRE gerencial", href: "/dre", icon: TrendingUp, modulo: "financeiro" },
  { label: "Notas", href: "/notas", icon: FileText, modulo: "notas" },
  { label: "Banco", href: "/banco", icon: Landmark, modulo: "financeiro" },
];

/** Itens secundários — ficam em "Mais" (mobile) e na sidebar (desktop). */
export const SECONDARY_NAV: NavItem[] = [
  { label: "Financeiro", href: "/financeiro", icon: Wallet, modulo: "financeiro" },
  { label: "Fornecedores", href: "/fornecedores", icon: Truck, modulo: "fornecedores" },
  { label: "Pedidos de compra", href: "/pedidos", icon: ShoppingCart, modulo: ["financeiro", "compras"] },
  { label: "Recebimento de compras", href: "/recebimento", icon: PackageCheck, modulo: "notas" },
  { label: "Pendências", href: "/pendencias", icon: ClipboardCheck, modulo: "financeiro" },
  { label: "Fluxo de caixa", href: "/fluxo", icon: LineChart, modulo: "financeiro" },
  { label: "Comissões e metas", href: "/comissoes", icon: Target, modulo: "comissoes" },
  { label: "DRE comparativo", href: "/dre-comparativo", icon: BarChart3, modulo: "financeiro" },
  { label: "Conciliação", href: "/conciliacao", icon: Scale, modulo: "financeiro" },
  { label: "Conciliação de saídas", href: "/saidas", icon: ArrowDownLeft, modulo: "financeiro" },
  { label: "Taxas de cartão", href: "/taxas", icon: CreditCard, modulo: "financeiro" },
  { label: "Vendas (PDV)", href: "/vendas", icon: ShoppingCart, modulo: "vendas" },
  { label: "Vendas manuais", href: "/manual", icon: PencilLine, modulo: "financeiro" },
  { label: "Maracanã", href: "/maracana", icon: Trophy, modulo: "financeiro" },
  { label: "Fretes (CT-e)", href: "/ctes", icon: Container, modulo: "ctes" },
  { label: "Serviços (NFS-e)", href: "/nfses", icon: Wrench, modulo: "nfses" },
  { label: "Acordos", href: "/acordos", icon: Handshake, modulo: "acordos" },
  { label: "Despesas fixas", href: "/despesas", icon: Receipt, modulo: "despesas" },
  { label: "Despesas manuais", href: "/despesas-manuais", icon: Coins, modulo: ["despesas", "despesas-manuais"] },
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
function itemPermite(i: NavItem, ctx: PermCtx): boolean {
  if (i.adminOnly) return ctx.isAdmin;
  if (!i.modulo) return true; // Início e afins
  const mods = Array.isArray(i.modulo) ? i.modulo : [i.modulo];
  return mods.some((m) => ctx.podeModulo(m));
}
export function filtrarPorPermissao(itens: NavItem[], ctx: PermCtx): NavItem[] {
  return itens.filter((i) => itemPermite(i, ctx));
}
/**
 * Guarda por ROTA: acha o item de menu que cobre o pathname (href exato ou prefixo,
 * ex.: /pedidos/123 → /pedidos) e diz se o usuário pode. Rota sem item mapeado
 * (Início, Mais, etc.) é liberada.
 */
export function podeVerRota(pathname: string, ctx: PermCtx): boolean {
  const item = ALL_NAV
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return item ? itemPermite(item, ctx) : true;
}
