// Apuração de uma competência: lê o Firestore, consolida as vendas do PDV,
// resolve a regra vigente de cada funcionário e roda o motor (§18, §21, §37).
//
// Nada de política aqui — só orquestração. O cálculo em si mora em motor.ts.

import { db } from "../lib/base";
import {
  consolidar,
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
  Funcionario,
  Meta,
  Regra,
  RegraPiso,
  ResultadoApuracao,
} from "./tipos";

const ZERO: Totais = { liquida: 0, bruta: 0, qtd: 0 };

export interface ConfigComissoes {
  /** Piso × comissão: "maior" (padrão) ou "soma" (§5). */
  regraPiso: RegraPiso;
  /** Cargo atribuído aos vendedores importados do PDV. */
  cargoPadraoId: string | null;
}

export async function carregarConfig(): Promise<ConfigComissoes> {
  const d = (await db.collection("com_config").doc("geral").get()).data() as
    | Partial<ConfigComissoes>
    | undefined;
  return {
    regraPiso: d?.regraPiso === "soma" ? "soma" : "maior",
    cargoPadraoId: d?.cargoPadraoId ?? null,
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
  pdvVendedorId: string | null;
  regraId: string | null;
  regraNome: string | null;
}

export interface ResultadoCompetencia {
  competencia: string;
  periodo: { de: string; ate: string };
  regraPiso: RegraPiso;
  linhas: LinhaApuracao[];
  totais: {
    faturamento: number;
    comissaoBase: number;
    bonus: number;
    ajustes: number;
    comissaoTotal: number;
    valorDevido: number;
    pisoUtilizado: number; // quanto do valor devido veio do piso, não da comissão
    acimaDaMeta: number;
    funcionarios: number;
  };
  /** Faturamento consolidado por loja (para o dashboard e o custo de comissões). */
  porLoja: { lojaId: number; lojaNome: string | null; faturamento: number; meta: number | null; comissao: number }[];
  divergencias: {
    vendasSemVendedor: { qtd: number; valor: number; ids: string[] };
    vendedoresSemCadastro: { id: string; nome: string | null; total: number }[];
    funcionariosSemRegra: string[];
    funcionariosSemPiso: string[];
    funcionariosSemMeta: string[];
  };
  status: string; // status do fechamento (§27)
}

/** Apura a competência inteira (sem gravar nada — é a base da tela e do fechamento). */
export async function apurarCompetencia(competencia: string): Promise<ResultadoCompetencia> {
  const [cfg, funcionarios, cargos, regras, metas, bonus, ajustes, vendas, lojasSnap, fechamentoDoc] =
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
      db.collection("com_fechamentos").doc(competencia).get(),
    ]);

  const consolidado = consolidar(vendas);
  const nomeLoja = new Map<number, string>();
  for (const d of lojasSnap.docs) {
    const v = d.data() as { grupoNome?: string; nome?: string };
    nomeLoja.set(Number(d.id), v.grupoNome || v.nome || `Loja ${d.id}`);
  }
  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));
  const metasDaComp = metas.filter((m) => m.competencia === competencia);
  const ajustesDaComp = ajustes.filter((a) => a.competencia === competencia);

  const linhas: LinhaApuracao[] = [];
  const comissaoPorLoja = new Map<number, number>();
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
    const metaGrupo = metasGrupo.length === lojasGrupo.length && metasGrupo.length > 0
      ? metasGrupo.reduce((a, b) => a + b, 0)
      : null;

    const regra = escolherRegra(regras, f, competencia);
    const res = apurar({
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
    });

    if (!regra) semRegra.push(f.nome);
    if (f.pisoGarantido == null) semPiso.push(f.nome);
    if (metaIndividual == null && metaLoja == null) semMeta.push(f.nome);
    if (f.lojaId != null) {
      comissaoPorLoja.set(f.lojaId, (comissaoPorLoja.get(f.lojaId) ?? 0) + res.valorDevido);
    }

    linhas.push({
      ...res,
      funcionarioNome: f.nome,
      cargoId: f.cargoId,
      cargoNome: f.cargoId ? (nomeCargo.get(f.cargoId) ?? null) : null,
      lojaId: f.lojaId,
      lojaNome: f.lojaId != null ? (nomeLoja.get(f.lojaId) ?? null) : null,
      pdvVendedorId: vendedorId,
      regraId: regra?.id ?? null,
      regraNome: regra?.nome ?? null,
    });
  }

  linhas.sort(
    (a, b) =>
      (a.lojaNome ?? "").localeCompare(b.lojaNome ?? "") ||
      a.funcionarioNome.localeCompare(b.funcionarioNome),
  );

  // Vendedores que venderam e não têm funcionário vinculado (§31).
  const vinculados = new Set(
    funcionarios.map((f) => f.pdvVendedorId).filter((v): v is string => !!v),
  );
  const sellersSnap = await db.collection("pdv_sellers").get();
  const nomeVendedor = new Map<string, string | null>();
  for (const d of sellersSnap.docs) nomeVendedor.set(d.id, (d.data().nome as string) ?? null);
  const vendedoresSemCadastro = [...consolidado.porVendedor.entries()]
    .filter(([id]) => !vinculados.has(id))
    .map(([id, t]) => ({ id, nome: nomeVendedor.get(id) ?? null, total: t.liquida }))
    .sort((a, b) => b.total - a.total);

  const faturamento = [...consolidado.porLoja.values()].reduce((s, t) => s + t.liquida, 0);
  const cent = (n: number) => Math.round(n * 100) / 100;

  return {
    competencia,
    periodo: limitesDaCompetencia(competencia),
    regraPiso: cfg.regraPiso,
    linhas,
    totais: {
      faturamento: cent(faturamento),
      comissaoBase: cent(linhas.reduce((s, l) => s + l.comissaoBase, 0)),
      bonus: cent(linhas.reduce((s, l) => s + l.bonusTotal, 0)),
      ajustes: cent(linhas.reduce((s, l) => s + l.ajustesTotal, 0)),
      comissaoTotal: cent(linhas.reduce((s, l) => s + l.comissaoTotal, 0)),
      valorDevido: cent(linhas.reduce((s, l) => s + l.valorDevido, 0)),
      pisoUtilizado: cent(
        linhas.filter((l) => l.pisoAplicado).reduce((s, l) => s + (l.piso - l.comissaoTotal), 0),
      ),
      acimaDaMeta: linhas.filter((l) => (l.atingimentoPct ?? 0) >= 100).length,
      funcionarios: linhas.length,
    },
    porLoja: [...consolidado.porLoja.entries()]
      .map(([lojaId, t]) => ({
        lojaId,
        lojaNome: nomeLoja.get(lojaId) ?? null,
        faturamento: t.liquida,
        meta: escolherMetaLoja(metasDaComp, lojaId, competencia),
        comissao: cent(comissaoPorLoja.get(lojaId) ?? 0),
      }))
      .sort((a, b) => b.faturamento - a.faturamento),
    divergencias: {
      vendasSemVendedor: consolidado.semVendedor,
      vendedoresSemCadastro,
      funcionariosSemRegra: semRegra,
      funcionariosSemPiso: semPiso,
      funcionariosSemMeta: semMeta,
    },
    status: (fechamentoDoc.data()?.status as string) ?? "aberto",
  };
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
  const fechados = await db
    .collection("com_fechamentos")
    .where("status", "==", "fechado")
    .get();
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
    const apuracoes = await db
      .collection("com_apuracoes")
      .where("competencia", "==", comp)
      .get();
    const pctPorVendedor = new Map<string, { funcionarioId: string; pct: number }>();
    for (const a of apuracoes.docs) {
      const d = a.data() as { pdvVendedorId?: string; funcionarioId?: string; percentualEfetivo?: number };
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
  return { criados, valor: Math.round(valor * 100) / 100 };
}
