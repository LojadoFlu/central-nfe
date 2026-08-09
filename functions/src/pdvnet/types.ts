// Tipos do PDVnet (subconjunto financeiro), fiéis ao Swagger /pdvapi/swagger/docs/v1.
// Só os campos que consumimos. Portado/estendido do CRM (crm-flu/functions/src/pdvnet/types.ts).

export interface PdvTokenAcesso {
  Token: string;
  ExpiraEm?: number; // segundos
}

export interface PdvPaginacaoInfo {
  PaginaAtual?: number;
  TamanhoPagina?: number;
  TotalPaginas?: number;
  TotalRegistros?: number;
  TemProximaPagina?: boolean;
  TemPaginaAnterior?: boolean;
}

export interface PdvListaResponse<T> {
  Registros: T[] | null;
  PaginacaoInfo?: PdvPaginacaoInfo;
  MensagemErro?: string | null;
}

export interface PdvRede {
  Id: number;
  Nome?: string;
  Inativa?: boolean;
}

export interface PdvLoja {
  Id: number;
  NomeFantasia?: string;
  RazaoSocial?: string;
  RedeId?: number;
  Inativa?: boolean;
}

/** Parcela de cartão embutida na venda — recebível com taxa/líquido/data reais. */
export interface PdvParcelaCartao {
  VendaId?: string;
  Sequencial?: number;
  CartaoId?: number;
  Valor?: number;
  DataLiquidacao?: string; // data prevista de crédito
  Parcela?: number;
  DataVencimento?: string;
  LojaId?: number;
  NumeroCartao?: string;
  ParcentualTaxa?: number; // taxa (%)
  Liquido?: number; // valor líquido previsto
  Resumo?: string;
  DataVenda?: string;
  Tipo?: number; // 1/2
  Parcelado?: boolean;
  Status?: boolean;
  Inativa?: boolean;
  NSU?: string;
  TEF?: boolean;
  CodigoAutorizacao?: string;
  DescricaoCartao?: string;
}

export interface PdvDocumentoFiscal {
  TipoDocumento?: number; // 55=NF-e, 65=NFC-e, …
  Chave?: string;
  Numero?: string;
}

export interface PdvVendaItem {
  VendaId?: string;
  SequencialItem?: number;
  VariacaoId?: string;
  Preco?: number;
  Quantidade?: number;
  NaturezaOperacao?: number; // 0=troca/devolução, 1=venda
  PrecoLiquido?: number;
  PrecoCustoAquisicao?: number;
  PrecoCustoGerencial?: number;
  ValorDesconto?: number;
  ValorAcrescimo?: number;
  Inativo?: boolean;
}

export interface PdvCliente {
  Id?: string;
  Nome?: string;
  CPFCNPJ?: string;
  LojaId?: number;
}

/** Venda — cabeçalho + valores por forma de pagamento + parcelas + docs fiscais. */
export interface PdvVenda {
  Id: string;
  LojaId?: number;
  DataHora?: string; // YYYY-MM-DDThh:mm:ss
  DataAtualizacao?: string;
  ValorTotal?: number;
  ValorProdutos?: number;
  ValorDesconto?: number;
  ValorDescontoPromocional?: number;
  // valores por forma de pagamento
  ValorDinheiro?: number;
  ValorPix?: number;
  ValorCartaoDebito?: number;
  ValorCartaoParcelado?: number;
  ValorCartaoRotativo?: number;
  ValorCheque?: number;
  ValorChequePre?: number;
  ValorCrediario?: number;
  ValorDuplicata?: number;
  ValorVale?: number;
  ValorVendaVale?: number;
  ValorValeSaida?: number;
  ValorDeposito?: number;
  ValorOutros?: number;
  ValorTroco?: number;
  ValorBonus?: number;
  ValorFrete?: number;
  VendedorId?: string;
  CaixaId?: number;
  TurnoId?: number;
  NotaFiscalNumero?: string;
  ClienteId?: string;
  ClienteCPF?: string;
  TipoVenda?: number;
  Inativa?: boolean; // cancelada
  Observacao?: string;
  Itens?: PdvVendaItem[];
  ParcelasCartao?: PdvParcelaCartao[];
  DocumentosFiscais?: PdvDocumentoFiscal[];
  Cliente?: PdvCliente;
}

/** Pedido de compra (para conciliação NF-e ↔ PDV; usado na Etapa 6). */
export interface PdvPedidoCompra {
  codigo_pedido?: string;
  fornecedor_fantasia?: string;
  fornecedor_razao_social?: string;
  fornecedor_doc?: string;
  filial?: string;
  filial_doc?: string;
  status_pedido?: string;
  condicao_pagamento?: string;
  previsao_entrega_inicio?: string;
  previsao_entrega_fim?: string;
  data_cadastro?: string;
  qtd_total_itens?: number;
  valor_total_itens?: number;
}
