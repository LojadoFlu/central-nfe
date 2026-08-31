import { describe, expect, it } from "vitest";
import { folhaPorLoja } from "@/lib/comissoes/folha-pdf";
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
    valorDevido: 1712,
    pisoAplicado: true,
    memoria: [],
    divergencias: [],
    ...p,
  };
}

describe("folha por loja", () => {
  it("gratificação é o que passou do piso", () => {
    const [loja] = folhaPorLoja([
      linha({ funcionarioNome: "QUEM VENDEU", comissaoTotal: 2500, valorDevido: 2500, pisoAplicado: false }),
    ]);
    expect(loja.pessoas[0]).toMatchObject({ piso: 1712, gratificacao: 788, total: 2500 });
    expect(loja.piso + loja.gratificacao).toBeCloseTo(loja.total, 2);
  });

  it("quem ficou no piso não tem gratificação", () => {
    const [loja] = folhaPorLoja([linha({ comissaoTotal: 900 })]);
    expect(loja.pessoas[0]).toMatchObject({ piso: 1712, gratificacao: 0, total: 1712 });
  });

  it("sem piso, tudo é gratificação", () => {
    const [loja] = folhaPorLoja([
      linha({ piso: 0, comissaoTotal: 1200, valorDevido: 1200, pisoAplicado: false }),
    ]);
    expect(loja.pessoas[0]).toMatchObject({ piso: 0, gratificacao: 1200, total: 1200 });
  });

  it("separa por loja e deixa quem não tem loja por último", () => {
    const lojas = folhaPorLoja([
      linha({ funcionarioNome: "A", lojaId: null, lojaNome: null, cargoNome: "Supervisor Rede" }),
      linha({ funcionarioNome: "B", lojaId: 371, lojaNome: "FLU TIJUCA" }),
      linha({ funcionarioNome: "C" }),
    ]);
    expect(lojas.map((l) => l.lojaNome)).toEqual(["FLU BARRA", "FLU TIJUCA", "Rede (sem loja)"]);
  });

  it("soma da loja bate com a soma das pessoas", () => {
    const [loja] = folhaPorLoja([
      linha({ funcionarioNome: "A", comissaoTotal: 3000, valorDevido: 3000, pisoAplicado: false }),
      linha({ funcionarioNome: "B" }),
      linha({ funcionarioNome: "C", comissaoTotal: 1999.99, valorDevido: 1999.99, pisoAplicado: false }),
    ]);
    expect(loja.total).toBeCloseTo(3000 + 1712 + 1999.99, 2);
    expect(loja.piso).toBeCloseTo(1712 * 3, 2);
    expect(loja.gratificacao).toBeCloseTo(loja.total - loja.piso, 2);
  });

  it("ordena por cargo e depois por nome", () => {
    const [loja] = folhaPorLoja([
      linha({ funcionarioNome: "ZE", cargoNome: "Vendedor" }),
      linha({ funcionarioNome: "ANA", cargoNome: "Vendedor" }),
      linha({ funcionarioNome: "LIA", cargoNome: "Gerente" }),
    ]);
    expect(loja.pessoas.map((p) => p.nome)).toEqual(["LIA", "ANA", "ZE"]);
  });
});
