// @vitest-environment jsdom
//
// A tela de importação quebrou justamente quando tinha um erro para mostrar:
// a resposta de "nenhuma linha aproveitável" vinha sem os campos de lista e o
// componente chamava .map em undefined. Tela branca no lugar da mensagem.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const importarMetas = vi.fn();
vi.mock("@/lib/comissoes/repo", () => ({
  importarMetas,
  obterConfig: vi.fn(async () => ({})),
  salvarConfig: vi.fn(),
}));

const { ImportarMetas } = await import("@/components/comissoes/importar-metas");
afterEach(cleanup);

const LOJAS = [{ id: 335, nome: "FLU CLUBE", grupoNome: "FLU CLUBE", ativoSync: true }];

async function conferir(resposta: unknown, texto = "linha qualquer") {
  importarMetas.mockResolvedValueOnce(resposta);
  const user = userEvent.setup();
  render(<ImportarMetas lojas={LOJAS} onImportado={async () => {}} />);
  await user.type(screen.getByRole("textbox"), texto);
  await user.click(screen.getByRole("button", { name: "Conferir" }));
}

describe("importação de metas", () => {
  it("resposta sem as listas não derruba a tela — mostra o erro", async () => {
    // Forma antiga/curta, que era a que quebrava.
    await conferir({ ok: false, linhas: 0, erros: ["Linha 1: não reconheci data e meta."] });
    expect(screen.getByText(/não reconheci data e meta/)).toBeDefined();
  });

  it("resposta sem campo nenhum também não derruba", async () => {
    await conferir({ ok: false });
    expect(screen.getByRole("button", { name: "Conferir" })).toBeDefined();
  });

  it("com linhas boas, mostra o resumo e o aviso de substituição", async () => {
    await conferir({
      ok: true,
      confirmado: false,
      linhas: 3,
      erros: [],
      ambiguos: [],
      lojasNaoMapeadas: [],
      semCasar: [],
      resumo: [
        {
          competencia: "2026-08",
          substituidas: 12,
          pessoas: 3,
          total: 54000,
          semanas: ["2026-08-24", "2026-08-30"],
          semMeta: ["FULANO"],
        },
      ],
    });
    expect(screen.getByText(/3 pessoa\(s\)/)).toBeDefined();
    expect(screen.getByText(/substitui/)).toBeDefined();
    expect(screen.getByText(/Ficam sem meta: FULANO/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Importar 3 linha/ })).toBeDefined();
  });

  it("loja não reconhecida vira um seletor, não um erro fatal", async () => {
    await conferir({
      ok: true,
      confirmado: false,
      linhas: 1,
      erros: [],
      ambiguos: [],
      lojasNaoMapeadas: ["Flu Laranjeiras"],
      semCasar: [],
      resumo: [],
    });
    expect(screen.getByText("Flu Laranjeiras")).toBeDefined();
    expect(screen.getByRole("combobox")).toBeDefined();
  });
});
