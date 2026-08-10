"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth/auth-provider";
import { pdvnetStatus, pdvnetSalvarCredenciais, pdvnetSondarVendas, type SondagemVendas } from "@/lib/nfe/repo";
import { formatBRL } from "@/lib/utils";
import { Plug, Lock, RefreshCw, Check } from "lucide-react";

export default function ConfiguracoesPage() {
  const { isAdmin, podeAcao } = useAuth();
  const [status, setStatus] = useState<{ temCredenciais: boolean; baseUrl: string | null } | null>(null);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sondando, setSondando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [sond, setSond] = useState<SondagemVendas | null>(null);

  const carregar = useCallback(async () => {
    try {
      const s = await pdvnetStatus();
      setStatus(s);
      if (s.baseUrl) setBaseUrl(s.baseUrl);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(null);
    setSalvando(true);
    try {
      await pdvnetSalvarCredenciais({ usuario: usuario.trim(), senha, baseUrl: baseUrl.trim() });
      setOk("Credenciais salvas com segurança.");
      setSenha("");
      setUsuario("");
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function sondar() {
    setErro(null);
    setSond(null);
    setSondando(true);
    try {
      const r = await pdvnetSondarVendas(3);
      setSond(r);
      if (!r.ok) setErro(r.erro ?? "Falha na sondagem.");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSondando(false);
    }
  }

  const podeSondar = podeAcao("integracoes.sincronizar");

  return (
    <div>
      <PageHeader title="Configurações" description="Integrações e preferências do sistema." />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}
      {ok ? <p className="mb-4 rounded-md bg-success/15 p-3 text-sm text-success">{ok}</p> : null}

      {/* ---- PDVnet ---- */}
      <Card className="mb-4">
        <CardContent className="py-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight">
              <Plug className="size-4" /> PDVnet
            </h2>
            <Badge variant={status?.temCredenciais ? "success" : "neutral"}>
              {status?.temCredenciais ? "Conectado" : "Não configurado"}
            </Badge>
          </div>

          {isAdmin ? (
            <>
              <div className="mb-4 flex gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  Usuário e senha vão apenas ao backend e ficam no <strong>Google Secret Manager</strong> — nunca no
                  navegador, no banco nem em logs. São as mesmas credenciais do CRM.
                </p>
              </div>
              <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="baseUrl">URL base da API</Label>
                  <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://<loja>.pdvnet.com.br/pdvapi" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usuario">Usuário</Label>
                  <Input id="usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="senha">Senha</Label>
                  <Input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" required />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm" disabled={salvando}>
                    <Check className="size-4" /> {salvando ? "Salvando…" : "Salvar credenciais"}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {status?.temCredenciais ? "Integração PDVnet configurada." : "Integração PDVnet ainda não configurada."}
              {" "}Só administradores alteram as credenciais.
            </p>
          )}

          {/* Sondagem */}
          {status?.temCredenciais && podeSondar ? (
            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Testar leitura de vendas</p>
                <Button size="sm" variant="outline" disabled={sondando} onClick={sondar}>
                  <RefreshCw className={`size-4 ${sondando ? "animate-spin" : ""}`} /> {sondando ? "Consultando…" : "Sondar (3 dias)"}
                </Button>
              </div>

              {sond?.ok ? (
                <div className="mt-3 space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    Período {sond.periodo?.inicio} a {sond.periodo?.fim} · {sond.totalPagina} venda(s) na 1ª página
                    {sond.totalRegistros != null ? ` de ${sond.totalRegistros}` : ""} · {sond.lojas?.length ?? 0} loja(s).
                  </p>
                  {sond.amostra ? (
                    <div className="rounded-md border border-border bg-muted/30 p-3">
                      <p className="font-medium">
                        Amostra de venda · {formatBRL(sond.amostra.valorTotal)}
                        {sond.amostra.inativa ? " · CANCELADA" : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Pagamentos: {Object.entries(sond.amostra.pagamentos ?? {})
                          .filter(([, v]) => (v as number) > 0)
                          .map(([k, v]) => `${k} ${formatBRL(v as number)}`)
                          .join(" · ") || "—"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Parcelas de cartão: {sond.amostra.parcelasCartao?.length ?? 0} ·
                        Docs fiscais: {sond.amostra.documentosFiscais?.length ?? 0} ·
                        Itens: {sond.amostra.qtdItens ?? 0}
                      </p>
                      {sond.amostra.parcelasCartao && sond.amostra.parcelasCartao.length > 0 ? (
                        <pre className="mt-2 max-h-52 overflow-auto rounded border border-border bg-background p-2 text-[11px] leading-tight">
{JSON.stringify(sond.amostra.parcelasCartao[0], null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Nenhuma venda no período (tente mais dias).</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Empresas, Certificado e Usuários têm telas próprias no menu. A integração com a SEFAZ/ADN roda automaticamente a cada 6h.
      </p>
    </div>
  );
}
