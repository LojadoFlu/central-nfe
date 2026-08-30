// Apuração de uma competência: lê o Firestore, consolida as vendas do PDV,
// resolve a regra vigente de cada funcionário e roda o motor (§18, §21, §37).
//
// Nada de política aqui — só orquestração. O cálculo em si mora em motor.ts.
//
// Competência FECHADA não recalcula: devolve o snapshot congelado em
// `com_apuracoes` (§26). É o que garante que a resposta a "por que eu recebi
// esse valor?" seja a mesma daqui a três meses.

import { db, hojeBRT } from "../lib/base";
import {
  consolidar,
  dataPagamentoFolha as calcularDataPagamento,
  limitesDaCompetencia,
  somarLojas,
  estornoDeVendaCancelada,
  type Totais,
  type VendaBruta,
} from "./consolidacao";
import {
  apurar,
  bonusAplicaveis,
  escolherMeta,
  escolherMetaLoja,
  escolherRegra,
} from "./motor";
import type {
  Ajuste,
  Bonus,
  Cargo,
  EntradaApuracao,
  Funcionario,
  Meta,
  Regra,
  RegraPiso,
  ResultadoApuracao,
} from "./tipos";

const ZERO: Totais = { liquida: 0, bruta: 0, qtd: 0 };
const cent = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Estados do fechamento (§27). */
export const STATUS_FECHAMENTO = [
  "aberto",
  "pre-fechamento",
  "conferido",
  "fechado",
  "reaberto",
] as const;
export type StatusFechamento = (typeof STATUS_FECHAMENTO)[number];

export interface ConfigComissoes {
  /** Piso × comissão: "maior" (padrão) ou "soma" (§5). */
  regraPiso: RegraPiso;
  /** Cargo atribuído aos vendedores importados do PDV. */
  cargoPadraoId: string | null;
  /** Dia em que a folha variável sai do caixa (§25). */
  diaPagamentoFolha: number;
  /** A folha do mês sai no mês seguinte (padrão) ou no próprio mês. */
  mesPagamento: "seguinte" | "mesmo";
  /**
   * Lançar a provisão de comissões como saída no fluxo de caixa.
   * Nasce DESLIGADA de propósito: quem já lança a folha como despesa manual
   * veria o mesmo dinheiro sair duas vezes.
   */
  provisaoNoFluxo: boolean;
}

export async function carregarConfig(): Promise<ConfigComissoes> {
  const d = (await db.collection("com_config").doc("geral").get()).data() as
    | Partial<ConfigComissoes>
    | undefined;
  const dia = Number(d?.diaPagamentoFolha);
  return {
    regraPiso: d?.regraPiso === "soma" ? "soma" : "maior",
    cargoPadraoId: d?.cargoPadraoId ?? null,
    diaPagamentoFolha: Number.isFinite(dia) && dia >= 1 && dia <= 28 ? Math.floor(dia) : 5,
    mesPagamento: d?.mesPagamento === "mesmo" ? "mesmo" : "seguinte",
    provisaoNoFluxo: d?.provisaoNoFluxo === true,
  };
}

async function lerColecao<T>(nome: string): Promise<T[]> {
  const snap = await db.collection(nome).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as T[];
}

/** Vendas da competência, no formato que a consolidação espera. */
export async function lerVendas(competencia: string): Promise<VendaBruta[]> {
  const { de, ate } = limitesDaCompetencia(competencia);
  const snap = await db.collection("sales").where("dia", ">=", de).where("dia", "<=", ate).get();
  return snap.docs.map((d) => {
    const s = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      lojaId: (s.lojaId as number | null) ?? null,
      dia: (s.dia as string) ?? "",
      vendedorId: (s.vendedorId as string | null) ?? null,
      valorTotal: Number(s.valorTotal) || 0,
      valorProdutos: s.valorProdutos == null ? null : Number(s.valorProdutos),
      cancelada: !!s.cancelada,
    } satisfies VendaBruta;
  });
}

export interface LinhaApuracao extends ResultadoApuracao {
  funcionarioNome: string;
  cargoId: string | null;
  cargoNome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  empresaId: string | null;
  pdvVendedorId: string | null;
  regraId: string | null;
  regraNome: string | null;
  /** Projeção do fechamento quando o mês ainda está em curso (§22). */
  vendaProjetada: number | null;
  comissaoProjetada: number | null;
  valorDevidoProjetado: number | null;
}

export interface ResultadoCompetencia {
  competencia: string;
  periodo: { de: string; ate: string };
  regraPiso: RegraPiso;
  /** Data em que a folha variável desta competência sai do caixa. */
  pagamentoEm: string;
  linhas: LinhaApuracao[];
  totais: {
    faturamento: number;
    comissaoBase: number;
    bonus: number;
    ajustes: number;
    comissaoTotal: number;
    valorDevido: number;
    pisoUtilizado: number;
    acimaDaMeta: number;
    funcionarios: number;
  };
  /** Custo por cargo (§24). */
  porCargo: { cargoId: string | null; cargoNome: string; valor: number; funcionarios: number }[];
  porLoja: {
    lojaId: number;
    lojaNome: string | null;
    faturamento: number;
    meta: number | null;
    comissao: number;
  }[];
  /** Folha variável por CNPJ — é assim que ela entra no fluxo de caixa. */
  porEmpresa: { empresaId: string; valor: number }[];
  projecao: { faturamento: number; valorDevido: number; diasDecorridos: number; diasTotais: number } | null;
  divergencias: {
    vendasSemVendedor: { qtd: number; valor: number; ids: string[] };
    vendedoresSemCadastro: { id: string; nome: string | null; total: number }[];
    funcionariosSemRegra: string[];
    funcionariosSemPiso: string[];
    funcionariosSemMeta: string[];
  };
  status: StatusFechamento;
  /** true quando os números vêm do fechamento congelado, não de um novo cálculo. */
  congelado: boolean;
  fechadoPor?: string | null;
  fechadoEm?: string | null;
}

/** Data de pagamento da folha variável de uma competência. */
export function dataPagamentoFolha(competencia: string, cfg: ConfigComissoes): string {
  return calcularDataPagamento(competencia, cfg.diaPagamentoFolha, cfg.mesPagamento);
}

/** Progresso do mês, para a projeção (§22). */
function progresso(competencia: string): { decorridos: number; totais: number; emCurso: boolean } {
  const { de, ate } = limitesDaCompetencia(competencia);
  const hoje = hojeBRT();
  const totais = Number(ate.slice(8, 10));
  if (hoje > ate) return { decorridos: totais, totais, emCurso: false };
  if (hoje < de) return { decorridos: 0, totais, emCurso: false };
  return { decorridos: Number(hoje.slice(8, 10)), totais, emCurso: true };
}

/** Multiplica as vendas de uma entrada (usado na projeção). */
function escalarVendas(e: EntradaApuracao, fator: number): EntradaApuracao {
  const esc = (v: { liquida: number; bruta: number }) => ({
    liquida: cent(v.liquida * fator),
    bruta: cent(v.bruta * fator),
  });
  return {
    ...e,
    vendas: {
      individual: esc(e.vendas.individual),
      loja: esc(e.vendas.loja),
      grupo: esc(e.vendas.grupo),
    },
  };
}

/** Apura a competência inteira. Fechada → devolve o congelado. */
export async function apurarCompetencia(competencia: string): Promise<ResultadoCompetencia> {
  const fechamento = (await db.collection("com_fechamentos").doc(competencia).get()).data() as
    | (Partial<ResultadoCompetencia> & { status?: StatusFechamento })
    | undefined;

  if (fechamento?.status === "fechado") {
    return lerFechamentoCongelado(competencia, fechamento);
  }

  const vivo = await calcularCompetencia(competencia, fechamento?.status ?? "aberto");
  await gravarProvisao(vivo);
  return vivo;
}

/** Cálculo ao vivo (não grava nada). */
export async function calcularCompetencia(
  competencia: string,
  status: StatusFechamento,
): Promise<ResultadoCompetencia> {
  const [cfg, funcionarios, cargos, regras, metas, bonus, ajustes, vendas, lojasSnap, sellersSnap] =
    await Promise.all([
      carregarConfig(),
      lerColecao<Funcionario>("com_funcionarios"),
      lerColecao<Cargo>("com_cargos"),
      lerColecao<Regra>("com_regras"),
      lerColecao<Meta>("com_metas"),
      lerColecao<Bonus>("com_bonus"),
      lerColecao<Ajuste>("com_ajustes"),
      lerVendas(competencia),
      db.collection("pdv_stores").get(),
      db.collection("pdv_sellers").get(),
    ]);

  const consolidado = consolidar(vendas);
  const nomeLoja = new Map<number, string>();
  const empresaDaLoja = new Map<number, string | null>();
  for (const d of lojasSnap.docs) {
    const v = d.data() as { grupoNome?: string; nome?: string; empresaId?: string | null };
    nomeLoja.set(Number(d.id), v.grupoNome || v.nome || `Loja ${d.id}`);
    empresaDaLoja.set(Number(d.id), v.empresaId ?? null);
  }
  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));
  const metasDaComp = metas.filter((m) => m.competencia === competencia);
  const ajustesDaComp = ajustes.filter((a) => a.competencia === competencia);
  const prog = progresso(competencia);
  const fatorProjecao = prog.emCurso && prog.decorridos > 0 ? prog.totais / prog.decorridos : null;

  const linhas: LinhaApuracao[] = [];
  const comissaoPorLoja = new Map<number, number>();
  const porEmpresaMap = new Map<string, number>();
  const porCargoMap = new Map<string | null, { nome: string; valor: number; funcionarios: number }>();
  const semRegra: string[] = [];
  const semPiso: string[] = [];
  const semMeta: string[] = [];

  for (const f of funcionarios) {
    if (!f.ativo) continue;
    const vendedorId = f.pdvVendedorId ?? null;
    const individual = (vendedorId && consolidado.porVendedor.get(vendedorId)) || ZERO;
    const loja = (f.lojaId != null && consolidado.porLoja.get(f.lojaId)) || ZERO;
    const lojasGrupo = f.lojasGrupo?.length ? f.lojasGrupo : f.lojaId != null ? [f.lojaId] : [];
    const grupo = somarLojas(consolidado.porLoja, lojasGrupo);

    const metaIndividual = escolherMeta(metasDaComp, f, competencia);
    const metaLoja = escolherMetaLoja(metasDaComp, f.lojaId, competencia);
    const metasGrupo = lojasGrupo
      .map((l) => escolherMetaLoja(metasDaComp, l, competencia))
      .filter((v): v is number => v != null);
    const metaGrupo =
      metasGrupo.length === lojasGrupo.length && metasGrupo.length > 0
        ? metasGrupo.reduce((a, b) => a + b, 0)
        : null;

    const regra = escolherRegra(regras, f, competencia);
    const entrada: EntradaApuracao = {
      competencia,
      funcionario: f,
      vendas: {
        individual: { liquida: individual.liquida, bruta: individual.bruta },
        loja: { liquida: loja.liquida, bruta: loja.bruta },
        grupo: { liquida: grupo.liquida, bruta: grupo.bruta },
      },
      metas: { individual: metaIndividual, loja: metaLoja, grupo: metaGrupo },
      regra,
      bonus: bonusAplicaveis(bonus, f, competencia),
      ajustes: ajustesDaComp.filter((a) => a.funcionarioId === f.id),
      extras: {
        melhorVendedorLoja:
          f.lojaId != null && !!vendedorId
            ? consolidado.melhorVendedorPorLoja.get(f.lojaId) === vendedorId
            : false,
      },
      regraPiso: cfg.regraPiso,
    };
    const res = apurar(entrada);
    const proj = fatorProjecao ? apurar(escalarVendas(entrada, fatorProjecao)) : null;

    if (!regra) semRegra.push(f.nome);
    if (f.pisoGarantido == null) semPiso.push(f.nome);
    if (metaIndividual == null && metaLoja == null) semMeta.push(f.nome);
    if (f.lojaId != null) {
      comissaoPorLoja.set(f.lojaId, (comissaoPorLoja.get(f.lojaId) ?? 0) + res.valorDevido);
    }
    const empresaId = f.lojaId != null ? (empresaDaLoja.get(f.lojaId) ?? null) : null;
    if (empresaId) porEmpresaMap.set(empresaId, (porEmpresaMap.get(empresaId) ?? 0) + res.valorDevido);
    const chaveCargo = f.cargoId ?? null;
    const acumCargo = porCargoMap.get(chaveCargo) ?? {
      nome: chaveCargo ? (nomeCargo.get(chaveCargo) ?? "cargo removido") : "Sem cargo",
      valor: 0,
      funcionarios: 0,
    };
    acumCargo.valor += res.valorDevido;
    acumCargo.funcionarios += 1;
    porCargoMap.set(chaveCargo, acumCargo);

    linhas.push({
      ...res,
      funcionarioNome: f.nome,
      cargoId: f.cargoId,
      cargoNome: f.cargoId ? (nomeCargo.get(f.cargoId) ?? null) : null,
      lojaId: f.lojaId,
      lojaNome: f.lojaId != null ? (nomeLoja.get(f.lojaId) ?? null) : null,
      empresaId,
      pdvVendedorId: vendedorId,
      regraId: regra?.id ?? null,
      regraNome: regra?.nome ?? null,
      vendaProjetada: proj ? proj.vendaConsiderada : null,
      comissaoProjetada: proj ? proj.comissaoTotal : null,
      valorDevidoProjetado: proj ? proj.valorDevido : null,
    });
  }

  linhas.sort(
    (a, b) =>
      (a.lojaNome ?? "").localeCompare(b.lojaNome ?? "") ||
      a.funcionarioNome.localeCompare(b.funcionarioNome),
  );

  const vinculados = new Set(
    funcionarios.map((f) => f.pdvVendedorId).filter((v): v is string => !!v),
  );
  const nomeVendedor = new Map<string, string | null>();
  for (const d of sellersSnap.docs) nomeVendedor.set(d.id, (d.data().nome as string) ?? null);
  const vendedoresSemCadastro = [...consolidado.porVendedor.entries()]
    .filter(([id]) => !vinculados.has(id))
    .map(([id, t]) => ({ id, nome: nomeVendedor.get(id) ?? null, total: t.liquida }))
    .sort((a, b) => b.total - a.total);

  const faturamento = cent([...consolidado.porLoja.values()].reduce((s, t) => s + t.liquida, 0));
  const valorDevido = cent(linhas.reduce((s, l) => s + l.valorDevido, 0));

  return {
    competencia,
    periodo: limitesDaCompetencia(competencia),
    regraPiso: cfg.regraPiso,
    pagamentoEm: dataPagamentoFolha(competencia, cfg),
    linhas,
    totais: {
      faturamento,
      comissaoBase: cent(linhas.reduce((s, l) => s + l.comissaoBase, 0)),
      bonus: cent(linhas.reduce((s, l) => s + l.bonusTotal, 0)),
      ajustes: cent(linhas.reduce((s, l) => s + l.ajustesTotal, 0)),
      comissaoTotal: cent(linhas.reduce((s, l) => s + l.comissaoTotal, 0)),
      valorDevido,
      pisoUtilizado: cent(
        linhas.filter((l) => l.pisoAplicado).reduce((s, l) => s + (l.piso - l.comissaoTotal), 0),
      ),
      acimaDaMeta: linhas.filter((l) => (l.atingimentoPct ?? 0) >= 100).length,
      funcionarios: linhas.length,
    },
    porCargo: [...porCargoMap.entries()]
      .map(([cargoId, v]) => ({
        cargoId,
        cargoNome: v.nome,
        valor: cent(v.valor),
        funcionarios: v.funcionarios,
      }))
      .sort((a, b) => b.valor - a.valor),
    porLoja: [...consolidado.porLoja.entries()]
      .map(([lojaId, t]) => ({
        lojaId,
        lojaNome: nomeLoja.get(lojaId) ?? null,
        faturamento: t.liquida,
        meta: escolherMetaLoja(metasDaComp, lojaId, competencia),
        comissao: cent(comissaoPorLoja.get(lojaId) ?? 0),
      }))
      .sort((a, b) => b.faturamento - a.faturamento),
    porEmpresa: [...porEmpresaMap.entries()]
      .map(([empresaId, valor]) => ({ empresaId, valor: cent(valor) }))
      .sort((a, b) => b.valor - a.valor),
    projecao: fatorProjecao
      ? {
          faturamento: cent(faturamento * fatorProjecao),
          valorDevido: cent(linhas.reduce((s, l) => s + (l.valorDevidoProjetado ?? l.valorDevido), 0)),
          diasDecorridos: prog.decorridos,
          diasTotais: prog.totais,
        }
      : null,
    divergencias: {
      vendasSemVendedor: consolidado.semVendedor,
      vendedoresSemCadastro,
      funcionariosSemRegra: semRegra,
      funcionariosSemPiso: semPiso,
      funcionariosSemMeta: semMeta,
    },
    status,
    congelado: false,
  };
}

/**
 * Guarda no `com_fechamentos` o resumo do mês em curso — é o que o fluxo de
 * caixa lê como PROVISÃO, sem precisar reprocessar as vendas (§25).
 */
async function gravarProvisao(r: ResultadoCompetencia): Promise<void> {
  await db
    .collection("com_fechamentos")
    .doc(r.competencia)
    .set(
      {
        competencia: r.competencia,
        status: r.status,
        periodo: r.periodo,
        pagamentoEm: r.pagamentoEm,
        totais: r.totais,
        porEmpresa: r.porEmpresa,
        porLoja: r.porLoja,
        porCargo: r.porCargo,
        projecao: r.projecao,
        provisaoAtualizadaEm: new Date().toISOString(),
      },
      { merge: true },
    );
}

/** Reconstrói a competência a partir do fechamento congelado. */
async function lerFechamentoCongelado(
  competencia: string,
  fechamento: Partial<ResultadoCompetencia>,
): Promise<ResultadoCompetencia> {
  const snap = await db
    .collection("com_apuracoes")
    .where("competencia", "==", competencia)
    .get();
  const linhas = snap.docs.map((d) => d.data() as LinhaApuracao);
  linhas.sort(
    (a, b) =>
      (a.lojaNome ?? "").localeCompare(b.lojaNome ?? "") ||
      a.funcionarioNome.localeCompare(b.funcionarioNome),
  );
  return {
    competencia,
    periodo: fechamento.periodo ?? limitesDaCompetencia(competencia),
    regraPiso: fechamento.regraPiso ?? "maior",
    pagamentoEm: fechamento.pagamentoEm ?? dataPagamentoFolha(competencia, await carregarConfig()),
    linhas,
    totais:
      fechamento.totais ?? {
        faturamento: 0,
        comissaoBase: 0,
        bonus: 0,
        ajustes: 0,
        comissaoTotal: 0,
        valorDevido: 0,
        pisoUtilizado: 0,
        acimaDaMeta: 0,
        funcionarios: linhas.length,
      },
    porCargo: fechamento.porCargo ?? [],
    porLoja: fechamento.porLoja ?? [],
    porEmpresa: fechamento.porEmpresa ?? [],
    projecao: null,
    divergencias:
      fechamento.divergencias ?? {
        vendasSemVendedor: { qtd: 0, valor: 0, ids: [] },
        vendedoresSemCadastro: [],
        funcionariosSemRegra: [],
        funcionariosSemPiso: [],
        funcionariosSemMeta: [],
      },
    status: "fechado",
    congelado: true,
    fechadoPor: fechamento.fechadoPor ?? null,
    fechadoEm: fechamento.fechadoEm ?? null,
  };
}

/**
 * Fecha a competência (§26). Antes de congelar: detecta estornos de vendas
 * canceladas em meses já fechados e recalcula com eles dentro.
 * Grava uma apuração por funcionário — inclusive a memória de cálculo.
 */
export async function fecharCompetencia(
  competencia: string,
  uid: string,
): Promise<{ linhas: number; valorDevido: number; estornos: number }> {
  const atual = (await db.collection("com_fechamentos").doc(competencia).get()).data() as
    | { status?: StatusFechamento }
    | undefined;
  if (atual?.status === "fechado") {
    throw new Error("Competência já está fechada. Reabra antes de fechar de novo.");
  }

  const estornos = await detectarEstornos(competencia);
  const r = await calcularCompetencia(competencia, "fechado");
  const agora = new Date().toISOString();

  // Se a competência já foi fechada antes (e reaberta), o snapshot anterior pode
  // ter gente que saiu do cadastro. Sobrescrever não basta — o órfão precisa sair,
  // senão ele reaparece na folha congelada.
  const anteriores = await db
    .collection("com_apuracoes")
    .where("competencia", "==", competencia)
    .get();
  const vivos = new Set(r.linhas.map((l) => `${competencia}_${l.funcionarioId}`));
  for (const doc of anteriores.docs) {
    if (!vivos.has(doc.id)) await doc.ref.delete();
  }

  let batch = db.batch();
  let ops = 0;
  for (const l of r.linhas) {
    batch.set(db.collection("com_apuracoes").doc(`${competencia}_${l.funcionarioId}`), {
      ...l,
      competencia,
      fechadoEm: agora,
      fechadoPor: uid,
    });
    if (++ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  await db
    .collection("com_fechamentos")
    .doc(competencia)
    .set(
      {
        competencia,
        status: "fechado",
        periodo: r.periodo,
        regraPiso: r.regraPiso,
        pagamentoEm: r.pagamentoEm,
        totais: r.totais,
        porCargo: r.porCargo,
        porLoja: r.porLoja,
        porEmpresa: r.porEmpresa,
        divergencias: r.divergencias,
        projecao: null,
        fechadoEm: agora,
        fechadoPor: uid,
        historico: [
          ...((atual as { historico?: unknown[] } | undefined)?.historico ?? []),
          { status: "fechado", em: agora, por: uid },
        ],
      },
      { merge: true },
    );

  return { linhas: r.linhas.length, valorDevido: r.totais.valorDevido, estornos: estornos.criados };
}

/** Muda o status do fechamento (§27), registrando quem fez. */
export async function alterarStatusFechamento(
  competencia: string,
  status: StatusFechamento,
  uid: string,
): Promise<void> {
  const ref = db.collection("com_fechamentos").doc(competencia);
  const atual = (await ref.get()).data() as { historico?: unknown[] } | undefined;
  const agora = new Date().toISOString();
  await ref.set(
    {
      competencia,
      status,
      atualizadoEm: agora,
      historico: [...(atual?.historico ?? []), { status, em: agora, por: uid }],
    },
    { merge: true },
  );
}

/** Simulação "e se…" — não toca em nada gravado (§20). */
export async function simular(
  competencia: string,
  funcionarioId: string,
  overrides: {
    vendaIndividual?: number;
    vendaLoja?: number;
    metaIndividual?: number | null;
    metaLoja?: number | null;
    piso?: number | null;
    regraId?: string | null;
  },
): Promise<{ atual: ResultadoApuracao; simulado: ResultadoApuracao }> {
  const base = await calcularCompetencia(competencia, "aberto");
  const linha = base.linhas.find((l) => l.funcionarioId === funcionarioId);
  if (!linha) throw new Error("Funcionário não encontrado nesta competência.");

  const [funcionarios, regras, metas, bonus, ajustes, cfg, vendas] = await Promise.all([
    lerColecao<Funcionario>("com_funcionarios"),
    lerColecao<Regra>("com_regras"),
    lerColecao<Meta>("com_metas"),
    lerColecao<Bonus>("com_bonus"),
    lerColecao<Ajuste>("com_ajustes"),
    carregarConfig(),
    lerVendas(competencia),
  ]);
  const f = funcionarios.find((x) => x.id === funcionarioId);
  if (!f) throw new Error("Funcionário não encontrado.");

  const consolidado = consolidar(vendas);
  const individual = (f.pdvVendedorId && consolidado.porVendedor.get(f.pdvVendedorId)) || ZERO;
  const loja = (f.lojaId != null && consolidado.porLoja.get(f.lojaId)) || ZERO;
  const lojasGrupo = f.lojasGrupo?.length ? f.lojasGrupo : f.lojaId != null ? [f.lojaId] : [];
  const grupo = somarLojas(consolidado.porLoja, lojasGrupo);
  const metasDaComp = metas.filter((m) => m.competencia === competencia);

  const entradaBase: EntradaApuracao = {
    competencia,
    funcionario: f,
    vendas: {
      individual: { liquida: individual.liquida, bruta: individual.bruta },
      loja: { liquida: loja.liquida, bruta: loja.bruta },
      grupo: { liquida: grupo.liquida, bruta: grupo.bruta },
    },
    metas: {
      individual: escolherMeta(metasDaComp, f, competencia),
      loja: escolherMetaLoja(metasDaComp, f.lojaId, competencia),
      grupo: null,
    },
    regra: escolherRegra(regras, f, competencia),
    bonus: bonusAplicaveis(bonus, f, competencia),
    ajustes: ajustes.filter((a) => a.competencia === competencia && a.funcionarioId === f.id),
    extras: {
      melhorVendedorLoja:
        f.lojaId != null && !!f.pdvVendedorId
          ? consolidado.melhorVendedorPorLoja.get(f.lojaId) === f.pdvVendedorId
          : false,
    },
    regraPiso: cfg.regraPiso,
  };

  const simulada: EntradaApuracao = {
    ...entradaBase,
    funcionario:
      overrides.piso !== undefined ? { ...f, pisoGarantido: overrides.piso } : f,
    vendas: {
      individual:
        overrides.vendaIndividual != null
          ? { liquida: overrides.vendaIndividual, bruta: overrides.vendaIndividual }
          : entradaBase.vendas.individual,
      loja:
        overrides.vendaLoja != null
          ? { liquida: overrides.vendaLoja, bruta: overrides.vendaLoja }
          : entradaBase.vendas.loja,
      grupo: entradaBase.vendas.grupo,
    },
    metas: {
      individual:
        overrides.metaIndividual !== undefined
          ? overrides.metaIndividual
          : entradaBase.metas.individual,
      loja: overrides.metaLoja !== undefined ? overrides.metaLoja : entradaBase.metas.loja,
      grupo: entradaBase.metas.grupo,
    },
    regra: overrides.regraId
      ? (regras.find((r) => r.id === overrides.regraId) ?? entradaBase.regra)
      : entradaBase.regra,
  };

  return { atual: apurar(entradaBase), simulado: apurar(simulada) };
}

/**
 * Estornos de vendas canceladas DEPOIS do fechamento (§17).
 * Idempotente: cada venda estornada vira um doc em `com_estornos/{vendaId}`,
 * então reprocessar não duplica ajuste (§41).
 */
export async function detectarEstornos(competenciaAlvo: string): Promise<{
  criados: number;
  valor: number;
}> {
  const fechados = await db.collection("com_fechamentos").where("status", "==", "fechado").get();
  let criados = 0;
  let valor = 0;

  for (const doc of fechados.docs) {
    const comp = doc.id;
    if (comp >= competenciaAlvo) continue; // só competências já encerradas
    const { de, ate } = limitesDaCompetencia(comp);
    const canceladas = await db
      .collection("sales")
      .where("dia", ">=", de)
      .where("dia", "<=", ate)
      .where("cancelada", "==", true)
      .get();
    if (canceladas.empty) continue;

    // Percentual efetivo congelado no fechamento daquela competência.
    const apuracoes = await db.collection("com_apuracoes").where("competencia", "==", comp).get();
    const pctPorVendedor = new Map<string, { funcionarioId: string; pct: number }>();
    for (const a of apuracoes.docs) {
      const d = a.data() as {
        pdvVendedorId?: string;
        funcionarioId?: string;
        percentualEfetivo?: number;
      };
      if (d.pdvVendedorId && d.funcionarioId && d.percentualEfetivo) {
        pctPorVendedor.set(d.pdvVendedorId, {
          funcionarioId: d.funcionarioId,
          pct: d.percentualEfetivo,
        });
      }
    }

    for (const s of canceladas.docs) {
      const jaEstornada = await db.collection("com_estornos").doc(s.id).get();
      if (jaEstornada.exists) continue;
      const v = s.data() as { vendedorId?: string; valorTotal?: number; dia?: string };
      const alvo = v.vendedorId ? pctPorVendedor.get(v.vendedorId) : undefined;
      if (!alvo) continue; // venda cancelada de quem não recebeu comissão naquele mês
      const ajuste = estornoDeVendaCancelada(Number(v.valorTotal) || 0, alvo.pct);
      if (!ajuste) continue;
      const ajusteId = `${competenciaAlvo}_${s.id}`;
      await db.collection("com_ajustes").doc(ajusteId).set({
        id: ajusteId,
        funcionarioId: alvo.funcionarioId,
        competencia: competenciaAlvo,
        valor: ajuste,
        motivo: `Estorno da venda ${s.id} (${v.dia}) cancelada após o fechamento de ${comp}`,
        tipo: "estorno",
        criadoEm: new Date().toISOString(),
        criadoPor: "sistema",
      });
      await db.collection("com_estornos").doc(s.id).set({
        vendaId: s.id,
        competenciaOriginal: comp,
        competenciaAjuste: competenciaAlvo,
        funcionarioId: alvo.funcionarioId,
        valorVenda: Number(v.valorTotal) || 0,
        percentualEfetivo: alvo.pct,
        ajuste,
        criadoEm: new Date().toISOString(),
      });
      criados++;
      valor += ajuste;
    }
  }
  return { criados, valor: cent(valor) };
}
