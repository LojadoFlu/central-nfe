"use client";

// Ajustes, estornos e descontos de folha da competência (§29, §17). Motivo é
// obrigatório em todos.
//
// Ajuste e desconto não são a mesma coisa: o ajuste entra na comissão (e o
// piso pode absorvê-lo), o desconto sai depois do piso — retirada de produto e
// falta se descontam do que a pessoa recebe.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatarDataHora } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { Ajuste, Funcionario } from "@/lib/comissoes/tipos";
import { excluirAjuste, salvarAjuste } from "@/lib/comissoes/repo";
import { Aviso, Campo, InputNumero, Select, mesLabel } from "./comum";

const CATEGORIA_LABEL: Record<string, string> = {
  retirada: "retirada de produto",
  falta: "falta",
  suspensao: "suspensão",
  outro: "outro",
};

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
  const [valor, setValor] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [tipo, setTipo] = useState<"manual" | "desconto">("desconto");
  const [categoria, setCategoria] = useState<string>("retirada");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const nome = useMemo(() => new Map(funcionarios.map((f) => [f.id, f.nome])), [funcionarios]);
  const lancamentos = useMemo(() => ajustes.filter((a) => a.tipo !== "desconto"), [ajustes]);
  const descontos = useMemo(() => ajustes.filter((a) => a.tipo === "desconto"), [ajustes]);
  const total = useMemo(() => lancamentos.reduce((s, a) => s + a.valor, 0), [lancamentos]);
  const totalDescontos = useMemo(() => descontos.reduce((s, a) => s + a.valor, 0), [descontos]);

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
              Novo lançamento em {mesLabel(competencia)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo
                label="Tipo"
                hint={
                  tipo === "desconto"
                    ? "Sai depois do piso: desconta mesmo de quem está no piso."
                    : "Entra na comissão — o piso pode absorvê-lo."
                }
              >
                <Select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as "manual" | "desconto")}
                >
                  <option value="desconto">Desconto de folha</option>
                  <option value="manual">Ajuste de comissão</option>
                </Select>
              </Campo>
              {tipo === "desconto" ? (
                <Campo label="Motivo do desconto">
                  <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                    <option value="retirada">Retirada de produto</option>
                    <option value="falta">Falta</option>
                    <option value="suspensao">Suspensão</option>
                    <option value="outro">Outro</option>
                  </Select>
                </Campo>
              ) : null}
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
              <Campo
                label="Valor (R$)"
                hint={
                  tipo === "desconto"
                    ? "Quanto descontar — sempre positivo."
                    : "Negativo para tirar da comissão."
                }
              >
                <InputNumero value={valor} onChange={setValor} />
              </Campo>
              <Campo label="Motivo" hint="Fica no histórico e na memória de cálculo.">
                <Input
                  value={motivo}
                  placeholder={
                    tipo === "desconto"
                      ? "Ex.: 2 camisas retiradas em 12/08"
                      : "Ex.: campanha autorizada pela diretoria"
                  }
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </Campo>
            </div>
            <Button
              size="sm"
              disabled={ocupado || !funcionarioId || !motivo.trim() || !valor}
              onClick={() =>
                executar(async () => {
                  await salvarAjuste({
                    funcionarioId,
                    competencia,
                    valor: valor ?? 0,
                    motivo: motivo.trim(),
                    tipo,
                    categoria: tipo === "desconto" ? categoria : undefined,
                  });
                  setValor(null);
                  setMotivo("");
                }, tipo === "desconto" ? "Desconto lançado." : "Ajuste lançado.")
              }
            >
              <Plus /> {tipo === "desconto" ? "Lançar desconto" : "Lançar ajuste"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {descontos.length > 0 ? (
        <>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">
              Descontos de folha em {mesLabel(competencia)}
            </h2>
            <span className="text-sm font-semibold tnum text-destructive">
              − {formatBRL(totalDescontos)}
            </span>
          </div>
          <div className="space-y-2">
            {descontos.map((a) => (
              <Card key={a.id}>
                <CardContent className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {nome.get(a.funcionarioId) ?? a.funcionarioId}
                      <Badge variant="neutral">{CATEGORIA_LABEL[a.categoria ?? "outro"] ?? a.categoria}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">{a.motivo}</p>
                    {a.criadoEm ? (
                      <p className="text-[11px] text-muted-foreground">{formatarDataHora(a.criadoEm)}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tnum text-destructive">− {formatBRL(a.valor)}</p>
                    {podeGerir ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={ocupado}
                        onClick={() => executar(() => excluirAjuste(a.id), "Desconto excluído.")}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      <div className="flex items-baseline justify-between">
        <h2 className="text-[0.95rem] font-semibold tracking-tight">
          Ajustes de comissão em {mesLabel(competencia)}
        </h2>
        <span className={`text-sm font-semibold tnum ${total < 0 ? "text-destructive" : ""}`}>
          {formatBRL(total)}
        </span>
      </div>

      <div className="space-y-2">
        {lancamentos.map((a) => (
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
        {lancamentos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum ajuste de comissão nesta competência.
          </p>
        ) : null}
      </div>
    </div>
  );
}
