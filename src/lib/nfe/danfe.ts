"use client";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JsBarcode from "jsbarcode";

// DANFE em layout próximo do padrão oficial (Manual do DANFE): canhoto,
// cabeçalho com emitente/DANFE/chave, destinatário, fatura, cálculo do imposto,
// produtos e dados adicionais. Gerado a partir do XML completo (procNFe).

function el(root: Element | Document, tag: string): Element | null {
  return root.getElementsByTagName(tag)[0] ?? null;
}
function txt(root: Element | Document | null, tag: string): string {
  if (!root) return "";
  return el(root, tag)?.textContent?.trim() ?? "";
}
function moeda(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return typeof v === "string" && v ? v : "0,00";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function qtd(v: string | null): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : v ?? "";
}
function cnpjMask(d: string): string {
  const s = (d || "").replace(/\D/g, "");
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
}
function cep(d: string): string {
  const s = (d || "").replace(/\D/g, "");
  return s.length === 8 ? s.replace(/^(\d{5})(\d{3})$/, "$1-$2") : d;
}
function dataBR(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function horaBR(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

export function gerarDanfe(xml: string, nomeArquivo: string): void {
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const infNFe = el(dom, "infNFe");
  const chave = (infNFe?.getAttribute("Id") ?? "").replace(/^NFe/, "");
  const ide = el(dom, "ide");
  const emit = el(dom, "emit");
  const dest = el(dom, "dest");
  const total = el(dom, "ICMSTot");
  const transp = el(dom, "transp");
  const vol = el(dom, "vol");
  const enderEmit = el(emit ?? dom, "enderEmit");
  const enderDest = el(dest ?? dom, "enderDest");
  const dets = Array.from(dom.getElementsByTagName("det"));
  const dups = Array.from(dom.getElementsByTagName("dup"));

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 6;
  const R = 210 - M; // margem direita
  const Wt = R - M; // largura útil
  const CX = 210 / 2;

  const rect = (x: number, y: number, w: number, h: number) => {
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h);
  };
  const cap = (x: number, y: number, t: string) => {
    doc.setFont("helvetica", "normal").setFontSize(5);
    doc.text(t, x + 1, y + 2.4);
  };
  const val = (
    x: number,
    y: number,
    w: number,
    t: string,
    size = 8,
    bold = false,
    align: "left" | "center" | "right" = "left",
  ) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    const px = align === "right" ? x + w - 1 : align === "center" ? x + w / 2 : x + 1;
    doc.text(t ?? "", px, y, { align, maxWidth: w - 2 });
  };
  // célula rotulada: caixa + label no topo + valor embaixo
  const field = (
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    opts: { size?: number; bold?: boolean; align?: "left" | "center" | "right" } = {},
  ) => {
    rect(x, y, w, h);
    cap(x, y, label);
    val(x, y + h - 1.6, w, value, opts.size ?? 8, opts.bold, opts.align ?? "left");
  };

  let y = M;

  // ---------- CANHOTO ----------
  rect(M, y, Wt, 9);
  doc.setFont("helvetica", "normal").setFontSize(5.5);
  doc.text(
    `RECEBEMOS DE ${txt(emit, "xNome").toUpperCase()} OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`,
    M + 1,
    y + 3,
    { maxWidth: Wt - 62 },
  );
  doc.line(M + Wt - 60, y, M + Wt - 60, y + 9);
  cap(M + Wt - 60, y, "DATA DE RECEBIMENTO");
  doc.line(M + Wt - 28, y + 4.5, M + Wt - 28, y + 9);
  doc.line(M + Wt - 60, y + 4.5, M + Wt, y + 4.5);
  cap(M + Wt - 28, y + 4.5, "IDENTIFICAÇÃO E ASSINATURA");
  doc.setFont("helvetica", "bold").setFontSize(7);
  doc.text(`NF-e Nº ${txt(ide, "nNF")}`, M + 1, y + 7.5);
  doc.text(`SÉRIE ${txt(ide, "serie")}`, M + 40, y + 7.5);
  y += 9;
  // linha de corte
  doc.setLineDashPattern([1, 1], 0);
  doc.line(M, y + 1.5, R, y + 1.5);
  doc.setLineDashPattern([], 0);
  y += 3.5;

  // ---------- CABEÇALHO ----------
  const hcab = 26;
  const emitW = 84;
  const danfeW = 42;
  const chaveW = Wt - emitW - danfeW;
  // Emitente
  rect(M, y, emitW, hcab);
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text(txt(emit, "xNome"), M + emitW / 2, y + 5, { align: "center", maxWidth: emitW - 4 });
  doc.setFont("helvetica", "normal").setFontSize(6.5);
  const endE = `${txt(enderEmit, "xLgr")}, ${txt(enderEmit, "nro")}`;
  doc.text(endE, M + emitW / 2, y + 10, { align: "center", maxWidth: emitW - 4 });
  doc.text(`${txt(enderEmit, "xBairro")} - ${txt(enderEmit, "xMun")}/${txt(enderEmit, "UF")}`, M + emitW / 2, y + 13.5, { align: "center", maxWidth: emitW - 4 });
  doc.text(`CEP: ${cep(txt(enderEmit, "CEP"))}  Fone: ${txt(enderEmit, "fone")}`, M + emitW / 2, y + 17, { align: "center", maxWidth: emitW - 4 });
  // Bloco DANFE
  const dx = M + emitW;
  rect(dx, y, danfeW, hcab);
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("DANFE", dx + danfeW / 2, y + 5, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(5);
  doc.text("Documento Auxiliar da", dx + danfeW / 2, y + 8, { align: "center" });
  doc.text("Nota Fiscal Eletrônica", dx + danfeW / 2, y + 10, { align: "center" });
  const tpNF = txt(ide, "tpNF");
  doc.setFontSize(6);
  doc.text("0 - ENTRADA", dx + 3, y + 14);
  doc.text("1 - SAÍDA", dx + 3, y + 17);
  rect(dx + danfeW - 8, y + 12, 5, 5);
  doc.setFont("helvetica", "bold").setFontSize(8);
  doc.text(tpNF === "0" ? "0" : "1", dx + danfeW - 5.5, y + 15.5, { align: "center" });
  doc.setFont("helvetica", "bold").setFontSize(7.5);
  doc.text(`Nº ${txt(ide, "nNF")}`, dx + danfeW / 2, y + 21, { align: "center" });
  doc.text(`SÉRIE ${txt(ide, "serie")}`, dx + danfeW / 2, y + 24.5, { align: "center" });
  // Bloco chave + barcode
  const cx = dx + danfeW;
  rect(cx, y, chaveW, hcab);
  const canvas = barcodeCanvas(chave);
  if (canvas) {
    const bcH = 11;
    const bcW = Math.min(chaveW - 4, (bcH * canvas.width) / canvas.height);
    doc.addImage(canvas.toDataURL("image/png"), "PNG", cx + (chaveW - bcW) / 2, y + 2, bcW, bcH);
  }
  cap(cx, y + 13.5, "CHAVE DE ACESSO");
  doc.setFont("courier", "bold").setFontSize(7);
  doc.text(chave.replace(/(\d{4})/g, "$1 ").trim(), cx + chaveW / 2, y + 20, { align: "center", maxWidth: chaveW - 3 });
  doc.setFont("helvetica", "normal").setFontSize(5);
  doc.text("Consulte a autenticidade em portais da SEFAZ/Nacional", cx + chaveW / 2, y + 24.5, { align: "center" });
  y += hcab;

  // Protocolo (linha)
  field(M, y, Wt, 7, "PROTOCOLO DE AUTORIZAÇÃO DE USO", `${txt(dom, "nProt")}  ${dataBR(txt(dom, "dhRecbto"))} ${horaBR(txt(dom, "dhRecbto"))}`, { size: 7, align: "center" });
  y += 7;

  // Natureza / IE / CNPJ
  field(M, y, Wt * 0.5, 7, "NATUREZA DA OPERAÇÃO", txt(ide, "natOp"), { size: 7 });
  field(M + Wt * 0.5, y, Wt * 0.28, 7, "INSCRIÇÃO ESTADUAL", txt(emit, "IE"), { size: 7 });
  field(M + Wt * 0.78, y, Wt * 0.22, 7, "CNPJ", cnpjMask(txt(emit, "CNPJ")), { size: 7 });
  y += 7;

  // ---------- DESTINATÁRIO ----------
  doc.setFont("helvetica", "bold").setFontSize(6);
  doc.text("DESTINATÁRIO / REMETENTE", M, y + 2);
  y += 3;
  field(M, y, Wt * 0.56, 7, "NOME / RAZÃO SOCIAL", txt(dest, "xNome"), { size: 7 });
  field(M + Wt * 0.56, y, Wt * 0.28, 7, "CNPJ / CPF", cnpjMask(txt(dest, "CNPJ") || txt(dest, "CPF")), { size: 7 });
  field(M + Wt * 0.84, y, Wt * 0.16, 7, "DATA EMISSÃO", dataBR(txt(ide, "dhEmi")), { size: 7 });
  y += 7;
  field(M, y, Wt * 0.56, 7, "ENDEREÇO", `${txt(enderDest, "xLgr")}, ${txt(enderDest, "nro")} - ${txt(enderDest, "xBairro")}`, { size: 7 });
  field(M + Wt * 0.56, y, Wt * 0.18, 7, "MUNICÍPIO", txt(enderDest, "xMun"), { size: 7 });
  field(M + Wt * 0.74, y, Wt * 0.06, 7, "UF", txt(enderDest, "UF"), { size: 7, align: "center" });
  field(M + Wt * 0.8, y, Wt * 0.2, 7, "INSCRIÇÃO ESTADUAL", txt(dest, "IE"), { size: 7 });
  y += 7;

  // ---------- FATURA / DUPLICATAS ----------
  if (dups.length) {
    doc.setFont("helvetica", "bold").setFontSize(6);
    doc.text("FATURA / DUPLICATAS", M, y + 2);
    y += 3;
    const perRow = 6;
    const cw = Wt / perRow;
    let dx2 = M;
    let rowY = y;
    dups.forEach((d, i) => {
      if (i > 0 && i % perRow === 0) {
        rowY += 8;
        dx2 = M;
      }
      field(dx2, rowY, cw, 8, `PARC ${txt(d, "nDup")}`, `${dataBR(txt(d, "dVenc"))}\nR$ ${moeda(txt(d, "vDup"))}`, { size: 6 });
      dx2 += cw;
    });
    y = rowY + 8;
  }

  // ---------- CÁLCULO DO IMPOSTO ----------
  doc.setFont("helvetica", "bold").setFontSize(6);
  doc.text("CÁLCULO DO IMPOSTO", M, y + 2);
  y += 3;
  const c6 = Wt / 6;
  field(M, y, c6, 7, "BASE CÁLC. ICMS", moeda(txt(total, "vBC")), { size: 6.5, align: "right" });
  field(M + c6, y, c6, 7, "VALOR ICMS", moeda(txt(total, "vICMS")), { size: 6.5, align: "right" });
  field(M + 2 * c6, y, c6, 7, "BC ICMS ST", moeda(txt(total, "vBCST")), { size: 6.5, align: "right" });
  field(M + 3 * c6, y, c6, 7, "VALOR ICMS ST", moeda(txt(total, "vST")), { size: 6.5, align: "right" });
  field(M + 4 * c6, y, c6, 7, "V. TOTAL PROD.", moeda(txt(total, "vProd")), { size: 6.5, align: "right" });
  field(M + 5 * c6, y, c6, 7, "V. APROX TRIB.", moeda(txt(total, "vTotTrib")), { size: 6.5, align: "right" });
  y += 7;
  field(M, y, c6, 7, "VALOR FRETE", moeda(txt(total, "vFrete")), { size: 6.5, align: "right" });
  field(M + c6, y, c6, 7, "VALOR SEGURO", moeda(txt(total, "vSeg")), { size: 6.5, align: "right" });
  field(M + 2 * c6, y, c6, 7, "DESCONTO", moeda(txt(total, "vDesc")), { size: 6.5, align: "right" });
  field(M + 3 * c6, y, c6, 7, "OUTRAS DESP.", moeda(txt(total, "vOutro")), { size: 6.5, align: "right" });
  field(M + 4 * c6, y, c6, 7, "VALOR IPI", moeda(txt(total, "vIPI")), { size: 6.5, align: "right" });
  rect(M + 5 * c6, y, c6, 7);
  cap(M + 5 * c6, y, "VALOR TOTAL DA NOTA");
  val(M + 5 * c6, y + 5.5, c6, `R$ ${moeda(txt(total, "vNF"))}`, 7.5, true, "right");
  y += 7;

  // ---------- PRODUTOS ----------
  doc.setFont("helvetica", "bold").setFontSize(6);
  doc.text("DADOS DOS PRODUTOS / SERVIÇOS", M, y + 2);
  y += 3;
  const body = dets.map((d) => {
    const prod = el(d, "prod");
    const imp = el(d, "imposto");
    const icms = imp ? imp.getElementsByTagName("ICMS")[0] : null;
    const ipi = imp ? el(imp, "IPI") : null;
    const cst = icms ? txt(icms, "CST") || txt(icms, "CSOSN") : "";
    return [
      txt(prod, "cProd"),
      txt(prod, "xProd"),
      txt(prod, "NCM"),
      cst,
      txt(prod, "CFOP"),
      txt(prod, "uCom"),
      qtd(txt(prod, "qCom")),
      moeda(txt(prod, "vUnCom")),
      moeda(txt(prod, "vProd")),
      moeda(icms ? txt(icms, "vBC") : ""),
      moeda(icms ? txt(icms, "vICMS") : ""),
      moeda(ipi ? txt(ipi, "vIPI") : ""),
      icms ? txt(icms, "pICMS") : "",
    ];
  });
  autoTable(doc, {
    startY: y,
    head: [["CÓD", "DESCRIÇÃO", "NCM", "CST", "CFOP", "UN", "QTD", "V.UNIT", "V.TOTAL", "BC ICMS", "V.ICMS", "V.IPI", "AL.ICMS"]],
    body,
    theme: "grid",
    styles: { fontSize: 5.6, cellPadding: 0.6, lineColor: [0, 0, 0], lineWidth: 0.1, overflow: "linebreak" },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontSize: 5.4, halign: "center" },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 13 },
      3: { cellWidth: 8, halign: "center" },
      4: { cellWidth: 9, halign: "center" },
      5: { cellWidth: 7, halign: "center" },
      6: { cellWidth: 12, halign: "right" },
      7: { cellWidth: 13, halign: "right" },
      8: { cellWidth: 14, halign: "right" },
      9: { cellWidth: 13, halign: "right" },
      10: { cellWidth: 12, halign: "right" },
      11: { cellWidth: 11, halign: "right" },
      12: { cellWidth: 10, halign: "right" },
    },
    margin: { left: M, right: M },
  });
  const tabela = doc as unknown as { lastAutoTable?: { finalY: number } };
  let afterY = (tabela.lastAutoTable?.finalY ?? y + 30) + 2;

  // ---------- DADOS ADICIONAIS ----------
  const infCpl = txt(dom, "infCpl");
  rect(M, afterY, Wt, 20);
  cap(M, afterY, "DADOS ADICIONAIS / INFORMAÇÕES COMPLEMENTARES");
  if (infCpl) {
    doc.setFont("helvetica", "normal").setFontSize(6);
    const linhas = doc.splitTextToSize(infCpl, Wt - 4);
    doc.text(linhas.slice(0, 8), M + 1.5, afterY + 5);
  }

  abrirOuSalvar(doc, nomeArquivo);
}

function barcodeCanvas(chave: string): HTMLCanvasElement | null {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, chave, { format: "CODE128C", displayValue: false, height: 90, width: 3, margin: 0 });
    return canvas;
  } catch {
    return null;
  }
}

function abrirOuSalvar(doc: jsPDF, nomeArquivo: string): void {
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
