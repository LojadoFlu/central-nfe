// Testes do motor de comissões (§42 do plano) + casos de borda que já apareceram
// em discussão de folha: faixa progressiva, condição do gerente e piso × estorno.

import { describe, expect, it } from "vitest";
import {
  apurar,
  escolherMeta,
  escolherRegra,
  pisoEfetivo,
  vigente,
} from "../functions/src/comissoes/motor";
import {
  consolidar,
  dataPagamentoFolha,
  estornoDeVendaCancelada,
  limitesDaCompetencia,
  somarLojas,
  type VendaBruta,
} from "../functions/src/comissoes/consolidacao";
import type {
  Bonus,
  EntradaApuracao,
  Funcionario,
  Meta,
  Regra,
} from "../functions/src/comissoes/tipos";

const JOAO: Funcionario = {
  id: "joao",
  nome: "João",
  cargoId: "vendedor",
  lojaId: 582,
  pdvVendedorId: "05820001",
  pisoGarantido: 1800,
  ativo: true,
};

/** Regra de percentual único (faixa em R$ a partir de zero). */
function regraSimples(percentual: number, extra: Partial<Regra> = {}): Regra {
  return {
    id: "r1",
    nome: "Vendedor padrão",
    ativo: true,
    cargoId: "vendedor",
    componentes: [
      {
        id: "c1",
        rotulo: "Venda própria",
        escopoVenda: "individual",
        baseCalculo: "liquida",
        baseFaixa: "valor",
        modelo: "integral",
        faixas: [{ de: 0, percentual }],
      },
    ],
    vigenciaDe: "2026-01",
    vigenciaAte: null,
    ...extra,
  };
}

function entrada(over: Partial<EntradaApuracao> = {}): EntradaApuracao {
  return {
    competencia: "2026-08",
    funcionario: JOAO,
    vendas: {
      individual: { liquida: 0, bruta: 0 },
      loja: { liquida: 0, bruta: 0 },
      grupo: { liquida: 0, bruta: 0 },
    },
    metas: { individual: null, loja: null, grupo: null },
    regra: null,
    bonus: [],
    ajustes: [],
    regraPiso: "maior",
    ...over,
  };
}

describe("§5 — piso garantido × comissão", () => {
  it("Caso 1: comissão abaixo do piso → paga o piso", () => {
    // 1.200 de comissão = 2% sobre 60.000
    const r = apurar(
      entrada({
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 60_000, bruta: 60_000 },
          loja: { liquida: 60_000, bruta: 60_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoTotal).toBe(1200);
    expect(r.piso).toBe(1800);
    expect(r.valorDevido).toBe(1800);
    expect(r.pisoAplicado).toBe(true);
  });

  it("Caso 2: comissão acima do piso → paga a comissão", () => {
    const r = apurar(
      entrada({
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 125_000, bruta: 125_000 },
          loja: { liquida: 125_000, bruta: 125_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoTotal).toBe(2500);
    expect(r.valorDevido).toBe(2500);
    expect(r.pisoAplicado).toBe(false);
  });

  it("nunca soma piso + comissão no modo padrão", () => {
    const r = apurar(
      entrada({
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 125_000, bruta: 125_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.valorDevido).not.toBe(r.piso + r.comissaoTotal);
  });

  it('modo "soma" é opt-in e aí sim soma (configurável)', () => {
    const r = apurar(
      entrada({
        regraPiso: "soma",
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.valorDevido).toBe(3800); // 1.800 + 2.000
  });
});

describe("§6/§8 — percentual e faixas", () => {
  it("Caso 3: 100.000 a 2% = 2.000", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoBase).toBe(2000);
    expect(r.valorDevido).toBe(2000);
  });

  it("Tipo A (integral): 85.000 na supermeta de 80.000 → 2% sobre tudo", () => {
    const regra = regraSimples(0);
    regra.componentes[0].faixas = [
      { de: 0, percentual: 1 },
      { de: 60_000, percentual: 1.5, rotulo: "Meta" },
      { de: 80_000, percentual: 2, rotulo: "Supermeta" },
    ];
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra,
        vendas: {
          individual: { liquida: 85_000, bruta: 85_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoBase).toBe(1700);
  });

  it("Tipo B (progressivo): cada fatia no seu percentual", () => {
    const regra = regraSimples(0);
    regra.componentes[0].modelo = "progressivo";
    regra.componentes[0].faixas = [
      { de: 0, percentual: 1 },
      { de: 60_000, percentual: 1.5 },
      { de: 80_000, percentual: 2 },
    ];
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra,
        vendas: {
          individual: { liquida: 85_000, bruta: 85_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    // 60.000×1% + 20.000×1,5% + 5.000×2% = 600 + 300 + 100
    expect(r.comissaoBase).toBe(1000);
  });

  it("faixas por % da meta (§35)", () => {
    const regra = regraSimples(0);
    regra.componentes[0].baseFaixa = "percentualMeta";
    regra.componentes[0].faixas = [
      { de: 0, percentual: 1 },
      { de: 80, percentual: 1.5 },
      { de: 100, percentual: 2 },
      { de: 120, percentual: 2.5 },
    ];
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra,
        metas: { individual: 80_000, loja: null, grupo: null },
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    // 125% da meta → faixa de 120% → 2,5% sobre 100.000
    expect(r.comissaoBase).toBe(2500);
    expect(r.atingimentoPct).toBe(125);
  });
});

describe("§17 — cancelamento e estorno", () => {
  const vendas: VendaBruta[] = [
    { id: "v1", lojaId: 582, dia: "2026-08-03", vendedorId: "05820001", valorTotal: 1000, cancelada: false },
    { id: "v2", lojaId: 582, dia: "2026-08-04", vendedorId: "05820001", valorTotal: 500, cancelada: true },
    { id: "v3", lojaId: 582, dia: "2026-08-05", vendedorId: null, valorTotal: 300, cancelada: false },
    { id: "v4", lojaId: 371, dia: "2026-08-05", vendedorId: "03710002", valorTotal: 2000, cancelada: false },
  ];

  it("Caso 4: venda cancelada não entra na base de cálculo", () => {
    const c = consolidar(vendas);
    expect(c.porVendedor.get("05820001")?.liquida).toBe(1000);
    expect(c.canceladas).toEqual({ qtd: 1, valor: 500 });
  });

  it("venda sem vendedor fica separada para correção (§30)", () => {
    const c = consolidar(vendas);
    expect(c.semVendedor.qtd).toBe(1);
    expect(c.semVendedor.ids).toEqual(["v3"]);
    // ainda soma no total da loja (o faturamento existiu)
    expect(c.porLoja.get(582)?.liquida).toBe(1300);
  });

  it("melhor vendedor é apurado por loja", () => {
    const c = consolidar(vendas);
    expect(c.melhorVendedorPorLoja.get(582)).toBe("05820001");
    expect(c.melhorVendedorPorLoja.get(371)).toBe("03710002");
  });

  it("Caso 6: venda de mês anterior cancelada vira ajuste negativo", () => {
    expect(estornoDeVendaCancelada(1000, 2)).toBe(-20);
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        ajustes: [
          {
            id: "a1",
            funcionarioId: "joao",
            competencia: "2026-08",
            valor: -20,
            motivo: "Estorno da venda v9 (jul/26) cancelada",
            tipo: "estorno",
          },
        ],
      }),
    );
    expect(r.ajustesTotal).toBe(-20);
    expect(r.comissaoTotal).toBe(1980);
  });

  it("estorno some dentro do piso — e o motor avisa", () => {
    const r = apurar(
      entrada({
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 50_000, bruta: 50_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        ajustes: [
          { id: "a1", funcionarioId: "joao", competencia: "2026-08", valor: -20, motivo: "Estorno", tipo: "estorno" },
        ],
      }),
    );
    expect(r.valorDevido).toBe(1800);
    expect(r.memoria.some((l) => l.detalhe.includes("absorvido pelo piso"))).toBe(true);
  });
});

describe("§5/§10 — piso vem do cargo, com exceção individual", () => {
  const pisoDoCargo = new Map<string, number | null>([
    ["vendedor", 1800],
    ["gerente", 3000],
    ["estagiario", null],
  ]);

  it("sem piso próprio, herda o do cargo", () => {
    const r = pisoEfetivo({ ...JOAO, pisoGarantido: null }, pisoDoCargo);
    expect(r).toEqual({ valor: 1800, origem: "cargo" });
  });

  it("piso individual sobrepõe o do cargo", () => {
    const r = pisoEfetivo({ ...JOAO, pisoGarantido: 2200 }, pisoDoCargo);
    expect(r).toEqual({ valor: 2200, origem: "funcionario" });
  });

  it("piso individual de zero é respeitado (não cai para o do cargo)", () => {
    const r = pisoEfetivo({ ...JOAO, pisoGarantido: 0 }, pisoDoCargo);
    expect(r).toEqual({ valor: 0, origem: "funcionario" });
  });

  it("cargo sem piso e pessoa sem piso → sem piso", () => {
    const r = pisoEfetivo({ ...JOAO, cargoId: "estagiario", pisoGarantido: null }, pisoDoCargo);
    expect(r).toEqual({ valor: null, origem: null });
  });

  it("funcionário sem cargo não herda nada", () => {
    const r = pisoEfetivo({ ...JOAO, cargoId: null, pisoGarantido: null }, pisoDoCargo);
    expect(r.valor).toBeNull();
  });

  it("o piso herdado do cargo segura o pagamento igual ao próprio", () => {
    const piso = pisoEfetivo({ ...JOAO, pisoGarantido: null }, pisoDoCargo);
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: piso.valor },
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 60_000, bruta: 60_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.valorDevido).toBe(1800);
    expect(r.pisoAplicado).toBe(true);
  });
});

describe("§36 — hierarquia de regras", () => {
  const padrao = regraSimples(2);
  const individual = regraSimples(2.3, { id: "r2", nome: "João (acordo)", cargoId: null, funcionarioId: "joao" });

  it("Caso 5: regra individual vence a regra do cargo", () => {
    const escolhida = escolherRegra([padrao, individual], JOAO, "2026-08");
    expect(escolhida?.id).toBe("r2");
  });

  it("colega sem regra individual continua na regra do cargo", () => {
    const maria: Funcionario = { ...JOAO, id: "maria", nome: "Maria" };
    expect(escolherRegra([padrao, individual], maria, "2026-08")?.id).toBe("r1");
  });

  it("cargo + loja vence cargo puro", () => {
    const daLoja = regraSimples(2.1, { id: "r3", lojaId: 582 });
    expect(escolherRegra([padrao, daLoja], JOAO, "2026-08")?.id).toBe("r3");
  });

  it("regra de outra loja não se aplica", () => {
    const outraLoja = regraSimples(9, { id: "r4", lojaId: 999 });
    expect(escolherRegra([padrao, outraLoja], JOAO, "2026-08")?.id).toBe("r1");
  });
});

describe("§33 — vigência histórica", () => {
  const antiga = regraSimples(2, { id: "old", vigenciaDe: "2026-01", vigenciaAte: "2026-07" });
  const nova = regraSimples(2.2, { id: "new", vigenciaDe: "2026-08", vigenciaAte: null });

  it("Caso 7: julho usa a regra antiga; agosto usa a nova", () => {
    expect(escolherRegra([antiga, nova], JOAO, "2026-07")?.id).toBe("old");
    expect(escolherRegra([antiga, nova], JOAO, "2026-08")?.id).toBe("new");
  });

  it("competência anterior à vigência não pega regra nenhuma", () => {
    expect(escolherRegra([nova], JOAO, "2026-07")).toBeNull();
    expect(vigente(nova, "2025-12")).toBe(false);
  });

  it("o valor de julho não muda quando a regra de agosto entra", () => {
    const julho = apurar(
      entrada({
        competencia: "2026-07",
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: escolherRegra([antiga, nova], JOAO, "2026-07"),
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(julho.comissaoBase).toBe(2000);
  });
});

describe("a meta que vale para cada cargo", () => {
  it("vendedor é medido pela venda própria", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: regraSimples(2),
        metas: { individual: 80_000, loja: 400_000, grupo: null },
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 500_000, bruta: 500_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.escopoMeta).toBe("individual");
    expect(r.metaConsiderada).toBe(80_000);
    expect(r.atingimentoPct).toBe(125);
  });

  it("gerente é medido pela loja, mesmo tendo componente de venda própria", () => {
    const regra = regraSimples(1);
    regra.componentes.push({
      id: "c2",
      rotulo: "Loja",
      escopoVenda: "loja",
      baseCalculo: "liquida",
      baseFaixa: "valor",
      modelo: "integral",
      faixas: [{ de: 0, percentual: 0.5 }],
    });
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra,
        metas: { individual: 80_000, loja: 400_000, grupo: null },
        vendas: {
          individual: { liquida: 20_000, bruta: 20_000 },
          loja: { liquida: 500_000, bruta: 500_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.escopoMeta).toBe("loja");
    expect(r.metaConsiderada).toBe(400_000);
    expect(r.atingimentoPct).toBe(125);
  });

  it("supervisor é medido pelo grupo de lojas", () => {
    const regra = regraSimples(0);
    regra.componentes[0].escopoVenda = "grupo";
    regra.componentes[0].faixas = [{ de: 0, percentual: 0.15 }];
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra,
        metas: { individual: 80_000, loja: 400_000, grupo: 1_800_000 },
        vendas: {
          individual: { liquida: 0, bruta: 0 },
          loja: { liquida: 500_000, bruta: 500_000 },
          grupo: { liquida: 2_000_000, bruta: 2_000_000 },
        },
      }),
    );
    expect(r.escopoMeta).toBe("grupo");
    expect(r.metaConsiderada).toBe(1_800_000);
    expect(r.comissaoBase).toBe(3000);
  });
});

describe("§11/§13 — gerente e supervisor", () => {
  const GERENTE: Funcionario = {
    id: "ana",
    nome: "Ana",
    cargoId: "gerente",
    lojaId: 582,
    pisoGarantido: 0,
    ativo: true,
  };
  const regraGerente: Regra = {
    id: "rg",
    nome: "Gerente",
    ativo: true,
    cargoId: "gerente",
    componentes: [
      {
        id: "c1",
        rotulo: "Venda própria",
        escopoVenda: "individual",
        baseCalculo: "liquida",
        baseFaixa: "valor",
        modelo: "integral",
        faixas: [{ de: 0, percentual: 1 }],
      },
      {
        id: "c2",
        rotulo: "Loja bateu a meta",
        escopoVenda: "loja",
        baseCalculo: "liquida",
        baseFaixa: "valor",
        modelo: "integral",
        faixas: [{ de: 0, percentual: 0.5 }],
        condicao: { tipo: "atingimentoLoja", minimoPct: 100 },
      },
    ],
    vigenciaDe: "2026-01",
    vigenciaAte: null,
  };

  it("paga os dois componentes quando a loja bate a meta", () => {
    const r = apurar(
      entrada({
        funcionario: GERENTE,
        regra: regraGerente,
        metas: { individual: null, loja: 400_000, grupo: null },
        vendas: {
          individual: { liquida: 20_000, bruta: 20_000 },
          loja: { liquida: 420_000, bruta: 420_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    // 20.000×1% + 420.000×0,5%
    expect(r.comissaoBase).toBe(2300);
  });

  it("não paga o componente da loja quando a meta não é batida", () => {
    const r = apurar(
      entrada({
        funcionario: GERENTE,
        regra: regraGerente,
        metas: { individual: null, loja: 400_000, grupo: null },
        vendas: {
          individual: { liquida: 20_000, bruta: 20_000 },
          loja: { liquida: 380_000, bruta: 380_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoBase).toBe(200);
    expect(r.memoria.some((l) => l.informativa && l.detalhe.includes("exige atingimento"))).toBe(true);
  });

  it("supervisor comissiona sobre o grupo de lojas", () => {
    const porLoja = new Map([
      [582, { liquida: 500_000, bruta: 500_000, qtd: 10 }],
      [371, { liquida: 700_000, bruta: 700_000, qtd: 12 }],
      [423, { liquida: 800_000, bruta: 800_000, qtd: 15 }],
      [999, { liquida: 100_000, bruta: 100_000, qtd: 2 }],
    ]);
    const grupo = somarLojas(porLoja, [582, 371, 423]);
    expect(grupo.liquida).toBe(2_000_000);

    const r = apurar(
      entrada({
        funcionario: {
          id: "sup",
          nome: "Supervisor",
          cargoId: "supervisor",
          lojaId: 582,
          lojasGrupo: [582, 371, 423],
          pisoGarantido: 0,
          ativo: true,
        },
        regra: {
          id: "rs",
          nome: "Supervisor",
          ativo: true,
          cargoId: "supervisor",
          componentes: [
            {
              id: "c1",
              rotulo: "Grupo de lojas",
              escopoVenda: "grupo",
              baseCalculo: "liquida",
              baseFaixa: "valor",
              modelo: "integral",
              faixas: [{ de: 0, percentual: 0.15 }],
            },
          ],
          vigenciaDe: "2026-01",
          vigenciaAte: null,
        },
        vendas: {
          individual: { liquida: 0, bruta: 0 },
          loja: { liquida: 500_000, bruta: 500_000 },
          grupo: { liquida: grupo.liquida, bruta: grupo.bruta },
        },
      }),
    );
    expect(r.comissaoBase).toBe(3000);
  });
});

describe("§14 — bônus", () => {
  const bonusMeta: Bonus = {
    id: "b1",
    nome: "Bateu a meta",
    ativo: true,
    cargoId: "vendedor",
    gatilho: { tipo: "atingimentoIndividual", minimoPct: 100 },
    premio: { tipo: "percentual", valor: 0.2, escopoVenda: "individual", baseCalculo: "liquida" },
    vigenciaDe: "2026-01",
    vigenciaAte: null,
  };
  const bonusFixo: Bonus = {
    id: "b2",
    nome: "Melhor vendedor",
    ativo: true,
    cargoId: "vendedor",
    gatilho: { tipo: "melhorVendedorLoja" },
    premio: { tipo: "fixo", valor: 300 },
    vigenciaDe: "2026-01",
    vigenciaAte: null,
  };

  it("percentual sobre a venda quando bate a meta; fixo quando é o melhor", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: regraSimples(2),
        metas: { individual: 80_000, loja: null, grupo: null },
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        bonus: [bonusMeta, bonusFixo],
        extras: { melhorVendedorLoja: true },
      }),
    );
    expect(r.bonusTotal).toBe(500); // 200 + 300
    expect(r.comissaoTotal).toBe(2500);
  });

  it("bônus não pago quando o gatilho não bate", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: regraSimples(2),
        metas: { individual: 80_000, loja: null, grupo: null },
        vendas: {
          individual: { liquida: 70_000, bruta: 70_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        bonus: [bonusMeta, bonusFixo],
        extras: { melhorVendedorLoja: false },
      }),
    );
    expect(r.bonusTotal).toBe(0);
    expect(r.memoria.filter((l) => l.informativa && l.rotulo.startsWith("Bônus")).length).toBe(2);
  });
});

describe("percentual efetivo (base do estorno)", () => {
  const bonusMetaBase: Bonus = {
    id: "b1",
    nome: "Meta base",
    ativo: true,
    cargoId: "vendedor",
    gatilho: { tipo: "atingimentoIndividual", minimoPct: 50 },
    premio: { tipo: "percentual", valor: 4, escopoVenda: "individual", baseCalculo: "liquida" },
    vigenciaDe: "2026-01",
    vigenciaAte: null,
  };

  it("conta o bônus: quem paga só por bônus não pode ficar com 0%", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: null,
        metas: { individual: 40_000, loja: null, grupo: null },
        vendas: {
          individual: { liquida: 40_000, bruta: 40_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        bonus: [bonusMetaBase],
      }),
    );
    expect(r.comissaoBase).toBe(0);
    expect(r.bonusTotal).toBe(1600);
    expect(r.percentualEfetivo).toBe(4); // e não 0
  });

  it("ajuste não entra no percentual — é correção pontual, não taxa", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        ajustes: [
          { id: "a", funcionarioId: "joao", competencia: "2026-08", valor: 500, motivo: "x", tipo: "manual" },
        ],
      }),
    );
    expect(r.percentualEfetivo).toBe(2);
  });

  it("meta e supermeta NÃO acumulam: paga só o degrau mais alto atingido", () => {
    const superMeta: Bonus = {
      ...bonusMetaBase,
      id: "b2",
      nome: "Supermeta",
      gatilho: { tipo: "atingimentoIndividual", minimoPct: 125 },
      premio: { tipo: "percentual", valor: 4.5, escopoVenda: "individual", baseCalculo: "liquida" },
    };
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: null,
        metas: { individual: 40_000, loja: null, grupo: null },
        vendas: {
          individual: { liquida: 50_000, bruta: 50_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        bonus: [bonusMetaBase, superMeta],
      }),
    );
    // 125% da meta → 4,5% sobre os 50.000. E não 4% + 4,5%.
    expect(r.bonusTotal).toBe(2250);
    expect(r.percentualEfetivo).toBe(4.5);
    expect(
      r.memoria.some((m) => m.informativa && m.detalhe.includes("substituído por \"Supermeta\"")),
    ).toBe(true);
  });

  it("abaixo da supermeta, quem paga é a meta", () => {
    const superMeta: Bonus = {
      ...bonusMetaBase,
      id: "b2",
      nome: "Supermeta",
      gatilho: { tipo: "atingimentoIndividual", minimoPct: 125 },
      premio: { tipo: "percentual", valor: 4.5, escopoVenda: "individual", baseCalculo: "liquida" },
    };
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: null,
        metas: { individual: 40_000, loja: null, grupo: null },
        vendas: {
          individual: { liquida: 40_000, bruta: 40_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        bonus: [bonusMetaBase, superMeta],
      }),
    );
    expect(r.bonusTotal).toBe(1600); // 40.000 × 4%
    expect(r.percentualEfetivo).toBe(4);
  });

  it("bônus que não é degrau de meta continua somando", () => {
    const superMeta: Bonus = {
      ...bonusMetaBase,
      id: "b2",
      nome: "Supermeta",
      gatilho: { tipo: "atingimentoIndividual", minimoPct: 125 },
      premio: { tipo: "percentual", valor: 4.5, escopoVenda: "individual", baseCalculo: "liquida" },
    };
    const melhorVendedor: Bonus = {
      ...bonusMetaBase,
      id: "b3",
      nome: "Melhor vendedor",
      gatilho: { tipo: "melhorVendedorLoja" },
      premio: { tipo: "fixo", valor: 300 },
    };
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: null,
        metas: { individual: 40_000, loja: null, grupo: null },
        vendas: {
          individual: { liquida: 50_000, bruta: 50_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
        bonus: [bonusMetaBase, superMeta, melhorVendedor],
        extras: { melhorVendedorLoja: true },
      }),
    );
    // supermeta 2.250 (substitui a meta) + prêmio de melhor vendedor 300
    expect(r.bonusTotal).toBe(2550);
  });

  it("degrau da loja e degrau individual não competem entre si", () => {
    const metaIndividual: Bonus = { ...bonusMetaBase, id: "bi", nome: "Meta individual" };
    const metaLoja: Bonus = {
      ...bonusMetaBase,
      id: "bl",
      nome: "Meta da loja",
      gatilho: { tipo: "atingimentoLoja", minimoPct: 100 },
      premio: { tipo: "percentual", valor: 0.5, escopoVenda: "loja", baseCalculo: "liquida" },
    };
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: null,
        metas: { individual: 40_000, loja: 400_000, grupo: null },
        vendas: {
          individual: { liquida: 50_000, bruta: 50_000 },
          loja: { liquida: 500_000, bruta: 500_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
        bonus: [metaIndividual, metaLoja],
      }),
    );
    // 50.000 × 4% + 500.000 × 0,5%
    expect(r.bonusTotal).toBe(4500);
  });

  it("a mesma coisa como FAIXA de regra: só a faixa atingida vale", () => {
    const regra = regraSimples(0);
    regra.componentes[0].baseFaixa = "percentualMeta";
    regra.componentes[0].faixas = [
      { de: 50, percentual: 4, rotulo: "Meta" },
      { de: 125, percentual: 4.5, rotulo: "Supermeta" },
    ];
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra,
        metas: { individual: 40_000, loja: null, grupo: null },
        vendas: {
          individual: { liquida: 50_000, bruta: 50_000 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoBase).toBe(2250); // 50.000 × 4,5%, não 8,5%
    expect(r.percentualEfetivo).toBe(4.5);
  });
});

describe("§31 — divergências e §9 — metas", () => {
  it("aponta funcionário sem regra e sem piso", () => {
    const r = apurar(entrada({ funcionario: { ...JOAO, pisoGarantido: null } }));
    expect(r.divergencias).toContain("Funcionário sem piso cadastrado.");
    expect(r.divergencias).toContain("Nenhuma regra de comissão vigente para este funcionário.");
    expect(r.valorDevido).toBe(0);
  });

  it("meta individual vence meta do cargo e da loja", () => {
    const metas: Meta[] = [
      { id: "m1", competencia: "2026-08", lojaId: 582, valor: 500_000 },
      { id: "m2", competencia: "2026-08", cargoId: "vendedor", lojaId: 582, valor: 70_000 },
      { id: "m3", competencia: "2026-08", funcionarioId: "joao", valor: 100_000 },
    ];
    expect(escolherMeta(metas, JOAO, "2026-08")).toBe(100_000);
  });

  it("meta de outra competência não vaza", () => {
    const metas: Meta[] = [{ id: "m1", competencia: "2026-07", funcionarioId: "joao", valor: 90_000 }];
    expect(escolherMeta(metas, JOAO, "2026-08")).toBeNull();
  });
});

describe("utilitários de competência", () => {
  it("limites do mês", () => {
    expect(limitesDaCompetencia("2026-08")).toEqual({ de: "2026-08-01", ate: "2026-08-31" });
    expect(limitesDaCompetencia("2026-02")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(limitesDaCompetencia("2028-02")).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
  });

  it("§25 — data de pagamento da folha variável", () => {
    expect(dataPagamentoFolha("2026-08", 5)).toBe("2026-09-05");
    expect(dataPagamentoFolha("2026-12", 5)).toBe("2027-01-05"); // vira o ano
    expect(dataPagamentoFolha("2026-08", 5, "mesmo")).toBe("2026-08-05");
    expect(dataPagamentoFolha("2026-08", 31)).toBe("2026-09-28"); // limitado a 28
  });
});
