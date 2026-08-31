// Agrupamento de lojas: o PDV tem 582 e 912 separadas, a operação tem UMA Barra.

import { describe, expect, it } from "vitest";
import {
  canonizar,
  canonizarLista,
  construirGrupos,
  lojasCanonicas,
  type LojaBruta,
} from "../functions/src/comissoes/grupos";
import { consolidar, type VendaBruta } from "../functions/src/comissoes/consolidacao";
import { pareceCodigoDeLoja } from "../functions/src/comissoes/vendedores";

const LOJAS: LojaBruta[] = [
  { id: 335, nome: "FLU CLUBE", grupoNome: "FLU CLUBE", empresaId: "30623074000145", ativoSync: true },
  { id: 371, nome: "FLU TIJUCA", grupoNome: "FLU TIJUCA", empresaId: "54224772000136", ativoSync: true },
  { id: 582, nome: "FLU BARRA", grupoNome: "FLU BARRA", empresaId: "59255964000123", ativoSync: true },
  { id: 912, nome: "FLU BARRA NAOUSAR", grupoNome: "FLU BARRA", empresaId: "59255964000123", ativoSync: true },
];

describe("agrupamento de filiais do PDV", () => {
  const g = construirGrupos(LOJAS);

  it("as duas filiais da Barra apontam para a mesma loja canônica", () => {
    expect(canonizar(g, 582)).toBe(582);
    expect(canonizar(g, 912)).toBe(582); // a de menor id manda
    expect(canonizar(g, 335)).toBe(335);
  });

  it("o grupo tem nome e empresa próprios", () => {
    expect(g.nomeDoGrupo.get(582)).toBe("FLU BARRA");
    expect(g.empresaDoGrupo.get(582)).toBe("59255964000123");
    expect(g.membros.get(582)).toEqual([582, 912]);
  });

  it("a lista de lojas mostra 3 lojas, não 4", () => {
    const lista = lojasCanonicas(g);
    expect(lista.map((l) => l.nome)).toEqual(["FLU BARRA", "FLU CLUBE", "FLU TIJUCA"]);
  });

  it("loja desconhecida passa direto (não some da apuração)", () => {
    expect(canonizar(g, 777)).toBe(777);
    expect(canonizar(g, null)).toBeNull();
  });

  it("lista de lojas do supervisor não repete a mesma loja duas vezes", () => {
    expect(canonizarLista(g, [582, 912, 371])).toEqual([371, 582]);
  });

  it("venda das duas filiais soma numa loja só", () => {
    const vendas: VendaBruta[] = [
      { id: "a", lojaId: 582, dia: "2026-08-01", vendedorId: "05820001", valorTotal: 1000 },
      { id: "b", lojaId: 912, dia: "2026-08-02", vendedorId: "09120005", valorTotal: 3000 },
      { id: "c", lojaId: 335, dia: "2026-08-02", vendedorId: "03350031", valorTotal: 500 },
    ];
    const c = consolidar(vendas.map((v) => ({ ...v, lojaId: canonizar(g, v.lojaId) })));
    expect(c.porLoja.get(582)?.liquida).toBe(4000);
    expect(c.porLoja.get(912)).toBeUndefined();
    expect(c.porLoja.size).toBe(2);
  });

  it("o melhor vendedor é o melhor da loja inteira, não o da filial", () => {
    const vendas: VendaBruta[] = [
      { id: "a", lojaId: 582, dia: "2026-08-01", vendedorId: "05820001", valorTotal: 1000 },
      { id: "b", lojaId: 912, dia: "2026-08-02", vendedorId: "09120005", valorTotal: 3000 },
    ];
    const c = consolidar(vendas.map((v) => ({ ...v, lojaId: canonizar(g, v.lojaId) })));
    expect(c.melhorVendedorPorLoja.get(582)).toBe("09120005");
  });

  it("loja sem grupoNome vira grupo dela mesma", () => {
    const g2 = construirGrupos([{ id: 700, nome: "FLU NOVA", grupoNome: null, ativoSync: true }]);
    expect(canonizar(g2, 700)).toBe(700);
    expect(g2.nomeDoGrupo.get(700)).toBe("FLU NOVA");
  });
});

describe("código do PDV que é a loja, não uma pessoa", () => {
  const nomesDeLoja = new Set(["FLU CLUBE", "FLU TIJUCA", "FLU BARRA", "FLU NOVA AMERICA"]);

  it("pega os códigos institucionais que aparecem na base", () => {
    for (const n of ["LOJA TIJUCA", "LOJA NOVA AMERICA", "LOJA BARRA", "FLU MARACANA 1"]) {
      expect(pareceCodigoDeLoja(n, nomesDeLoja)).toBe(true);
    }
  });

  it("não confunde com gente de verdade", () => {
    for (const n of [
      "MARCOS COSTA DA SILVA",
      "LEONARDO BATTEMARCO",
      "TAIS MAC DOWELL ROSSI",
      "RAÍ FERREIRA",
      "LUIZ GUSTAVO BARRA",
      "GABI CX",
      "ABRÃAO",
    ]) {
      expect(pareceCodigoDeLoja(n, nomesDeLoja)).toBe(false);
    }
  });

  it("acento não engana (FLU MARACANÃ = FLU MARACANA)", () => {
    expect(pareceCodigoDeLoja("Flu Maracanã 1", nomesDeLoja)).toBe(true);
  });

  it("nome vazio não é marcado", () => {
    expect(pareceCodigoDeLoja(null, nomesDeLoja)).toBe(false);
    expect(pareceCodigoDeLoja("  ", nomesDeLoja)).toBe(false);
  });
});
