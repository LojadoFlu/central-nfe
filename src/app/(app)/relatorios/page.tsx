"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listarDocumentos,
  listarParcelas,
  listarItens,
  listarEmpresas,
  type NfeDocumento,
  type Parcela,
  type Item,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { formatBRL, formatCNPJ, formatarData, diasAte } from "@/lib/utils";
import { Download } from "lucide-react";

type Relatorio = {
  headers: string[];
  rows: string[][];
};

const TIPOS = [
  { key: "compras_periodo", label: "Compras por período" },
  { key: "compras_fornecedor", label: "Compras por fornecedor" },
  { key: "a_vencer", label: "Contas a vencer" },
  { key: "vencidas", label: "Contas vencidas" },
  { key: "produtos", label: "Produtos comprados" },
  { key: "compras_empresa", label: "Compras por empresa" },
] as const;

type TipoKey = (typeof TIPOS)[number]["key"];

function baixarCSV(nome: string, r: Relatorio) {
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const linhas = [r.headers.map(esc).join(";"), ...r.rows.map((row) => row.map(esc).join(";"))];
  const csv = "﻿" + linhas.join("\r\n"); // BOM p/ Excel abrir acentos
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function RelatoriosPage() {
  const [docs, setDocs] = useState<NfeDocumento[] | null>(null);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [itens, setItens] = useState<Item[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [tipo, setTipo] = useState<TipoKey>("compras_periodo");

  const carregar = useCallback(async () => {
    const [ds, ps, its, emps] = await Promise.all([
      listarDocumentos(300),
      listarParcelas(300),
      listarItens(1000),
      listarEmpresas(),
    ]);
    setDocs(ds);
    setParcelas(ps);
    setItens(its);
    setEmpresas(emps);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const relatorio: Relatorio = useMemo(() => {
    const D = docs ?? [];
    if (tipo === "compras_periodo") {
      return {
        headers: ["Fornecedor", "CNPJ", "NF", "Emissão", "Valor"],
        rows: D.map((d) => [
          d.xNomeEmit ?? "—",
          formatCNPJ(d.cnpjEmit ?? ""),
          `${d.nNF ?? "—"}${d.serie ? "/" + d.serie : ""}`,
          formatarData(d.dhEmi),
          formatBRL(d.vNF),
        ]),
      };
    }
    if (tipo === "compras_fornecedor") {
      const m = new Map<string, { nome: string; qtd: number; total: number }>();
      for (const d of D) {
        const c = d.cnpjEmit ?? "—";
        const f = m.get(c) ?? { nome: d.xNomeEmit ?? "—", qtd: 0, total: 0 };
        f.qtd++;
        f.total += d.vNF ?? 0;
        m.set(c, f);
      }
      return {
        headers: ["Fornecedor", "CNPJ", "Nº NF-e", "Total", "Ticket médio"],
        rows: [...m.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([c, f]) => [f.nome, formatCNPJ(c), String(f.qtd), formatBRL(f.total), formatBRL(f.total / f.qtd)]),
      };
    }
    if (tipo === "a_vencer" || tipo === "vencidas") {
      const venc = tipo === "vencidas";
      const rows = parcelas
        .filter((p) => {
          if (p.statusPagamento === "pago") return false; // já baixada
          const dias = diasAte(p.vencimento);
          return dias !== null && (venc ? dias < 0 : dias >= 0);
        })
        .sort((a, b) => (a.vencimento ?? "").localeCompare(b.vencimento ?? ""))
        .map((p) => {
          const dias = diasAte(p.vencimento) ?? 0;
          return [
            p.xNomeEmit ?? "—",
            p.nDup ?? "1",
            formatarData(p.vencimento),
            formatBRL(p.valor),
            venc ? String(-dias) : String(dias),
          ];
        });
      return {
        headers: ["Fornecedor", "Parcela", "Vencimento", "Valor", venc ? "Dias atraso" : "Dias restantes"],
        rows,
      };
    }
    if (tipo === "produtos") {
      const m = new Map<string, { prod: string; forn: string; qtd: number; total: number }>();
      for (const it of itens) {
        const k = `${it.cnpjEmit ?? ""}|${it.descricao ?? ""}`;
        const g = m.get(k) ?? { prod: it.descricao ?? "—", forn: it.xNomeEmit ?? "—", qtd: 0, total: 0 };
        g.qtd += it.quantidade ?? 0;
        g.total += it.valorTotal ?? 0;
        m.set(k, g);
      }
      return {
        headers: ["Produto", "Fornecedor", "Quantidade", "Valor médio", "Total"],
        rows: [...m.values()]
          .sort((a, b) => b.total - a.total)
          .map((g) => [
            g.prod,
            g.forn,
            g.qtd.toLocaleString("pt-BR"),
            formatBRL(g.qtd ? g.total / g.qtd : 0),
            formatBRL(g.total),
          ]),
      };
    }
    // compras_empresa
    const nomeEmp = new Map(empresas.map((e) => [e.id, e.razaoSocial]));
    const m = new Map<string, { qtd: number; total: number }>();
    for (const d of D) {
      const c = d.companyId ?? "—";
      const g = m.get(c) ?? { qtd: 0, total: 0 };
      g.qtd++;
      g.total += d.vNF ?? 0;
      m.set(c, g);
    }
    return {
      headers: ["Empresa", "Nº NF-e", "Total"],
      rows: [...m.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([c, g]) => [nomeEmp.get(c) ?? c, String(g.qtd), formatBRL(g.total)]),
    };
  }, [tipo, docs, parcelas, itens, empresas]);

  const labelAtual = TIPOS.find((t) => t.key === tipo)?.label ?? "";

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Compras, vencimentos e produtos — exportáveis em CSV."
        action={
          docs && relatorio.rows.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => baixarCSV(labelAtual, relatorio)}>
              <Download className="size-4" /> CSV
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TIPOS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTipo(t.key)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              tipo === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {docs === null ? (
        <Skeleton className="h-64" />
      ) : relatorio.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dados para este relatório ainda.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                {relatorio.headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {relatorio.rows.slice(0, 300).map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className={`whitespace-nowrap px-3 py-2 ${j >= relatorio.headers.length - 1 ? "tnum text-right font-medium" : ""}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {relatorio.rows.length} linha(s). Exporte em CSV (abre no Excel). Base: notas sincronizadas.
      </p>
    </div>
  );
}
