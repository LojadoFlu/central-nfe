"use client";

// Log de alterações do módulo (§28). Quem mudou o quê, quando e de qual valor
// para qual — é o que sustenta a conversa três meses depois.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatarDataHora } from "@/lib/utils";
import type { LogAuditoria } from "@/lib/comissoes/tipos";
import { listarAuditoria } from "@/lib/comissoes/repo";
import { Aviso } from "./comum";

const ACAO_LABEL: Record<string, string> = {
  "comissoes.salvarCargo": "Cargo salvo",
  "comissoes.excluirCargo": "Cargo excluído",
  "comissoes.salvarFuncionario": "Funcionário salvo",
  "comissoes.excluirFuncionario": "Funcionário excluído",
  "comissoes.importarVendedores": "Vendedores importados do PDV",
  "comissoes.salvarRegra": "Regra de comissão salva",
  "comissoes.excluirRegra": "Regra excluída",
  "comissoes.salvarMetas": "Metas salvas",
  "comissoes.excluirMeta": "Meta excluída",
  "comissoes.salvarBonus": "Bônus salvo",
  "comissoes.excluirBonus": "Bônus excluído",
  "comissoes.salvarAjuste": "Ajuste lançado",
  "comissoes.excluirAjuste": "Ajuste excluído",
  "comissoes.salvarConfig": "Configuração alterada",
  "comissoes.fechar": "Competência fechada",
  "comissoes.alterarStatus": "Status do fechamento alterado",
  "comissoes.sincronizarVendedores": "Vendedores sincronizados",
};

/** Resumo curto do detalhe — sem despejar JSON na tela. */
function resumo(log: LogAuditoria): string {
  const d = log.detalhe ?? {};
  const partes: string[] = [];
  for (const chave of ["nome", "competencia", "funcionarioId", "valor", "motivo", "status", "para", "qtd", "criados"]) {
    const v = d[chave];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object") continue;
    partes.push(`${chave}: ${String(v)}`);
  }
  return partes.join(" · ");
}

export function Auditoria() {
  const [logs, setLogs] = useState<LogAuditoria[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await listarAuditoria(200);
      setLogs(r.logs);
    } catch (e) {
      setErro((e as Error).message);
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (logs === null) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Últimas {logs.length} alterações do módulo. Toque numa linha para ver o antes e o depois.
      </p>
      {logs.map((l) => (
        <Card key={l.id}>
          <CardContent className="py-3">
            <button
              className="w-full text-left"
              onClick={() => setAberto(aberto === l.id ? null : l.id)}
            >
              <p className="text-sm font-medium">{ACAO_LABEL[l.acao] ?? l.acao}</p>
              <p className="text-xs text-muted-foreground">
                {formatarDataHora(l.at)} · {l.usuario ?? l.uid}
              </p>
              {resumo(l) ? (
                <p className="truncate text-[11px] text-muted-foreground">{resumo(l)}</p>
              ) : null}
            </button>
            {aberto === l.id ? (
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-[10px] leading-snug">
                {JSON.stringify(l.detalhe, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      ))}
      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</p>
      ) : null}
    </div>
  );
}
