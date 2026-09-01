import { describe, expect, it } from "vitest";
import { precisaAtualizar } from "@/lib/versao";

describe("aviso de versão nova", () => {
  it("avisa quando o build no ar é outro", () => {
    expect(precisaAtualizar("65d2543", "c992d7a")).toBe(true);
  });

  it("não avisa quando é o mesmo", () => {
    expect(precisaAtualizar("c992d7a", "c992d7a")).toBe(false);
  });

  it("não avisa em desenvolvimento", () => {
    expect(precisaAtualizar("local", "c992d7a")).toBe(false);
    expect(precisaAtualizar("c992d7a", "local")).toBe(false);
  });

  it("resposta estranha não vira aviso", () => {
    for (const lixo of [undefined, null, "", 42, {}, []]) {
      expect(precisaAtualizar("c992d7a", lixo)).toBe(false);
    }
  });
});
