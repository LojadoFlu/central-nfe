import { describe, expect, it } from "vitest";
import { custoDaFolha, custoDaLinha } from "@/lib/comissoes/custo";
import type { LinhaApuracao } from "@/lib/comissoes/tipos";

function linha(p: Partial<LinhaApuracao>): LinhaApuracao {
  return {
    funcionarioId: "f",
    funcionarioNome: "FULANO",
    competencia: "2026-08",
    cargoId: "c",
    cargoNome: "Vendedor",
    lojaId: 582,
    lojaNome: "FLU BARRA",
    empresaId: null,
    pdvVendedorId: null,
    regraId: null,
    regraNome: null,
    pisoOrigem: "cargo",
    vendaProjetada: null,
    comissaoProjetada: null,
    valorDevidoProjetado: null,
    vendaConsiderada: 0,
    metaConsiderada: null,
    escopoMeta: "individual",
    atingimentoPct: null,
    percentualEfetivo: null,
    comissaoBase: 0,
    bonusTotal: 0,
    ajustesTotal: 0,
    comissaoTotal: 0,
    piso: 1712,
    descontosTotal: 0,
    valorDevido: 1712,
    pisoAplicado: true,
    memoria: [],
    divergencias: [],
    ...p,
  };
}

describe("custo da folha: piso × comissão", () => {
  it("quem está no piso é só piso", () => {
    expect(custoDaLinha(linha({ comissaoTotal: 900 }))).toEqual({
      piso: 1712,
      comissao: 0,
      desconto: 0,
      total: 1712,
    });
  });

  it("quem passou do piso divide entre os dois", () => {
    expect(
      custoDaLinha(linha({ comissaoTotal: 2500, valorDevido: 2500, pisoAplicado: false })),
    ).toEqual({ piso: 1712, comissao: 788, desconto: 0, total: 2500 });
  });

  it("o desconto sai do total, não do piso nem da comissão", () => {
    expect(
      custoDaLinha(
        linha({ comissaoTotal: 2500, valorDevido: 2300, descontosTotal: 200, pisoAplicado: false }),
      ),
    ).toEqual({ piso: 1712, comissao: 788, desconto: 200, total: 2300 });
  });

  it("caixa, que só tem fixo, entra inteira no piso", () => {
    expect(custoDaLinha(linha({ cargoNome: "Caixa", semComissao: true }))).toMatchObject({
      piso: 1712,
      comissao: 0,
    });
  });

  it("sem piso cadastrado, tudo é comissão", () => {
    expect(
      custoDaLinha(linha({ piso: 0, comissaoTotal: 1200, valorDevido: 1200, pisoAplicado: false })),
    ).toMatchObject({ piso: 0, comissao: 1200 });
  });

  it("o total da folha fecha: piso + comissão − descontos", () => {
    const c = custoDaFolha([
      linha({ comissaoTotal: 900 }),
      linha({ comissaoTotal: 2500, valorDevido: 2500, pisoAplicado: false }),
      linha({ comissaoTotal: 3000, valorDevido: 2800, descontosTotal: 200, pisoAplicado: false }),
    ]);
    expect(c.piso).toBe(1712 * 3);
    expect(c.comissao).toBe(788 + 1288);
    expect(c.desconto).toBe(200);
    expect(c.total).toBe(1712 + 2500 + 2800);
    expect(c.piso + c.comissao - c.desconto).toBeCloseTo(c.total, 2);
  });

  it("folha vazia é tudo zero", () => {
    expect(custoDaFolha([])).toEqual({ piso: 0, comissao: 0, desconto: 0, total: 0 });
  });
});
