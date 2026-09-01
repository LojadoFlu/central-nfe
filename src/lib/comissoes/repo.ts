"use client";

// Acesso ao módulo de comissões: leitura direta (client SDK) + escrita por
// callable, igual ao resto do app.

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebase } from "@/lib/firebase/client";
import type {
  Ajuste,
  Bonus,
  Cargo,
  ConfigComissoes,
  CustoMes,
  EscopoVenda,
  Funcionario,
  Indicador,
  IndicadoresAtingidos,
  LogAuditoria,
  Meta,
  Regra,
  ResultadoApuracao,
  ResultadoCompetencia,
  ResultadoSyncQuadro,
  StatusFechamento,
  VendedorPdv,
} from "./tipos";

function fb() {
  const f = getFirebase();
  if (!f) throw new Error("Firebase não configurado.");
  return f;
}

async function ler<T>(colecao: string): Promise<T[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, colecao));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as T[];
}

async function chamar<T>(nome: string, dados: unknown): Promise<T> {
  const { functions } = fb();
  const fn = httpsCallable(functions, nome);
  const res = await fn(dados as Record<string, unknown>);
  return res.data as T;
}

// ── Leituras ────────────────────────────────────────────────────────────────

export async function listarCargos(): Promise<Cargo[]> {
  const arr = await ler<Cargo>("com_cargos");
  return arr.sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99) || a.nome.localeCompare(b.nome));
}

export async function listarFuncionarios(): Promise<Funcionario[]> {
  const arr = await ler<Funcionario>("com_funcionarios");
  return arr.sort((a, b) => a.nome.localeCompare(b.nome));
}

export async function listarRegras(): Promise<Regra[]> {
  const arr = await ler<Regra>("com_regras");
  return arr.sort((a, b) => b.vigenciaDe.localeCompare(a.vigenciaDe) || a.nome.localeCompare(b.nome));
}

export async function listarBonus(): Promise<Bonus[]> {
  const arr = await ler<Bonus>("com_bonus");
  return arr.sort((a, b) => a.nome.localeCompare(b.nome));
}

export async function listarMetas(competencia?: string): Promise<Meta[]> {
  const { db } = fb();
  const ref = collection(db, "com_metas");
  const snap = await getDocs(competencia ? query(ref, where("competencia", "==", competencia)) : ref);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Meta[];
}

export async function listarAjustes(competencia?: string): Promise<Ajuste[]> {
  const { db } = fb();
  const ref = collection(db, "com_ajustes");
  const snap = await getDocs(competencia ? query(ref, where("competencia", "==", competencia)) : ref);
  return (snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Ajuste[]).sort((a, b) =>
    (b.criadoEm ?? "").localeCompare(a.criadoEm ?? ""),
  );
}

export async function listarIndicadores(): Promise<Indicador[]> {
  const arr = await ler<Indicador>("com_indicadores");
  return arr.sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99) || a.nome.localeCompare(b.nome));
}

/** Marcações da competência, já indexadas por funcionário. */
export async function listarIndicadoresAtingidos(
  competencia: string,
): Promise<Map<string, string[]>> {
  const { db } = fb();
  const snap = await getDocs(
    query(collection(db, "com_indicadores_atingidos"), where("competencia", "==", competencia)),
  );
  const m = new Map<string, string[]>();
  for (const d of snap.docs) {
    const a = d.data() as IndicadoresAtingidos;
    m.set(a.funcionarioId, a.indicadores ?? []);
  }
  return m;
}

export interface PreviaImportMetas {
  ok: boolean;
  confirmado: boolean;
  linhas: number;
  erros: string[];
  ambiguos: string[];
  lojasNaoMapeadas: string[];
  semCasar: {
    linha: number;
    nome: string | null;
    codigo: string | null;
    loja: string | null;
    /** Chave do de-para, para amarrar esta pessoa de uma vez por todas. */
    chave: string;
    meta: number;
  }[];
  resumo: {
    competencia: string;
    /** Metas por pessoa que o arquivo substituiu. */
    substituidas?: number;
    pessoas: number;
    total: number;
    lojas?: { lojaId: number; total: number }[];
    semanas: string[];
    semMeta: string[];
  }[];
}

/** Sem `confirmar`, é só prévia — nada é gravado. */
export const importarMetas = (texto: string, confirmar = false) =>
  chamar<PreviaImportMetas>("comissoesImportarMetas", { texto, confirmar });

export async function listarVendedoresPdv(): Promise<VendedorPdv[]> {
  const arr = await ler<VendedorPdv>("pdv_sellers");
  return arr.sort((a, b) => (b.totalPeriodo ?? 0) - (a.totalPeriodo ?? 0));
}

export async function obterConfig(): Promise<ConfigComissoes> {
  const { db } = fb();
  const snap = await getDoc(doc(db, "com_config", "geral"));
  const d = snap.data() as Partial<ConfigComissoes> | undefined;
  const dia = Number(d?.diaPagamentoFolha);
  return {
    sincronizarFuncionarios: d?.sincronizarFuncionarios !== false,
    cargosPorTipoPdv: d?.cargosPorTipoPdv ?? {},
    // Sem estes dois aqui, salvar um de-para apagava o outro: amarrar a loja
    // desfazia as pessoas, amarrar a pessoa desfazia a loja, e a tela ficava
    // pedindo os dois em looping.
    lojasImport: d?.lojasImport ?? {},
    vendedoresImport: d?.vendedoresImport ?? {},
    regraPiso: d?.regraPiso === "soma" ? "soma" : "maior",
    cargoPadraoId: d?.cargoPadraoId ?? null,
    diaPagamentoFolha: Number.isFinite(dia) && dia >= 1 && dia <= 28 ? Math.floor(dia) : 5,
    mesPagamento: d?.mesPagamento === "mesmo" ? "mesmo" : "seguinte",
    provisaoNoFluxo: d?.provisaoNoFluxo === true,
  };
}

// ── Escritas (callables) ────────────────────────────────────────────────────

export const salvarCargo = (i: Partial<Cargo>) => chamar<{ ok: boolean; id: string }>("comissoesSalvarCargo", i);
export const excluirCargo = (id: string) => chamar<{ ok: boolean }>("comissoesExcluirCargo", { id });

export const salvarFuncionario = (i: Partial<Funcionario>) =>
  chamar<{ ok: boolean; id: string }>("comissoesSalvarFuncionario", i);
export const excluirFuncionario = (id: string) =>
  chamar<{ ok: boolean }>("comissoesExcluirFuncionario", { id });

export const importarVendedores = (i: { cargoId?: string | null; ids?: string[] }) =>
  chamar<{ ok: boolean; criados: number }>("comissoesImportarVendedores", i);

export const salvarRegra = (i: Partial<Regra>) => chamar<{ ok: boolean; id: string }>("comissoesSalvarRegra", i);
export const excluirRegra = (id: string) => chamar<{ ok: boolean }>("comissoesExcluirRegra", { id });

export const salvarMetas = (metas: Partial<Meta>[]) =>
  chamar<{ ok: boolean; salvos: number }>("comissoesSalvarMetas", { metas });
export const excluirMeta = (id: string) => chamar<{ ok: boolean }>("comissoesExcluirMeta", { id });

export const salvarBonus = (i: Partial<Bonus>) => chamar<{ ok: boolean; id: string }>("comissoesSalvarBonus", i);
export const excluirBonus = (id: string) => chamar<{ ok: boolean }>("comissoesExcluirBonus", { id });

export const salvarAjuste = (i: {
  funcionarioId: string;
  competencia: string;
  valor: number;
  motivo: string;
  /** "desconto" sai depois do piso; sem isso, é ajuste de comissão. */
  tipo?: "manual" | "desconto";
  categoria?: string;
}) =>
  chamar<{ ok: boolean; id: string }>("comissoesSalvarAjuste", i);
export const excluirAjuste = (id: string) => chamar<{ ok: boolean }>("comissoesExcluirAjuste", { id });

export const salvarIndicador = (i: Partial<Indicador>) =>
  chamar<{ ok: boolean; id: string }>("comissoesSalvarIndicador", i);
export const excluirIndicador = (id: string) =>
  chamar<{ ok: boolean }>("comissoesExcluirIndicador", { id });
export const marcarIndicadores = (i: {
  competencia: string;
  funcionarioId: string;
  indicadores: string[];
}) => chamar<{ ok: boolean; id: string }>("comissoesMarcarIndicadores", i);

export const salvarConfig = (i: Partial<ConfigComissoes>) =>
  chamar<{ ok: boolean } & ConfigComissoes>("comissoesSalvarConfig", i);

export const sincronizarVendedoresPdv = (competencias?: string[]) =>
  chamar<ResultadoSyncQuadro>("comissoesSincronizarVendedores", { competencias });

export interface AchadoPdv {
  codigo: string | null;
  nome: string | null;
  apelido: string | null;
  cpf: string | null;
  tipo: string | null;
  lojaId: number;
  lojaNome: string | null;
  lojaAtiva: boolean;
}

/** Procura um vendedor nas equipes do PDV (por lotação). Não grava nada. */
export const procurarVendedorPdv = (busca: string, redeInteira = false) =>
  chamar<{ ok: boolean; varridas: number; achados: AchadoPdv[] }>("pdvnetProcurarVendedor", {
    busca,
    redeInteira,
  });

export const marcarVendedor = (id: string, ignorado: boolean) =>
  chamar<{ ok: boolean; ignorado: boolean }>("comissoesMarcarVendedor", { id, ignorado });

export const apurarComissoes = (competencia: string) =>
  chamar<ResultadoCompetencia>("comissoesApurar", { competencia });

export const fecharComissoes = (competencia: string) =>
  chamar<{ ok: boolean; linhas: number; valorDevido: number; estornos: number }>(
    "comissoesFechar",
    { competencia },
  );

export const alterarStatusFechamento = (competencia: string, status: StatusFechamento) =>
  chamar<{ ok: boolean; status: StatusFechamento }>("comissoesAlterarStatus", {
    competencia,
    status,
  });

export const simularComissao = (i: {
  competencia: string;
  funcionarioId: string;
  /** Valem para o escopo pelo qual a pessoa é medida (própria, loja ou grupo). */
  venda?: number | null;
  meta?: number | null;
  piso?: number | null;
}) =>
  chamar<{
    ok: boolean;
    atual: ResultadoApuracao;
    simulado: ResultadoApuracao;
    escopo: EscopoVenda;
  }>("comissoesSimular", i);

export const listarAuditoria = (limite = 200) =>
  chamar<{ ok: boolean; logs: LogAuditoria[] }>("comissoesAuditoria", { limite });

export const custoComissoes = (de: string, ate: string) =>
  chamar<{ ok: boolean; meses: CustoMes[] }>("comissoesCusto", { de, ate });
