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
import { listarEmpresas, salvarEmpresa } from "@/lib/nfe/repo";
import { formatCNPJ } from "@/lib/utils";
import type { Company } from "@/lib/nfe/types";
import { Building2, Plus, Pencil } from "lucide-react";

interface FormEmpresa {
  id?: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  uf: string;
  ambiente: "producao" | "homologacao";
}
const VAZIO: FormEmpresa = { razaoSocial: "", nomeFantasia: "", cnpj: "", uf: "", ambiente: "producao" };

export default function EmpresasPage() {
  const { podeAcao } = useAuth();
  const podeEditar = podeAcao("empresas.gerir");
  const [empresas, setEmpresas] = useState<Company[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<FormEmpresa>(VAZIO);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const editando = !!form.id;

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

  function abrirNova() {
    setForm(VAZIO);
    setMostrarForm(true);
  }
  function abrirEdicao(emp: Company) {
    setForm({
      id: emp.id,
      razaoSocial: emp.razaoSocial ?? "",
      nomeFantasia: emp.nomeFantasia ?? "",
      cnpj: emp.cnpj ?? "",
      uf: emp.uf ?? "",
      ambiente: emp.ambiente === "producao" ? "producao" : "homologacao",
    });
    setMostrarForm(true);
  }

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
        description="CNPJs do grupo consultados na SEFAZ. Cada empresa tem seu certificado."
        action={
          podeEditar && !mostrarForm ? (
            <Button size="sm" onClick={abrirNova}>
              <Plus className="size-4" /> Nova
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
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nomeFantasia">Nome fantasia (opcional)</Label>
                <Input
                  id="nomeFantasia"
                  value={form.nomeFantasia}
                  onChange={(e) => setForm({ ...form, nomeFantasia: e.target.value })}
                  placeholder="Como a empresa aparece nas listas"
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
                  disabled={editando}
                />
                {editando ? (
                  <p className="text-xs text-muted-foreground">O CNPJ não pode ser alterado.</p>
                ) : null}
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
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ambiente">Ambiente</Label>
                <select
                  id="ambiente"
                  value={form.ambiente}
                  onChange={(e) => setForm({ ...form, ambiente: e.target.value as FormEmpresa["ambiente"] })}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                >
                  <option value="producao">Produção (traz notas reais)</option>
                  <option value="homologacao">Homologação (testes — sem notas reais)</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Para receber os documentos reais da SEFAZ, use <strong>Produção</strong>.
                </p>
              </div>
              <div className="flex items-end gap-2 sm:col-span-2">
                <Button type="submit" disabled={salvando}>
                  {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Salvar empresa"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setMostrarForm(false); setForm(VAZIO); }}>
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
            Cadastre o primeiro CNPJ para depois instalar o certificado e sincronizar as NF-e.
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
                  <p className="truncate font-medium">{emp.nomeFantasia || emp.razaoSocial}</p>
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
                {podeEditar ? (
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => abrirEdicao(emp)}>
                    <Pencil className="size-4" />
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Fluxo: cadastre a empresa (Produção) → instale o certificado A1 dela em <strong>Certificado</strong> →
        sincronize em <strong>Integrações</strong> (ou aguarde a automática de 6h).
      </p>
    </div>
  );
}
