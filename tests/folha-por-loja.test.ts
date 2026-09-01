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
    descontosTotal: 0,
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

describe("folha por loja com descontos", () => {
  it("piso + gratificação − desconto fecha no total pago", () => {
    const [loja] = folhaPorLoja([
      linha({
        funcionarioNome: "QUEM RETIROU",
        comissaoTotal: 2500,
        valorDevido: 2300,
        descontosTotal: 200,
        pisoAplicado: false,
      }),
    ]);
    expect(loja.pessoas[0]).toMatchObject({
      piso: 1712,
      gratificacao: 788,
      desconto: 200,
      total: 2300,
    });
    expect(loja.piso + loja.gratificacao - loja.desconto).toBeCloseTo(loja.total, 2);
  });

  it("quem está no piso e levou produto não vira gratificação negativa", () => {
    const [loja] = folhaPorLoja([
      linha({ comissaoTotal: 900, valorDevido: 1612, descontosTotal: 100 }),
    ]);
    expect(loja.pessoas[0]).toMatchObject({
      piso: 1712,
      gratificacao: 0,
      desconto: 100,
      total: 1612,
    });
  });

  it("sem desconto nenhum, a loja segue com desconto zero", () => {
    const [loja] = folhaPorLoja([linha({})]);
    expect(loja.desconto).toBe(0);
  });
});

describe("faltas no relatório da loja", () => {
  it("soma os dias de cada pessoa e da loja", () => {
    const [loja] = folhaPorLoja([
      linha({ funcionarioNome: "A", faltas: { dias: 2 }, descontosTotal: 171.21, valorDevido: 1540.79 }),
      linha({ funcionarioNome: "B" }),
      linha({ funcionarioNome: "C", faltas: { dias: 1 }, descontosTotal: 114.14, valorDevido: 1597.86 }),
    ]);
    expect(loja.faltas).toBe(3);
    expect(loja.pessoas.map((p) => p.faltas)).toEqual([2, 0, 1]);
    expect(loja.desconto).toBe(285.35);
  });

  it("loja sem falta nenhuma fica com zero", () => {
    expect(folhaPorLoja([linha({})])[0].faltas).toBe(0);
  });
});

describe("cargo sem gratificação no relatório", () => {
  it("esconde só a gratificação daquele cargo", () => {
    const [loja] = folhaPorLoja(
      [
        linha({ funcionarioNome: "SUPERVISOR", cargoId: "sup", cargoNome: "Supervisor Rede", comissaoTotal: 16380, valorDevido: 16380, pisoAplicado: false }),
        linha({ funcionarioNome: "VENDEDOR", comissaoTotal: 2500, valorDevido: 2500, pisoAplicado: false }),
      ],
      new Set(["sup"]),
    );
    expect(loja.pessoas.map((p) => p.ocultaGratificacao)).toEqual([true, false]);
  });

  it("o valor continua na conta da loja — só não é impresso", () => {
    const [loja] = folhaPorLoja(
      [linha({ cargoId: "sup", comissaoTotal: 16380, valorDevido: 16380, pisoAplicado: false })],
      new Set(["sup"]),
    );
    expect(loja.pessoas[0].gratificacao).toBe(14668);
    expect(loja.gratificacao).toBe(14668);
    expect(loja.total).toBe(16380);
  });

  it("sem cargos marcados, ninguém esconde nada", () => {
    const [loja] = folhaPorLoja([linha({ cargoId: "sup" })]);
    expect(loja.pessoas[0].ocultaGratificacao).toBe(false);
  });
});
