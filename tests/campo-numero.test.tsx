// @vitest-environment jsdom
//
// O campo de piso do cargo já "comeu os centavos" duas vezes. Aqui a digitação
// é reproduzida tecla a tecla, com o MESMO vai-e-vem de estado da tela de
// cargos (o pai guarda texto e devolve número), para provar o que chega no save.

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InputNumero } from "@/components/comissoes/comum";

afterEach(cleanup);

/** Réplica da linha de cargo: estado do pai em string, valor de volta em número. */
function LinhaCargo({
  inicial,
  onSalvar,
}: {
  inicial: number | null;
  onSalvar: (n: number | null) => void;
}) {
  const [piso, setPiso] = useState<string>(inicial == null ? "" : String(inicial));
  return (
    <>
      <InputNumero
        aria-label="piso"
        value={piso === "" ? null : Number(piso)}
        onChange={(n) => setPiso(n == null ? "" : String(n))}
      />
      <button onClick={() => onSalvar(piso === "" ? null : Number(piso))}>Salvar</button>
    </>
  );
}

async function digitarESalvar(inicial: number | null, digitado: string) {
  const salvar = vi.fn();
  const user = userEvent.setup();
  render(<LinhaCargo inicial={inicial} onSalvar={salvar} />);
  const campo = screen.getByLabelText("piso");
  await user.clear(campo);
  await user.type(campo, digitado);
  await user.click(screen.getByText("Salvar"));
  return { salvo: salvar.mock.calls[0][0] as number | null, campo };
}

describe("campo de piso na tela de cargos", () => {
  it("cargo novo: 1712,50 chega inteiro no save", async () => {
    const { salvo } = await digitarESalvar(null, "1712,50");
    expect(salvo).toBe(1712.5);
  });

  it("cargo que já tinha 1712: passar para 1712,50 não perde os centavos", async () => {
    const { salvo } = await digitarESalvar(1712, "1712,50");
    expect(salvo).toBe(1712.5);
  });

  it("centavos quebrados sobrevivem", async () => {
    expect((await digitarESalvar(null, "1621,35")).salvo).toBe(1621.35);
  });

  it("percentual com vírgula sobrevive", async () => {
    expect((await digitarESalvar(null, "2,75")).salvo).toBe(2.75);
  });

  it("digitar com separador de milhar também funciona", async () => {
    expect((await digitarESalvar(null, "1.712,50")).salvo).toBe(1712.5);
  });

  it("ao sair do campo, mostra 2 casas — sem sumir com o zero", async () => {
    const user = userEvent.setup();
    render(<LinhaCargo inicial={null} onSalvar={() => {}} />);
    const campo = screen.getByLabelText("piso") as HTMLInputElement;
    await user.type(campo, "1712,50");
    await user.tab();
    expect(campo.value).toBe("1.712,50");
  });

  it("campo limpo salva null, não zero", async () => {
    const salvar = vi.fn();
    const user = userEvent.setup();
    render(<LinhaCargo inicial={1712} onSalvar={salvar} />);
    await user.clear(screen.getByLabelText("piso"));
    await user.click(screen.getByText("Salvar"));
    expect(salvar.mock.calls[0][0]).toBeNull();
  });
});

describe("valor que já vem salvo aparece com as duas casas", () => {
  /** Campo alimentado por um valor vindo do banco, sem ninguém digitar. */
  function CampoSoLeitura({ valor }: { valor: number | null }) {
    const [v, setV] = useState<number | null>(valor);
    return <InputNumero aria-label="piso" value={v} onChange={setV} />;
  }

  it("valor inteiro mostra ,00", () => {
    render(<CampoSoLeitura valor={1712} />);
    expect((screen.getByLabelText("piso") as HTMLInputElement).value).toBe("1.712,00");
  });

  it("valor com um decimal mostra as duas casas", () => {
    render(<CampoSoLeitura valor={1712.5} />);
    expect((screen.getByLabelText("piso") as HTMLInputElement).value).toBe("1.712,50");
  });

  /** O caso real: o campo monta antes dos dados chegarem do Firestore. */
  function CampoQueCarregaDepois() {
    const [v, setV] = useState<number | null>(null);
    return (
      <>
        <InputNumero aria-label="piso" value={v} onChange={setV} />
        <button onClick={() => setV(1712)}>carregar</button>
      </>
    );
  }

  it("valor que chega depois do primeiro render também aparece com ,00", async () => {
    const user = userEvent.setup();
    render(<CampoQueCarregaDepois />);
    expect((screen.getByLabelText("piso") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByText("carregar"));
    expect((screen.getByLabelText("piso") as HTMLInputElement).value).toBe("1.712,00");
  });

  it("zero mostra 0,00 e não fica em branco", () => {
    render(<CampoSoLeitura valor={0} />);
    expect((screen.getByLabelText("piso") as HTMLInputElement).value).toBe("0,00");
  });
});
