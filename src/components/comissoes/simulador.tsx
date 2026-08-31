"use client";

// Simulador "e se…" (§20). Roda o mesmo motor da apuração, sem gravar nada.

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/utils";
import { Play } from "lucide-react";
import type { EscopoVenda, Funcionario, ResultadoApuracao } from "@/lib/comissoes/tipos";
import { simularComissao } from "@/lib/comissoes/repo";
import { Aviso, Campo, InputNumero, Select, mesLabel, pctFmt } from "./comum";

const ESCOPO_COLUNA: Record<EscopoVenda, string> = {
  individual: "própria",
  loja: "da loja",
  grupo: "do grupo",
};

function Coluna({ titulo, r, destaque }: { titulo: string; r: ResultadoApuracao; destaque?: boolean }) {
  return (
    <div className={`rounded-md p-3 ${destaque ? "bg-primary/10" : "bg-muted/50"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Valor devido
      </p>
      <p className={`text-xl font-bold tnum ${destaque ? "text-primary" : ""}`}>
        {formatBRL(r.valorDevido)}
      </p>
      <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        <p>
          Venda ({ESCOPO_COLUNA[r.escopoMeta]}): {formatBRL(r.vendaConsiderada)}
        </p>
        <p>Meta: {r.metaConsiderada == null ? "—" : formatBRL(r.metaConsiderada)}</p>
        <p>Atingimento: {pctFmt(r.atingimentoPct)}</p>
        <p>Comissão calculada: {formatBRL(r.comissaoTotal)}</p>
        <p>Piso garantido: {formatBRL(r.piso)}</p>
        <p>% efetivo: {pctFmt(r.percentualEfetivo)}</p>
      </div>
      {r.pisoAplicado ? (
        <p className="mt-2 rounded bg-warning/15 px-2 py-1 text-[11px] text-warning">
          A comissão ficou abaixo do piso — paga-se o piso.
        </p>
      ) : null}
    </div>
  );
}

export function Simulador({
  competencia,
  funcionarios,
}: {
  competencia: string;
  funcionarios: Funcionario[];
}) {
  const [funcionarioId, setFuncionarioId] = useState("");
  const [venda, setVenda] = useState<number | null>(null);
  const [meta, setMeta] = useState<number | null>(null);
  const [piso, setPiso] = useState<number | null>(null);
  const [res, setRes] = useState<{
    atual: ResultadoApuracao;
    simulado: ResultadoApuracao;
    escopo: EscopoVenda;
  } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await simularComissao({ competencia, funcionarioId, venda, meta, piso });
      setRes({ atual: r.atual, simulado: r.simulado, escopo: r.escopo });
    } catch (e) {
      setErro((e as Error).message);
      setRes(null);
    } finally {
      setOcupado(false);
    }
  }

  const diferenca = res ? res.simulado.valorDevido - res.atual.valorDevido : 0;
  const ESCOPO_LABEL: Record<EscopoVenda, string> = {
    individual: "venda própria da pessoa",
    loja: "venda da loja dela",
    grupo: "venda somada das lojas que ela acompanha",
  };
  const dica = res
    ? `Vale para a ${ESCOPO_LABEL[res.escopo]} — é por ela que esta pessoa é medida.`
    : "Vazio = venda real do mês";

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <Card>
        <CardContent className="space-y-3 py-4">
          <p className="text-xs text-muted-foreground">
            Mexe nos números só aqui: nada é gravado. Serve para responder &ldquo;quanto eu ganho se
            vender mais X?&rdquo; sem alterar a apuração de {mesLabel(competencia)}.
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
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
            <Campo label="Venda (R$)" hint={dica}>
              <InputNumero value={venda} onChange={setVenda} />
            </Campo>
            <Campo label="Meta (R$)" hint="Vazio = meta cadastrada">
              <InputNumero value={meta} onChange={setMeta} />
            </Campo>
            <Campo label="Piso (R$)" hint="Vazio = piso cadastrado">
              <InputNumero value={piso} onChange={setPiso} />
            </Campo>
          </div>
          <Button size="sm" disabled={ocupado || !funcionarioId} onClick={rodar}>
            <Play /> {ocupado ? "Calculando…" : "Simular"}
          </Button>
        </CardContent>
      </Card>

      {res ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Coluna titulo="Hoje" r={res.atual} />
            <Coluna titulo="Simulado" r={res.simulado} destaque />
          </div>
          <Card>
            <CardContent className="py-3 text-sm">
              <p>
                Diferença:{" "}
                <strong className={`tnum ${diferenca >= 0 ? "text-success" : "text-destructive"}`}>
                  {diferenca >= 0 ? "+" : ""}
                  {formatBRL(diferenca)}
                </strong>{" "}
                — de {formatBRL(res.atual.valorDevido)} para {formatBRL(res.simulado.valorDevido)}.
              </p>
              {res.simulado.pisoAplicado && diferenca === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  A diferença some porque, nos dois cenários, o piso é maior que a comissão.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Memória do cenário simulado
              </p>
              <div className="divide-y divide-border/60">
                {res.simulado.memoria.map((m, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <p className={`text-xs font-medium ${m.informativa ? "text-muted-foreground" : ""}`}>
                        {m.rotulo}
                      </p>
                      <p className="text-[11px] leading-snug text-muted-foreground">{m.detalhe}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tnum">
                      {m.informativa && m.valor === 0 ? "—" : formatBRL(m.valor)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
