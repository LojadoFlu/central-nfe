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
  listarDespesasFixas,
  type NfeDocumento,
  type Parcela,
  type Item,
  type DespesaFixa,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { FiltroPeriodo } from "@/components/ui/filtro-periodo";
import { formatBRL, formatCNPJ, formatarData, diasAte } from "@/lib/utils";
import { Download, X } from "lucide-react";

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
  { key: "despesas_fixas", label: "Despesas fixas" },
] as const;

type TipoKey = (typeof TIPOS)[number]["key"];

const CATEGORIAS: { key: string; label: string }[] = [
  { key: "aluguel", label: "Aluguel" },
  { key: "condominio", label: "Condomínio" },
  { key: "energia", label: "Energia" },
  { key: "agua", label: "Água" },
  { key: "internet", label: "Internet" },
  { key: "telefone", label: "Telefone" },
  { key: "contabilidade", label: "Contabilidade" },
  { key: "software", label: "Software/Sistema" },
  { key: "salarios", label: "Salários" },
  { key: "impostos", label: "Impostos/Taxas" },
  { key: "outros", label: "Outros" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIAS.map((c) => [c.key, c.label]));
const REC_LABEL: Record<string, string> = {
  mensal: "Mensal", bimestral: "Bimestral", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual",
};

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
  const [despesasFixas, setDespesasFixas] = useState<DespesaFixa[]>([]);
  const [tipo, setTipo] = useState<TipoKey>("compras_periodo");

  // Filtros
  const [empresaId, setEmpresaId] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [forn, setForn] = useState("");
  const [cat, setCat] = useState("");

  const carregar = useCallback(async () => {
    const [ds, ps, its, emps, dfs] = await Promise.all([
      listarDocumentos(300),
      listarParcelas(300),
      listarItens(1000),
      listarEmpresas(),
      listarDespesasFixas(),
    ]);
    setDocs(ds);
    setParcelas(ps);
    setItens(its);
    setEmpresas(emps);
    setDespesasFixas(dfs);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Fornecedores distintos (das notas) para o filtro.
  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs ?? []) if (d.cnpjEmit) m.set(d.cnpjEmit, d.xNomeEmit ?? d.cnpjEmit);
    return [...m.entries()].map(([cnpj, nome]) => ({ cnpj, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [docs]);

  const passaPeriodo = useCallback(
    (iso: string | null | undefined) => {
      if (!de && !ate) return true;
      if (!iso) return false;
      const d = iso.slice(0, 10);
      if (de && d < de) return false;
      if (ate && d > ate) return false;
      return true;
    },
    [de, ate],
  );

  const usaFornecedor = tipo !== "compras_empresa" && tipo !== "despesas_fixas";
  const usaCategoria = tipo === "despesas_fixas";
  const usaPeriodo = tipo !== "despesas_fixas";

  const relatorio: Relatorio = useMemo(() => {
    const D = (docs ?? []).filter(
      (d) =>
        (!empresaId || d.companyId === empresaId) &&
        (!forn || (d.cnpjEmit ?? "") === forn) &&
        passaPeriodo(d.dhEmi),
    );

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
          if (p.statusPagamento === "pago") return false;
          if (empresaId && (p.companyId ?? "") !== empresaId) return false;
          if (forn && (p.cnpjEmit ?? "") !== forn) return false;
          if (!passaPeriodo(p.vencimento)) return false;
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
      const its = itens.filter(
        (it) =>
          (!empresaId || it.companyId === empresaId) &&
          (!forn || (it.cnpjEmit ?? "") === forn) &&
          passaPeriodo(it.dhEmi),
      );
      const m = new Map<string, { prod: string; forn: string; qtd: number; total: number }>();
      for (const it of its) {
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
            g.prod, g.forn, g.qtd.toLocaleString("pt-BR"),
            formatBRL(g.qtd ? g.total / g.qtd : 0), formatBRL(g.total),
          ]),
      };
    }
    if (tipo === "despesas_fixas") {
      const dfs = despesasFixas.filter(
        (d) => (!empresaId || (d.companyId ?? "") === empresaId) && (!cat || d.categoria === cat),
      );
      return {
        headers: ["Empresa", "Despesa", "Categoria", "Recorrência", "Dia venc.", "Valor previsto", "Situação"],
        rows: dfs
          .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0))
          .map((d) => [
            d.empresaNome ?? "—",
            d.nome,
            CAT_LABEL[d.categoria ?? "outros"] ?? d.categoria ?? "—",
            REC_LABEL[d.recorrencia ?? "mensal"] ?? "Mensal",
            d.diaVencimento != null ? String(d.diaVencimento) : "—",
            formatBRL(d.valor),
            d.ativo === false ? "Inativa" : "Ativa",
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
  }, [tipo, docs, parcelas, itens, empresas, despesasFixas, forn, cat, empresaId, passaPeriodo]);

  const labelAtual = TIPOS.find((t) => t.key === tipo)?.label ?? "";
  const temFiltro = empresaId || de || ate || forn || cat;

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Compras, vencimentos, produtos e despesas — exportáveis em CSV."
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

      {/* Filtros */}
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          {empresas.length > 1 ? (
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">Empresa</label>
              <select
                value={empresaId}
                onChange={(e) => setEmpresaId(e.target.value)}
                className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todas</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
                ))}
              </select>
            </div>
          ) : null}

          {usaPeriodo ? (
            <div className="w-full space-y-1 sm:w-72">
              <label className="block text-xs text-muted-foreground">Período</label>
              <FiltroPeriodo value={{ de, ate }} onChange={(p) => { setDe(p.de); setAte(p.ate); }} />
            </div>
          ) : null}

          {usaFornecedor ? (
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">Fornecedor</label>
              <select
                value={forn}
                onChange={(e) => setForn(e.target.value)}
                className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {fornecedores.map((f) => (
                  <option key={f.cnpj} value={f.cnpj}>{f.nome}</option>
                ))}
              </select>
            </div>
          ) : null}

          {usaCategoria ? (
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">Tipo de despesa</label>
              <select
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todas</option>
                {CATEGORIAS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
          ) : null}

          {temFiltro ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setEmpresaId(""); setDe(""); setAte(""); setForn(""); setCat(""); }}
            >
              <X className="size-4" /> Limpar
            </Button>
          ) : null}
        </div>
      </Card>

      {docs === null ? (
        <Skeleton className="h-64" />
      ) : relatorio.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dados para este relatório com os filtros atuais.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                {relatorio.headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {relatorio.rows.slice(0, 400).map((row, i) => (
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
        {relatorio.rows.length} linha(s). Exporte em CSV (abre no Excel). Filtros de período e fornecedor aplicam às
        compras/contas; tipo de despesa aplica ao relatório de despesas fixas.
      </p>
    </div>
  );
}
