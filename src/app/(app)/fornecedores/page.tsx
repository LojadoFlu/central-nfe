"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { listarDocumentos, type NfeDocumento } from "@/lib/nfe/repo";
import { formatBRL, formatCNPJ, formatarData, normalizar } from "@/lib/utils";
import { Truck, ChevronRight } from "lucide-react";

interface Fornecedor {
  cnpj: string;
  nome: string;
  qtd: number;
  total: number;
  ultimaCompra: string | null;
}

export default function FornecedoresPage() {
  const [docs, setDocs] = useState<NfeDocumento[] | null>(null);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try {
      setDocs(await listarDocumentos(300));
    } catch {
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const fornecedores = useMemo(() => {
    const mapa = new Map<string, Fornecedor>();
    for (const d of docs ?? []) {
      const cnpj = d.cnpjEmit ?? "sem-cnpj";
      const f = mapa.get(cnpj) ?? {
        cnpj,
        nome: d.xNomeEmit ?? "Fornecedor não identificado",
        qtd: 0,
        total: 0,
        ultimaCompra: null,
      };
      f.qtd += 1;
      f.total += d.vNF ?? 0;
      if (d.xNomeEmit && f.nome === "Fornecedor não identificado") f.nome = d.xNomeEmit;
      if (d.dhEmi && (!f.ultimaCompra || d.dhEmi > f.ultimaCompra)) f.ultimaCompra = d.dhEmi;
      mapa.set(cnpj, f);
    }
    let lista = [...mapa.values()].sort((a, b) => b.total - a.total);
    const termo = normalizar(busca);
    if (termo) {
      lista = lista.filter((f) => (normalizar(f.nome) + " " + f.cnpj).includes(termo));
    }
    return lista;
  }, [docs, busca]);

  return (
    <div>
      <PageHeader title="Fornecedores" description="Quem mais faturou para o grupo." />

      <Input
        placeholder="Buscar fornecedor…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="mb-4 h-11"
      />

      {docs === null ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : fornecedores.length === 0 ? (
        <ModulePlaceholder icon={Truck} title="Sem fornecedores" etapa="Aguardando notas">
          Os fornecedores aparecem a partir das NF-e sincronizadas.
        </ModulePlaceholder>
      ) : (
        <div className="space-y-3">
          {fornecedores.map((f) => (
            <Card key={f.cnpj} className="transition-colors hover:bg-accent/50">
              <Link href={`/fornecedores/${encodeURIComponent(f.cnpj)}`} className="block">
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCNPJ(f.cnpj)} · {f.qtd} nota{f.qtd > 1 ? "s" : ""} · última{" "}
                      {formatarData(f.ultimaCompra)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Ticket médio {formatBRL(f.total / f.qtd)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tnum">{formatBRL(f.total)}</p>
                    <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Totais calculados sobre as notas sincronizadas mais recentes.
      </p>
    </div>
  );
}
