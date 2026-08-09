"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import {
  listarEmpresas,
  listarTaxasCartao,
  obterConfigCartao,
  salvarTaxaCartao,
  excluirTaxaCartao,
  salvarConfigCartao,
  copiarTaxasCartao,
  type TaxaCartao,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { CreditCard, Plus, Trash2, Check, X, Pencil, Copy } from "lucide-react";

const fmtPct = (n: number | undefined) => `${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export default function TaxasPage() {
  const { podeAcao } = useAuth();
  const podeEditar = podeAcao("financeiro.baixar");
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [cartoes, setCartoes] = useState<TaxaCartao[] | null>(null);
  const [antecipacao, setAntecipacao] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [copiaDe, setCopiaDe] = useState("");
  const [copiando, setCopiando] = useState(false);

  // Formulário
  const [formAberto, setFormAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fNome, setFNome] = useState("");
  const [fPix, setFPix] = useState("");
  const [fDebito, setFDebito] = useState("");
  const [fCredito, setFCredito] = useState("");
  const [fParcelado, setFParcelado] = useState("");
  const [fAntecip, setFAntecip] = useState("");
  const [fAtivo, setFAtivo] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void listarEmpresas().then((es) => {
      setEmpresas(es);
      if (es.length && !empresaId) setEmpresaId(es[0].id);
    }).catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    if (!empresaId) { setCartoes([]); return; }
    setErro(null);
    try {
      const [cs, cfg] = await Promise.all([listarTaxasCartao(empresaId), obterConfigCartao(empresaId)]);
      setCartoes(cs);
      setAntecipacao(cfg.antecipacao);
    } catch (e) {
      setErro((e as Error).message);
      setCartoes([]);
    }
  }, [empresaId]);

  useEffect(() => { setCartoes(null); void carregar(); }, [carregar]);

  async function toggleAntecipacao(v: boolean) {
    setAntecipacao(v);
    setErro(null);
    try {
      await salvarConfigCartao(empresaId, v);
    } catch (e) {
      setErro((e as Error).message);
      await carregar();
    }
  }

  async function copiar() {
    if (!copiaDe || copiaDe === empresaId) return;
    setCopiando(true);
    setErro(null);
    setMsg(null);
    try {
      const r = await copiarTaxasCartao(copiaDe, empresaId);
      setMsg(`${r.copiados} cartão(ões) copiado(s) para esta loja.`);
      setCopiaDe("");
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCopiando(false);
    }
  }

  function resetForm() {
    setEditId(null);
    setFNome(""); setFPix(""); setFDebito(""); setFCredito(""); setFParcelado(""); setFAntecip(""); setFAtivo(true);
  }
  function abrirNovo() { resetForm(); setFormAberto(true); }
  function abrirEdicao(c: TaxaCartao) {
    setEditId(c.id);
    setFNome(c.nome);
    setFPix(String(c.taxaPix ?? ""));
    setFDebito(String(c.taxaDebito ?? ""));
    setFCredito(String(c.taxaCredito ?? ""));
    setFParcelado(String(c.taxaParcelado ?? ""));
    setFAntecip(String(c.taxaAntecipacao ?? ""));
    setFAtivo(c.ativo !== false);
    setFormAberto(true);
  }

  async function salvar() {
    if (!empresaId) return setErro("Selecione a loja.");
    if (!fNome.trim()) return setErro("Informe o nome do cartão.");
    setSalvando(true);
    setErro(null);
    try {
      await salvarTaxaCartao({
        id: editId ?? undefined,
        empresaId,
        nome: fNome.trim(),
        taxaPix: Number(fPix) || 0,
        taxaDebito: Number(fDebito) || 0,
        taxaCredito: Number(fCredito) || 0,
        taxaParcelado: Number(fParcelado) || 0,
        taxaAntecipacao: Number(fAntecip) || 0,
        ativo: fAtivo,
      });
      setFormAberto(false);
      resetForm();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  async function remover(c: TaxaCartao) {
    setOcupado(`del:${c.id}`);
    setErro(null);
    try {
      await excluirTaxaCartao(c.id);
      setConfirmDel(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const nomeEmpresa = (id: string) => {
    const e = empresas.find((x) => x.id === id);
    return e ? e.nomeFantasia || e.razaoSocial : id;
  };

  return (
    <div>
      <PageHeader
        title="Taxas de cartão"
        description="Cartões e taxas por loja — cada loja pode ter juros e antecipação diferentes."
        action={
          podeEditar && !formAberto && empresaId ? (
            <Button size="sm" onClick={abrirNovo}><Plus className="size-4" /> Novo cartão</Button>
          ) : undefined
        }
      />

      {empresas.length > 1 ? (
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="mb-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
          ))}
        </select>
      ) : null}

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}
      {msg ? <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{msg}</p> : null}

      {/* Liga/desliga antecipação (por loja) */}
      <Card className="mb-4">
        <CardContent className="flex items-start justify-between gap-3 py-4">
          <div>
            <p className="font-medium">Antecipação automática</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {antecipacao
                ? "Ligada: a venda inteira cai em D+1 (fim de semana → segunda) e incide a taxa de antecipação."
                : "Desligada: o crédito do parcelado é feito em ~30 dias, sem taxa de antecipação."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={antecipacao}
            disabled={!podeEditar || !empresaId}
            onClick={() => toggleAntecipacao(!antecipacao)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${antecipacao ? "bg-primary" : "bg-muted-foreground/30"} disabled:opacity-50`}
          >
            <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${antecipacao ? "left-[1.375rem]" : "left-0.5"}`} />
          </button>
        </CardContent>
      </Card>

      {/* Copiar de outra loja */}
      {podeEditar && empresas.length > 1 && !formAberto ? (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-end gap-2 py-3">
            <div className="min-w-[12rem] flex-1 space-y-1">
              <label className="block text-[11px] text-muted-foreground">Copiar cartões/taxas de outra loja</label>
              <select value={copiaDe} onChange={(e) => setCopiaDe(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="">— escolher loja de origem —</option>
                {empresas.filter((e) => e.id !== empresaId).map((e) => (
                  <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
                ))}
              </select>
            </div>
            <Button size="sm" variant="outline" disabled={!copiaDe || copiando} onClick={copiar}>
              <Copy className="size-4" /> {copiando ? "Copiando…" : "Copiar para cá"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Formulário */}
      {formAberto ? (
        <Card className="mb-4">
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{editId ? "Editar cartão" : "Novo cartão"} · {nomeEmpresa(empresaId)}</h2>
              <Button size="sm" variant="ghost" onClick={() => { setFormAberto(false); resetForm(); }}>
                <X className="size-4" /> Fechar
              </Button>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">Nome do cartão / bandeira</label>
              <Input placeholder="Ex.: Stone Visa" value={fNome} onChange={(e) => setFNome(e.target.value)} maxLength={80} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <CampoTaxa label="PIX (%)" value={fPix} onChange={setFPix} />
              <CampoTaxa label="Débito / à vista (%)" value={fDebito} onChange={setFDebito} />
              <CampoTaxa label="Crédito à vista (%)" value={fCredito} onChange={setFCredito} />
              <CampoTaxa label="Parcelado (%)" value={fParcelado} onChange={setFParcelado} />
              <CampoTaxa label="Antecipação (% adic.)" value={fAntecip} onChange={setFAntecip} />
            </div>
            <p className="text-[11px] text-muted-foreground">A antecipação soma ao parcelado para o efetivo.</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fAtivo} onChange={(e) => setFAtivo(e.target.checked)} className="size-4" />
              Cartão ativo
            </label>
            <div className="flex gap-2">
              <Button size="sm" disabled={salvando} onClick={salvar}>
                <Check className="size-4" /> {salvando ? "Salvando…" : "Salvar"}
              </Button>
              <Button size="sm" variant="ghost" disabled={salvando} onClick={() => { setFormAberto(false); resetForm(); }}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Lista */}
      {cartoes === null ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : cartoes.length === 0 ? (
        <ModulePlaceholder icon={CreditCard} title="Nenhum cartão nesta loja" etapa="Taxas de cartão">
          Cadastre os cartões desta loja, ou copie de outra loja acima. As taxas servem para conferir os recebíveis e projetar o líquido.
        </ModulePlaceholder>
      ) : (
        <div className="space-y-3">
          {cartoes.map((c) => (
            <Card key={c.id} className={c.ativo === false ? "opacity-70" : undefined}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="flex items-center gap-2 font-medium">
                    <CreditCard className="size-4 text-muted-foreground" /> {c.nome}
                    {c.ativo === false ? <Badge variant="neutral">Inativo</Badge> : null}
                  </p>
                  {podeEditar ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrirEdicao(c)}><Pencil className="size-4" /></Button>
                      {confirmDel === c.id ? (
                        <span className="flex items-center gap-1">
                          <Button size="sm" variant="destructive" disabled={ocupado === `del:${c.id}`} onClick={() => remover(c)}>
                            {ocupado === `del:${c.id}` ? "…" : "Excluir"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>Não</Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDel(c.id)}><Trash2 className="size-4" /></Button>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  <Taxa rot="PIX" v={fmtPct(c.taxaPix)} />
                  <Taxa rot="Débito" v={fmtPct(c.taxaDebito)} />
                  <Taxa rot="Crédito" v={fmtPct(c.taxaCredito)} />
                  <Taxa rot="Parcelado" v={fmtPct(c.taxaParcelado)} />
                  <Taxa rot="Antecip. (adic.)" v={fmtPct(c.taxaAntecipacao)} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CampoTaxa({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-muted-foreground">{label}</label>
      <Input type="number" step="0.01" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" placeholder="0,00" />
    </div>
  );
}
function Taxa({ rot, v }: { rot: string; v: string }) {
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{rot}</p>
      <p className="font-semibold tnum">{v}</p>
    </div>
  );
}
