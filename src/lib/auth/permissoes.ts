// Catálogo de permissões (RBAC por módulo + ações sensíveis).
// Perfis são criados pelo admin e marcam quais módulos/ações liberam.

export interface ModuloDef {
  key: string;
  label: string;
  href: string;
}

/** Módulos (telas) que um perfil pode liberar. "Início" é sempre visível. */
export const MODULOS: ModuloDef[] = [
  { key: "notas", label: "Notas (NF-e)", href: "/notas" },
  { key: "ctes", label: "Fretes (CT-e)", href: "/ctes" },
  { key: "nfses", label: "Serviços (NFS-e)", href: "/nfses" },
  { key: "financeiro", label: "Financeiro", href: "/financeiro" },
  { key: "acordos", label: "Acordos", href: "/acordos" },
  { key: "despesas", label: "Despesas fixas", href: "/despesas" },
  { key: "fornecedores", label: "Fornecedores", href: "/fornecedores" },
  { key: "relatorios", label: "Relatórios", href: "/relatorios" },
  { key: "alertas", label: "Alertas", href: "/alertas" },
  { key: "integracoes", label: "Integrações", href: "/integracoes" },
  { key: "empresas", label: "Empresas", href: "/empresas" },
  { key: "certificado", label: "Certificado", href: "/certificado" },
  { key: "configuracoes", label: "Configurações", href: "/configuracoes" },
];

export interface AcaoDef {
  key: string;
  label: string;
}

/** Ações sensíveis (interruptores por perfil). */
export const ACOES: AcaoDef[] = [
  { key: "financeiro.baixar", label: "Dar baixa em contas / marcar pago" },
  { key: "nfe.manifestar", label: "Manifestar NF-e na SEFAZ" },
  { key: "integracoes.sincronizar", label: "Sincronizar com SEFAZ / PDV" },
  { key: "empresas.gerir", label: "Cadastrar / editar empresas" },
  { key: "certificado.gerir", label: "Instalar certificado digital" },
];

export interface Perfil {
  id: string;
  nome: string;
  descricao?: string | null;
  modulos: string[];
  acoes: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type StatusUsuario = "pendente" | "ativo" | "inativo";
