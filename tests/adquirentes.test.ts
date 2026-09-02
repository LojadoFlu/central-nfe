import { describe, expect, it } from "vitest";
import {
  adquirenteDoBanco,
  adquirenteDoPdv,
  ordenarAdquirentes,
} from "../functions/src/financeiro/adquirentes";

describe("adquirente pela descrição do PDV", () => {
  it("reconhece as descrições reais da base", () => {
    expect(adquirenteDoPdv("STONE CREDITO VISA")).toBe("Stone");
    expect(adquirenteDoPdv("STONE DEBITO MASTER")).toBe("Stone");
    expect(adquirenteDoPdv("STONE PIX")).toBe("Stone");
    expect(adquirenteDoPdv("MERCADO PAGO CREDITO")).toBe("Mercado Pago");
    expect(adquirenteDoPdv("CIELO DEBITO")).toBe("Cielo");
  });

  it("o que não se reconhece vira Outros, e não some", () => {
    expect(adquirenteDoPdv("GETNET CREDITO")).toBe("Outros");
    expect(adquirenteDoPdv(null)).toBe("Outros");
    expect(adquirenteDoPdv("")).toBe("Outros");
  });
});

describe("adquirente pelo lançamento do banco", () => {
  it("o histórico manda, quando diz o nome", () => {
    expect(adquirenteDoBanco("CIELO S.A. - Liquidação", "Itaú")).toBe("Cielo");
    expect(adquirenteDoBanco("MERCADO PAGO - transferência", "Itaú")).toBe("Mercado Pago");
  });

  it("conta de adquirente resolve o histórico genérico", () => {
    // O caso da loja do clube: a conta importada É a Conta Stone.
    expect(adquirenteDoBanco("Recebimento vendas - Antecipação | Crédito", "Stone Instituição de Pagamento S.A.")).toBe("Stone");
    expect(adquirenteDoBanco("Fulano de Tal - Pix | Maquininha", "Stone Instituição de Pagamento S.A.")).toBe("Stone");
  });

  it("banco comum com histórico genérico fica em Outros", () => {
    expect(adquirenteDoBanco("Recebimento vendas", "Itaú Unibanco")).toBe("Outros");
  });

  it("o histórico vence a instituição", () => {
    expect(adquirenteDoBanco("CIELO - repasse", "Stone Instituição de Pagamento S.A.")).toBe("Cielo");
  });
});

describe("ordem dos cards", () => {
  it("maior movimento primeiro e Outros por último", () => {
    const l = ordenarAdquirentes([
      { adquirente: "Outros" as const, banco: 999999, previsto: 0 },
      { adquirente: "Cielo" as const, banco: 100, previsto: 0 },
      { adquirente: "Stone" as const, banco: 5000, previsto: 4000 },
    ]);
    expect(l.map((x) => x.adquirente)).toEqual(["Stone", "Cielo", "Outros"]);
  });

  it("usa o maior entre banco e previsto — adquirente que só tem previsto não afunda", () => {
    const l = ordenarAdquirentes([
      { adquirente: "Stone" as const, banco: 10, previsto: 10 },
      { adquirente: "Cielo" as const, banco: 0, previsto: 5000 },
    ]);
    expect(l[0].adquirente).toBe("Cielo");
  });
});
