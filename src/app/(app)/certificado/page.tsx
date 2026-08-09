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
import {
  listarEmpresas,
  listarCertificados,
  cadastrarCertificado,
  arquivoParaBase64,
} from "@/lib/nfe/repo";
import { situacaoCertificado } from "@/lib/nfe/types";
import type { Company, CertificateMeta } from "@/lib/nfe/types";
import { formatarData, formatCNPJ } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, ShieldX, Lock } from "lucide-react";

export default function CertificadoPage() {
  const { podeAcao } = useAuth();
  const podeEditar = podeAcao("certificado.gerir");
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [certs, setCerts] = useState<CertificateMeta[] | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [emps, cs] = await Promise.all([listarEmpresas(), listarCertificados()]);
      setEmpresas(emps);
      setCerts(cs);
    } catch (e) {
      setErro((e as Error).message);
      setCerts([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function onEnviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(null);
    if (!companyId) return setErro("Selecione a empresa.");
    if (!arquivo) return setErro("Selecione o arquivo .pfx/.p12.");
    setEnviando(true);
    try {
      const pfxBase64 = await arquivoParaBase64(arquivo);
      const r = await cadastrarCertificado({ companyId, pfxBase64, senha });
      setOk(
        `Certificado instalado. Válido até ${formatarData(r.validadeFim)} (${r.diasRestantes} dias).`,
      );
      setArquivo(null);
      setSenha("");
      await carregar();
    } catch (e) {
      setErro((e as Error).message || "Falha ao instalar o certificado.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Certificado Digital"
        description="Certificado A1 (ICP-Brasil) por empresa — guardado com segurança."
      />

      <Card className="mb-4 border-primary/30 bg-primary/5">
        <CardContent className="flex gap-3 py-4 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            O arquivo e a senha são enviados apenas ao backend e guardados no
            <strong> Google Secret Manager</strong>. Nunca ficam no navegador, no
            banco de dados nem em logs. Aqui só aparecem <strong>metadados</strong>.
          </p>
        </CardContent>
      </Card>

      {erro ? (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : null}
      {ok ? (
        <p className="mb-4 rounded-md bg-success/15 p-3 text-sm text-success">{ok}</p>
      ) : null}

      {podeEditar ? (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={onEnviar} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="empresa">Empresa</Label>
                <select
                  id="empresa"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  <option value="">Selecione…</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.razaoSocial} — {formatCNPJ(e.cnpj)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pfx">Arquivo do certificado (.pfx / .p12)</Label>
                <Input
                  id="pfx"
                  type="file"
                  accept=".pfx,.p12"
                  onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="senha">Senha do certificado</Label>
                <Input
                  id="senha"
                  type="password"
                  autoComplete="off"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={enviando}>
                {enviando ? "Validando e instalando…" : "Instalar certificado"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="mb-6 text-sm text-muted-foreground">
          Apenas administradores podem instalar ou alterar certificados.
        </p>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Certificados instalados
      </h2>
      {certs === null ? (
        <Skeleton className="h-24" />
      ) : certs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum certificado instalado ainda.</p>
      ) : (
        <div className="space-y-3">
          {certs.map((c) => (
            <CertRow key={c.id} cert={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CertRow({ cert }: { cert: CertificateMeta }) {
  const { situacao, diasRestantes } = situacaoCertificado(cert.validadeFim);
  const cfg = {
    valido: { icon: ShieldCheck, variant: "success" as const, label: "Válido" },
    vencendo: { icon: ShieldAlert, variant: "warning" as const, label: "Vencendo" },
    vencido: { icon: ShieldX, variant: "destructive" as const, label: "Vencido" },
  }[situacao];
  const Icon = cfg.icon;

  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <Icon className="size-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{cert.razaoSocial ?? formatCNPJ(cert.cnpj)}</p>
          <p className="text-xs text-muted-foreground">
            Série {cert.numeroSerie} · Emissor {cert.emissor}
          </p>
          <p className="text-xs text-muted-foreground">
            Validade: {formatarData(cert.validadeInicio)} — {formatarData(cert.validadeFim)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
          <span className="text-xs text-muted-foreground tnum">
            {diasRestantes >= 0 ? `${diasRestantes} dias` : `${-diasRestantes} dias atrás`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
