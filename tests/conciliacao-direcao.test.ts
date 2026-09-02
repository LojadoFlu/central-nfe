// A direção da diferença é a parte que se lê errado. Testada como regra.
import { describe, expect, it } from "vitest";

function direcao(dif: number, tolerancia = 0.5): { texto: string; falta: boolean; ok: boolean } {
  if (Math.abs(dif) <= tolerancia) return { texto: "Bate", falta: false, ok: true };
  return dif < 0
    ? { texto: "Faltou no banco", falta: true, ok: false }
    : { texto: "Sobrou no banco", falta: false, ok: false };
}

describe("direção da diferença (banco − esperado)", () => {
  it("negativo é dinheiro que não chegou", () => {
    expect(direcao(-1200)).toMatchObject({ texto: "Faltou no banco", falta: true, ok: false });
  });

  it("positivo é dinheiro a mais do que se esperava", () => {
    expect(direcao(1200)).toMatchObject({ texto: "Sobrou no banco", falta: false, ok: false });
  });

  it("centavos não viram alarme", () => {
    expect(direcao(0.09).ok).toBe(true);
    expect(direcao(-0.5).ok).toBe(true);
  });

  it("a tolerância pode ser maior, e aí o quase-zero também bate", () => {
    expect(direcao(-40, 50).texto).toBe("Bate");
    expect(direcao(-60, 50).texto).toBe("Faltou no banco");
  });
});
