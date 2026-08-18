"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/utils";
import type { Company } from "@/lib/nfe/types";
import type { ContaPagamento } from "@/lib/nfe/repo";
import { Plus, X } from "lucide-react";

/**
 * Editor das contas de pagamento (rateio): de qual(is) conta(s)/empresa(s) o
 * dinheiro saiu e quanto de cada. Pode ser de outra empresa (cross-company) e
 * mais de uma (rateio). Mostra a diferença vs o valor total esperado.
 */
export function ContasPagamento({
  empresas,
  valorTotal,
  contas,
  onChange,
}: {
  empresas: Company[];
  valorTotal: number;
  contas: ContaPagamento[];
  onChange: (c: ContaPagamento[]) => void;
}) {
  const soma = contas.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const dif = Math.round((soma - valorTotal) * 100) / 100;

  function set(i: number, patch: Partial<ContaPagamento>) {
    onChange(contas.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function add() {
    const resto = Math.round((valorTotal - soma) * 100) / 100;
    onChange([...contas, { empresaId: empresas[0]?.id ?? "", valor: resto > 0 ? resto : 0 }]);
  }
  function remover(i: number) {
    onChange(contas.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted-foreground">De qual conta saiu o pagamento</label>
      {contas.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Nenhuma conta informada — vai lançar na própria empresa da conta a pagar.
        </p>
      ) : null}
      {contas.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={c.empresaId}
            onChange={(e) => set(i, { empresaId: e.target.value })}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">— conta —</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
          </select>
          <Input
            type="number" step="0.01" inputMode="decimal"
            value={c.valor || ""}
            onChange={(e) => set(i, { valor: Number(e.target.value) || 0 })}
            placeholder="0,00"
            className="h-9 w-28"
          />
          <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => remover(i)}>
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="size-4" /> {contas.length === 0 ? "Informar conta(s)" : "Outra conta (rateio)"}
        </Button>
        {contas.length > 0 ? (
          <span className={`text-[11px] tnum ${Math.abs(dif) >= 0.01 ? "text-destructive" : "text-muted-foreground"}`}>
            Soma {formatBRL(soma)} {Math.abs(dif) >= 0.01 ? `· falta ${formatBRL(-dif)}` : "· confere"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Contas válidas (empresa + valor > 0). Vazio = não enviar (baixa legada). */
export function contasValidas(contas: ContaPagamento[]): ContaPagamento[] {
  return contas.filter((c) => c.empresaId && Number(c.valor) > 0).map((c) => ({ empresaId: c.empresaId, valor: Math.round(Number(c.valor) * 100) / 100 }));
}
