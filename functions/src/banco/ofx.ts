// Parser de extrato bancário OFX (SGML 1.x — ex.: Stone, charset Windows-1252).
// Tolerante a tags de folha sem fechamento. Categoriza pela natureza do MEMO.
// Validado contra extrato real da Stone (1164 lançamentos).

export interface TxOFX {
  fitid: string;
  tipo: string; // CREDIT | DEBIT
  data: string; // YYYY-MM-DD
  valor: number; // sinal: crédito +, débito −
  memo: string;
  categoria: string;
}
export interface ExtratoOFX {
  org: string | null;
  fid: string | null;
  curdef: string | null;
  dtStart: string | null;
  dtEnd: string | null;
  saldo: number | null;
  saldoData: string | null;
  transacoes: TxOFX[];
}

function leaf(bloco: string, tag: string): string {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`));
  return m ? m[1].trim() : "";
}
function dataOFX(s: string): string {
  const d = (s || "").replace(/[^0-9]/g, "").slice(0, 8);
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
}
/** Categoria pela natureza do MEMO (sem acento, minúsculo). Derivado do dado real. */
export function categoriaMemo(memo: string): string {
  const m = (memo || "").normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase();
  if (m.includes("pix | maquininha")) return "pix_venda";
  if (m.includes("antecipa")) return "cartao_credito";
  if (m.includes("| debito")) return "cartao_debito";
  if (m.includes("devolu")) return "devolucao";
  if (m.includes("mensalidade") || m.includes("tarifa") || m.includes("cobranca")) return "tarifa";
  if (m.includes("transfer")) return "transferencia";
  if (m.includes("pagamento")) return "pagamento";
  return "outros";
}

export function parseOFX(texto: string): ExtratoOFX {
  const balBloco = (texto.match(/<LEDGERBAL>[\s\S]*?(<\/LEDGERBAL>|$)/) || [""])[0];
  const saldoStr = leaf(balBloco, "BALAMT");
  const transacoes: TxOFX[] = [];
  const seen = new Set<string>();
  for (const b of texto.split("<STMTTRN>").slice(1)) {
    const fitid = leaf(b, "FITID");
    if (!fitid || seen.has(fitid)) continue;
    seen.add(fitid);
    const memo = leaf(b, "MEMO");
    transacoes.push({
      fitid,
      tipo: leaf(b, "TRNTYPE") || (Number(leaf(b, "TRNAMT")) < 0 ? "DEBIT" : "CREDIT"),
      data: dataOFX(leaf(b, "DTPOSTED")),
      valor: Number(leaf(b, "TRNAMT")) || 0,
      memo,
      categoria: categoriaMemo(memo),
    });
  }
  return {
    org: leaf(texto, "ORG") || null,
    fid: leaf(texto, "FID") || null,
    curdef: leaf(texto, "CURDEF") || null,
    dtStart: dataOFX(leaf(texto, "DTSTART")) || null,
    dtEnd: dataOFX(leaf(texto, "DTEND")) || null,
    saldo: saldoStr ? Number(saldoStr) : null,
    saldoData: dataOFX(leaf(balBloco, "DTASOF")) || null,
    transacoes,
  };
}
