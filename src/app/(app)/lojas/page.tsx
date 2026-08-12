"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/auth-provider";
import {
  listarStores,
  listarEmpresas,
  pdvnetSincronizarLojas,
  pdvnetSalvarLoja,
  type StorePdv,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { normalizar } from "@/lib/utils";
import { Store, RefreshCw } from "lucide-react";

export default function LojasPage() {
  const { isAdmin } = useAuth();
  const [stores, setStores] = useState<StorePdv[] | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [busca, setBusca] = useState("");
  const [soAtivas, setSoAtivas] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [salvo, setSalvo] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [st, emps] = await Promise.all([listarStores(), listarEmpresas()]);
      setStores(st);
      setEmpresas(emps);
    } catch (e) {
      setErro((e as Error).message);
      setStores([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void carregar();
  }, [carregar, isAdmin]);

  async function atualizarLista() {
    setAtualizando(true);
    setErro(null);
    try {
      const r = await pdvnetSincronizarLojas();
      if (!r.ok) setErro(r.erro ?? "Falha ao atualizar lojas.");
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAtualizando(false);
    }
  }

  async function salvar(lojaId: number, patch: { ativoSync?: boolean; grupoNome?: string; empresaId?: string | null; maquinaEmpresaId?: string | null }) {
    setErro(null);
    // otimista
    setStores((prev) => (prev ?? []).map((s) => (s.id === lojaId ? { ...s, ...patch } : s)));
    try {
      await pdvnetSalvarLoja({ lojaId, ...patch });
      setSalvo(lojaId);
      setTimeout(() => setSalvo((v) => (v === lojaId ? null : v)), 1500);
    } catch (e) {
      setErro((e as Error).message);
      await carregar();
    }
  }

  const lista = useMemo(() => {
    let arr = stores ?? [];
    if (soAtivas) arr = arr.filter((s) => s.ativoSync);
    const t = normalizar(busca);
    if (t) arr = arr.filter((s) => normalizar(s.nome ?? "").includes(t) || normalizar(s.grupoNome ?? "").includes(t));
    return arr;
  }, [stores, busca, soAtivas]);

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Lojas (PDV)" />
        <p className="text-sm text-muted-foreground">Apenas administradores acessam esta área.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Lojas (PDV)"
        description="Quais lojas entram no financeiro, como agrupar e a empresa de cada uma."
        action={
          <Button size="sm" variant="outline" disabled={atualizando} onClick={atualizarLista}>
            <RefreshCw className={`size-4 ${atualizando ? "animate-spin" : ""}`} /> {atualizando ? "Atualizando…" : "Atualizar do PDV"}
          </Button>
        }
      />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar loja…" value={busca} onChange={(e) => setBusca(e.target.value)} className="h-10 max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4" checked={soAtivas} onChange={(e) => setSoAtivas(e.target.checked)} />
          Só incluídas
        </label>
      </div>

      <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
        Dica: para somar a <strong>Barra “não usar”</strong> na Barra, marque-a como <strong>incluída</strong> e coloque o
        mesmo <strong>Grupo</strong> das duas (ex.: “FLU BARRA”). O financeiro agrupa por esse nome.
      </div>

      {stores === null ? (
        <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma loja. Clique em <strong>Atualizar do PDV</strong> para trazer a lista.
        </p>
      ) : (
        <div className="space-y-2">
          {lista.map((s) => (
            <Card key={s.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium">
                      <Store className="size-4 text-muted-foreground" /> {s.nome}
                      <span className="text-xs text-muted-foreground">#{s.id}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {s.varejo ? <Badge variant="neutral">Varejo</Badge> : null}
                      {s.inativa ? <Badge variant="neutral">Inativa no PDV</Badge> : null}
                      {salvo === s.id ? <Badge variant="success">Salvo</Badge> : null}
                    </div>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={!!s.ativoSync}
                      onChange={(e) => salvar(s.id, { ativoSync: e.target.checked })} />
                    Incluir
                  </label>
                </div>
                {s.ativoSync ? (
                  <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="block text-[11px] text-muted-foreground">Grupo (soma lojas com o mesmo nome)</label>
                      <Input defaultValue={s.grupoNome ?? s.nome ?? ""} className="h-9"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.grupoNome ?? s.nome)) salvar(s.id, { grupoNome: v }); }} />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] text-muted-foreground">Empresa (CNPJ)</label>
                      <select value={s.empresaId ?? ""} onChange={(e) => salvar(s.id, { empresaId: e.target.value || null })}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">— não vinculada —</option>
                        {empresas.map((emp) => (
                          <option key={emp.id} value={emp.id}>{emp.nomeFantasia || emp.razaoSocial}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="block text-[11px] text-muted-foreground">Loja da máquina de cartão (onde cai cartão/PIX no banco)</label>
                      <select value={s.maquinaEmpresaId ?? ""} onChange={(e) => salvar(s.id, { maquinaEmpresaId: e.target.value || null })}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">— a própria empresa —</option>
                        {empresas.map((emp) => (
                          <option key={emp.id} value={emp.id}>{emp.nomeFantasia || emp.razaoSocial}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-muted-foreground">Use quando as maquininhas desta loja são de outra empresa (a conciliação de cartão/PIX vai para ela). O DRE e o total de vendas continuam nesta loja.</p>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
