"use client";

// Configuração geral do módulo (§5, §49).

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Cargo, ConfigComissoes } from "@/lib/comissoes/tipos";
import { salvarConfig } from "@/lib/comissoes/repo";
import { Aviso, Campo, Select } from "./comum";

export function Configuracoes({
  config,
  cargos,
  podeGerir,
  onRecarregar,
}: {
  config: ConfigComissoes;
  cargos: Cargo[];
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [regraPiso, setRegraPiso] = useState(config.regraPiso);
  const [cargoPadraoId, setCargoPadraoId] = useState(config.cargoPadraoId ?? "");
  const [diaPagamentoFolha, setDiaPagamentoFolha] = useState(String(config.diaPagamentoFolha));
  const [mesPagamento, setMesPagamento] = useState(config.mesPagamento);
  const [provisaoNoFluxo, setProvisaoNoFluxo] = useState(config.provisaoNoFluxo);
  const [sincronizarFuncionarios, setSincronizarFuncionarios] = useState(
    config.sincronizarFuncionarios,
  );
  const [cargosPorTipoPdv, setCargosPorTipoPdv] = useState<Record<string, string>>(
    config.cargosPorTipoPdv ?? {},
  );
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      <Card>
        <CardContent className="space-y-3 py-4">
          <Campo
            label="Piso garantido × comissão"
            hint="O padrão do varejo é o maior dos dois — o piso é um mínimo, não um adicional."
          >
            <Select
              value={regraPiso}
              disabled={!podeGerir}
              onChange={(e) => setRegraPiso(e.target.value as ConfigComissoes["regraPiso"])}
            >
              <option value="maior">Paga o MAIOR entre piso e comissão (padrão)</option>
              <option value="soma">Paga piso + comissão (soma)</option>
            </Select>
          </Campo>
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            {regraPiso === "maior" ? (
              <>
                Piso R$ 1.800,00 e comissão R$ 1.450,00 → <strong>paga R$ 1.800,00</strong>.<br />
                Piso R$ 1.800,00 e comissão R$ 2.650,00 → <strong>paga R$ 2.650,00</strong>.
              </>
            ) : (
              <>
                Piso R$ 1.800,00 e comissão R$ 1.450,00 → <strong>paga R$ 3.250,00</strong>. Confirme com o RH
                antes de deixar assim: muda o custo da folha inteira.
              </>
            )}
          </div>

          <Campo label="Cargo padrão ao importar do PDV">
            <Select
              value={cargoPadraoId}
              disabled={!podeGerir}
              onChange={(e) => setCargoPadraoId(e.target.value)}
            >
              <option value="">— nenhum —</option>
              {cargos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Dia de pagamento da folha variável" hint="Usado como data da saída no fluxo de caixa.">
              <Input
                type="number"
                min={1}
                max={28}
                disabled={!podeGerir}
                value={diaPagamentoFolha}
                onChange={(e) => setDiaPagamentoFolha(e.target.value)}
              />
            </Campo>
            <Campo label="A comissão do mês é paga">
              <Select
                value={mesPagamento}
                disabled={!podeGerir}
                onChange={(e) => setMesPagamento(e.target.value as ConfigComissoes["mesPagamento"])}
              >
                <option value="seguinte">No mês seguinte</option>
                <option value="mesmo">No próprio mês</option>
              </Select>
            </Campo>
          </div>

          <Campo
            label="Lançar a provisão de comissões no fluxo de caixa"
            hint="Deixe desligado se a folha já entra no fluxo como despesa manual — senão o mesmo dinheiro sai duas vezes."
          >
            <Select
              value={provisaoNoFluxo ? "1" : "0"}
              disabled={!podeGerir}
              onChange={(e) => setProvisaoNoFluxo(e.target.value === "1")}
            >
              <option value="0">Não lançar (padrão)</option>
              <option value="1">Lançar como saída prevista</option>
            </Select>
          </Campo>

          <Campo
            label="Cadastro de funcionários segue o PDV"
            hint="Ligado, o quadro é reconciliado todo dia às 7h: quem entra no PDV vira funcionário, quem sai é inativado."
          >
            <Select
              value={sincronizarFuncionarios ? "1" : "0"}
              disabled={!podeGerir}
              onChange={(e) => setSincronizarFuncionarios(e.target.value === "1")}
            >
              <option value="1">Sim, seguir o PDV (recomendado)</option>
              <option value="0">Não, só cadastro manual</option>
            </Select>
          </Campo>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">
              Cargo de quem entra pelo PDV
            </label>
            <p className="text-[11px] text-muted-foreground">
              O PDV classifica cada vendedor por um tipo. Diga qual cargo daqui corresponde a cada
              um — vale só no momento da criação; depois o cargo é seu e a sincronização não mexe.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { tipo: "V", label: 'Tipo "V" (vendedor)' },
                { tipo: "G", label: 'Tipo "G" (gerente)' },
              ].map(({ tipo, label }) => (
                <Campo key={tipo} label={label}>
                  <Select
                    value={cargosPorTipoPdv[tipo] ?? ""}
                    disabled={!podeGerir}
                    onChange={(e) =>
                      setCargosPorTipoPdv({ ...cargosPorTipoPdv, [tipo]: e.target.value })
                    }
                  >
                    <option value="">— usar o cargo padrão —</option>
                    {cargos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ))}
            </div>
          </div>

          {podeGerir ? (
            <Button
              size="sm"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                setErro(null);
                setOk(null);
                try {
                  await salvarConfig({
                    regraPiso,
                    cargoPadraoId: cargoPadraoId || null,
                    diaPagamentoFolha: Number(diaPagamentoFolha) || 5,
                    mesPagamento,
                    provisaoNoFluxo,
                    sincronizarFuncionarios,
                    cargosPorTipoPdv: Object.fromEntries(
                      Object.entries(cargosPorTipoPdv).filter(([, v]) => v),
                    ),
                  });
                  await onRecarregar();
                  setOk("Configuração salva.");
                } catch (e) {
                  setErro((e as Error).message);
                } finally {
                  setOcupado(false);
                }
              }}
            >
              Salvar
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
