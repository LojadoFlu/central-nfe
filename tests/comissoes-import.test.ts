// Leitura do arquivo de metas exportado do Controle de Vez.
// Arquivo de meta com linha engolida em silêncio é folha errada no fim do mês,
// então o parser tem de recusar alto e apontar a linha.

import { describe, expect, it } from "vitest";
import {
  acharPorNome,
  colunaDoCabecalho,
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
    expect(r.erros[0]).toContain("não reconheci a meta");
  });

  it("recusa linha sem código e sem nome", () => {
    const r = parseCsvMetas("semana_inicio;codigo_pdv;nome;meta\n04/08/2026;;;12000");
    expect(r.erros[0]).toContain("não dá para saber de quem é");
  });

  it("arquivo sem data nenhuma é recusado linha a linha", () => {
    // Sem cabeçalho conhecido e sem data, não há como saber de que semana é.
    const r = parseCsvMetas("pessoa;quanto\nLUIZ;12000");
    expect(r.linhas).toHaveLength(0);
    expect(r.erros).toHaveLength(2);
    expect(r.erros[0]).toContain("não reconheci data e meta");
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

describe("formato real do Controle de Vez (sem cabeçalho)", () => {
  const REAL = [
    "Flu Laranjeiras;30/08/2026;31/08/2026;Lazlo;4600,00",
    "Flu Laranjeiras;24/08/2026;29/08/2026;Lazlo;18400,00",
    "Flu Laranjeiras;24/08/2026;29/08/2026;Marcos;21000,00",
  ].join("\n");

  it("lê loja, limites da semana, nome e meta sem cabeçalho nenhum", () => {
    const r = parseCsvMetas(REAL);
    expect(r.erros).toEqual([]);
    expect(r.linhas).toHaveLength(3);
    expect(r.linhas[0]).toMatchObject({
      loja: "Flu Laranjeiras",
      semanaInicio: "2026-08-30",
      semanaFim: "2026-08-31",
      nome: "Lazlo",
      meta: 4600,
    });
  });

  it("a semana cortada no fim do mês fica na competência dela", () => {
    const r = parseCsvMetas(REAL);
    expect(competenciaDaSemana(r.linhas[0].semanaInicio)).toBe("2026-08");
    // 30/08 a 31/08 são dois dias: a semana foi cortada no fim do mês.
    expect(r.linhas[0].semanaFim).toBe("2026-08-31");
  });

  it("não confunde a primeira linha de dados com cabeçalho", () => {
    expect(parseCsvMetas(REAL).linhas[0].nome).toBe("Lazlo");
  });

  it("uma coluna a mais no meio não quebra a leitura", () => {
    const r = parseCsvMetas("Flu Laranjeiras;30/08/2026;31/08/2026;03350006;Lazlo;4600,00");
    expect(r.linhas[0]).toMatchObject({ codigoPdv: "03350006", nome: "Lazlo", meta: 4600 });
  });
});

describe("casar o nome curto do arquivo com o nome do cadastro", () => {
  const QUADRO = [
    { id: "1", nome: "LAZLO SENTO SE" },
    { id: "2", nome: "MARCOS COSTA DA SILVA" },
    { id: "3", nome: "MARCOS JR" },
    { id: "4", nome: "TAIS MAC DOWELL ROSSI" },
  ];

  it('"Lazlo" acha LAZLO SENTO SE', () => {
    expect(acharPorNome("Lazlo", QUADRO).achado?.id).toBe("1");
  });

  it("nome completo continua achando", () => {
    expect(acharPorNome("TAIS MAC DOWELL ROSSI", QUADRO).achado?.id).toBe("4");
  });

  it('"Marcos" é ambíguo e NÃO escolhe sozinho', () => {
    const r = acharPorNome("Marcos", QUADRO);
    expect(r.achado).toBeNull();
    expect(r.ambiguos.map((c) => c.nome).sort()).toEqual(["MARCOS COSTA DA SILVA", "MARCOS JR"]);
  });

  it('"Marcos Jr" resolve a ambiguidade', () => {
    expect(acharPorNome("Marcos Jr", QUADRO).achado?.id).toBe("3");
  });

  it("acento e caixa não atrapalham", () => {
    expect(acharPorNome("taís", QUADRO).achado?.id).toBe("4");
  });

  it("quem não existe não casa com ninguém", () => {
    expect(acharPorNome("FULANO", QUADRO).achado).toBeNull();
  });
});

describe("variações de arquivo que um exportador costuma produzir", () => {
  it("data com hora grudada", () => {
    expect(dataDoCsv("30/08/2026 00:00:00")).toBe("2026-08-30");
    expect(dataDoCsv("2026-08-30T00:00:00Z")).toBe("2026-08-30");
    expect(dataDoCsv("2026-08-30 03:00")).toBe("2026-08-30");
  });

  it("data entre aspas e com ponto", () => {
    expect(dataDoCsv('"30/08/2026"')).toBe("2026-08-30");
    expect(dataDoCsv("30.08.2026")).toBe("2026-08-30");
  });

  it("valor entre aspas e com espaço fino", () => {
    expect(valorDoCsv('"4.600,00"')).toBe(4600);
    expect(valorDoCsv("4 600,00")).toBe(4600);
  });

  it("linha inteira entre aspas, com cabeçalho", () => {
    const r = parseCsvMetas(
      ['"loja";"inicio";"fim";"nome";"meta"', '"Flu Laranjeiras";"30/08/2026";"31/08/2026";"Lazlo";"4.600,00"'].join(
        "\n",
      ),
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ semanaInicio: "2026-08-30", nome: "Lazlo", meta: 4600 });
  });

  it("cabeçalho apontando para a coluna errada cai na leitura por formato", () => {
    // "data" casa com a coluna da LOJA por azar; a leitura por formato salva.
    const r = parseCsvMetas(
      ["data;inicio;fim;nome;meta", "Flu Laranjeiras;30/08/2026;31/08/2026;Lazlo;4600,00"].join("\n"),
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ semanaInicio: "2026-08-30", nome: "Lazlo", meta: 4600 });
  });

  it("quando não dá mesmo, o erro mostra a linha inteira", () => {
    const r = parseCsvMetas(["loja;inicio;fim;nome;meta", "Flu;ontem;hoje;Lazlo;muito"].join("\n"));
    expect(r.linhas).toHaveLength(0);
    expect(r.erros[0]).toContain("Flu;ontem;hoje;Lazlo;muito");
  });
});

describe("o arquivo real (metas-semanais_31-08-2026.csv)", () => {
  // Bytes como saem do exportador: BOM, CRLF, títulos descritivos, acento.
  const REAL =
    "﻿Loja;Início da semana;Fim da semana;Vendedor;Meta da semana\r\n" +
    "Flu Barra;01/07/2026;04/07/2026;Daniel;8284,40\r\n" +
    "Flu Barra;01/07/2026;04/07/2026;Gabriel;8284,40\r\n" +
    "Flu Laranjeiras;30/08/2026;31/08/2026;Lazlo;4600,00\r\n";

  it("reconhece as colunas pelo título descritivo", () => {
    expect(colunaDoCabecalho("Início da semana")).toBe("semanaInicio");
    expect(colunaDoCabecalho("Fim da semana")).toBe("semanaFim");
    expect(colunaDoCabecalho("Meta da semana")).toBe("meta");
    expect(colunaDoCabecalho("Vendedor")).toBe("nome");
    expect(colunaDoCabecalho("Loja")).toBe("loja");
  });

  it('"Meta da semana" é meta, não semana', () => {
    // Contém as duas palavras; a ordem do teste é que decide.
    expect(colunaDoCabecalho("Meta da semana")).not.toBe("semanaInicio");
  });

  it("lê o arquivo inteiro sem erro", () => {
    const r = parseCsvMetas(REAL);
    expect(r.erros).toEqual([]);
    expect(r.linhas).toHaveLength(3);
    expect(r.linhas[0]).toMatchObject({
      loja: "Flu Barra",
      semanaInicio: "2026-07-01",
      semanaFim: "2026-07-04",
      nome: "Daniel",
      meta: 8284.4,
    });
  });

  it("separa as competências pelo início da semana", () => {
    const r = parseCsvMetas(REAL);
    expect(competenciaDaSemana(r.linhas[0].semanaInicio)).toBe("2026-07");
    expect(competenciaDaSemana(r.linhas[2].semanaInicio)).toBe("2026-08");
  });
});
