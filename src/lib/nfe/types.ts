// Tipos de domínio da Central NF-e (compartilhados entre telas e, quando útil,
// espelhados nas Functions). Mantêm rastreabilidade até o XML original.

export type Ambiente = "homologacao" | "producao";

export interface Auditoria {
  createdAt: string; // ISO
  updatedAt: string; // ISO
  createdBy?: string; // uid
}

/** Empresa/CNPJ do grupo. */
export interface Company extends Auditoria {
  id: string;
  razaoSocial: string;
  nomeFantasia?: string;
  /** Código de afiliação na Stone (não é segredo). */
  stoneCode?: string | null;
  /** Todos os códigos que liquidam nesta conta — uma conta pode ter vários. */
  stoneCodes?: string[];
  /** A chave da API da Stone está guardada no cofre. */
  temChaveStone?: boolean;
  cnpj: string; // 14 dígitos
  inscricaoEstadual?: string;
  uf: string;
  ambiente: Ambiente; // ambiente de consulta à SEFAZ
  ativo: boolean;
  /** true se há certificado válido associado (metadado, nunca o segredo). */
  temCertificado?: boolean;
  /** true = loja offline (sem PDV/SEFAZ); vendas lançadas manualmente. */
  manual?: boolean;
}

export type SituacaoCertificado = "valido" | "vencendo" | "vencido";

/** METADADOS do certificado. O .pfx e a senha NUNCA vivem aqui (Secret Manager). */
export interface CertificateMeta extends Auditoria {
  id: string; // = cnpj base (8) ou companyId
  companyId: string;
  cnpj: string;
  razaoSocial?: string;
  numeroSerie: string;
  emissor: string;
  validadeInicio: string; // ISO
  validadeFim: string; // ISO
  /** Referência ao segredo no Secret Manager (nome), nunca o conteúdo. */
  secretRef: string;
  situacao: SituacaoCertificado;
}

/** Situação a partir da validade + hoje. */
export function situacaoCertificado(
  validadeFim: string,
  hoje = new Date(),
): { situacao: SituacaoCertificado; diasRestantes: number } {
  const fim = new Date(validadeFim);
  const dias = Math.ceil((fim.getTime() - hoje.getTime()) / 86_400_000);
  const situacao: SituacaoCertificado =
    dias < 0 ? "vencido" : dias <= 30 ? "vencendo" : "valido";
  return { situacao, diasRestantes: dias };
}

/** Estado de sincronização por CNPJ (controle de NSU). */
export interface SyncState {
  companyId: string;
  cnpj: string;
  ultNSU: string; // 15 dígitos
  maxNSU: string;
  ultimaSync?: string; // ISO
  proximaSync?: string; // ISO — respeita recuo do 656
  status: "ok" | "bloqueado" | "erro" | "nunca";
  ultimoCStat?: string;
  ultimaMensagem?: string;
}
