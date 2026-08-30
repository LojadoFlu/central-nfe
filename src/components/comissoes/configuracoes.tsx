"use client";

// Configuração geral do módulo (§5, §49).

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
                Piso R$ 1.800 e comissão R$ 1.450 → <strong>paga R$ 1.800</strong>.<br />
                Piso R$ 1.800 e comissão R$ 2.650 → <strong>paga R$ 2.650</strong>.
              </>
            ) : (
              <>
                Piso R$ 1.800 e comissão R$ 1.450 → <strong>paga R$ 3.250</strong>. Confirme com o RH
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

          {podeGerir ? (
            <Button
              size="sm"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                setErro(null);
                setOk(null);
                try {
                  await salvarConfig({ regraPiso, cargoPadraoId: cargoPadraoId || null });
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
