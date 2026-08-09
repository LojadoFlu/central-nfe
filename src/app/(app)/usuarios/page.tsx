"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/auth-provider";
import { MODULOS, ACOES } from "@/lib/auth/permissoes";
import {
  listarUsuarios,
  listarPerfis,
  listarEmpresas,
  aprovarUsuario,
  salvarPerfil,
  excluirPerfil,
  type Usuario,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { Users, Plus, Check, X, Pencil, Trash2, ShieldCheck } from "lucide-react";

type Perfil = { id: string; nome: string; descricao?: string | null; modulos: string[]; acoes: string[] };

export default function UsuariosPage() {
  const { isAdmin } = useAuth();
  const [aba, setAba] = useState<"usuarios" | "perfis">("usuarios");
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // aprovação de usuário
  const [editUser, setEditUser] = useState<string | null>(null);
  const [uRole, setURole] = useState("");
  const [uEmpresas, setUEmpresas] = useState<Set<string>>(new Set());

  // form de perfil
  const [formPerfil, setFormPerfil] = useState(false);
  const [pfId, setPfId] = useState<string | null>(null);
  const [pfNome, setPfNome] = useState("");
  const [pfDesc, setPfDesc] = useState("");
  const [pfModulos, setPfModulos] = useState<Set<string>>(new Set());
  const [pfAcoes, setPfAcoes] = useState<Set<string>>(new Set());
  const [confirmDelPerfil, setConfirmDelPerfil] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [us, ps, emps] = await Promise.all([listarUsuarios(), listarPerfis(), listarEmpresas()]);
      setUsuarios(us);
      setPerfis(ps as Perfil[]);
      setEmpresas(emps);
    } catch (e) {
      setErro((e as Error).message);
      setUsuarios([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void carregar();
  }, [carregar, isAdmin]);

  function abrirAprovacao(u: Usuario) {
    setEditUser(u.uid);
    setURole(u.roleId ?? "");
    setUEmpresas(new Set(u.empresas ?? []));
  }
  async function confirmarAprovacao(u: Usuario, status: "ativo" | "inativo") {
    setOcupado(`u:${u.uid}`);
    setErro(null);
    try {
      await aprovarUsuario({ uid: u.uid, roleId: uRole || null, empresas: [...uEmpresas], status });
      setEditUser(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }
  async function mudarStatus(u: Usuario, status: "ativo" | "inativo") {
    setOcupado(`u:${u.uid}`);
    setErro(null);
    try {
      await aprovarUsuario({ uid: u.uid, roleId: u.roleId ?? null, empresas: u.empresas ?? [], status });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  function abrirNovoPerfil() {
    setPfId(null); setPfNome(""); setPfDesc(""); setPfModulos(new Set()); setPfAcoes(new Set());
    setFormPerfil(true);
  }
  function abrirEdicaoPerfil(p: Perfil) {
    setPfId(p.id); setPfNome(p.nome); setPfDesc(p.descricao ?? "");
    setPfModulos(new Set(p.modulos ?? [])); setPfAcoes(new Set(p.acoes ?? []));
    setFormPerfil(true);
  }
  async function salvar() {
    if (!pfNome.trim()) { setErro("Dê um nome ao perfil."); return; }
    setOcupado("perfil");
    setErro(null);
    try {
      await salvarPerfil({ id: pfId ?? undefined, nome: pfNome.trim(), descricao: pfDesc.trim() || undefined, modulos: [...pfModulos], acoes: [...pfAcoes] });
      setFormPerfil(false);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }
  async function removerPerfil(id: string) {
    setOcupado(`del:${id}`);
    try {
      await excluirPerfil(id);
      setConfirmDelPerfil(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const toggle = (set: Set<string>, key: string, upd: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key); else n.add(key);
    upd(n);
  };
  const nomeEmpresa = (id: string) => {
    const e = empresas.find((x) => x.id === id);
    return e ? e.nomeFantasia || e.razaoSocial : id;
  };
  const nomePerfil = (id?: string | null) => perfis.find((p) => p.id === id)?.nome ?? "—";

  const STATUS = {
    pendente: { v: "warning" as const, l: "Pendente" },
    ativo: { v: "success" as const, l: "Ativo" },
    inativo: { v: "neutral" as const, l: "Inativo" },
  };

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Usuários e perfis" />
        <p className="text-sm text-muted-foreground">Apenas administradores acessam esta área.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Usuários e perfis" description="Aprove contas, defina perfis e o que cada um acessa." />

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      <div className="mb-4 flex gap-2">
        {(["usuarios", "perfis"] as const).map((a) => (
          <button key={a} onClick={() => setAba(a)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${aba === a ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {a === "usuarios" ? "Usuários" : "Perfis"}
          </button>
        ))}
      </div>

      {/* ===== USUÁRIOS ===== */}
      {aba === "usuarios" ? (
        usuarios === null ? (
          <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        ) : usuarios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum usuário ainda. Contas criadas na tela de login aparecem aqui para aprovação.</p>
        ) : (
          <div className="space-y-3">
            {usuarios.map((u) => {
              const cfg = STATUS[u.status ?? "pendente"];
              const editando = editUser === u.uid;
              const bz = ocupado === `u:${u.uid}`;
              return (
                <Card key={u.uid}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{u.nome || u.email || u.uid}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Perfil: {nomePerfil(u.roleId)}
                          {u.empresas && u.empresas.length > 0 ? ` · ${u.empresas.length} empresa(s)` : " · todas as empresas"}
                        </p>
                      </div>
                      <Badge variant={cfg.v}>{cfg.l}</Badge>
                    </div>

                    {editando ? (
                      <div className="mt-3 space-y-3 border-t border-border pt-3">
                        <div className="space-y-1.5">
                          <label className="block text-xs text-muted-foreground">Perfil</label>
                          <select value={uRole} onChange={(e) => setURole(e.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                            <option value="">— Selecione um perfil —</option>
                            {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                          </select>
                        </div>
                        {empresas.length > 0 ? (
                          <div className="space-y-1.5">
                            <label className="block text-xs text-muted-foreground">Empresas autorizadas (nenhuma marcada = todas)</label>
                            <div className="flex flex-wrap gap-2">
                              {empresas.map((e) => {
                                const on = uEmpresas.has(e.id);
                                return (
                                  <button key={e.id} type="button" onClick={() => toggle(uEmpresas, e.id, setUEmpresas)}
                                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                                    {e.nomeFantasia || e.razaoSocial}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" disabled={bz || !uRole} onClick={() => confirmarAprovacao(u, "ativo")}>
                            <Check className="size-4" /> {bz ? "Salvando…" : "Ativar com este perfil"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditUser(null)}>Cancelar</Button>
                        </div>
                        {!uRole ? <p className="text-xs text-muted-foreground">Selecione um perfil para ativar.</p> : null}
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                        {u.status !== "ativo" ? (
                          <Button size="sm" onClick={() => abrirAprovacao(u)}><Check className="size-4" /> Aprovar / definir perfil</Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => abrirAprovacao(u)}><Pencil className="size-4" /> Editar perfil/empresas</Button>
                            <Button size="sm" variant="ghost" className="text-destructive" disabled={bz} onClick={() => mudarStatus(u, "inativo")}><X className="size-4" /> Desativar</Button>
                          </>
                        )}
                        {u.status === "inativo" ? (
                          <Button size="sm" variant="outline" disabled={bz} onClick={() => mudarStatus(u, "ativo")}>Reativar</Button>
                        ) : null}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {/* ===== PERFIS ===== */}
      {aba === "perfis" ? (
        <div>
          {!formPerfil ? (
            <div className="mb-4">
              <Button size="sm" onClick={abrirNovoPerfil}><Plus className="size-4" /> Novo perfil</Button>
            </div>
          ) : (
            <Card className="mb-5">
              <CardContent className="space-y-4 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{pfId ? "Editar perfil" : "Novo perfil"}</h2>
                  <Button size="sm" variant="ghost" onClick={() => setFormPerfil(false)}><X className="size-4" /> Fechar</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-muted-foreground">Nome do perfil</label>
                    <Input value={pfNome} onChange={(e) => setPfNome(e.target.value)} placeholder="Ex.: Gerente de loja" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-muted-foreground">Descrição (opcional)</label>
                    <Input value={pfDesc} onChange={(e) => setPfDesc(e.target.value)} />
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Módulos que pode ver</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {MODULOS.map((m) => {
                      const on = pfModulos.has(m.key);
                      return (
                        <label key={m.key} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                          <input type="checkbox" className="size-4" checked={on} onChange={() => toggle(pfModulos, m.key, setPfModulos)} />
                          {m.label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">A tela <strong>Início</strong> é sempre visível.</p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ações sensíveis</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ACOES.map((a) => {
                      const on = pfAcoes.has(a.key);
                      return (
                        <label key={a.key} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                          <input type="checkbox" className="size-4" checked={on} onChange={() => toggle(pfAcoes, a.key, setPfAcoes)} />
                          {a.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" disabled={ocupado === "perfil"} onClick={salvar}><Check className="size-4" /> {ocupado === "perfil" ? "Salvando…" : "Salvar perfil"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setFormPerfil(false)}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {perfis.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum perfil criado. Crie perfis (ex.: Financeiro, Gerente da Barra) e depois atribua aos usuários.</p>
          ) : (
            <div className="space-y-3">
              {perfis.map((p) => (
                <Card key={p.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-primary" /> {p.nome}</p>
                        {p.descricao ? <p className="text-xs text-muted-foreground">{p.descricao}</p> : null}
                        <p className="mt-1 text-xs text-muted-foreground">{(p.modulos?.length ?? 0)} módulo(s) · {(p.acoes?.length ?? 0)} ação(ões)</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                      <Button size="sm" variant="outline" onClick={() => abrirEdicaoPerfil(p)}><Pencil className="size-4" /> Editar</Button>
                      {confirmDelPerfil === p.id ? (
                        <>
                          <Button size="sm" variant="destructive" disabled={ocupado === `del:${p.id}`} onClick={() => removerPerfil(p.id)}>Confirmar exclusão</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelPerfil(null)}>Não</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelPerfil(p.id)}><Trash2 className="size-4" /> Excluir</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="size-3.5" /> Administradores têm acesso total. Novos usuários entram como “pendente” e só acessam após aprovação.
      </p>
    </div>
  );
}
