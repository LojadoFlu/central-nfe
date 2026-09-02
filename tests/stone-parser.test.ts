import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  dataDoArquivo,
  dataHoraDoArquivo,
  diasDoPeriodo,
  idDaParcela,
  parseConciliacaoStone,
} from "../functions/src/stone/parser";

// Trechos REAIS do arquivo de 01/09/2026 da loja do clube (StoneCode 146659798).
const ARQUIVO = `<?xml version="1.0" encoding="utf-8"?><Conciliation xmlns:xsd="http://schemas.stone.com/"><Header><GenerationDateTime>20260902135937</GenerationDateTime><StoneCode>146659798</StoneCode><LayoutVersion>2.4</LayoutVersion><FileId>0</FileId><ReferenceDate>20260901</ReferenceDate></Header><FinancialTransactions><Transaction><Events><CancellationCharges>0</CancellationCharges><Cancellations>0</Cancellations><Captures>1</Captures><ChargebackRefunds>0</ChargebackRefunds><Chargebacks>0</Chargebacks><Payments>0</Payments></Events><AcquirerTransactionKey>34463164122941</AcquirerTransactionKey><InitiatorTransactionKey>4AH611453-3.17.4.2-positivoSeriesL-TKOQFI-0001</InitiatorTransactionKey><AuthorizationDateTime>20260901122348</AuthorizationDateTime><CaptureLocalDateTime>20260901092348</CaptureLocalDateTime><International>False</International><AccountType>2</AccountType><InstallmentType>1</InstallmentType><NumberOfInstallments>1</NumberOfInstallments><AuthorizedAmount>386.990000</AuthorizedAmount><CapturedAmount>386.990000</CapturedAmount><AuthorizationCurrencyCode>986</AuthorizationCurrencyCode><IssuerAuthorizationCode>133309</IssuerAuthorizationCode><BrandId>1</BrandId><CardNumber>466763******1865</CardNumber><Poi><SerialNumber>4AH611453</SerialNumber></Poi><EntryMode>1</EntryMode><FeeType>2</FeeType><Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>386.990000</GrossAmount><NetAmount>375.805990</NetAmount><PrevisionPaymentDate>20261001</PrevisionPaymentDate></Installment></Installments></Transaction></FinancialTransactions><FinancialTransactionsAccounts><Transaction><Events><CancellationCharges>0</CancellationCharges><Cancellations>0</Cancellations><Captures>0</Captures><ChargebackRefunds>0</ChargebackRefunds><Chargebacks>0</Chargebacks><Payments>3</Payments></Events><AcquirerTransactionKey>34363141620361</AcquirerTransactionKey><InitiatorTransactionKey>4AH611453-3.17.4.2-positivoSeriesL-TKMVCR-0001</InitiatorTransactionKey><AuthorizationDateTime>20260831121459</AuthorizationDateTime><CaptureLocalDateTime>20260831091459</CaptureLocalDateTime><EntryMode>1</EntryMode><Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>216.670000</GrossAmount><NetAmount>206.746515</NetAmount><PaymentDate>20260901</PaymentDate><OriginalPaymentDate>20260901</OriginalPaymentDate><SaleFee>9.923485</SaleFee><AdvancedReceivableOriginalPaymentDate>20260930</AdvancedReceivableOriginalPaymentDate><PaymentId>6028220092</PaymentId><WalletTypeId>7</WalletTypeId><WalletNatureId>8</WalletNatureId></Installment><Installment><InstallmentNumber>2</InstallmentNumber><GrossAmount>216.660000</GrossAmount><NetAmount>206.736972</NetAmount><PaymentDate>20260901</PaymentDate><OriginalPaymentDate>20260901</OriginalPaymentDate><SaleFee>9.923028</SaleFee><AdvancedReceivableOriginalPaymentDate>20261030</AdvancedReceivableOriginalPaymentDate><PaymentId>6028220176</PaymentId><WalletTypeId>7</WalletTypeId><WalletNatureId>1</WalletNatureId></Installment></Installments></Transaction></FinancialTransactionsAccounts><Payments>0</Payments><Trailer><CapturedTransactionsQuantity>15</CapturedTransactionsQuantity><CanceledTransactionsQuantity>0</CanceledTransactionsQuantity><PaidInstallmentsQuantity>31</PaidInstallmentsQuantity><ChargebacksQuantity>0</ChargebacksQuantity></Trailer></Conciliation>`;

describe("datas do arquivo", () => {
  it("converte AAAAMMDD", () => expect(dataDoArquivo("20260901")).toBe("2026-09-01"));
  it("zerada vira nulo", () => expect(dataDoArquivo("00000000")).toBeNull());
  it("vazia vira nulo", () => expect(dataDoArquivo(null)).toBeNull());
  it("converte data e hora", () =>
    expect(dataHoraDoArquivo("20260901122348")).toBe("2026-09-01T12:23:48"));
});

describe("parser do arquivo da Stone", () => {
  const c = parseConciliacaoStone(ARQUIVO);

  it("lê o cabeçalho", () => {
    expect(c.cabecalho).toMatchObject({
      stoneCode: "146659798",
      referenceDate: "2026-09-01",
      layout: "2.4",
    });
  });

  it("a venda capturada vem com a previsão de crédito", () => {
    const p = c.capturadas[0];
    expect(p).toMatchObject({
      transacaoKey: "34463164122941",
      autorizacao: "133309",
      serialPos: "4AH611453",
      parcela: 1,
      parcelas: 1,
      bruto: 386.99,
      liquido: 375.81,
      previsaoPagamento: "2026-10-01",
      origem: "capturada",
      pagamentoEm: null,
    });
  });

  it("na previsão, a taxa é a diferença entre bruto e líquido", () => {
    expect(c.capturadas[0].taxa).toBe(11.18);
  });

  it("a parcela liquidada traz a data do crédito e a taxa em reais", () => {
    const p = c.liquidadas[0];
    expect(p).toMatchObject({
      transacaoKey: "34363141620361",
      parcela: 1,
      bruto: 216.67,
      liquido: 206.75,
      taxa: 9.92,
      pagamentoEm: "2026-09-01",
      paymentId: "6028220092",
      origem: "liquidada",
    });
  });

  it("antecipação aparece com a data em que cairia", () => {
    expect(c.liquidadas.map((p) => p.antecipadaDe)).toEqual(["2026-09-30", "2026-10-30"]);
  });

  it("uma transação parcelada vira várias parcelas", () => {
    expect(c.liquidadas).toHaveLength(2);
    expect(c.liquidadas.map((p) => p.parcela)).toEqual([1, 2]);
  });

  it("lê os contadores do trailer", () => {
    expect(c.trailer.CapturedTransactionsQuantity).toBe(15);
    expect(c.trailer.PaidInstallmentsQuantity).toBe(31);
  });

  it("o id da parcela é estável entre previsão e liquidação", () => {
    expect(idDaParcela("146659798", c.capturadas[0])).toBe("146659798_34463164122941_1");
    expect(idDaParcela("146659798", c.liquidadas[1])).toBe("146659798_34363141620361_2");
  });

  it("arquivo vazio não quebra", () => {
    const v = parseConciliacaoStone("<Conciliation><Header></Header></Conciliation>");
    expect(v.capturadas).toEqual([]);
    expect(v.liquidadas).toEqual([]);
  });
});

describe("contra o arquivo real inteiro", () => {
  const caminho = process.env.STONE_XML;
  it.skipIf(!caminho)("os contadores do trailer batem com o que foi lido", () => {
    const c = parseConciliacaoStone(readFileSync(caminho!, "utf8"));
    const transacoes = new Set(c.capturadas.map((p) => p.transacaoKey));
    expect(transacoes.size).toBe(c.trailer.CapturedTransactionsQuantity);
    expect(c.liquidadas.length).toBe(c.trailer.PaidInstallmentsQuantity);
  });
});

describe("dias do período", () => {
  it("inclui as duas pontas", () => {
    expect(diasDoPeriodo("2026-08-30", "2026-09-02")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("um dia só devolve um dia", () => {
    expect(diasDoPeriodo("2026-09-01", "2026-09-01")).toEqual(["2026-09-01"]);
  });

  it("período invertido não devolve nada", () => {
    expect(diasDoPeriodo("2026-09-05", "2026-09-01")).toEqual([]);
  });
});

describe("cancelamento e eventos financeiros", () => {
  // Trecho real do arquivo de 14/08: a venda foi cancelada e a Stone cobra o
  // valor de volta do lojista em 14/08.
  // O <Events> no começo tem um CONTADOR chamado <Cancellations> — é a
  // armadilha que fez o parser achar zero cancelamento no arquivo real.
  const XML = `<Conciliation><Header><StoneCode>146659798</StoneCode><ReferenceDate>20260814</ReferenceDate></Header>
  <FinancialTransactionsAccounts><Transaction><Events><CancellationCharges>1</CancellationCharges><Cancellations>0</Cancellations><Captures>0</Captures></Events><AcquirerTransactionKey>32563692311703</AcquirerTransactionKey><CaptureLocalDateTime>20260813125536</CaptureLocalDateTime><Cancellations><Cancellation><OperationKey>jrrtbeqfgwa13cxrhgy6rwy9c</OperationKey><CancellationDateTime>20260813125624</CancellationDateTime><ReturnedAmount>724.980000</ReturnedAmount><Billing><ChargedAmount>704.028079</ChargedAmount><ChargeDate>20260814</ChargeDate><OriginalChargeDate>20260814</OriginalChargeDate></Billing><PaymentId>5886393599</PaymentId></Cancellation></Cancellations></Transaction></FinancialTransactionsAccounts>
  <FinancialEvents><Event><EventId>283875520</EventId><Description>CrossBalance</Description><Type>11</Type><PrevisionPaymentDate>20260814</PrevisionPaymentDate><Amount>-704.030000</Amount></Event><Event><EventId>283875520</EventId><Description>CrossBalance</Description><Type>11</Type><PrevisionPaymentDate>20260814</PrevisionPaymentDate><Amount>704.030000</Amount></Event></FinancialEvents>
  <Trailer><ChargedCancellationsQuantity>1</ChargedCancellationsQuantity></Trailer></Conciliation>`;

  const c = parseConciliacaoStone(XML);

  it("lê o cancelamento com o que foi devolvido e o que a Stone cobra de volta", () => {
    expect(c.cancelamentos).toHaveLength(1);
    expect(c.cancelamentos[0]).toMatchObject({
      transacaoKey: "32563692311703",
      devolvido: 724.98,
      cobrado: 704.03,
      cobradoEm: "2026-08-14",
      paymentId: "5886393599",
    });
  });

  it("lê os eventos financeiros com sinal", () => {
    expect(c.eventos.map((e) => e.valor)).toEqual([-704.03, 704.03]);
    expect(c.eventos[0].descricao).toBe("CrossBalance");
    expect(c.eventos[0].data).toBe("2026-08-14");
  });

  it("arquivo sem cancelamento nem evento devolve listas vazias", () => {
    const v = parseConciliacaoStone("<Conciliation><Header></Header></Conciliation>");
    expect(v.cancelamentos).toEqual([]);
    expect(v.eventos).toEqual([]);
  });

  it("venda comum não vira cancelamento", () => {
    expect(parseConciliacaoStone(ARQUIVO).cancelamentos).toEqual([]);
  });
});
