// @vitest-environment jsdom
//
// "Editar funciona, criar não." Este teste clica no botão de criar e vai até o
// Salvar, conferindo o que sai para o servidor.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const salvarFuncionario = vi.fn(async (_i: Record<string, unknown>) => ({ ok: true, id: "novo" }));

vi.mock("@/lib/comissoes/repo", () => ({
  salvarFuncionario,
  excluirFuncionario: vi.fn(),
  excluirCargo: vi.fn(),
  salvarCargo: vi.fn(),
  importarVendedores: vi.fn(),
  marcarVendedor: vi.fn(),
  procurarVendedorPdv: vi.fn(async () => ({ ok: true, varridas: 0, achados: [] })),
  sincronizarVendedoresPdv: vi.fn(async () => ({ ok: true })),
}));

const { Funcionarios } = await import("@/components/comissoes/funcionarios");

afterEach(cleanup);

const CARGOS = [
  { id: "c-vend", nome: "Vendedor", ordem: 1, ativo: true, pisoGarantido: 1712 },
  { id: "c-ger", nome: "Gerente", ordem: 2, ativo: true, pisoGarantido: 2396.99 },
];
const LOJAS = [
  { id: 335, nome: "FLU CLUBE", grupoNome: "FLU CLUBE", ativoSync: true },
  { id: 371, nome: "FLU TIJUCA", grupoNome: "FLU TIJUCA", ativoSync: true },
];
const CONFIG = {
  regraPiso: "maior" as const,
  cargoPadraoId: null,
  diaPagamentoFolha: 5,
  mesPagamento: "seguinte" as const,
  provisaoNoFluxo: false,
  sincronizarFuncionarios: true,
  cargosPorTipoPdv: {},
};

function montar() {
  render(
    <Funcionarios
      cargos={CARGOS}
      funcionarios={[]}
      vendedores={[]}
      lojas={LOJAS}
      config={CONFIG}
      podeGerir
      onRecarregar={async () => {}}
    />,
  );
}

describe("criar funcionário do zero", () => {
  it("o botão de criar fora do PDV abre o formulário", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /fora do PDV/i }));
    expect(screen.getByLabelText("Nome")).toBeDefined();
  });

  it("salva nome, cargo e lojas do zero", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /fora do PDV/i }));

    await user.type(screen.getByLabelText("Nome"), "JESSICA");
    await user.selectOptions(screen.getByLabelText("Cargo"), "c-ger");
    await user.selectOptions(screen.getByLabelText("Loja"), "335");
    await user.click(screen.getByRole("button", { name: "FLU TIJUCA" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(salvarFuncionario).toHaveBeenCalledTimes(1);
    const enviado = salvarFuncionario.mock.calls[0][0];
    expect(enviado.nome).toBe("JESSICA");
    expect(enviado.cargoId).toBe("c-ger");
    expect(enviado.lojaId).toBe(335);
    expect(enviado.semPdv).toBe(true);
    expect(enviado.lojasGrupo).toEqual([371]);
  });
});
