// Espelho dos vendedores do PDVnet → coleção `pdv_sellers` (§2, §30, §31).
//
// De onde vem o nome: a listagem global (/vendedores) tem ~27 mil registros de
// TODA a rede PDVnet — inviável. A equipe por filial
// (/RecursoInicial/Vendedores/{loja}) responde em ~1s e traz o mesmo `Codigo`
// que aparece em `sales.vendedorId`. Quem sobrar (vendeu mas não está em
// nenhuma equipe) é buscado um a um em /vendedores/{id}.

import { db } from "../lib/base";
import type { PdvnetClient } from "../pdvnet/client";
import { limitesDaCompetencia } from "./consolidacao";
import { canonizar, construirGrupos, type LojaBruta } from "./grupos";

export interface VendedorPdv {
  id: string; // = Codigo/VendedorId
  nome: string | null;
  apelido: string | null;
  cpf: string | null;
  tipo: string | null;
  /** Loja onde mais vendeu no período analisado. */
  lojaId: number | null;
  /** Todas as lojas onde aparece (equipe ou venda). */
  lojas: number[];
  inativo: boolean | null;
  /** Último dia com venda no período analisado. */
  ultimaVenda: string | null;
  /** Total vendido (líquido) no período analisado — só para ordenar a tela. */
  totalPeriodo: number;
  atualizadoEm: string;
}

export interface ResultadoSyncVendedores {
  lojas: number;
  equipe: number; // vendedores vindos das equipes das filiais
  comVenda: number; // códigos que aparecem em vendas do período
  semNome: number; // não achamos nome em lugar nenhum
  gravados: number;
  periodo: { de: string; ate: string };
}

function limpar(s: unknown): string | null {
  const v = String(s ?? "").trim();
  return v ? v : null;
}

/**
 * Sincroniza o espelho de vendedores. Analisa as vendas de `competencias`
 * (default: mês corrente) para descobrir quem está vendendo e em qual loja.
 */
export async function sincronizarVendedores(
  cli: PdvnetClient,
  competencias: string[],
): Promise<ResultadoSyncVendedores> {
  const agora = new Date().toISOString();

  // 1) Lojas ativas. A consulta ao PDV é por FILIAL (ele não sabe do agrupamento);
  // o que gravamos depois é a loja canônica do grupo.
  const lojasSnap = await db.collection("pdv_stores").where("ativoSync", "==", true).get();
  const lojaIds = lojasSnap.docs.map((d) => Number(d.id)).filter((n) => Number.isFinite(n));
  const todasLojas = await db.collection("pdv_stores").get();
  const grupos = construirGrupos(
    todasLojas.docs.map((d) => ({ id: Number(d.id), ...(d.data() as object) }) as LojaBruta),
  );
  const grupoDa = (id: number | null | undefined) => canonizar(grupos, id);

  // 2) Equipe de cada loja (nome/CPF/apelido).
  const porCodigo = new Map<string, VendedorPdv>();
  let equipe = 0;
  for (const lojaId of lojaIds) {
    let lista;
    try {
      lista = await cli.listarVendedoresDaFilial(lojaId);
    } catch {
      continue; // uma filial fora do ar não derruba o resto
    }
    for (const v of lista) {
      const id = limpar(v.Codigo);
      if (!id) continue;
      equipe++;
      const atual = porCodigo.get(id);
      const lojas = new Set(atual?.lojas ?? []);
      const grupoLoja = grupoDa(lojaId);
      if (grupoLoja != null) lojas.add(grupoLoja);
      porCodigo.set(id, {
        id,
        nome: limpar(v.Nome) ?? atual?.nome ?? null,
        apelido: limpar(v.Apelido ?? v.NomeAmigavel) ?? atual?.apelido ?? null,
        cpf: limpar(v.Cpf)?.replace(/\D/g, "") ?? atual?.cpf ?? null,
        tipo: limpar(v.Tipo) ?? atual?.tipo ?? null,
        lojaId: atual?.lojaId ?? null,
        lojas: [...lojas].sort((a, b) => a - b),
        inativo: atual?.inativo ?? null,
        ultimaVenda: atual?.ultimaVenda ?? null,
        totalPeriodo: atual?.totalPeriodo ?? 0,
        atualizadoEm: agora,
      });
    }
  }

  // 3) Quem realmente vendeu no período (define a loja principal).
  const comps = competencias.length ? [...competencias].sort() : [];
  const de = comps.length ? limitesDaCompetencia(comps[0]).de : "";
  const ate = comps.length ? limitesDaCompetencia(comps[comps.length - 1]).ate : "";
  const vendaPorCodigoLoja = new Map<string, Map<number, number>>();
  let comVenda = 0;
  if (de && ate) {
    const snap = await db
      .collection("sales")
      .where("dia", ">=", de)
      .where("dia", "<=", ate)
      .get();
    for (const d of snap.docs) {
      const s = d.data() as {
        vendedorId?: string | null;
        lojaId?: number | null;
        valorTotal?: number;
        dia?: string;
        cancelada?: boolean;
      };
      const id = limpar(s.vendedorId);
      if (!id || s.cancelada) continue;
      const lojaId = grupoDa(s.lojaId ?? null);
      const valor = Number(s.valorTotal) || 0;
      const atual =
        porCodigo.get(id) ??
        ({
          id,
          nome: null,
          apelido: null,
          cpf: null,
          tipo: null,
          lojaId: null,
          lojas: [],
          inativo: null,
          ultimaVenda: null,
          totalPeriodo: 0,
          atualizadoEm: agora,
        } as VendedorPdv);
      atual.totalPeriodo += valor;
      if (s.dia && (!atual.ultimaVenda || s.dia > atual.ultimaVenda)) atual.ultimaVenda = s.dia;
      if (lojaId != null && !atual.lojas.includes(lojaId)) {
        atual.lojas = [...atual.lojas, lojaId].sort((a, b) => a - b);
      }
      porCodigo.set(id, atual);
      if (lojaId != null) {
        const m = vendaPorCodigoLoja.get(id) ?? new Map<number, number>();
        m.set(lojaId, (m.get(lojaId) ?? 0) + valor);
        vendaPorCodigoLoja.set(id, m);
      }
    }
    comVenda = vendaPorCodigoLoja.size;
  }

  // Loja principal = onde mais vendeu no período.
  for (const [id, m] of vendaPorCodigoLoja) {
    const v = porCodigo.get(id);
    if (!v) continue;
    let melhor: number | null = null;
    let maior = -Infinity;
    for (const [lojaId, valor] of m) {
      if (valor > maior) {
        maior = valor;
        melhor = lojaId;
      }
    }
    v.lojaId = melhor;
  }

  // 4) Quem vendeu mas não apareceu em nenhuma equipe: busca individual.
  let semNome = 0;
  for (const v of porCodigo.values()) {
    if (v.nome) continue;
    const det = await cli.obterVendedor(v.id);
    if (det) {
      v.nome = limpar(det.Nome);
      v.cpf = limpar(det.CPF)?.replace(/\D/g, "") ?? null;
      v.inativo = det.Inativo ?? null;
      if (v.lojaId == null && det.LojaId != null) v.lojaId = grupoDa(det.LojaId);
    }
    if (!v.nome) semNome++;
  }

  // 5) Grava.
  let batch = db.batch();
  let ops = 0;
  let gravados = 0;
  for (const v of porCodigo.values()) {
    v.totalPeriodo = Math.round(v.totalPeriodo * 100) / 100;
    batch.set(db.collection("pdv_sellers").doc(v.id), { ...v, origem: "pdvnet" }, { merge: true });
    ops++;
    gravados++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  await db.collection("pdv_sync_state").doc("vendedores").set(
    { ultimaSync: agora, lojas: lojaIds.length, vendedores: gravados, semNome, periodo: { de, ate } },
    { merge: true },
  );

  return { lojas: lojaIds.length, equipe, comVenda, semNome, gravados, periodo: { de, ate } };
}
