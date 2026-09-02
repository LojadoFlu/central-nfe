import { describe, expect, it } from "vitest";
import { dataStone, estruturaDoXml } from "../functions/src/stone/client";

describe("data no formato da Stone", () => {
  it("converte AAAA-MM-DD em AAAAMMDD", () => {
    expect(dataStone("2026-08-31")).toBe("20260831");
  });
  it("aceita Date", () => {
    expect(dataStone(new Date(Date.UTC(2026, 7, 5)))).toBe("20260805");
  });
  it("ignora hora que venha junto", () => {
    expect(dataStone("2026-08-31T13:45:00Z")).toBe("20260831");
  });
});

describe("mapa da estrutura do XML", () => {
  const xml = `<?xml version="1.0"?>
    <Header><MerchantId>123</MerchantId></Header>
    <FinancialTransactions>
      <FinancialTransaction><Amount>10</Amount></FinancialTransaction>
      <FinancialTransaction><Amount>20</Amount></FinancialTransaction>
    </FinancialTransactions>`;

  it("conta cada elemento", () => {
    const m = new Map(estruturaDoXml(xml).map((x) => [x.tag, x.qtd]));
    expect(m.get("FinancialTransaction")).toBe(2);
    expect(m.get("Amount")).toBe(2);
    expect(m.get("Header")).toBe(1);
  });

  it("vem ordenado do mais frequente para o menos", () => {
    const l = estruturaDoXml(xml);
    expect(l[0].qtd).toBeGreaterThanOrEqual(l[l.length - 1].qtd);
  });

  it("não confunde fechamento de tag com elemento novo", () => {
    expect(estruturaDoXml("<a></a>").find((x) => x.tag === "a")?.qtd).toBe(1);
  });
});
