"use client";

// Metas da competência: por loja e por funcionário (§9, §10).
// A meta individual tem prioridade sobre a do cargo, que tem sobre a da loja.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/utils";
import { Copy, Save } from "lucide-react";
import type { Funcionario, Meta } from "@/lib/comissoes/tipos";
import type { StorePdv } from "@/lib/nfe/repo";
import { listarMetas, salvarMetas } from "@/lib/comissoes/repo";
import { Aviso, mesLabel } from "./comum";

/** Competência anterior a "YYYY-MM". */
function mesAnterior(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function Metas({
  competencia,
  metas,
  funcionarios,
  lojas,
  podeGerir,
  onRecarregar,
}: {
  competencia: string;
  metas: Meta[];
  funcionarios: Funcionario[];
  lojas: StorePdv[];
  podeGerir: boolean;
  onRecarregar: () => Promise<void>;
}) {
  const [porLoja, setPorLoja] = useState<Record<number, string>>({});
  const [porFuncionario, setPorFuncionario] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Recarrega os campos sempre que a competência (ou as metas) mudam.
  useEffect(() => {
    const l: Record<number, string> = {};
    const f: Record<string, string> = {};
    for (const m of metas) {
      if (m.funcionarioId) f[m.funcionarioId] = String(m.valor);
      else if (m.lojaId != null && !m.cargoId) l[m.lojaId] = String(m.valor);
    }
    setPorLoja(l);
    setPorFuncionario(f);
  }, [metas, competencia]);

  const ativos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  const totalLojas = useMemo(
    () => Object.values(porLoja).reduce((s, v) => s + (Number(v) || 0), 0),
    [porLoja],
  );

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

  async function salvarTudo() {
    const lote: Partial<Meta>[] = [];
    for (const [lojaId, v] of Object.entries(porLoja)) {
      const valor = Number(v);
      if (!Number.isFinite(valor) || valor <= 0) continue;
      lote.push({ competencia, lojaId: Number(lojaId), valor });
    }
    for (const [funcionarioId, v] of Object.entries(porFuncionario)) {
      const valor = Number(v);
      if (!Number.isFinite(valor) || valor <= 0) continue;
      lote.push({ competencia, funcionarioId, valor });
    }
    if (lote.length === 0) throw new Error("Nada para salvar — preencha ao menos uma meta.");
    await salvarMetas(lote);
  }

  async function copiarDoMesAnterior() {
    const anterior = mesAnterior(competencia);
    const antigas = await listarMetas(anterior);
    if (antigas.length === 0) throw new Error(`Nenhuma meta em ${mesLabel(anterior)} para copiar.`);
    await salvarMetas(
      antigas.map((m) => ({
        competencia,
        funcionarioId: m.funcionarioId ?? null,
        cargoId: m.cargoId ?? null,
        lojaId: m.lojaId ?? null,
        valor: m.valor,
      })),
    );
  }

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      {podeGerir ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={ocupado} onClick={() => executar(salvarTudo, "Metas salvas.")}>
            <Save /> Salvar metas de {mesLabel(competencia)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              executar(copiarDoMesAnterior, `Metas de ${mesLabel(mesAnterior(competencia))} copiadas.`)
            }
          >
            <Copy /> Copiar do mês anterior
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Meta por loja</h2>
            <span className="text-xs text-muted-foreground tnum">soma {formatBRL(totalLojas)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Vale para o bônus da loja e para a comissão de gerente/supervisor.
          </p>
          <div className="space-y-1.5">
            {lojas.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{l.grupoNome || l.nome}</span>
                <Input
                  className="h-9 w-40"
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  disabled={!podeGerir}
                  value={porLoja[l.id] ?? ""}
                  onChange={(e) => setPorLoja({ ...porLoja, [l.id]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 py-4">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">Meta por funcionário</h2>
          <p className="text-[11px] text-muted-foreground">
            Em branco = usa a meta da loja/cargo. Preenchida = exceção individual desta pessoa.
          </p>
          <div className="space-y-1.5">
            {ativos.map((f) => (
              <div key={f.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{f.nome}</span>
                <Input
                  className="h-9 w-40"
                  type="number"
                  step="0.01"
                  placeholder="—"
                  disabled={!podeGerir}
                  value={porFuncionario[f.id] ?? ""}
                  onChange={(e) => setPorFuncionario({ ...porFuncionario, [f.id]: e.target.value })}
                />
              </div>
            ))}
            {ativos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Cadastre funcionários primeiro.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
