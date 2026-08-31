// Tipos do módulo de comissões no cliente.
// ESPELHO de functions/src/comissoes/tipos.ts — o motor roda no servidor e o
// build das Functions tem rootDir próprio, então os dois arquivos não podem se
// importar. Mexeu num, mexa no outro.

export type Competencia = string; // "YYYY-MM"
export type EscopoVenda = "individual" | "loja" | "grupo";
export type BaseCalculo = "liquida" | "bruta";
export type BaseFaixa = "valor" | "percentualMeta";
export type ModeloFaixa = "integral" | "progressivo";
export type RegraPiso = "maior" | "soma";

export interface Faixa {
  de: number;
  percentual: number;
  rotulo?: string | null;
}

export interface Condicao {
  tipo: "atingimentoIndividual" | "atingimentoLoja" | "atingimentoGrupo";
  minimoPct: number;
}

export interface Componente {
  id: string;
  rotulo: string;
  escopoVenda: EscopoVenda;
  baseCalculo: BaseCalculo;
  baseFaixa: BaseFaixa;
  modelo: ModeloFaixa;
  faixas: Faixa[];
  condicao?: Condicao | null;
}

export interface Regra {
  id: string;
  nome: string;
  ativo: boolean;
  funcionarioId?: string | null;
  cargoId?: string | null;
  lojaId?: number | null;
  componentes: Componente[];
  vigenciaDe: Competencia;
  vigenciaAte?: Competencia | null;
}

export interface Gatilho {
  tipo:
    | "sempre"
    | "atingimentoIndividual"
    | "atingimentoLoja"
    | "atingimentoGrupo"
    | "melhorVendedorLoja";
  minimoPct?: number;
}

export interface Premio {
  tipo: "percentual" | "fixo";
  valor: number;
  escopoVenda?: EscopoVenda;
  baseCalculo?: BaseCalculo;
}

export interface Bonus {
  id: string;
  nome: string;
  ativo: boolean;
  funcionarioId?: string | null;
  cargoId?: string | null;
  lojaId?: number | null;
  gatilho: Gatilho;
  premio: Premio;
  vigenciaDe: Competencia;
  vigenciaAte?: Competencia | null;
}

export interface Ajuste {
  id: string;
  funcionarioId: string;
  competencia: Competencia;
  valor: number;
  motivo: string;
  tipo: "manual" | "estorno";
  criadoPor?: string | null;
  criadoEm?: string | null;
}

export interface Cargo {
  id: string;
  nome: string;
  ordem?: number;
  /** Piso garantido do cargo — é aqui que o piso normalmente se define. */
  pisoGarantido?: number | null;
  /** A meta da loja é dividida entre as pessoas dos cargos marcados. */
  recebeMetaIndividual?: boolean;
  ativo: boolean;
}

export interface Funcionario {
  id: string;
  nome: string;
  cpf?: string | null;
  cargoId: string | null;
  lojaId: number | null;
  pdvVendedorId?: string | null;
  /** Não vende no PDV: comissiona pela loja/grupo, e a sync não mexe nele. */
  semPdv?: boolean;
  lojasGrupo?: number[];
  /** Piso individual — EXCEÇÃO. Vazio (null) = herda o piso do cargo. */
  pisoGarantido?: number | null;
  admissao?: string | null;
  ativo: boolean;
}

export interface Meta {
  id: string;
  competencia: Competencia;
  funcionarioId?: string | null;
  cargoId?: string | null;
  lojaId?: number | null;
  /** Alvo do MÊS. Com semanas preenchidas, é a soma delas. */
  valor: number;
  /** Metas da semana 1 a 6; posição vazia = semana não usada no mês. */
  semanas?: (number | null)[] | null;
}

export interface VendedorPdv {
  id: string;
  nome: string | null;
  apelido: string | null;
  cpf: string | null;
  tipo: string | null;
  lojaId: number | null;
  lojas: number[];
  inativo: boolean | null;
  /** Apareceu na equipe de alguma loja na última sincronização. */
  naEquipe?: boolean;
  /** Código institucional da loja, não uma pessoa. */
  ignorado?: boolean;
  ultimaVenda: string | null;
  totalPeriodo: number;
}

export interface LinhaMemoria {
  rotulo: string;
  detalhe: string;
  valor: number;
  informativa?: boolean;
}

export type StatusFechamento = "aberto" | "pre-fechamento" | "conferido" | "fechado" | "reaberto";

export const STATUS_LABEL: Record<StatusFechamento, string> = {
  aberto: "Em andamento",
  "pre-fechamento": "Pré-fechamento",
  conferido: "Conferido",
  fechado: "Fechado",
  reaberto: "Reaberto",
};

/** Saída crua do motor — usada pelo simulador. */
export interface ResultadoApuracao {
  funcionarioId: string;
  competencia: Competencia;
  vendaConsiderada: number;
  metaConsiderada: number | null;
  escopoMeta: EscopoVenda;
  atingimentoPct: number | null;
  percentualEfetivo: number | null;
  comissaoBase: number;
  bonusTotal: number;
  ajustesTotal: number;
  comissaoTotal: number;
  piso: number;
  valorDevido: number;
  pisoAplicado: boolean;
  memoria: LinhaMemoria[];
  divergencias: string[];
}

export interface LinhaApuracao {
  funcionarioId: string;
  funcionarioNome: string;
  competencia: Competencia;
  cargoId: string | null;
  cargoNome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  empresaId: string | null;
  pdvVendedorId: string | null;
  regraId: string | null;
  regraNome: string | null;
  pisoOrigem: "cargo" | "funcionario" | null;
  vendaProjetada: number | null;
  comissaoProjetada: number | null;
  valorDevidoProjetado: number | null;
  vendaConsiderada: number;
  metaConsiderada: number | null;
  escopoMeta: EscopoVenda;
  atingimentoPct: number | null;
  percentualEfetivo: number | null;
  comissaoBase: number;
  bonusTotal: number;
  ajustesTotal: number;
  comissaoTotal: number;
  piso: number;
  valorDevido: number;
  pisoAplicado: boolean;
  memoria: LinhaMemoria[];
  divergencias: string[];
}

export interface ResultadoCompetencia {
  ok: boolean;
  competencia: Competencia;
  periodo: { de: string; ate: string };
  regraPiso: RegraPiso;
  pagamentoEm: string;
  linhas: LinhaApuracao[];
  totais: {
    faturamento: number;
    comissaoBase: number;
    bonus: number;
    ajustes: number;
    comissaoTotal: number;
    valorDevido: number;
    pisoUtilizado: number;
    acimaDaMeta: number;
    funcionarios: number;
  };
  porCargo: { cargoId: string | null; cargoNome: string; valor: number; funcionarios: number }[];
  porLoja: {
    lojaId: number;
    lojaNome: string | null;
    faturamento: number;
    meta: number | null;
    comissao: number;
  }[];
  porEmpresa: { empresaId: string; valor: number }[];
  projecao: {
    faturamento: number;
    valorDevido: number;
    diasDecorridos: number;
    diasTotais: number;
  } | null;
  divergencias: {
    vendasSemVendedor: { qtd: number; valor: number; ids: string[] };
    vendedoresSemCadastro: { id: string; nome: string | null; total: number }[];
    funcionariosSemRegra: string[];
    funcionariosSemPiso: string[];
    funcionariosSemMeta: string[];
    gruposSemMeta: string[];
    inativosComVenda: { nome: string; total: number }[];
  };
  status: StatusFechamento;
  congelado: boolean;
  fechadoPor?: string | null;
  fechadoEm?: string | null;
}

export interface ConfigComissoes {
  regraPiso: RegraPiso;
  cargoPadraoId: string | null;
  diaPagamentoFolha: number;
  mesPagamento: "seguinte" | "mesmo";
  provisaoNoFluxo: boolean;
  /** O cadastro de funcionários segue o PDV automaticamente. */
  sincronizarFuncionarios: boolean;
  /** Tipo do vendedor no PDV ("V", "G"…) → cargo daqui, na criação. */
  cargosPorTipoPdv: Record<string, string>;
}

export interface ResultadoSyncQuadro {
  ok: boolean;
  lojas?: number;
  gravados?: number;
  semNome?: number;
  ignorados?: number;
  criados?: number;
  atualizados?: number;
  inativados?: number;
  reconciliado?: boolean;
  erro?: string;
}

export interface LogAuditoria {
  id: string;
  acao: string;
  uid: string;
  usuario: string | null;
  at: string;
  detalhe: Record<string, unknown>;
}

/** Custo de comissões por competência (§24). */
export interface CustoMes {
  competencia: Competencia;
  status: StatusFechamento;
  pagamentoEm: string | null;
  faturamento: number;
  valorDevido: number;
  comissaoTotal: number;
  pisoUtilizado: number;
  bonus: number;
  porCargo: { cargoId: string | null; cargoNome: string; valor: number; funcionarios: number }[];
  porEmpresa: { empresaId: string; valor: number }[];
}
