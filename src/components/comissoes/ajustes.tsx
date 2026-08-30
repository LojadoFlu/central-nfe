"use client";

// Ajustes manuais e estornos da competência (§29, §17). Motivo é obrigatório.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatarDataHora } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { Ajuste, Funcionario } from "@/lib/comissoes/tipos";
import { excluirAjuste, salvarAjuste } from "@/lib/comissoes/repo";
import { Aviso, Campo, Select, mesLabel } from "./comum";

export function Ajustes({
  competencia,
  ajustes,
  funcionarios,
  podeGerir,
  onRecarregar,
}: {
  competencia: string;
  ajustes: Ajuste[];
  funcionarios: Funcionario[];
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [funcionarioId, setFuncionarioId] = useState("");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const nome = useMemo(() => new Map(funcionarios.map((f) => [f.id, f.nome])), [funcionarios]);
  const total = useMemo(() => ajustes.reduce((s, a) => s + a.valor, 0), [ajustes]);

  async function executar(fn: () => Promise<unknown>, mensagem: string) {
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      await fn();
      await onRecarregar();
      setOk(mensagem);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      {podeGerir ? (
        <Card className="border-primary/40">
          <CardContent className="space-y-3 py-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">
              Novo ajuste em {mesLabel(competencia)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Funcionário">
                <Select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
                  <option value="">— selecione —</option>
                  {funcionarios
                    .filter((f) => f.ativo)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                </Select>
              </Campo>
              <Campo label="Valor (R$)" hint="Negativo para desconto/estorno.">
                <Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
              </Campo>
              <Campo label="Motivo" hint="Fica no histórico e na memória de cálculo.">
                <Input
                  value={motivo}
                  placeholder="Ex.: campanha autorizada pela diretoria"
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </Campo>
            </div>
            <Button
              size="sm"
              disabled={ocupado || !funcionarioId || !motivo.trim() || !Number(valor)}
              onClick={() =>
                executar(async () => {
                  await salvarAjuste({
                    funcionarioId,
                    competencia,
                    valor: Number(valor),
                    motivo: motivo.trim(),
                  });
                  setValor("");
                  setMotivo("");
                }, "Ajuste lançado.")
              }
            >
              <Plus /> Lançar ajuste
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-baseline justify-between">
        <h2 className="text-[0.95rem] font-semibold tracking-tight">
          Ajustes de {mesLabel(competencia)}
        </h2>
        <span className={`text-sm font-semibold tnum ${total < 0 ? "text-destructive" : ""}`}>
          {formatBRL(total)}
        </span>
      </div>

      <div className="space-y-2">
        {ajustes.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {nome.get(a.funcionarioId) ?? a.funcionarioId}
                  {a.tipo === "estorno" ? <Badge variant="neutral">estorno automático</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">{a.motivo}</p>
                {a.criadoEm ? (
                  <p className="text-[11px] text-muted-foreground">{formatarDataHora(a.criadoEm)}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className={`font-semibold tnum ${a.valor < 0 ? "text-destructive" : "text-success"}`}>
                  {formatBRL(a.valor)}
                </p>
                {podeGerir && a.tipo !== "estorno" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => executar(() => excluirAjuste(a.id), "Ajuste excluído.")}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
        {ajustes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum ajuste nesta competência.</p>
        ) : null}
      </div>
    </div>
  );
}
