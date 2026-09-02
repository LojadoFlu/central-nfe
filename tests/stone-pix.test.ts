import { describe, expect, it } from "vitest";
import { lerCsv, parsePixCsv } from "../functions/src/stone/pix";

describe("leitura de CSV", () => {
  it("lê cabeçalho e linhas com vírgula", () => {
    expect(lerCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("lê com ponto e vírgula", () => {
    expect(lerCsv("a;b\n1;2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("respeita campo entre aspas", () => {
    expect(lerCsv('nome,valor\n"SILVA, JOAO",10')[0]).toEqual({ nome: "SILVA, JOAO", valor: "10" });
  });

  it("ignora linhas em branco e o BOM", () => {
    expect(lerCsv("﻿a,b\n1,2\n\n")).toHaveLength(1);
  });

  it("arquivo só com cabeçalho devolve lista vazia", () => {
    expect(lerCsv("a,b")).toEqual([]);
  });

  it("coluna faltando na linha vira string vazia", () => {
    expect(lerCsv("a,b,c\n1,2")[0].c).toBe("");
  });
});

describe("PIX da Stone", () => {
  const CSV = [
    "id,status,created_at,amount,pix_transaction__paid_amount,pix_transaction__canceled_amount,pix_transaction__fee_amount,pix_transaction__terminal__type,pix_transaction__terminal__serial_number,pix_transaction__payer__name,pix_transaction__payer__document,pix_transaction__payer__institution_name",
    "abc123,paid,2026-08-17T14:22:10Z,2589.96,2583.49,0,6.47,payment_link,,CLEUSON CALIXTO DEBERALDINI,12345678900,ITAU",
    "def456,paid,2026-08-17T15:00:00Z,139.60,139.46,0,0.14,pos,4AH611453,ALINE F P ALCOFORADO,98765432100,NUBANK",
  ].join("\n");

  const l = parsePixCsv(CSV);

  it("lê valor, pago e taxa", () => {
    expect(l[0]).toMatchObject({ id: "abc123", valor: 2589.96, pago: 2583.49, taxa: 6.47 });
  });

  it("traz o meio de captura — é o que separa link de maquininha", () => {
    expect(l[0].captura).toBe("payment_link");
    expect(l[1].captura).toBe("pos");
    expect(l[1].serialPos).toBe("4AH611453");
  });

  it("traz o pagador, que casa com o histórico do banco", () => {
    expect(l[0].pagador).toBe("CLEUSON CALIXTO DEBERALDINI");
    expect(l[1].instituicaoPagador).toBe("NUBANK");
  });

  it("linha sem id é descartada", () => {
    expect(parsePixCsv("id,amount\n,10")).toEqual([]);
  });

  it("arquivo vazio (só cabeçalho) não quebra", () => {
    expect(parsePixCsv("id,status,amount")).toEqual([]);
  });

  it("aceita número com vírgula decimal", () => {
    expect(parsePixCsv("id,amount\nx,\"1.234,56\"")[0].valor).toBe(1234.56);
  });

  it("coluna que a Stone mudar de nome vira nulo, não derruba a linha", () => {
    const r = parsePixCsv("id,amount\nx,10")[0];
    expect(r).toMatchObject({ id: "x", valor: 10, captura: null, pagador: null });
  });
});
