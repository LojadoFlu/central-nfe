// Testes do motor de comissões (§42 do plano) + casos de borda que já apareceram
// em discussão de folha: faixa progressiva, condição do gerente e piso × estorno.

import { describe, expect, it } from "vitest";
import {
  apurar,
  codigosPdv,
  escolherMeta,
  escolherMetaLoja,
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

describe("funcionário que não vende no PDV (gerente, supervisor, contratado de fora)", () => {
  /** Sem código no PDV, a venda individual é zero — a comissão vem da loja. */
  const GERENTE_SEM_PDV: Funcionario = {
    id: "jessica",
    nome: "Jéssica",
    cargoId: "gerente",
    lojaId: 582,
    pdvVendedorId: null,
    semPdv: true,
    pisoGarantido: 2396.99,
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
        rotulo: "Venda da loja",
        escopoVenda: "loja",
        baseCalculo: "liquida",
        baseFaixa: "valor",
        modelo: "integral",
        faixas: [{ de: 0, percentual: 0.5 }],
      },
    ],
    vigenciaDe: "2026-01",
    vigenciaAte: null,
  };

  it("comissiona pela loja mesmo sem nenhuma venda própria", () => {
    const r = apurar(
      entrada({
        funcionario: GERENTE_SEM_PDV,
        regra: regraGerente,
        metas: { individual: null, loja: 400_000, grupo: null },
        vendas: {
          individual: { liquida: 0, bruta: 0 },
          loja: { liquida: 500_000, bruta: 500_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoBase).toBe(2500); // 500.000 × 0,5%
    expect(r.valorDevido).toBe(2500);
    expect(r.escopoMeta).toBe("loja");
    expect(r.metaConsiderada).toBe(400_000);
  });

  it("o piso continua valendo quando a loja vende pouco", () => {
    const r = apurar(
      entrada({
        funcionario: GERENTE_SEM_PDV,
        regra: regraGerente,
        metas: { individual: null, loja: 400_000, grupo: null },
        vendas: {
          individual: { liquida: 0, bruta: 0 },
          loja: { liquida: 200_000, bruta: 200_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoBase).toBe(1000);
    expect(r.valorDevido).toBe(2396.99);
    expect(r.pisoAplicado).toBe(true);
  });

  it("supervisor sem PDV soma as lojas que acompanha", () => {
    const porLoja = new Map([
      [582, { liquida: 500_000, bruta: 500_000, qtd: 1 }],
      [371, { liquida: 300_000, bruta: 300_000, qtd: 1 }],
    ]);
    const grupo = somarLojas(porLoja, [582, 371]);
    const r = apurar(
      entrada({
        funcionario: {
          ...GERENTE_SEM_PDV,
          id: "sup",
          cargoId: "supervisor",
          lojasGrupo: [582, 371],
          pisoGarantido: 0,
        },
        regra: {
          ...regraGerente,
          id: "rs",
          cargoId: "supervisor",
          componentes: [{ ...regraGerente.componentes[0], escopoVenda: "grupo", faixas: [{ de: 0, percentual: 0.15 }] }],
        },
        metas: { individual: null, loja: null, grupo: 700_000 },
        vendas: {
          individual: { liquida: 0, bruta: 0 },
          loja: { liquida: 500_000, bruta: 500_000 },
          grupo: { liquida: grupo.liquida, bruta: grupo.bruta },
        },
      }),
    );
    expect(grupo.liquida).toBe(800_000);
    expect(r.comissaoBase).toBe(1200); // 800.000 × 0,15%
  });
});

describe("sem regra cadastrada, o escopo segue o formato da pessoa", () => {
  const semVendas = {
    individual: { liquida: 500, bruta: 500 },
    loja: { liquida: 300_000, bruta: 300_000 },
    grupo: { liquida: 800_000, bruta: 800_000 },
  };

  it("supervisor de UMA loja só também é medido por ela", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, cargoId: "supervisor", lojasGrupo: [582], pisoGarantido: 2396.99 },
        regra: null,
        metas: { individual: 80_000, loja: 400_000, grupo: 400_000 },
        vendas: {
          individual: { liquida: 500, bruta: 500 },
          loja: { liquida: 300_000, bruta: 300_000 },
          grupo: { liquida: 300_000, bruta: 300_000 },
        },
      }),
    );
    expect(r.escopoMeta).toBe("grupo");
    expect(r.vendaConsiderada).toBe(300_000);
    expect(r.metaConsiderada).toBe(400_000);
    expect(r.atingimentoPct).toBe(75);
  });

  it("supervisor com lojas marcadas é medido pelo grupo, não pela venda própria", () => {
    const r = apurar(
      entrada({
        funcionario: {
          ...JOAO,
          cargoId: "supervisor",
          lojasGrupo: [582, 371],
          semPdv: true,
          pisoGarantido: 2396.99,
        },
        regra: null,
        metas: { individual: null, loja: 400_000, grupo: 700_000 },
        vendas: semVendas,
      }),
    );
    expect(r.escopoMeta).toBe("grupo");
    expect(r.vendaConsiderada).toBe(800_000);
    expect(r.metaConsiderada).toBe(700_000);
  });

  it("quem não vende no PDV e não supervisiona é medido pela loja", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, cargoId: "gerente", semPdv: true, lojasGrupo: [] },
        regra: null,
        metas: { individual: null, loja: 400_000, grupo: null },
        vendas: semVendas,
      }),
    );
    expect(r.escopoMeta).toBe("loja");
    expect(r.metaConsiderada).toBe(400_000);
  });

  it("vendedor sem regra continua medido pela venda própria", () => {
    const r = apurar(
      entrada({ funcionario: JOAO, regra: null, metas: { individual: 80_000, loja: null, grupo: null }, vendas: semVendas }),
    );
    expect(r.escopoMeta).toBe("individual");
  });

  it("a regra manda quando existe: regra individual vence as lojas marcadas", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, lojasGrupo: [582, 371], pisoGarantido: 0 },
        regra: regraSimples(2),
        metas: { individual: 80_000, loja: null, grupo: 700_000 },
        vendas: semVendas,
      }),
    );
    expect(r.escopoMeta).toBe("individual");
    expect(r.comissaoBase).toBe(10); // 500 × 2%
  });
});

describe("meta da loja não vira meta individual de cada um", () => {
  const META_LOJA: Meta = { id: "m-loja", competencia: "2026-08", lojaId: 582, valor: 10_000 };

  it("a meta da loja NÃO é a meta própria do vendedor", () => {
    // Antes, o escopo de loja casava com qualquer funcionário dela e cada
    // vendedor levava os 10.000 inteiros.
    expect(escolherMeta([META_LOJA], JOAO, "2026-08")).toBeNull();
    expect(escolherMetaLoja([META_LOJA], 582, "2026-08")).toBe(10_000);
  });

  it("meta cadastrada para a pessoa continua vencendo", () => {
    const propria: Meta = { id: "m-j", competencia: "2026-08", funcionarioId: "joao", valor: 3_000 };
    expect(escolherMeta([META_LOJA, propria], JOAO, "2026-08")).toBe(3_000);
  });

  it("meta do cargo na loja também é meta própria", () => {
    const doCargo: Meta = {
      id: "m-c",
      competencia: "2026-08",
      cargoId: "vendedor",
      lojaId: 582,
      valor: 2_500,
    };
    expect(escolherMeta([META_LOJA, doCargo], JOAO, "2026-08")).toBe(2_500);
  });

  it("o gerente é medido pela meta da loja inteira, não pela fatia", () => {
    const regra = regraSimples(0);
    regra.componentes[0].escopoVenda = "loja";
    regra.componentes[0].faixas = [{ de: 0, percentual: 0.5 }];
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, cargoId: "gerente", pisoGarantido: 0 },
        regra,
        metas: { individual: null, loja: 10_000, grupo: null },
        vendas: {
          individual: { liquida: 0, bruta: 0 },
          loja: { liquida: 12_000, bruta: 12_000 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.escopoMeta).toBe("loja");
    expect(r.metaConsiderada).toBe(10_000);
    expect(r.atingimentoPct).toBe(120);
  });
});

describe("mesma pessoa com mais de um código no PDV (Barra = 582 + 912)", () => {
  it("junta os códigos, sem repetir, e aceita o campo antigo", () => {
    expect(
      codigosPdv({ ...JOAO, pdvVendedorId: null, pdvVendedorIds: ["05820041", "09120001"] }),
    ).toEqual(["05820041", "09120001"]);

    // Cadastro meio-migrado: o código legado não pode sumir da conta.
    expect(
      codigosPdv({ ...JOAO, pdvVendedorId: "05820001", pdvVendedorIds: ["09120001"] }),
    ).toEqual(["09120001", "05820001"]);
    // cadastro legado, com um código só
    expect(codigosPdv({ ...JOAO, pdvVendedorIds: undefined, pdvVendedorId: "05820041" })).toEqual([
      "05820041",
    ]);
    // o legado repetido dentro da lista não duplica
    expect(
      codigosPdv({ ...JOAO, pdvVendedorIds: ["05820041"], pdvVendedorId: "05820041" }),
    ).toEqual(["05820041"]);
    expect(codigosPdv({ ...JOAO, pdvVendedorId: null, pdvVendedorIds: [] })).toEqual([]);
  });

  it("as vendas dos dois códigos somam numa pessoa só", () => {
    const vendas: VendaBruta[] = [
      { id: "a", lojaId: 582, dia: "2026-08-01", vendedorId: "05820041", valorTotal: 36_139 },
      { id: "b", lojaId: 912, dia: "2026-08-02", vendedorId: "09120001", valorTotal: 63_171 },
    ];
    const c = consolidar(vendas);
    const codigos = codigosPdv({
      ...JOAO,
      pdvVendedorId: null,
      pdvVendedorIds: ["05820041", "09120001"],
    });
    const total = codigos.reduce((s, k) => s + (c.porVendedor.get(k)?.liquida ?? 0), 0);
    expect(total).toBe(99_310);
  });

  it("com os códigos juntos, a comissão sai sobre a venda somada", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, pisoGarantido: 0 },
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 99_310, bruta: 99_310 },
          loja: { liquida: 0, bruta: 0 },
          grupo: { liquida: 0, bruta: 0 },
        },
      }),
    );
    expect(r.comissaoBase).toBe(1986.2);
  });
});

describe("cargo que não comissiona (caixa)", () => {
  const CAIXA: Funcionario = {
    id: "caixa",
    nome: "Ana Carolina",
    cargoId: "caixa",
    lojaId: 582,
    pdvVendedorId: null,
    semPdv: true,
    pisoGarantido: 1712,
    ativo: true,
  };
  const vendasDaLoja = {
    individual: { liquida: 0, bruta: 0 },
    loja: { liquida: 416_599.07, bruta: 416_599.07 },
    grupo: { liquida: 416_599.07, bruta: 416_599.07 },
  };

  it("não leva o resultado da loja: trabalha só pelo fixo", () => {
    const r = apurar(
      entrada({ funcionario: CAIXA, semComissao: true, vendas: vendasDaLoja, metas: { individual: null, loja: 375_999.99, grupo: null } }),
    );
    expect(r.escopoMeta).toBe("individual");
    expect(r.vendaConsiderada).toBe(0);
    expect(r.metaConsiderada).toBeNull();
    expect(r.atingimentoPct).toBeNull();
    expect(r.valorDevido).toBe(1712);
  });

  it("sem a marca, quem não vende no PDV continua medido pela loja", () => {
    const r = apurar(entrada({ funcionario: CAIXA, vendas: vendasDaLoja, metas: { individual: null, loja: 375_999.99, grupo: null } }));
    expect(r.escopoMeta).toBe("loja");
    expect(r.vendaConsiderada).toBe(416_599.07);
  });

  it("a memória diz que é fixo do cargo, não piso complementando comissão", () => {
    const r = apurar(entrada({ funcionario: CAIXA, semComissao: true, vendas: vendasDaLoja }));
    expect(r.memoria.map((m) => m.rotulo)).toContain("Fixo do cargo");
    expect(r.memoria.map((m) => m.rotulo)).not.toContain("Piso garantido");
  });

  it("caixa que vendeu no balcão aparece com a venda dela, e nada muda no que recebe", () => {
    const r = apurar(
      entrada({
        funcionario: { ...CAIXA, semPdv: false, pdvVendedorId: "05820099" },
        semComissao: true,
        vendas: { ...vendasDaLoja, individual: { liquida: 419.95, bruta: 419.95 } },
      }),
    );
    expect(r.vendaConsiderada).toBe(419.95);
    expect(r.comissaoTotal).toBe(0);
    expect(r.valorDevido).toBe(1712);
  });
});

describe("descontos de folha (retirada de produto, falta, suspensão)", () => {
  const desconto = (valor: number, categoria = "retirada", motivo = "camisa retirada") => ({
    id: `d-${categoria}-${valor}`,
    funcionarioId: "joao",
    competencia: "2026-08",
    valor,
    motivo,
    tipo: "desconto" as const,
    categoria,
  });

  it("sai depois do piso: quem está no piso paga a retirada", () => {
    // Comissão de 900 < piso de 1.800 → recebia 1.800; com 200 de retirada, 1.600.
    const r = apurar(
      entrada({
        regra: regraSimples(2),
        vendas: {
          individual: { liquida: 45_000, bruta: 45_000 },
          loja: { liquida: 45_000, bruta: 45_000 },
          grupo: { liquida: 45_000, bruta: 45_000 },
        },
        descontos: [desconto(200)],
      }),
    );
    expect(r.comissaoTotal).toBe(900);
    expect(r.piso).toBe(1800);
    expect(r.descontosTotal).toBe(200);
    expect(r.valorDevido).toBe(1600);
  });

  it("ajuste negativo continua sendo absorvido pelo piso — desconto não", () => {
    const base = {
      regra: regraSimples(2),
      vendas: {
        individual: { liquida: 45_000, bruta: 45_000 },
        loja: { liquida: 45_000, bruta: 45_000 },
        grupo: { liquida: 45_000, bruta: 45_000 },
      },
    };
    const comAjuste = apurar(
      entrada({
        ...base,
        ajustes: [
          { id: "a1", funcionarioId: "joao", competencia: "2026-08", valor: -200, motivo: "x", tipo: "manual" },
        ],
      }),
    );
    expect(comAjuste.valorDevido).toBe(1800);
    const comDesconto = apurar(entrada({ ...base, descontos: [desconto(200)] }));
    expect(comDesconto.valorDevido).toBe(1600);
  });

  it("soma vários descontos e registra cada um na memória", () => {
    const r = apurar(
      entrada({
        regra: regraSimples(4),
        vendas: {
          individual: { liquida: 100_000, bruta: 100_000 },
          loja: { liquida: 100_000, bruta: 100_000 },
          grupo: { liquida: 100_000, bruta: 100_000 },
        },
        descontos: [desconto(150), desconto(89.9, "falta", "1 falta"), desconto(300, "suspensao", "2 dias")],
      }),
    );
    expect(r.descontosTotal).toBe(539.9);
    expect(r.valorDevido).toBe(4000 - 539.9);
    const linhas = r.memoria.filter((m) => m.rotulo.startsWith("Desconto"));
    expect(linhas).toHaveLength(3);
    expect(linhas.map((l) => l.valor)).toEqual([-150, -89.9, -300]);
    expect(linhas[1].rotulo).toBe("Desconto: falta");
  });

  it("valor lançado com sinal invertido ainda desconta", () => {
    const r = apurar(entrada({ regra: regraSimples(4), vendas: { individual: { liquida: 100_000, bruta: 100_000 }, loja: { liquida: 0, bruta: 0 }, grupo: { liquida: 0, bruta: 0 } }, descontos: [desconto(-100)] }));
    expect(r.valorDevido).toBe(3900);
  });

  it("desconto maior que a folha zera o pagamento e avisa da sobra", () => {
    const r = apurar(entrada({ descontos: [desconto(2500)] }));
    expect(r.valorDevido).toBe(0);
    expect(r.divergencias.join(" ")).toContain("passam do que a pessoa tem a receber");
  });

  it("caixa que só tem fixo também pode ser descontada", () => {
    const r = apurar(
      entrada({
        funcionario: { ...JOAO, semPdv: true, pisoGarantido: 1712 },
        semComissao: true,
        descontos: [desconto(112)],
      }),
    );
    expect(r.valorDevido).toBe(1600);
  });
});

describe("metas secundárias (PA, VA) como gatilho de bônus", () => {
  const supermeta: Bonus = {
    id: "b-super",
    nome: "Supermeta",
    ativo: true,
    gatilho: { tipo: "atingimentoIndividual", minimoPct: 125 },
    premio: { tipo: "percentual", valor: 0.3, escopoVenda: "individual" },
    vigenciaDe: "2026-01",
  };
  const porIndicador = (id: string, nome: string): Bonus => ({
    id: `b-${id}`,
    nome,
    ativo: true,
    gatilho: { tipo: "indicador", indicadorId: id },
    condicao: { tipo: "atingimentoIndividual", minimoPct: 125 },
    premio: { tipo: "percentual", valor: 0.1, escopoVenda: "individual" },
    vigenciaDe: "2026-01",
  });
  const PA = porIndicador("pa", "PA");
  const VA = porIndicador("va", "VA");

  const cenario = (atingimento: number, atingidos: string[]) =>
    entrada({
      vendas: {
        individual: { liquida: 100_000 * (atingimento / 125), bruta: 0 },
        loja: { liquida: 0, bruta: 0 },
        grupo: { liquida: 0, bruta: 0 },
      },
      metas: { individual: 100_000 * (100 / 125), loja: null, grupo: null },
      bonus: [supermeta, PA, VA],
      indicadores: [
        { id: "pa", nome: "PA", atingido: atingidos.includes("pa") },
        { id: "va", nome: "VA", atingido: atingidos.includes("va") },
      ],
    });

  it("supermeta com PA e VA: 0,3 + 0,1 + 0,1 sobre a venda", () => {
    const r = apurar(cenario(125, ["pa", "va"]));
    expect(r.vendaConsiderada).toBe(100_000);
    expect(r.atingimentoPct).toBe(125);
    expect(r.bonusTotal).toBe(500); // 0,5% de 100.000
  });

  it("as secundárias somam ao degrau da supermeta, não o substituem", () => {
    const so = apurar(cenario(125, []));
    const comPa = apurar(cenario(125, ["pa"]));
    expect(so.bonusTotal).toBe(300);
    expect(comPa.bonusTotal).toBe(400);
  });

  it("sem a supermeta, PA e VA não pagam mesmo marcados", () => {
    const r = apurar(cenario(110, ["pa", "va"]));
    expect(r.bonusTotal).toBe(0);
    expect(r.memoria.filter((m) => m.rotulo === "Bônus: PA")[0].detalhe).toContain("exige");
  });

  it("indicador não marcado não paga", () => {
    const r = apurar(cenario(125, ["va"]));
    expect(r.bonusTotal).toBe(400);
    expect(r.memoria.filter((m) => m.rotulo === "Bônus: PA")[0].detalhe).toContain("PA não batido");
  });

  it("indicador que nem existe mais não paga e diz por quê", () => {
    const r = apurar(
      entrada({
        vendas: { individual: { liquida: 100_000, bruta: 0 }, loja: { liquida: 0, bruta: 0 }, grupo: { liquida: 0, bruta: 0 } },
        metas: { individual: 80_000, loja: null, grupo: null },
        bonus: [porIndicador("sumiu", "Fantasma")],
        indicadores: [],
      }),
    );
    expect(r.bonusTotal).toBe(0);
    const linha = r.memoria.find((m) => m.rotulo === "Bônus: Fantasma");
    expect(linha?.detalhe).toContain("não cadastrada");
  });
});

describe("bônus preso a outro bônus", () => {
  const supermeta: Bonus = {
    id: "super",
    nome: "Supermeta Vendedor",
    ativo: true,
    gatilho: { tipo: "atingimentoIndividual", minimoPct: 125 },
    premio: { tipo: "percentual", valor: 0.3, escopoVenda: "individual" },
    vigenciaDe: "2026-01",
  };
  const preso = (id: string, nome: string, indicadorId: string): Bonus => ({
    id,
    nome,
    ativo: true,
    gatilho: { tipo: "indicador", indicadorId },
    dependeDe: "super",
    premio: { tipo: "percentual", valor: 0.1, escopoVenda: "individual" },
    vigenciaDe: "2026-01",
  });
  const PA = preso("pa", "PA", "i-pa");
  const VA = preso("va", "VA", "i-va");

  const cenario = (atingimentoPct: number, marcados: string[], bonus = [supermeta, PA, VA]) =>
    entrada({
      vendas: {
        individual: { liquida: 100_000, bruta: 100_000 },
        loja: { liquida: 0, bruta: 0 },
        grupo: { liquida: 0, bruta: 0 },
      },
      metas: { individual: 100_000 / (atingimentoPct / 100), loja: null, grupo: null },
      bonus,
      indicadores: [
        { id: "i-pa", nome: "PA", atingido: marcados.includes("pa") },
        { id: "i-va", nome: "VA", atingido: marcados.includes("va") },
      ],
    });

  it("com a supermeta paga, PA e VA somam a ela", () => {
    const r = apurar(cenario(125, ["pa", "va"]));
    expect(r.bonusTotal).toBe(500); // 0,3 + 0,1 + 0,1 sobre 100.000
  });

  it("sem a supermeta, nada do que depende dela paga", () => {
    const r = apurar(cenario(110, ["pa", "va"]));
    expect(r.bonusTotal).toBe(0);
    const linha = r.memoria.find((m) => m.rotulo === "Bônus: VA");
    expect(linha?.detalhe).toContain('"Supermeta Vendedor" não pagou');
  });

  it("a supermeta paga, mas o indicador não marcado não", () => {
    const r = apurar(cenario(125, ["pa"]));
    expect(r.bonusTotal).toBe(400);
    expect(r.memoria.find((m) => m.rotulo === "Bônus: VA")?.detalhe).toContain("VA não batido");
  });

  it("mudou o degrau da supermeta, o preso acompanha sem ser editado", () => {
    const super130 = { ...supermeta, gatilho: { tipo: "atingimentoIndividual" as const, minimoPct: 130 } };
    const r = apurar(cenario(127, ["pa", "va"], [super130, PA, VA]));
    expect(r.bonusTotal).toBe(0);
  });

  it("o preso não disputa o degrau da escada de que depende", () => {
    // Sem isso, o VA (gatilho de indicador) poderia substituir a supermeta.
    const r = apurar(cenario(125, ["va"]));
    expect(r.memoria.find((m) => m.rotulo === "Bônus: Supermeta Vendedor")?.valor).toBe(300);
    expect(r.memoria.find((m) => m.rotulo === "Bônus: VA")?.valor).toBe(100);
  });

  it("bônus exigido fora do alcance da pessoa não paga o dependente", () => {
    const r = apurar(cenario(125, ["pa"], [PA]));
    expect(r.bonusTotal).toBe(0);
    expect(r.memoria.find((m) => m.rotulo === "Bônus: PA")?.detalhe).toContain(
      "não se aplica a esta pessoa",
    );
  });

  it("dependência circular não paga e não trava", () => {
    const a: Bonus = { ...PA, id: "a", nome: "A", dependeDe: "b" };
    const b: Bonus = { ...VA, id: "b", nome: "B", dependeDe: "a" };
    const r = apurar(cenario(125, ["pa", "va"], [a, b]));
    expect(r.bonusTotal).toBe(0);
    expect(r.memoria.find((m) => m.rotulo === "Bônus: A")?.detalhe).toContain("circular");
  });

  it("corrente de três: VA depende do PA, que depende da supermeta", () => {
    const vaDoPa = { ...VA, dependeDe: "pa" };
    expect(apurar(cenario(125, ["pa", "va"], [supermeta, PA, vaDoPa])).bonusTotal).toBe(500);
    expect(apurar(cenario(125, ["va"], [supermeta, PA, vaDoPa])).bonusTotal).toBe(300);
  });
});

describe("desconto do caixa não comissiona", () => {
  // O PDVnet manda ValorTotal SEM tirar o desconto: numa venda de 549,98 com
  // 55,00 de desconto, o cliente pagou 494,98. Comissionar sobre 549,98 paga
  // sobre dinheiro que a loja não recebeu.
  const venda = (over: Partial<VendaBruta> = {}): VendaBruta => ({
    id: "v1",
    lojaId: 335,
    dia: "2026-08-01",
    vendedorId: "03350034",
    valorTotal: 549.98,
    valorProdutos: 549.98,
    valorDesconto: 55,
    ...over,
  });

  it("a base é o total menos o desconto", () => {
    const c = consolidar([venda()]);
    expect(c.porVendedor.get("03350034")?.liquida).toBe(494.98);
    expect(c.porLoja.get(335)?.liquida).toBe(494.98);
  });

  it("desconto promocional também sai", () => {
    const c = consolidar([venda({ valorDesconto: 10, valorDescontoPromocional: 5 })]);
    expect(c.porVendedor.get("03350034")?.liquida).toBe(534.98);
  });

  it("sem desconto, nada muda", () => {
    const c = consolidar([venda({ valorDesconto: 0, valorDescontoPromocional: null })]);
    expect(c.porVendedor.get("03350034")?.liquida).toBe(549.98);
  });

  it("o bruto continua sendo o valor dos produtos", () => {
    const c = consolidar([venda({ valorProdutos: 600 })]);
    expect(c.porVendedor.get("03350034")?.bruta).toBe(600);
    expect(c.porVendedor.get("03350034")?.liquida).toBe(494.98);
  });

  it("melhor vendedor da loja é decidido pelo líquido", () => {
    // O outro vende mais no papel, mas deu um desconto que derruba o líquido.
    const c = consolidar([
      venda({ id: "a", vendedorId: "A", valorTotal: 1000, valorDesconto: 0 }),
      venda({ id: "b", vendedorId: "B", valorTotal: 1100, valorDesconto: 200 }),
    ]);
    expect(c.melhorVendedorPorLoja.get(335)).toBe("A");
  });

  it("venda cancelada é contabilizada pelo líquido", () => {
    const c = consolidar([venda({ cancelada: true })]);
    expect(c.canceladas.valor).toBe(494.98);
  });

  it("venda sem vendedor entra pelo líquido", () => {
    const c = consolidar([venda({ vendedorId: null })]);
    expect(c.semVendedor.valor).toBe(494.98);
  });
});

describe("venda já normalizada pela sync", () => {
  // Depois que a sync passou a gravar o líquido, o desconto não pode sair de
  // novo aqui — seria descontado duas vezes.
  const normalizada: VendaBruta = {
    id: "v1",
    lojaId: 335,
    dia: "2026-08-01",
    vendedorId: "03350034",
    valorTotal: 494.98,
    valorTotalPdv: 549.98,
    valorProdutos: 549.98,
    valorDesconto: 55,
  };

  it("usa o valorTotal como está", () => {
    expect(consolidar([normalizada]).porVendedor.get("03350034")?.liquida).toBe(494.98);
  });

  it("venda antiga, sem a marca, ainda tem o desconto subtraído aqui", () => {
    const antiga = { ...normalizada, valorTotal: 549.98, valorTotalPdv: undefined };
    expect(consolidar([antiga]).porVendedor.get("03350034")?.liquida).toBe(494.98);
  });

  it("as duas convivem no mesmo mês sem uma contaminar a outra", () => {
    const antiga = { ...normalizada, id: "v2", valorTotal: 549.98, valorTotalPdv: undefined };
    expect(consolidar([normalizada, antiga]).porLoja.get(335)?.liquida).toBe(989.96);
  });
});
