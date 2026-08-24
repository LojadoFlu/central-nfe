// Parser de extrato bancário OFX (SGML 1.x — ex.: Stone, charset Windows-1252).
// Tolerante a tags de folha sem fechamento. Categoriza pela natureza do MEMO.
// Validado contra extrato real da Stone (1164 lançamentos).
import crypto from "node:crypto";

export interface TxOFX {
  fitid: string;
  chave: string; // dedup ESTÁVEL por conteúdo (data+valor+memo+ocorrência) — a Stone troca o FITID a cada exportação
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
  bankId: string | null;   // BANKID (banco)
  acctId: string | null;   // ACCTID (número da conta) — identifica a CONTA dentro da loja
  acctType: string | null; // ACCTTYPE
  contaId: string;         // id estável da conta (bankId+acctId), p/ permitir várias contas por loja
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
  const ocorr = new Map<string, number>(); // conteúdo → nº de ocorrências no arquivo
  for (const b of texto.split("<STMTTRN>").slice(1)) {
    const fitid = leaf(b, "FITID");
    if (fitid && seen.has(fitid)) continue; // dedup por FITID dentro do MESMO arquivo (quando existir)
    if (fitid) seen.add(fitid);
    const memo = leaf(b, "MEMO");
    const data = dataOFX(leaf(b, "DTPOSTED"));
    const valor = Number(leaf(b, "TRNAMT")) || 0;
    // Chave ESTÁVEL por conteúdo: sobrevive à troca de FITID entre exportações.
    // Ocorrência (0,1,2…) preserva lançamentos legítimos idênticos no mesmo dia.
    const conteudo = `${data}|${valor.toFixed(2)}|${memo.trim().toLowerCase()}`;
    const hash = crypto.createHash("sha1").update(conteudo).digest("hex").slice(0, 16);
    const i = ocorr.get(hash) ?? 0; ocorr.set(hash, i + 1);
    transacoes.push({
      fitid,
      chave: i ? `${hash}_${i}` : hash,
      tipo: leaf(b, "TRNTYPE") || (valor < 0 ? "DEBIT" : "CREDIT"),
      data,
      valor,
      memo,
      categoria: categoriaMemo(memo),
    });
  }
  // Identidade da CONTA (várias contas por loja): BANKID + ACCTID do bloco *ACCTFROM.
  const org = leaf(texto, "ORG") || null;
  const fid = leaf(texto, "FID") || null;
  const bankId = leaf(texto, "BANKID") || null;
  const acctId = leaf(texto, "ACCTID") || null;
  const acctType = leaf(texto, "ACCTTYPE") || null;
  // contaId estável: prefere o nº da conta; se ausente, cai para org+fid; nunca vazio.
  const semSimbolo = (s: string) => s.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/[^A-Za-z0-9]/g, "").slice(0, 48);
  const contaBruta = acctId ? `${bankId ?? ""}${acctId}` : `${org ?? ""}${fid ?? ""}`;
  const contaId = semSimbolo(contaBruta) || "principal";
  return {
    org, fid, curdef: leaf(texto, "CURDEF") || null,
    bankId, acctId, acctType, contaId,
    dtStart: dataOFX(leaf(texto, "DTSTART")) || null,
    dtEnd: dataOFX(leaf(texto, "DTEND")) || null,
    saldo: saldoStr ? Number(saldoStr) : null,
    saldoData: dataOFX(leaf(balBloco, "DTASOF")) || null,
    transacoes,
  };
}
