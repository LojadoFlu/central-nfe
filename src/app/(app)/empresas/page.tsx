"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/auth-provider";
import { podeGerirCertificado } from "@/lib/auth/roles";
import { listarEmpresas, salvarEmpresa } from "@/lib/nfe/repo";
import { formatCNPJ } from "@/lib/utils";
import type { Company } from "@/lib/nfe/types";
import { Building2, Plus } from "lucide-react";

const VAZIO = { razaoSocial: "", cnpj: "", uf: "", ambiente: "homologacao" as const };

export default function EmpresasPage() {
  const { role } = useAuth();
  const podeEditar = podeGerirCertificado(role); // admin
  const [empresas, setEmpresas] = useState<Company[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setEmpresas(await listarEmpresas());
    } catch (e) {
      setErro((e as Error).message);
      setEmpresas([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function onSalvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await salvarEmpresa(form);
      setForm(VAZIO);
      setMostrarForm(false);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Empresas"
        description="CNPJs do grupo consultados na SEFAZ."
        action={
          podeEditar ? (
            <Button size="sm" onClick={() => setMostrarForm((v) => !v)}>
              <Plus className="size-4" />
              Nova
            </Button>
          ) : undefined
        }
      />

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : null}

      {mostrarForm && podeEditar ? (
        <Card className="mb-4">
          <CardContent className="pt-6">
            <form onSubmit={onSalvar} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="razaoSocial">Razão social</Label>
                <Input
                  id="razaoSocial"
                  value={form.razaoSocial}
                  onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cnpj">CNPJ</Label>
                <Input
                  id="cnpj"
                  inputMode="numeric"
                  value={form.cnpj}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  placeholder="00.000.000/0000-00"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uf">UF</Label>
                <Input
                  id="uf"
                  maxLength={2}
                  value={form.uf}
                  onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })}
                  placeholder="RJ"
                  required
                />
              </div>
              <div className="flex items-end gap-2 sm:col-span-2">
                <Button type="submit" disabled={salvando}>
                  {salvando ? "Salvando…" : "Salvar empresa"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setMostrarForm(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {empresas === null ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : empresas.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <Building2 className="size-6" />
          </div>
          <p className="font-semibold">Nenhuma empresa cadastrada</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Cadastre o primeiro CNPJ para depois instalar o certificado e
            sincronizar as NF-e.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {empresas.map((emp) => (
            <Card key={emp.id}>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <Building2 className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{emp.razaoSocial}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCNPJ(emp.cnpj)} · {emp.uf}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={emp.ambiente === "producao" ? "success" : "warning"}>
                    {emp.ambiente === "producao" ? "Produção" : "Homologação"}
                  </Badge>
                  <Badge variant={emp.temCertificado ? "success" : "neutral"}>
                    {emp.temCertificado ? "Com certificado" : "Sem certificado"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
