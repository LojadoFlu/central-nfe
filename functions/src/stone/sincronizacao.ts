// Ingestão do arquivo diário da Stone → Storage (cru) + `stone_recebiveis`.
//
// Uma parcela aparece duas vezes em dias diferentes: prevista no dia da venda e
// paga no dia do crédito. A gravação é por transação + parcela, com merge — o
// segundo encontro completa o primeiro (data do pagamento, taxa em reais,
// antecipação) em vez de criar outro registro.

import { getStorage } from "firebase-admin/storage";
import { db } from "../lib/base";
import { baixarArquivoConciliacao } from "./client";
import { idDaParcela, parseConciliacaoStone, type ParcelaStone } from "./parser";

export { diasDoPeriodo } from "./parser";

export interface ResultadoDiaStone {
  dia: string;
  httpStatus: number;
  ok: boolean;
  capturadas: number;
  liquidadas: number;
  erro: string | null;
}

export interface ResultadoSyncStone {
  empresaId: string;
  stoneCode: string;
  dias: ResultadoDiaStone[];
  parcelas: number;
}

function docDaParcela(
  empresaId: string,
  stoneCode: string,
  referenceDate: string,
  p: ParcelaStone,
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    empresaId,
    stoneCode,
    transacaoKey: p.transacaoKey,
    parcela: p.parcela,
    bruto: p.bruto,
    liquido: p.liquido,
    taxa: p.taxa,
    atualizadoEm: new Date().toISOString(),
  };
  // Identificação da venda: maquininha, bandeira, cartão, autorização. O bloco
  // da LIQUIDAÇÃO não repete esses campos — gravar o nulo dele por cima apagava
  // o que a captura tinha trazido, e a conta ficava sem saber de qual máquina
  // veio o dinheiro.
  const somenteSeVier: Record<string, unknown> = {
    iniciadorKey: p.iniciadorKey,
    parcelas: p.parcelas,
    autorizacao: p.autorizacao,
    serialPos: p.serialPos,
    bandeiraId: p.bandeiraId,
    cartao: p.cartao,
    entryMode: p.entryMode,
    autorizadoEm: p.autorizadoEm,
    capturadoEm: p.capturadoEm,
    /** Dia da venda, para casar com o que o PDV registrou. */
    diaVenda: (p.capturadoEm ?? p.autorizadoEm ?? "").slice(0, 10) || null,
  };
  for (const [k, v] of Object.entries(somenteSeVier)) if (v != null) doc[k] = v;
  if (p.origem === "capturada") {
    doc.previsaoPagamento = p.previsaoPagamento;
    doc.arquivoCaptura = referenceDate;
  } else {
    // Só a liquidação sabe o que de fato caiu — não sobrescreve a previsão com
    // nulo quando o registro chega pelo outro bloco.
    doc.pagamentoEm = p.pagamentoEm;
    doc.pagamentoOriginalEm = p.pagamentoOriginalEm;
    doc.antecipadaDe = p.antecipadaDe;
    doc.antecipada = !!p.antecipadaDe && p.antecipadaDe !== p.pagamentoEm;
    doc.paymentId = p.paymentId;
    doc.arquivoLiquidacao = referenceDate;
    doc.liquidada = true;
  }
  return doc;
}

/** Baixa e persiste os dias pedidos de UM StoneCode. */
export async function sincronizarStone(opc: {
  empresaId: string;
  stoneCode: string;
  chave: string;
  dias: string[];
}): Promise<ResultadoSyncStone> {
  const dias: ResultadoDiaStone[] = [];
  let parcelas = 0;

  for (const dia of opc.dias) {
    const r = await baixarArquivoConciliacao({
      stoneCode: opc.stoneCode,
      data: dia,
      chave: opc.chave,
      layout: "XML2_4",
    });

    if (!r.xml) {
      dias.push({
        dia,
        httpStatus: r.httpStatus,
        ok: false,
        capturadas: 0,
        liquidadas: 0,
        erro: r.erro?.slice(0, 200) ?? null,
      });
      // 429 é limite de consumo: parar aqui evita transformar um erro em vários.
      if (r.httpStatus === 429) break;
      continue;
    }

    // O arquivo cru fica guardado: reprocessar o parser depois não custa
    // consulta nova, e a Stone só deixa baixar 7 vezes por hora.
    const caminho = `stone/${opc.stoneCode}/${dia.replace(/-/g, "")}.xml`;
    await getStorage()
      .bucket()
      .file(caminho)
      .save(Buffer.from(r.xml, "utf8"), { contentType: "application/xml", resumable: false });

    const c = parseConciliacaoStone(r.xml);
    const ref = c.cabecalho.referenceDate ?? dia;

    let batch = db.batch();
    let ops = 0;
    const grava = (id: string, dados: Record<string, unknown>) => {
      batch.set(db.collection("stone_recebiveis").doc(id), dados, { merge: true });
      ops++;
      parcelas++;
    };
    for (const p of [...c.capturadas, ...c.liquidadas]) {
      if (!p.transacaoKey) continue;
      grava(idDaParcela(opc.stoneCode, p), docDaParcela(opc.empresaId, opc.stoneCode, ref, p));
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    // Cancelamento: a Stone devolve ao cliente e COBRA do lojista. Entra como
    // valor negativo na data da cobrança — é a única coisa que tira dinheiro da
    // conta, e sem ela a agenda fica acima do banco.
    for (const x of c.cancelamentos) {
      if (!x.transacaoKey || !x.cobrado) continue;
      grava(`${opc.stoneCode}_${x.transacaoKey}_canc_${x.operationKey || ref}`, {
        empresaId: opc.empresaId,
        stoneCode: opc.stoneCode,
        tipo: "cancelamento",
        transacaoKey: x.transacaoKey,
        bruto: -Math.abs(x.devolvido),
        liquido: -Math.abs(x.cobrado),
        taxa: 0,
        pagamentoEm: x.cobradoEm,
        canceladoEm: x.canceladoEm,
        paymentId: x.paymentId,
        liquidada: true,
        arquivoLiquidacao: ref,
        atualizadoEm: new Date().toISOString(),
      });
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    // Eventos (balanceamento de saldo, cobrança, ajuste). Costumam vir aos
    // pares e se anular; guardados porque quando NÃO se anulam, explicam
    // diferença.
    for (const [i, e] of c.eventos.entries()) {
      if (!e.valor) continue;
      grava(`${opc.stoneCode}_evt_${ref}_${e.eventId ?? i}_${e.valor > 0 ? "c" : "d"}_${i}`, {
        empresaId: opc.empresaId,
        stoneCode: opc.stoneCode,
        tipo: "evento",
        descricao: e.descricao,
        bruto: e.valor,
        liquido: e.valor,
        taxa: 0,
        pagamentoEm: e.data,
        liquidada: true,
        arquivoLiquidacao: ref,
        atualizadoEm: new Date().toISOString(),
      });
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();

    await db.collection("stone_sync_state").doc(`${opc.stoneCode}_${dia}`).set(
      {
        empresaId: opc.empresaId,
        stoneCode: opc.stoneCode,
        dia,
        caminho,
        capturadas: c.capturadas.length,
        liquidadas: c.liquidadas.length,
        cancelamentos: c.cancelamentos.length,
        eventos: c.eventos.length,
        trailer: c.trailer,
        atualizadoEm: new Date().toISOString(),
      },
      { merge: true },
    );

    dias.push({
      dia,
      httpStatus: r.httpStatus,
      ok: true,
      capturadas: c.capturadas.length,
      liquidadas: c.liquidadas.length,
      erro: null,
    });
  }

  return { empresaId: opc.empresaId, stoneCode: opc.stoneCode, dias, parcelas };
}
