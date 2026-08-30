"use client";

// Comissões, metas e remuneração variável (§34).
// Uma tela só, com abas — a competência escolhida vale para todas elas.

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/auth-provider";
import { listarStores, type StorePdv } from "@/lib/nfe/repo";
import {
  apurarComissoes,
  listarAjustes,
  listarBonus,
  listarCargos,
  listarFuncionarios,
  listarMetas,
  listarRegras,
  listarVendedoresPdv,
  obterConfig,
} from "@/lib/comissoes/repo";
import type {
  Ajuste,
  Bonus as BonusTipo,
  Cargo,
  ConfigComissoes,
  Funcionario,
  Meta,
  Regra,
  ResultadoCompetencia,
  VendedorPdv,
} from "@/lib/comissoes/tipos";
import { Acompanhamento } from "@/components/comissoes/acompanhamento";
import { Ajustes } from "@/components/comissoes/ajustes";
import { Auditoria } from "@/components/comissoes/auditoria";
import { Bonus } from "@/components/comissoes/bonus";
import { Configuracoes } from "@/components/comissoes/configuracoes";
import { Dashboard } from "@/components/comissoes/dashboard";
import { Fechamento } from "@/components/comissoes/fechamento";
import { Funcionarios } from "@/components/comissoes/funcionarios";
import { Metas } from "@/components/comissoes/metas";
import { Regras } from "@/components/comissoes/regras";
import { Simulador } from "@/components/comissoes/simulador";
import { Aviso, Select, competenciaAtual, competenciasDisponiveis, mesLabel } from "@/components/comissoes/comum";

const ABAS = [
  "Acompanhamento",
  "Dashboard",
  "Fechamento",
  "Simulador",
  "Funcionários",
  "Regras",
  "Metas",
  "Bônus",
  "Ajustes",
  "Auditoria",
  "Configurações",
] as const;
type Aba = (typeof ABAS)[number];

export default function ComissoesPage() {
  const { podeAcao, isAdmin } = useAuth();
  const podeGerir = podeAcao("comissoes.gerir");
  const podeFechar = podeAcao("comissoes.fechar");

  const [aba, setAba] = useState<Aba>("Acompanhamento");
  const [competencia, setCompetencia] = useState(competenciaAtual());

  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [bonus, setBonus] = useState<BonusTipo[]>([]);
  const [vendedores, setVendedores] = useState<VendedorPdv[]>([]);
  const [lojas, setLojas] = useState<StorePdv[]>([]);
  const [config, setConfig] = useState<ConfigComissoes>({
    regraPiso: "maior",
    cargoPadraoId: null,
    diaPagamentoFolha: 5,
    mesPagamento: "seguinte",
    provisaoNoFluxo: false,
  });
  const [metas, setMetas] = useState<Meta[]>([]);
  const [ajustes, setAjustes] = useState<Ajuste[]>([]);
  const [apuracao, setApuracao] = useState<ResultadoCompetencia | null>(null);

  const [carregando, setCarregando] = useState(true);
  const [apurando, setApurando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  /** Cadastros — não dependem da competência. */
  const carregarCadastros = useCallback(async () => {
    try {
      const [c, f, r, b, v, l, cfg] = await Promise.all([
        listarCargos(),
        listarFuncionarios(),
        listarRegras(),
        listarBonus(),
        listarVendedoresPdv(),
        listarStores(),
        obterConfig(),
      ]);
      setCargos(c);
      setFuncionarios(f);
      setRegras(r);
      setBonus(b);
      setVendedores(v);
      setLojas(l.filter((x) => x.ativoSync !== false));
      setConfig(cfg);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  /** Dados da competência + apuração. */
  const carregarCompetencia = useCallback(async () => {
    setApurando(true);
    try {
      const [m, a] = await Promise.all([listarMetas(competencia), listarAjustes(competencia)]);
      setMetas(m);
      setAjustes(a);
      setApuracao(await apurarComissoes(competencia));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setApurando(false);
    }
  }, [competencia]);

  const recarregarTudo = useCallback(async () => {
    await carregarCadastros();
    await carregarCompetencia();
  }, [carregarCadastros, carregarCompetencia]);

  useEffect(() => {
    void carregarCadastros();
  }, [carregarCadastros]);
  useEffect(() => {
    void carregarCompetencia();
  }, [carregarCompetencia]);

  return (
    <div>
      <PageHeader
        title="Comissões e metas"
        description="Vendas do PDV × regras cadastradas = quanto cada pessoa recebe no mês."
        action={
          <Select
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="h-9 w-auto"
          >
            {competenciasDisponiveis().map((c) => (
              <option key={c} value={c}>
                {mesLabel(c)}
              </option>
            ))}
          </Select>
        }
      />

      <div className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-2">
          {ABAS.map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                aba === a ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {carregando ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : aba === "Acompanhamento" ? (
        <Acompanhamento apuracao={apuracao} carregando={apurando} />
      ) : aba === "Dashboard" ? (
        <Dashboard competencia={competencia} apuracao={apuracao} />
      ) : aba === "Fechamento" ? (
        <Fechamento
          competencia={competencia}
          apuracao={apuracao}
          podeFechar={podeFechar}
          isAdmin={isAdmin}
          onRecarregar={recarregarTudo}
        />
      ) : aba === "Simulador" ? (
        <Simulador competencia={competencia} funcionarios={funcionarios} />
      ) : aba === "Auditoria" ? (
        <Auditoria />
      ) : aba === "Funcionários" ? (
        <Funcionarios
          cargos={cargos}
          funcionarios={funcionarios}
          vendedores={vendedores}
          lojas={lojas}
          podeGerir={podeGerir}
          onRecarregar={recarregarTudo}
        />
      ) : aba === "Regras" ? (
        <Regras
          regras={regras}
          cargos={cargos}
          funcionarios={funcionarios}
          lojas={lojas}
          podeGerir={podeGerir}
          onRecarregar={recarregarTudo}
        />
      ) : aba === "Metas" ? (
        <Metas
          competencia={competencia}
          metas={metas}
          funcionarios={funcionarios}
          lojas={lojas}
          podeGerir={podeGerir}
          onRecarregar={recarregarTudo}
        />
      ) : aba === "Bônus" ? (
        <Bonus
          bonus={bonus}
          cargos={cargos}
          funcionarios={funcionarios}
          lojas={lojas}
          podeGerir={podeGerir}
          onRecarregar={recarregarTudo}
        />
      ) : aba === "Ajustes" ? (
        <Ajustes
          competencia={competencia}
          ajustes={ajustes}
          funcionarios={funcionarios}
          podeGerir={podeGerir}
          onRecarregar={recarregarTudo}
        />
      ) : (
        <Configuracoes
          config={config}
          cargos={cargos}
          podeGerir={podeGerir}
          onRecarregar={recarregarTudo}
        />
      )}
    </div>
  );
}
