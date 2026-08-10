"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Hero } from "@/components/ui/hero";
import { FiltroPeriodo, type Periodo } from "@/components/ui/filtro-periodo";
import {
  listarEmpresas,
  listarNotasCompra,
  marcarNotaRecebida,
  type NotaCompra,
  type NotasCompraResp,
} from "@/lib/nfe/repo";
import type { Company } from "@/lib/nfe/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatBRL, formatarData } from "@/lib/utils";
import { PackageCheck } from "lucide-react";

type Status = "todas" | "pendentes" | "recebidas";

function periodoEsteMes(): Periodo {
  const d = new Date();
  const de = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de, ate: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}` };
}

const STATUS: { key: Status; label: string }[] = [
  { key: "pendentes", label: "Pendentes" },
  { key: "recebidas", label: "Recebidas" },
  { key: "todas", label: "Todas" },
];

export default function RecebimentoPage() {
  const { podeAcao } = useAuth();
  const podeReceber = podeAcao("nfe.receber");
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(periodoEsteMes());
  const [status, setStatus] = useState<Status>("pendentes");
  const [dados, setDados] = useState<NotasCompraResp | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    void listarEmpresas().then(setEmpresas).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    if (!periodo.de || !periodo.ate) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await listarNotasCompra(periodo.de, periodo.ate, empresaId, status));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo, status]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function alternar(n: NotaCompra) {
    setOcupado(n.chNFe);
    setErro(null);
    // atualização otimista
    setDados((prev) => prev && ({
      ...prev,
      itens: prev.itens.map((x) => x.chNFe === n.chNFe ? { ...x, recebida: !n.recebida, recebidaOrigem: !n.recebida ? "manual" : null } : x),
    }));
    try {
      await marcarNotaRecebida(n.chNFe, !n.recebida);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
      await carregar();
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Recebimento de compras"
        description="NF-e de compra capturadas na SEFAZ × entrada registrada na loja. O que não entrou no PDV, você confirma o recebimento aqui."
      />

      <div className="mb-4 space-y-2">
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas as lojas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
          ))}
        </select>
        <FiltroPeriodo value={periodo} onChange={setPeriodo} allowClear={false} />
        <div className="flex gap-1 rounded-md border border-border p-1">
          {STATUS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatus(s.key)}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${status === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {erro ? <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p> : null}

      {carregando && !dados ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : dados ? (
        <>
          <Hero
            eyebrow="Compras no período"
            value={formatBRL(dados.total.valor)}
            subtitle={`${dados.total.qtd} nota(s) de compra capturadas na SEFAZ`}
            metrics={[
              { label: "Recebidas", value: formatBRL(dados.recebidas.valor), hint: `${dados.recebidas.qtd} nota(s)`, tone: "success" },
              { label: "Pendentes", value: formatBRL(dados.pendentes.valor), hint: `${dados.pendentes.qtd} nota(s)`, tone: "warning" },
            ]}
          />

          <div className="mt-4 space-y-2">
            {dados.itens.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma nota de compra {status === "pendentes" ? "pendente " : status === "recebidas" ? "recebida " : ""}no período.</p>
            ) : (
              dados.itens.map((n) => (
                <Card key={n.chNFe}>
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-[hsl(var(--primary))]"
                        checked={n.recebida}
                        disabled={!podeReceber || ocupado === n.chNFe}
                        onChange={() => alternar(n)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{n.xNomeEmit || n.cnpjEmit}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          NF {n.nNF ?? "—"}{n.serie ? `/${n.serie}` : ""} · {n.dhEmi ? formatarData(n.dhEmi) : "—"}
                          {empresaId ? "" : ` · ${n.lojaNome}`}
                          {n.recebida && n.recebidaOrigem === "pdvnet" ? " · entrada no PDV" : n.recebida ? " · recebida manual" : ""}
                        </span>
                      </span>
                    </label>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-bold tnum">{formatBRL(n.vNF)}</span>
                      {n.recebida ? (
                        <Badge variant="success">recebida</Badge>
                      ) : (
                        <Badge variant="warning">pendente</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            <PackageCheck className="mr-1 inline size-3.5 align-[-2px]" />
            &ldquo;Recebida&rdquo; nunca é inferida do XML: vem da entrada registrada no PDV (automático, por chave) ou da sua confirmação manual — sempre com autor e horário.
          </p>
        </>
      ) : null}
    </div>
  );
}
