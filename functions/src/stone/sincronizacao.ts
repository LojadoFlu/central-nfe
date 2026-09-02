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

/** Dias de `de` até `ate`, inclusive, em ordem. */
export function diasDoPeriodo(de: string, ate: string): string[] {
  const out: string[] = [];
  const d = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (d <= fim && out.length < 120) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
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
    iniciadorKey: p.iniciadorKey,
    parcela: p.parcela,
    parcelas: p.parcelas,
    bruto: p.bruto,
    liquido: p.liquido,
    taxa: p.taxa,
    autorizacao: p.autorizacao,
    serialPos: p.serialPos,
    bandeiraId: p.bandeiraId,
    cartao: p.cartao,
    entryMode: p.entryMode,
    autorizadoEm: p.autorizadoEm,
    capturadoEm: p.capturadoEm,
    /** Dia da venda, para casar com o que o PDV registrou. */
    diaVenda: (p.capturadoEm ?? p.autorizadoEm ?? "").slice(0, 10) || null,
    atualizadoEm: new Date().toISOString(),
  };
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
    for (const p of [...c.capturadas, ...c.liquidadas]) {
      if (!p.transacaoKey) continue;
      batch.set(
        db.collection("stone_recebiveis").doc(idDaParcela(opc.stoneCode, p)),
        docDaParcela(opc.empresaId, opc.stoneCode, ref, p),
        { merge: true },
      );
      ops++;
      parcelas++;
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
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
