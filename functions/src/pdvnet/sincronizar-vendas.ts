// Ingestão de vendas do PDVnet → sales + sale_payments + card_receivables.
// Uma venda mista vira N recebimentos; cada parcela de cartão vira 1 recebível
// (com taxa/líquido/data reais). Escopo: lojas de varejo ativas (heurística FLU).

import { db } from "../lib/base";
import { PdvnetClient } from "./client";
import type { PdvVenda, PdvLoja } from "./types";

/** Heurística de "loja de varejo ativa": FLU física, sem matriz/estoque/escritório/inativa. */
export function ehVarejo(l: PdvLoja): boolean {
  const nome = (l.NomeFantasia || l.RazaoSocial || "").toUpperCase();
  if (l.Inativa) return false;
  if (!/^FLU\b/.test(nome)) return false;
  return !/(INATIVA|NAOUSAR|FECHADA|ESTOQUE|ESCRITORIO|\bMTZ\b|NAO USAR)/.test(nome);
}

/** Puxa /lojas e materializa em pdv_stores (preserva empresaId/ativoSync já definidos). */
export async function materializarLojas(cli: PdvnetClient): Promise<Map<number, { nome: string; empresaId: string | null }>> {
  const lojas = await cli.listarLojas();
  const now = new Date().toISOString();
  const batch = db.batch();
  const ativos = new Map<number, { nome: string; empresaId: string | null }>();
  for (const l of lojas) {
    const varejo = ehVarejo(l);
    const ref = db.collection("pdv_stores").doc(String(l.Id));
    const existente = (await ref.get()).data() as { empresaId?: string | null; ativoSync?: boolean } | undefined;
    const empresaId = existente?.empresaId ?? null;
    // ativoSync: respeita escolha manual; senão default = varejo.
    const ativoSync = existente?.ativoSync ?? varejo;
    batch.set(
      ref,
      {
        id: l.Id,
        nome: l.NomeFantasia || l.RazaoSocial || `Loja ${l.Id}`,
        redeId: l.RedeId ?? null,
        inativa: !!l.Inativa,
        varejo,
        ativoSync,
        empresaId,
        atualizadoEm: now,
      },
      { merge: true },
    );
    if (ativoSync) ativos.set(l.Id, { nome: l.NomeFantasia || l.RazaoSocial || `Loja ${l.Id}`, empresaId });
  }
  await batch.commit();
  return ativos;
}

const FORMAS: { key: string; campo: keyof PdvVenda }[] = [
  { key: "dinheiro", campo: "ValorDinheiro" },
  { key: "pix", campo: "ValorPix" },
  { key: "cartaoDebito", campo: "ValorCartaoDebito" },
  { key: "cartaoParcelado", campo: "ValorCartaoParcelado" },
  { key: "cartaoRotativo", campo: "ValorCartaoRotativo" },
  { key: "crediario", campo: "ValorCrediario" },
  { key: "cheque", campo: "ValorCheque" },
  { key: "vale", campo: "ValorVale" },
  { key: "duplicata", campo: "ValorDuplicata" },
];

export interface ResultadoSyncVendas {
  vendas: number;
  recebimentos: number;
  recebiveis: number;
  lojas: number;
  totalVendido: number;
  totalRecebiveis: number;
  totalLiquido: number;
  porForma: Record<string, number>;
}

/** Sincroniza vendas de [inicio, fim] (yyyy-MM-dd) das lojas ativas. */
export async function sincronizarVendas(
  cli: PdvnetClient,
  inicio: string,
  fim: string,
): Promise<ResultadoSyncVendas> {
  const ativos = await materializarLojas(cli);
  let vendasN = 0;
  let recebN = 0;
  let recebiveisN = 0;
  let totalVendido = 0;
  let totalRecebiveis = 0;
  let totalLiquido = 0;
  const porForma: Record<string, number> = {};

  await cli.percorrerVendas(inicio, fim, async (lote) => {
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; }
    };
    for (const v of lote) {
      const loja = v.LojaId != null ? ativos.get(v.LojaId) : undefined;
      if (!loja) continue; // fora do escopo (loja não-ativa)
      const now = new Date().toISOString();
      const dia = (v.DataHora ?? "").slice(0, 10);
      const cancelada = !!v.Inativa;
      const docFiscal = v.DocumentosFiscais?.[0];

      batch.set(
        db.collection("sales").doc(v.Id),
        {
          id: v.Id,
          lojaId: v.LojaId ?? null,
          lojaNome: loja.nome,
          empresaId: loja.empresaId,
          dataHora: v.DataHora ?? null,
          dia,
          valorTotal: v.ValorTotal ?? 0,
          valorProdutos: v.ValorProdutos ?? null,
          valorDesconto: v.ValorDesconto ?? null,
          cancelada,
          vendedorId: v.VendedorId ?? null,
          clienteCPF: v.ClienteCPF ?? null,
          docChave: docFiscal?.Chave ?? null,
          docTipo: docFiscal?.TipoDocumento ?? null,
          qtdItens: v.Itens?.length ?? 0,
          origem: "pdvnet",
          atualizadoEm: now,
        },
        { merge: true },
      );
      ops++;
      vendasN++;
      if (!cancelada) totalVendido += v.ValorTotal ?? 0;

      if (!cancelada) {
        // Recebimentos por forma de pagamento (não-zero).
        for (const f of FORMAS) {
          const valor = Number(v[f.campo] ?? 0);
          if (!valor) continue;
          porForma[f.key] = (porForma[f.key] ?? 0) + valor;
          batch.set(
            db.collection("sale_payments").doc(`${v.Id}_${f.key}`),
            {
              vendaId: v.Id, lojaId: v.LojaId ?? null, empresaId: loja.empresaId,
              dia, dataHora: v.DataHora ?? null, forma: f.key, valor, origem: "pdvnet", atualizadoEm: now,
            },
            { merge: true },
          );
          ops++;
          recebN++;
        }
        // Recebíveis de cartão (parcelas) — taxa/líquido/data reais.
        for (const p of v.ParcelasCartao ?? []) {
          if (p.Inativa) continue;
          const seq = p.Sequencial ?? 0;
          totalRecebiveis += p.Valor ?? 0;
          totalLiquido += p.Liquido ?? p.Valor ?? 0;
          batch.set(
            db.collection("card_receivables").doc(`${v.Id}_${seq}`),
            {
              vendaId: v.Id, lojaId: v.LojaId ?? p.LojaId ?? null, empresaId: loja.empresaId,
              cartaoId: p.CartaoId ?? null,
              descricaoCartao: p.DescricaoCartao ?? null,
              valor: p.Valor ?? 0,
              taxaPct: p.ParcentualTaxa ?? null,
              liquido: p.Liquido ?? null,
              parcela: p.Parcela ?? 1,
              dataVencimento: p.DataVencimento ?? null,
              dataLiquidacao: p.DataLiquidacao ?? null,
              nsu: p.NSU || null,
              autorizacao: p.CodigoAutorizacao || null,
              tef: !!p.TEF,
              status: "previsto",
              conciliado: false,
              origem: "pdvnet",
              atualizadoEm: now,
            },
            { merge: true },
          );
          ops++;
          recebiveisN++;
        }
      }
      if (ops >= 400) await flush();
    }
    await flush();
  });

  const now = new Date().toISOString();
  await db.collection("pdv_sync_state").doc("vendas").set(
    {
      ultimaSync: now, periodoInicio: inicio, periodoFim: fim,
      vendas: vendasN, recebimentos: recebN, recebiveis: recebiveisN, lojas: ativos.size,
      totalVendido, totalRecebiveis, totalLiquido, porForma,
    },
    { merge: true },
  );

  return {
    vendas: vendasN, recebimentos: recebN, recebiveis: recebiveisN, lojas: ativos.size,
    totalVendido, totalRecebiveis, totalLiquido, porForma,
  };
}
