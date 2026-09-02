// PIX da Stone — o fluxo é diferente do cartão e vale entender antes de mexer:
//
//   1. pedimos o arquivo de UM dia   → POST .../conciliation-file/pix/{data}
//      responde 202 na hora; o arquivo leva até ~30 min para ficar pronto, e só
//      pode ser pedido depois das 3h do dia seguinte;
//   2. quando fica pronto, a Stone chama o NOSSO webhook com uma URL assinada;
//   3. baixamos o CSV dessa URL e materializamos.
//
// O que este arquivo traz e o do cartão não: o MEIO DE CAPTURA (maquininha,
// link de pagamento, QR estático) e o NOME DO PAGADOR. É com isso que se
// descobre que a venda registrada no PDV como cartão foi, na verdade, paga por
// link em PIX — hoje ela sobra de um lado e falta do outro.

const BASE = "https://conciliation.stone.com.br";

function auth(chave: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${chave}:`).toString("base64")}`,
    "x-user-type": "client",
    "Content-Type": "application/json",
  };
}

/** Pede o arquivo de PIX de um dia. Responde 202 e avisa depois, por webhook. */
export async function solicitarArquivoPix(opc: {
  documento: string; // CNPJ, só dígitos
  data: string; // AAAA-MM-DD
  chave: string;
}): Promise<{ httpStatus: number; aceito: boolean; corpo: string }> {
  const url = `${BASE}/v2/merchant/${encodeURIComponent(opc.documento)}/conciliation-file/pix/${opc.data}`;
  const res = await fetch(url, { method: "POST", headers: auth(opc.chave) });
  const corpo = (await res.text()).slice(0, 400);
  return { httpStatus: res.status, aceito: res.status === 202 || res.ok, corpo };
}

/**
 * Cadastra (ou atualiza) o webhook. O cadastro é por ClientId — um só por
 * conta, não por loja.
 *
 * `headers` viaja de volta em toda notificação: é por onde mandamos um segredo
 * nosso, já que a Stone não assina a chamada. Sem isso, qualquer um que
 * descobrisse a URL poderia mandar uma notificação falsa.
 */
export async function cadastrarWebhook(opc: {
  chave: string;
  url: string;
  headers?: Record<string, string>;
  atualizar?: boolean;
}): Promise<{ httpStatus: number; ok: boolean; corpo: string }> {
  const res = await fetch(`${BASE}/v2/webhook`, {
    method: opc.atualizar ? "PUT" : "POST",
    headers: auth(opc.chave),
    body: JSON.stringify({
      url: opc.url,
      ...(opc.headers ? { headers: JSON.stringify(opc.headers) } : {}),
    }),
  });
  const corpo = (await res.text()).slice(0, 400);
  return { httpStatus: res.status, ok: res.ok, corpo };
}

// ── Leitura do CSV ──────────────────────────────────────────────────────────

export interface PixStone {
  id: string;
  status: string | null;
  criadoEm: string | null;
  valor: number;
  pago: number;
  cancelado: number;
  taxa: number;
  /** Meio de captura: é ele que separa maquininha de link de pagamento. */
  captura: string | null;
  serialPos: string | null;
  pagador: string | null;
  documentoPagador: string | null;
  instituicaoPagador: string | null;
}

/**
 * CSV simples com aspas. Varredura caractere a caractere em vez de regex: com
 * regex, campo vazio e aspas viram armadilha silenciosa — a primeira versão
 * inventava colunas em branco no meio da linha.
 */
export function lerCsv(texto: string): Record<string, string>[] {
  const linhas = texto.replace(/^\ufeff/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length === 0) return [];
  const sep = (linhas[0].match(/;/g)?.length ?? 0) > (linhas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const campos = (linha: string): string[] => {
    const out: string[] = [];
    let atual = "";
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i];
      if (ch === '"') {
        // "" dentro de aspas é uma aspa literal
        if (aspas && linha[i + 1] === '"') { atual += '"'; i++; }
        else aspas = !aspas;
      } else if (ch === sep && !aspas) {
        out.push(atual.trim());
        atual = "";
      } else {
        atual += ch;
      }
    }
    out.push(atual.trim());
    return out;
  };
  const cab = campos(linhas[0]);
  return linhas.slice(1).map((l) => {
    const v = campos(l);
    const o: Record<string, string> = {};
    cab.forEach((c, i) => (o[c] = v[i] ?? ""));
    return o;
  });
}

function n(v: string | undefined): number {
  if (!v) return 0;
  const x = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  const r = Number(x);
  return Number.isFinite(r) ? Math.round(r * 100) / 100 : 0;
}

/**
 * Converte as linhas do CSV. Os nomes das colunas vêm da documentação; o que
 * não vier fica nulo em vez de derrubar a importação — arquivo de terceiro
 * muda, e é melhor perder um campo do que perder o dia inteiro.
 */
export function parsePixCsv(texto: string): PixStone[] {
  return lerCsv(texto)
    .map((r) => ({
      id: r["id"] ?? "",
      status: r["status"] || null,
      criadoEm: r["created_at"] || null,
      valor: n(r["amount"]),
      pago: n(r["pix_transaction__paid_amount"]),
      cancelado: n(r["pix_transaction__canceled_amount"]),
      taxa: n(r["pix_transaction__fee_amount"]),
      captura: r["pix_transaction__terminal__type"] || null,
      serialPos: r["pix_transaction__terminal__serial_number"] || null,
      pagador: r["pix_transaction__payer__name"] || null,
      documentoPagador: r["pix_transaction__payer__document"] || null,
      instituicaoPagador: r["pix_transaction__payer__institution_name"] || null,
    }))
    .filter((x) => x.id);
}
