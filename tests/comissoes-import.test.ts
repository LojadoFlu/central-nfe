// Leitura do arquivo de metas exportado do Controle de Vez.
// Arquivo de meta com linha engolida em silêncio é folha errada no fim do mês,
// então o parser tem de recusar alto e apontar a linha.

import { describe, expect, it } from "vitest";
import {
  competenciaDaSemana,
  dataDoCsv,
  indicesDasSemanas,
  normalizarNome,
  parseCsvMetas,
  valorDoCsv,
} from "../functions/src/comissoes/importacao";

describe("valores e datas do arquivo", () => {
  it("lê valor em pt-BR e em formato de planilha", () => {
    expect(valorDoCsv("12.000,50")).toBe(12000.5);
    expect(valorDoCsv("12000,50")).toBe(12000.5);
    expect(valorDoCsv("12000.50")).toBe(12000.5);
    expect(valorDoCsv("R$ 12.000,00")).toBe(12000);
    expect(valorDoCsv("")).toBeNull();
  });

  it("lê data ISO e brasileira", () => {
    expect(dataDoCsv("2026-08-04")).toBe("2026-08-04");
    expect(dataDoCsv("04/08/2026")).toBe("2026-08-04");
    expect(dataDoCsv("4/8/26")).toBe("2026-08-04");
    expect(dataDoCsv("qualquer coisa")).toBeNull();
  });

  it("nome comparável ignora acento e pontuação", () => {
    expect(normalizarNome("Raí Ferreira")).toBe("RAI FERREIRA");
    expect(normalizarNome("GABRIEL DA SILVA - BARRA")).toBe("GABRIEL DA SILVA BARRA");
  });
});

describe("parse do arquivo", () => {
  const ok = [
    "semana_inicio;codigo_pdv;nome;loja;meta",
    "04/08/2026;09120002;LUIZ GUSTAVO;FLU BARRA;12.000,00",
    "11/08/2026;09120002;LUIZ GUSTAVO;FLU BARRA;13.500,00",
    "04/08/2026;09120001;HENZO;FLU BARRA;11.000,00",
  ].join("\n");

  it("lê as linhas com código, nome e valor", () => {
    const r = parseCsvMetas(ok);
    expect(r.erros).toEqual([]);
    expect(r.linhas).toHaveLength(3);
    expect(r.linhas[0]).toMatchObject({
      semanaInicio: "2026-08-04",
      codigoPdv: "09120002",
      meta: 12000,
    });
  });

  it("aceita separador por tabulação (colar direto da planilha)", () => {
    const r = parseCsvMetas("semana\tcodigo\tmeta\n2026-08-04\t09120002\t12000");
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].meta).toBe(12000);
  });

  it("aponta a linha da meta inválida em vez de ignorar", () => {
    const r = parseCsvMetas("semana_inicio;codigo_pdv;meta\n04/08/2026;09120002;abc");
    expect(r.linhas).toHaveLength(0);
    expect(r.erros[0]).toContain("Linha 2");
    expect(r.erros[0]).toContain("meta inválida");
  });

  it("recusa linha sem código e sem nome", () => {
    const r = parseCsvMetas("semana_inicio;codigo_pdv;nome;meta\n04/08/2026;;;12000");
    expect(r.erros[0]).toContain("não dá para saber de quem é");
  });

  it("recusa cabeçalho que não tem o mínimo", () => {
    const r = parseCsvMetas("pessoa;quanto\nLUIZ;12000");
    expect(r.linhas).toHaveLength(0);
    expect(r.erros[0]).toContain("Cabeçalho não reconhecido");
  });

  it("arquivo vazio não passa por engano", () => {
    expect(parseCsvMetas("").erros[0]).toContain("vazio");
  });
});

describe("semanas e competência", () => {
  it("a semana não atravessa o mês: a data manda na competência", () => {
    expect(competenciaDaSemana("2026-08-04")).toBe("2026-08");
    expect(competenciaDaSemana("2026-09-01")).toBe("2026-09");
  });

  it("as semanas viram 1, 2, 3… pela ordem das datas", () => {
    const i = indicesDasSemanas(["2026-08-11", "2026-08-04", "2026-08-18", "2026-08-04"]);
    expect(i.get("2026-08-04")).toBe(0);
    expect(i.get("2026-08-11")).toBe(1);
    expect(i.get("2026-08-18")).toBe(2);
  });
});
