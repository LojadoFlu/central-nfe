// Parser do arquivo de conciliação da Stone (layout 2.4) — FUNÇÕES PURAS.
//
// O arquivo de um dia tem quatro partes que importam:
//
//   Header                        StoneCode, data de referência, versão
//   FinancialTransactions         transações CAPTURADAS no dia; cada parcela
//                                 traz bruto, líquido e a PREVISÃO de crédito
//   FinancialTransactionsAccounts parcelas LIQUIDADAS no dia; trazem a data do
//                                 pagamento, a taxa em reais e, quando houve
//                                 antecipação, a data original do crédito
//   Trailer                       contadores para conferência
//
// A mesma parcela aparece nos dois blocos em dias diferentes: prevista no dia
// da venda, paga no dia do crédito. Por isso a chave é
// transação + número da parcela, e a gravação é merge — o segundo encontro
// enriquece o primeiro em vez de duplicá-lo.
//
// O XML não tem namespaces nos elementos internos e é plano; regex resolve sem
// trazer um parser de XML para dentro das funções.

export interface CabecalhoStone {
  stoneCode: string | null;
  referenceDate: string | null; // YYYY-MM-DD
  layout: string | null;
  geradoEm: string | null; // ISO
}

export interface ParcelaStone {
  /** Chave da transação na adquirente — o identificador que a Stone usa. */
  transacaoKey: string;
  /** Chave que o POS mandou (serial + sequência) — ajuda a achar a venda. */
  iniciadorKey: string | null;
  autorizacao: string | null;
  serialPos: string | null;
  bandeiraId: string | null;
  cartao: string | null;
  entryMode: string | null;
  autorizadoEm: string | null; // ISO
  capturadoEm: string | null; // ISO
  parcela: number;
  parcelas: number | null;
  bruto: number;
  liquido: number;
  /** Taxa em reais. Vem pronta na liquidação; na previsão é bruto − líquido. */
  taxa: number;
  previsaoPagamento: string | null; // YYYY-MM-DD
  pagamentoEm: string | null; // YYYY-MM-DD
  pagamentoOriginalEm: string | null; // YYYY-MM-DD
  /** Preenchida quando a parcela foi antecipada: a data em que cairia. */
  antecipadaDe: string | null;
  paymentId: string | null;
  /** De qual bloco veio: previsão da venda ou crédito efetivo. */
  origem: "capturada" | "liquidada";
}

/**
 * Cancelamento de uma venda já paga: a Stone devolve o dinheiro ao cliente e
 * COBRA de volta do lojista, numa data própria. Sem isso a agenda fica acima do
 * banco — o cancelamento é o único lançamento que tira dinheiro da conta.
 */
export interface CancelamentoStone {
  transacaoKey: string;
  operationKey: string;
  canceladoEm: string | null;
  /** O que foi devolvido ao portador. */
  devolvido: number;
  /** O que a Stone cobra do lojista — é este que sai da conta. */
  cobrado: number;
  cobradoEm: string | null;
  paymentId: string | null;
}

/** Evento financeiro (balanceamento de saldo, cobrança, ajuste). */
export interface EventoStone {
  eventId: string | null;
  descricao: string | null;
  tipo: string | null;
  valor: number;
  data: string | null;
}

export interface ConciliacaoStone {
  cabecalho: CabecalhoStone;
  capturadas: ParcelaStone[];
  liquidadas: ParcelaStone[];
  cancelamentos: CancelamentoStone[];
  eventos: EventoStone[];
  trailer: Record<string, number>;
}

function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`));
  return m ? m[1].trim() : null;
}

function bloco(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`));
  return m ? m[1] : null;
}

function num(v: string | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** "20260901" → "2026-09-01". Vazio ou zerado vira null. */
export function dataDoArquivo(v: string | null): string | null {
  if (!v || !/^\d{8}$/.test(v) || v === "00000000") return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

/** "20260901122348" → ISO local (a Stone manda horário de Brasília). */
export function dataHoraDoArquivo(v: string | null): string | null {
  if (!v || !/^\d{14}$/.test(v)) return dataDoArquivo(v);
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(
    10,
    12,
  )}:${v.slice(12, 14)}`;
}

function parcelasDaTransacao(t: string, origem: ParcelaStone["origem"]): ParcelaStone[] {
  const comum = {
    transacaoKey: tag(t, "AcquirerTransactionKey") ?? "",
    iniciadorKey: tag(t, "InitiatorTransactionKey"),
    autorizacao: tag(t, "IssuerAuthorizationCode"),
    serialPos: tag(bloco(t, "Poi") ?? "", "SerialNumber"),
    bandeiraId: tag(t, "BrandId"),
    cartao: tag(t, "CardNumber"),
    entryMode: tag(t, "EntryMode"),
    autorizadoEm: dataHoraDoArquivo(tag(t, "AuthorizationDateTime")),
    capturadoEm: dataHoraDoArquivo(tag(t, "CaptureLocalDateTime")),
    parcelas: tag(t, "NumberOfInstallments") ? Number(tag(t, "NumberOfInstallments")) : null,
    origem,
  };

  const out: ParcelaStone[] = [];
  const re = /<Installment>([\s\S]*?)<\/Installment>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const p = m[1];
    const bruto = num(tag(p, "GrossAmount"));
    const liquido = num(tag(p, "NetAmount"));
    const taxaCru = tag(p, "SaleFee");
    out.push({
      ...comum,
      parcela: Number(tag(p, "InstallmentNumber") ?? 1) || 1,
      bruto,
      liquido,
      // Na liquidação a Stone já manda a taxa em reais; na previsão, ela é a
      // diferença. Guardar as duas do mesmo jeito evita conta na hora de somar.
      taxa: taxaCru != null ? num(taxaCru) : Math.round((bruto - liquido) * 100) / 100,
      previsaoPagamento: dataDoArquivo(tag(p, "PrevisionPaymentDate")),
      pagamentoEm: dataDoArquivo(tag(p, "PaymentDate")),
      pagamentoOriginalEm: dataDoArquivo(tag(p, "OriginalPaymentDate")),
      antecipadaDe: dataDoArquivo(tag(p, "AdvancedReceivableOriginalPaymentDate")),
      paymentId: tag(p, "PaymentId"),
    });
  }
  return out;
}

function transacoesDe(xml: string, container: string, origem: ParcelaStone["origem"]): ParcelaStone[] {
  const b = bloco(xml, container);
  if (!b) return [];
  const out: ParcelaStone[] = [];
  const re = /<Transaction>([\s\S]*?)<\/Transaction>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(b)) !== null) out.push(...parcelasDaTransacao(m[1], origem));
  return out;
}

function cancelamentosDe(xml: string): CancelamentoStone[] {
  const out: CancelamentoStone[] = [];
  for (const t of xml.match(/<Transaction>[\s\S]*?<\/Transaction>/g) ?? []) {
    const chave = tag(t, "AcquirerTransactionKey") ?? "";
    const bloco = t.match(/<Cancellations>([\s\S]*?)<\/Cancellations>/);
    if (!bloco) continue;
    for (const c of bloco[1].match(/<Cancellation>[\s\S]*?<\/Cancellation>/g) ?? []) {
      const billing = c.match(/<Billing>([\s\S]*?)<\/Billing>/)?.[1] ?? "";
      out.push({
        transacaoKey: chave,
        operationKey: tag(c, "OperationKey") ?? "",
        canceladoEm: dataHoraDoArquivo(tag(c, "CancellationDateTime")),
        devolvido: num(tag(c, "ReturnedAmount")),
        cobrado: num(tag(billing, "ChargedAmount")),
        cobradoEm: dataDoArquivo(tag(billing, "ChargeDate")),
        paymentId: tag(c, "PaymentId"),
      });
    }
  }
  return out;
}

function eventosDe(xml: string): EventoStone[] {
  const bloco = xml.match(/<FinancialEvents>([\s\S]*?)<\/FinancialEvents>/);
  if (!bloco) return [];
  const out: EventoStone[] = [];
  for (const e of bloco[1].match(/<Event>[\s\S]*?<\/Event>/g) ?? []) {
    out.push({
      eventId: tag(e, "EventId"),
      descricao: tag(e, "Description"),
      tipo: tag(e, "Type"),
      valor: num(tag(e, "Amount")),
      data: dataDoArquivo(tag(e, "PrevisionPaymentDate")),
    });
  }
  return out;
}

export function parseConciliacaoStone(xml: string): ConciliacaoStone {
  const head = bloco(xml, "Header") ?? "";
  const trailerXml = bloco(xml, "Trailer") ?? "";
  const trailer: Record<string, number> = {};
  const reT = /<(\w+)>([^<]*)<\/\1>/g;
  let t: RegExpExecArray | null;
  while ((t = reT.exec(trailerXml)) !== null) trailer[t[1]] = Number(t[2]) || 0;

  return {
    cabecalho: {
      stoneCode: tag(head, "StoneCode"),
      referenceDate: dataDoArquivo(tag(head, "ReferenceDate")),
      layout: tag(head, "LayoutVersion"),
      geradoEm: dataHoraDoArquivo(tag(head, "GenerationDateTime")),
    },
    capturadas: transacoesDe(xml, "FinancialTransactions", "capturada"),
    liquidadas: transacoesDe(xml, "FinancialTransactionsAccounts", "liquidada"),
    cancelamentos: cancelamentosDe(xml),
    eventos: eventosDe(xml),
    trailer,
  };
}

/** Id estável de uma parcela: transação + número. Serve para gravar com merge. */
export function idDaParcela(stoneCode: string, p: ParcelaStone): string {
  return `${stoneCode}_${p.transacaoKey}_${p.parcela}`;
}

/**
 * Dias de `de` até `ate`, inclusive. Mora aqui, no módulo puro, porque o teste
 * precisa dela: qualquer import que chegue em `lib/base.ts` arrasta
 * `firebase-functions`, que não existe na instalação da raiz e derruba o build
 * do front na Netlify.
 */
export function diasDoPeriodo(de: string, ate: string): string[] {
  const out: string[] = [];
  const d = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (d <= fim && out.length < 120) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
