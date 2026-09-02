"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listarEmpresas,
  testarConexao,
  sincronizarAgora,
  salvarCredenciaisStone,
  testarStone,
  type ResultadoConexao,
  type ResultadoSync,
  type TesteStone,
} from "@/lib/nfe/repo";
import { Input } from "@/components/ui/input";
import { formatCNPJ } from "@/lib/utils";
import type { Company } from "@/lib/nfe/types";
import { Plug, RefreshCw, DownloadCloud, CreditCard, KeyRound } from "lucide-react";

export default function IntegracoesPage() {
  const [empresas, setEmpresas] = useState<Company[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conexao, setConexao] = useState<Record<string, ResultadoConexao>>({});
  const [sync, setSync] = useState<Record<string, ResultadoSync>>({});
  // Stone: a chave é digitada aqui e vai direto para o cofre no servidor. Ela
  // nunca é lida de volta — o campo fica em branco depois de salvar.
  const [stoneAberto, setStoneAberto] = useState<string | null>(null);
  const [stoneCode, setStoneCode] = useState("");
  const [stoneChave, setStoneChave] = useState("");
  const [stoneDia, setStoneDia] = useState("");
  const [stoneMsg, setStoneMsg] = useState<Record<string, string>>({});
  const [stoneTeste, setStoneTeste] = useState<Record<string, TesteStone>>({});

  const carregar = useCallback(async () => {
    try {
      setEmpresas(await listarEmpresas());
    } catch {
      setEmpresas([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function testar(id: string) {
    setBusy(id + ":test");
    try {
      const r = await testarConexao(id);
      setConexao((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setConexao((m) => ({ ...m, [id]: { ok: false, erro: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  async function sincronizar(id: string) {
    setBusy(id + ":sync");
    try {
      const r = await sincronizarAgora(id);
      setSync((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setSync((m) => ({ ...m, [id]: { ok: false, erro: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  async function salvarStone(id: string) {
    setBusy(id + ":stone");
    setStoneMsg((m) => ({ ...m, [id]: "" }));
    try {
      await salvarCredenciaisStone({ empresaId: id, stoneCode, chave: stoneChave });
      setStoneChave("");
      setStoneMsg((m) => ({ ...m, [id]: "Chave guardada no cofre e StoneCode salvo." }));
      await carregar();
    } catch (e) {
      setStoneMsg((m) => ({ ...m, [id]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  async function testarStoneEmpresa(id: string) {
    setBusy(id + ":stoneTest");
    setStoneMsg((m) => ({ ...m, [id]: "" }));
    try {
      const r = await testarStone({ empresaId: id, dia: stoneDia || undefined });
      setStoneTeste((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setStoneMsg((m) => ({ ...m, [id]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Integrações" description="NF-e / SEFAZ — conexão e sincronização." />

      {empresas === null ? (
        <Skeleton className="h-24" />
      ) : empresas.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <Plug className="size-6" />
          </div>
          <p className="font-semibold">Nenhuma empresa cadastrada</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Cadastre uma empresa e instale o certificado para conectar à SEFAZ.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {empresas.map((emp) => {
            const c = conexao[emp.id];
            const s = sync[emp.id];
            const semCert = !emp.temCertificado;
            return (
              <Card key={emp.id}>
                <CardContent className="py-4">
                  <p className="truncate font-medium">{emp.razaoSocial}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCNPJ(emp.cnpj)} · {emp.uf} ·{" "}
                    {emp.ambiente === "producao" ? "Produção" : "Homologação"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || semCert}
                      onClick={() => testar(emp.id)}
                      title={semCert ? "Instale o certificado primeiro" : ""}
                    >
                      <RefreshCw className={busy === emp.id + ":test" ? "size-4 animate-spin" : "size-4"} />
                      {busy === emp.id + ":test" ? "Testando…" : "Testar conexão"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy !== null || semCert}
                      onClick={() => sincronizar(emp.id)}
                      title={semCert ? "Instale o certificado primeiro" : ""}
                    >
                      <DownloadCloud className={busy === emp.id + ":sync" ? "size-4 animate-spin" : "size-4"} />
                      {busy === emp.id + ":sync" ? "Sincronizando…" : "Sincronizar agora"}
                    </Button>
                  </div>

                  {c ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
                      {c.ok ? (
                        <>
                          <Badge variant={c.cStat === "137" || c.cStat === "138" ? "success" : "warning"}>
                            Conexão · cStat {c.cStat ?? "—"}
                          </Badge>
                          <span className="ml-2 text-muted-foreground">{c.xMotivo ?? ""}</span>
                        </>
                      ) : (
                        <>
                          <Badge variant="destructive">Falha na conexão</Badge>
                          <p className="mt-1 break-words text-xs text-destructive">{c.erro}</p>
                        </>
                      )}
                    </div>
                  ) : null}

                  {/* Stone — conciliação de cartão pela adquirente. */}
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={emp.temChaveStone ? "success" : "neutral"}>
                        <CreditCard className="size-3" />
                        Stone {emp.temChaveStone ? `· ${emp.stoneCode}` : "· não configurada"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const abrindo = stoneAberto !== emp.id;
                          setStoneAberto(abrindo ? emp.id : null);
                          setStoneCode(abrindo ? (emp.stoneCode ?? "") : "");
                          setStoneChave("");
                        }}
                      >
                        <KeyRound /> {emp.temChaveStone ? "Trocar chave" : "Configurar"}
                      </Button>
                      {emp.temChaveStone ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => testarStoneEmpresa(emp.id)}
                        >
                          <RefreshCw className={busy === emp.id + ":stoneTest" ? "size-4 animate-spin" : "size-4"} />
                          {busy === emp.id + ":stoneTest" ? "Consultando…" : "Testar Stone"}
                        </Button>
                      ) : null}
                    </div>

                    {stoneAberto === emp.id ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <Input
                          placeholder="StoneCode (só números)"
                          value={stoneCode}
                          onChange={(e) => setStoneCode(e.target.value)}
                        />
                        <Input
                          type="password"
                          placeholder={emp.temChaveStone ? "Chave (em branco = manter)" : "Chave da API (Stone Portal)"}
                          value={stoneChave}
                          onChange={(e) => setStoneChave(e.target.value)}
                          autoComplete="off"
                        />
                        <Button
                          size="sm"
                          disabled={busy !== null || !stoneCode.trim()}
                          onClick={() => salvarStone(emp.id)}
                        >
                          Salvar
                        </Button>
                        <p className="text-[11px] text-muted-foreground sm:col-span-3">
                          A chave vai direto para o cofre de segredos do servidor. Ela não fica no
                          navegador nem pode ser lida de volta — para trocar, digite outra.
                        </p>
                      </div>
                    ) : null}

                    {stoneMsg[emp.id] ? (
                      <p className="mt-2 text-xs text-muted-foreground">{stoneMsg[emp.id]}</p>
                    ) : null}

                    {stoneTeste[emp.id] ? (
                      <div className="mt-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                        {stoneTeste[emp.id].ok ? (
                          <div className="space-y-1">
                            <Badge variant="success">
                              Arquivo de {stoneTeste[emp.id].dia} · {stoneTeste[emp.id].tamanhoXml} caracteres
                            </Badge>
                            <p className="text-xs text-muted-foreground">
                              {(stoneTeste[emp.id].estrutura ?? [])
                                .slice(0, 12)
                                .map((x) => `${x.tag}(${x.qtd})`)
                                .join(" · ")}
                            </p>
                          </div>
                        ) : (
                          <>
                            <Badge variant="destructive">
                              HTTP {stoneTeste[emp.id].httpStatus} · {stoneTeste[emp.id].dia}
                            </Badge>
                            <p className="mt-1 text-xs text-destructive">{stoneTeste[emp.id].dica}</p>
                          </>
                        )}
                      </div>
                    ) : null}

                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="date"
                        className="h-8 w-40"
                        value={stoneDia}
                        onChange={(e) => setStoneDia(e.target.value)}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        Dia do arquivo a testar (vazio = ontem). A Stone permite 7 consultas por
                        hora para o mesmo dia.
                      </span>
                    </div>
                  </div>

                  {s ? (
                    <div className="mt-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                      {s.ok ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={s.bloqueado ? "warning" : "success"}>
                              {s.bloqueado ? "Recuo (656)" : `${s.novos ?? 0} novos`}
                            </Badge>
                            <span className="text-muted-foreground">{s.xMotivo ?? ""}</span>
                          </div>
                          <p className="tnum text-xs text-muted-foreground">
                            ultNSU {s.ultNSU ?? "—"} · maxNSU {s.maxNSU ?? "—"} · {s.iteracoes ?? 0} lote(s)
                          </p>
                        </div>
                      ) : (
                        <>
                          <Badge variant="destructive">Falha na sincronização</Badge>
                          <p className="mt-1 break-words text-xs text-destructive">{s.erro}</p>
                        </>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        <strong>Testar</strong> faz uma consulta única (ultNSU=0, sem gravar).{" "}
        <strong>Sincronizar</strong> percorre os NSU, baixa e guarda os XMLs. Em homologação
        o retorno é sempre "nenhum documento" (cStat 137) — dados reais só em produção.
      </p>
    </div>
  );
}
