// Comissões — tipos do domínio (motor de remuneração variável).
//
// Princípio (§46): NADA de percentual/meta/piso escrito no código. Tudo aqui é
// só a FORMA das regras; os valores vivem no Firestore e são editáveis na tela.

/** Competência = mês de apuração, "YYYY-MM". */
export type Competencia = string;

/** Sobre a venda de quem o componente incide. */
export type EscopoVenda = "individual" | "loja" | "grupo";

/** Qual valor da venda entra na base. */
export type BaseCalculo =
  | "liquida" // valorTotal da venda (já com descontos) — padrão recomendado (§16)
  | "bruta"; // valorProdutos (antes dos descontos)

/** Como as faixas são medidas. */
export type BaseFaixa =
  | "valor" // faixas em R$ vendidos
  | "percentualMeta"; // faixas em % da meta (§35)

/** Como o percentual da faixa se aplica (§8). */
export type ModeloFaixa =
  | "integral" // a faixa atingida vale para TUDO que foi vendido
  | "progressivo"; // cada fatia usa o percentual da sua faixa

/** Uma faixa da tabela de comissão. */
export interface Faixa {
  /** Piso da faixa: R$ (baseFaixa "valor") ou % da meta (baseFaixa "percentualMeta"). */
  de: number;
  /** Percentual de comissão da faixa. 1.5 = 1,5%. */
  percentual: number;
  /** Rótulo livre ("Meta", "Supermeta"…) — só apresentação. */
  rotulo?: string | null;
}

/** Condição de pagamento de um componente/bônus (ex.: só se a loja bateu a meta). */
export interface Condicao {
  tipo: "atingimentoIndividual" | "atingimentoLoja" | "atingimentoGrupo";
  /** Atingimento mínimo em % (100 = bateu a meta). */
  minimoPct: number;
}

/**
 * Um pedaço do cálculo. O vendedor normalmente tem 1 (venda própria); o gerente
 * pode ter 2 (venda própria + % da loja quando a loja bate a meta); o supervisor
 * tem 1 sobre o grupo de lojas (§11–13).
 */
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

/** Regra de comissão. A hierarquia (§36) vem do escopo preenchido. */
export interface Regra {
  id: string;
  nome: string;
  ativo: boolean;
  /** Escopo — quanto mais campos preenchidos, mais específica (§36). */
  funcionarioId?: string | null;
  cargoId?: string | null;
  lojaId?: number | null;
  componentes: Componente[];
  /** Vigência por competência, inclusiva (§33). vigenciaAte null = em aberto. */
  vigenciaDe: Competencia;
  vigenciaAte?: Competencia | null;
}

/** Gatilho de um bônus (§14). */
export interface Gatilho {
  tipo:
    | "sempre"
    | "atingimentoIndividual"
    | "atingimentoLoja"
    | "atingimentoGrupo"
    | "melhorVendedorLoja"
    | "indicador";
  /** Atingimento mínimo em % (para os gatilhos de atingimento). */
  minimoPct?: number;
  /** Gatilho "indicador": qual meta secundária precisa estar marcada. */
  indicadorId?: string | null;
}

/** Prêmio do bônus: percentual sobre uma base, ou valor fixo. */
export interface Premio {
  tipo: "percentual" | "fixo";
  /** Percentual (0.2 = 0,2%) ou R$, conforme `tipo`. */
  valor: number;
  /** Base do percentual (ignorado quando `tipo` = "fixo"). */
  escopoVenda?: EscopoVenda;
  baseCalculo?: BaseCalculo;
}

/** Bônus configurável — mecanismo genérico, não só meta/supermeta (§14). */
export interface Bonus {
  id: string;
  nome: string;
  ativo: boolean;
  funcionarioId?: string | null;
  cargoId?: string | null;
  lojaId?: number | null;
  gatilho: Gatilho;
  /**
   * Exigência extra, além do gatilho. É o que faz o bônus de PA valer só para
   * quem bateu a supermeta: gatilho = indicador PA, condição = 125% da meta.
   */
  condicao?: Condicao | null;
  /**
   * Só paga se ESTE outro bônus tiver pago. É como o VA se prende à supermeta
   * sem repetir o degrau dela: mudou a supermeta, o VA acompanha.
   */
  dependeDe?: string | null;
  premio: Premio;
  vigenciaDe: Competencia;
  vigenciaAte?: Competencia | null;
}

/** Ajuste manual ou estorno automático (§17, §29). */
export interface Ajuste {
  id: string;
  funcionarioId: string;
  competencia: Competencia;
  /** Ajuste pode ser negativo. Desconto é sempre positivo — o sinal é o tipo. */
  valor: number;
  motivo: string;
  /**
   * "manual"/"estorno" entram na comissão (e o piso pode absorvê-los).
   * "desconto" sai DEPOIS do piso: retirada de produto e falta se descontam do
   * que a pessoa recebe, não da comissão que ela gerou.
   */
  tipo: "manual" | "estorno" | "desconto" | "falta";
  /** Só para desconto: "retirada", "falta", "suspensao", "outro". */
  categoria?: string | null;
  /**
   * Falta e suspensão: os dias não trabalhados. São INFORMATIVOS — o desconto
   * é calculado pela contabilidade, não aqui.
   */
  dias?: string[] | null;

  criadoPor?: string | null;
  criadoEm?: string | null;
}

/**
 * Meta secundária (PA, VA…) — indicador que não sai de venda, e por isso é
 * MARCADO a cada competência. Serve de gatilho de bônus.
 */
export interface Indicador {
  id: string;
  nome: string;
  descricao?: string | null;
  ordem?: number;
  ativo: boolean;
}

/** Quem bateu quais metas secundárias numa competência. */
export interface IndicadoresAtingidos {
  id: string; // `${competencia}_${funcionarioId}`
  competencia: Competencia;
  funcionarioId: string;
  indicadores: string[];
  atualizadoPor?: string | null;
  atualizadoEm?: string | null;
}

/** Cargo — criado pelo admin, não fixo no código (§4). */
export interface Cargo {
  id: string;
  nome: string;
  /** Ordem de exibição. */
  ordem?: number;
  /**
   * Piso garantido do cargo (§5). É AQUI que o piso normalmente se define —
   * um valor por cargo, em vez de repetir pessoa a pessoa.
   */
  pisoGarantido?: number | null;
  /**
   * Recebe meta individual: a meta da loja é dividida igualmente entre as
   * pessoas destes cargos. Gerente e supervisor não entram — são medidos pela
   * loja ou pelo grupo, e dividir com eles reduziria a meta de quem vende.
   */
  recebeMetaIndividual?: boolean;
  /**
   * Comissiona? Caixa e afins recebem só o piso do cargo — nenhuma regra e
   * nenhum bônus os alcança, e o piso deles é salário, não piso garantido.
   * Ausente = sim (o padrão é comissionar).
   */
  recebeComissao?: boolean;
  ativo: boolean;
}

/** Funcionário (§4). O piso é o mínimo garantido do mês (§5). */
export interface Funcionario {
  id: string;
  nome: string;
  cpf?: string | null;
  cargoId: string | null;
  lojaId: number | null;
  /** Id do vendedor no PDVnet (VendedorId das vendas). Legado: use `pdvVendedorIds`. */
  pdvVendedorId?: string | null;
  /**
   * TODOS os códigos desta pessoa no PDV. A mesma pessoa pode ter um código
   * por filial (a Barra é 582 + 912, e lá cada vendedor aparece duas vezes).
   * Para meta e resultado ela é UMA pessoa: as vendas dos códigos somam.
   */
  pdvVendedorIds?: string[];
  /**
   * Não vende no PDV — gerente, supervisor, caixa, gente contratada fora.
   * A comissão vem da loja ou do grupo de lojas, pela regra do cargo, e a
   * sincronização com o PDV não mexe nesta pessoa.
   */
  semPdv?: boolean;
  /** Lojas que um supervisor acompanha (§13). Vazio = usa a própria loja. */
  lojasGrupo?: number[];
  /** Piso individual — EXCEÇÃO. Vazio (null) = herda o piso do cargo. */
  pisoGarantido?: number | null;
  admissao?: string | null;
  ativo: boolean;
  /** Por que foi inativado — a sync usa para não confundir código de loja com gente. */
  motivoInativacao?: string | null;
}

/** Meta de uma competência (§9). */
export interface Meta {
  id: string;
  competencia: Competencia;
  /** Escopo: funcionário, loja ou cargo+loja. */
  funcionarioId?: string | null;
  cargoId?: string | null;
  lojaId?: number | null;
  /** Alvo do MÊS em R$. Com semanas preenchidas, é a soma delas. */
  valor: number;
  /**
   * Metas semanais (semana 1 a 6). A loja planeja por semana; a apuração é
   * mensal e usa a soma. Posição vazia = semana não usada naquele mês.
   */
  semanas?: (number | null)[];
}

/** Como o piso conversa com a comissão (§5) — configurável. */
export type RegraPiso = "maior" | "soma";

/** Uma linha da memória de cálculo (§38). */
export interface LinhaMemoria {
  rotulo: string;
  detalhe: string;
  valor: number;
  /** Linha informativa (não soma) — ex.: "condição não atendida". */
  informativa?: boolean;
}

/** Entrada do motor — tudo já resolvido (regra vigente, metas, vendas). */
export interface EntradaApuracao {
  competencia: Competencia;
  funcionario: Funcionario;
  /** Vendas já consolidadas do mês, por escopo. */
  vendas: {
    individual: { liquida: number; bruta: number };
    loja: { liquida: number; bruta: number };
    grupo: { liquida: number; bruta: number };
  };
  metas: {
    individual: number | null;
    loja: number | null;
    grupo: number | null;
  };
  regra: Regra | null;
  /**
   * Cargo que não comissiona (caixa): recebe o piso e nada mais. Não é medido
   * por venda nenhuma — nem a própria, nem a da loja.
   */
  semComissao?: boolean;
  bonus: Bonus[];
  ajustes: Ajuste[];
  /**
   * Bônus que alcançam esta pessoa mas não valem nesta competência — só para
   * a memória de cálculo dizer por que o prêmio não saiu.
   */
  bonusForaDeVigencia?: { nome: string; motivo: string }[];
  /** Descontos de folha da competência. */
  descontos?: Ajuste[];
  /** Metas secundárias e se a pessoa bateu cada uma nesta competência. */
  indicadores?: { id: string; nome: string; atingido: boolean }[];
  /** Sinais extras vindos da consolidação. */
  extras?: { melhorVendedorLoja?: boolean };
  regraPiso: RegraPiso;
}

/** Saída do motor (§37). */
export interface ResultadoApuracao {
  funcionarioId: string;
  competencia: Competencia;
  vendaConsiderada: number;
  metaConsiderada: number | null;
  /** Por qual escopo a pessoa é medida: venda própria, da loja ou do grupo. */
  escopoMeta: EscopoVenda;
  atingimentoPct: number | null;
  /** Percentual efetivo = comissão base ÷ venda considerada. */
  percentualEfetivo: number | null;
  comissaoBase: number;
  bonusTotal: number;
  ajustesTotal: number;
  comissaoTotal: number;
  piso: number;
  /** Descontos de folha (retirada, falta, suspensão) — saem depois do piso. */
  descontosTotal: number;
  valorDevido: number;
  /** true quando o piso “segurou” o pagamento (comissão < piso). */
  pisoAplicado: boolean;
  memoria: LinhaMemoria[];
  divergencias: string[];
}
