// Piso garantido: mora no CARGO; o campo do funcionário é exceção.
// ESPELHO de `pisoEfetivo` em functions/src/comissoes/motor.ts — quem calcula
// de verdade é o servidor; aqui é só para a tela mostrar o mesmo número.

import type { Cargo, Funcionario } from "./tipos";

export interface PisoResolvido {
  valor: number | null;
  origem: "funcionario" | "cargo" | null;
}

export function pisoEfetivo(f: Funcionario, cargos: Cargo[]): PisoResolvido {
  if (f.pisoGarantido != null) return { valor: f.pisoGarantido, origem: "funcionario" };
  const cargo = f.cargoId ? cargos.find((c) => c.id === f.cargoId) : undefined;
  if (cargo?.pisoGarantido != null) return { valor: cargo.pisoGarantido, origem: "cargo" };
  return { valor: null, origem: null };
}
