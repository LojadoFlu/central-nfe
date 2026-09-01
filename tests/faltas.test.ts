// A conta do desconto de falta vive em dois lugares (servidor e tela). Este
// teste cobre a regra e garante que os dois dão o mesmo número.

import { describe, expect, it } from "vitest";
import {
  calcularDescontoFalta,
  diasValidos,
  semanaDoDia,
} from "../functions/src/comissoes/faltas";
import { calcularDescontoFalta as calcularNoCliente } from "@/lib/comissoes/faltas";

const PISO = 1712;

describe("semana da falta", () => {
  it("segunda a domingo caem na mesma semana", () => {
    // 2026-08-03 é uma segunda; 2026-08-09, o domingo seguinte.
    expect(semanaDoDia("2026-08-03")).toBe("2026-08-03");
    expect(semanaDoDia("2026-08-06")).toBe("2026-08-03");
    expect(semanaDoDia("2026-08-09")).toBe("2026-08-03");
  });

  it("a segunda seguinte já é outra semana", () => {
    expect(semanaDoDia("2026-08-10")).toBe("2026-08-10");
  });

  it("vira o mês sem perder a semana", () => {
    expect(semanaDoDia("2026-09-01")).toBe(semanaDoDia("2026-08-31"));
  });
});

describe("dias lançados", () => {
  it("repetido conta uma vez", () => {
    expect(diasValidos(["2026-08-03", "2026-08-03"])).toEqual(["2026-08-03"]);
  });
  it("lixo é ignorado", () => {
    expect(diasValidos(["2026-08-03", "", "ontem", "2026-13-40"])).toEqual(["2026-08-03"]);
  });
  it("sai em ordem", () => {
    expect(diasValidos(["2026-08-10", "2026-08-03"])).toEqual(["2026-08-03", "2026-08-10"]);
  });
});

describe("desconto de falta (mensalista, salário ÷ 30)", () => {
  it("um dia de falta desconta o dia e o DSR da semana", () => {
    const d = calcularDescontoFalta({ dias: ["2026-08-03"], base: PISO });
    expect(d.valorDia).toBe(57.07);
    expect(d).toMatchObject({ dias: 1, dsr: 1 });
    expect(d.valor).toBe(114.14); // 2 × 57,07
  });

  it("dois dias na MESMA semana perdem um DSR só", () => {
    const d = calcularDescontoFalta({ dias: ["2026-08-03", "2026-08-05"], base: PISO });
    expect(d).toMatchObject({ dias: 2, dsr: 1 });
    expect(d.valor).toBe(171.21); // 3 × 57,07
  });

  it("dois dias em semanas diferentes perdem dois DSRs", () => {
    const d = calcularDescontoFalta({ dias: ["2026-08-03", "2026-08-11"], base: PISO });
    expect(d).toMatchObject({ dias: 2, dsr: 2 });
    expect(d.valor).toBe(228.28); // 4 × 57,07
  });

  it("com o DSR desligado, desconta só os dias", () => {
    const d = calcularDescontoFalta({ dias: ["2026-08-03", "2026-08-11"], base: PISO, descontarDsr: false });
    expect(d).toMatchObject({ dias: 2, dsr: 0, valor: 114.14 });
  });

  it("divisor diferente muda o valor do dia", () => {
    expect(calcularDescontoFalta({ dias: ["2026-08-03"], base: 3000, diasBaseMes: 25 }).valorDia).toBe(120);
  });

  it("sem dias, não desconta nada", () => {
    expect(calcularDescontoFalta({ dias: [], base: PISO })).toMatchObject({ dias: 0, dsr: 0, valor: 0 });
  });

  it("sem salário base, o desconto é zero (e não NaN)", () => {
    expect(calcularDescontoFalta({ dias: ["2026-08-03"], base: 0 }).valor).toBe(0);
  });

  it("uma semana inteira de suspensão", () => {
    const dias = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
    const d = calcularDescontoFalta({ dias, base: PISO });
    expect(d).toMatchObject({ dias: 5, dsr: 1 });
    expect(d.valor).toBe(342.42); // 6 × 57,07
  });
});

describe("servidor e tela dão o mesmo número", () => {
  const casos = [
    { dias: ["2026-08-03"], base: PISO },
    { dias: ["2026-08-03", "2026-08-05", "2026-08-12"], base: 2396.99 },
    { dias: ["2026-08-31", "2026-09-01"], base: 1621, diasBaseMes: 30 },
    { dias: ["2026-08-03"], base: 5000, descontarDsr: false },
    { dias: [], base: 1712 },
  ];
  for (const c of casos) {
    it(`${c.dias.length} dia(s), base ${c.base}`, () => {
      expect(calcularNoCliente(c)).toEqual(calcularDescontoFalta(c));
    });
  }
});
