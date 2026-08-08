"use client";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JsBarcode from "jsbarcode";

// Gera um DANFE (representação em PDF) a partir do XML completo (procNFe).
// Não é o layout oficial pixel-a-pixel, mas contém os elementos essenciais:
// emitente, destinatário, chave + código de barras, itens, totais e duplicatas.

function el(root: Element | Document, tag: string): Element | null {
  return root.getElementsByTagName(tag)[0] ?? null;
}
function txt(root: Element | Document | null, tag: string): string {
  if (!root) return "";
  return el(root, tag)?.textContent?.trim() ?? "";
}
function moeda(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function cnpjMask(d: string): string {
  const s = (d || "").replace(/\D/g, "");
  return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d;
}
function dataBR(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function barcodeDataUrl(chave: string): string | null {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, chave, { format: "CODE128C", displayValue: false, height: 45, width: 1.4, margin: 0 });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export function gerarDanfe(xml: string, nomeArquivo: string): void {
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const infNFe = el(dom, "infNFe");
  const chave = (infNFe?.getAttribute("Id") ?? "").replace(/^NFe/, "");
  const ide = el(dom, "ide");
  const emit = el(dom, "emit");
  const dest = el(dom, "dest");
  const total = el(dom, "ICMSTot");
  const enderEmit = el(emit ?? dom, "enderEmit");
  const enderDest = el(dest ?? dom, "enderDest");
  const dets = Array.from(dom.getElementsByTagName("det"));
  const dups = Array.from(dom.getElementsByTagName("dup"));

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 8;
  let y = M;

  // Cabeçalho
  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text("DANFE", M, y + 5);
  doc.setFontSize(8).setFont("helvetica", "normal");
  doc.text("Documento Auxiliar da Nota Fiscal Eletrônica", M, y + 10);
  const tpNF = txt(ide, "tpNF");
  doc.text(`${tpNF === "0" ? "0 - ENTRADA" : "1 - SAÍDA"}`, M, y + 14);
  doc.setFont("helvetica", "bold").setFontSize(10);
  doc.text(`NF-e nº ${txt(ide, "nNF")}  Série ${txt(ide, "serie")}`, W - M, y + 5, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(8);
  doc.text(`Emissão: ${dataBR(txt(ide, "dhEmi"))}`, W - M, y + 10, { align: "right" });
  doc.text(`Modelo ${txt(ide, "mod")}`, W - M, y + 14, { align: "right" });

  y += 18;
  // Código de barras + chave
  const bc = barcodeDataUrl(chave);
  if (bc) doc.addImage(bc, "PNG", M, y, W - 2 * M, 12);
  y += 13;
  doc.setFontSize(7).setFont("helvetica", "normal");
  doc.text("CHAVE DE ACESSO", W / 2, y, { align: "center" });
  doc.setFont("courier", "bold").setFontSize(8);
  doc.text(chave.replace(/(\d{4})/g, "$1 ").trim(), W / 2, y + 4, { align: "center" });
  y += 7;
  doc.setFont("helvetica", "normal").setFontSize(7);
  doc.text(`Natureza da operação: ${txt(ide, "natOp")}`, M, y);
  doc.text(`Protocolo: ${txt(dom, "nProt")}`, W - M, y, { align: "right" });
  y += 4;
  doc.line(M, y, W - M, y);
  y += 4;

  // Emitente
  doc.setFont("helvetica", "bold").setFontSize(8);
  doc.text("EMITENTE", M, y);
  doc.setFont("helvetica", "normal");
  doc.text(txt(emit, "xNome"), M, y + 4);
  doc.setFontSize(7);
  const eEnd = `${txt(enderEmit, "xLgr")}, ${txt(enderEmit, "nro")} - ${txt(enderEmit, "xBairro")} - ${txt(enderEmit, "xMun")}/${txt(enderEmit, "UF")}`;
  doc.text(eEnd, M, y + 8);
  doc.text(`CNPJ: ${cnpjMask(txt(emit, "CNPJ"))}   IE: ${txt(emit, "IE")}`, M, y + 11);
  y += 15;

  // Destinatário
  doc.setFont("helvetica", "bold").setFontSize(8);
  doc.text("DESTINATÁRIO", M, y);
  doc.setFont("helvetica", "normal");
  doc.text(txt(dest, "xNome"), M, y + 4);
  doc.setFontSize(7);
  const dEnd = `${txt(enderDest, "xLgr")}, ${txt(enderDest, "nro")} - ${txt(enderDest, "xMun")}/${txt(enderDest, "UF")}`;
  doc.text(dEnd, M, y + 8);
  doc.text(`CNPJ/CPF: ${cnpjMask(txt(dest, "CNPJ") || txt(dest, "CPF"))}`, M, y + 11);
  y += 15;

  // Itens
  const body = dets.map((d) => {
    const prod = el(d, "prod");
    return [
      txt(prod, "cProd"),
      txt(prod, "xProd"),
      txt(prod, "NCM"),
      txt(prod, "CFOP"),
      txt(prod, "uCom"),
      moeda(txt(prod, "qCom")),
      moeda(txt(prod, "vUnCom")),
      moeda(txt(prod, "vProd")),
    ];
  });
  autoTable(doc, {
    startY: y,
    head: [["Código", "Descrição", "NCM", "CFOP", "Un", "Qtd", "V.Unit", "V.Total"]],
    body,
    styles: { fontSize: 6.5, cellPadding: 1 },
    headStyles: { fillColor: [11, 61, 46], fontSize: 6.5 },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 16 },
      3: { cellWidth: 12 },
      4: { cellWidth: 8 },
      5: { cellWidth: 14, halign: "right" },
      6: { cellWidth: 16, halign: "right" },
      7: { cellWidth: 18, halign: "right" },
    },
    margin: { left: M, right: M },
  });

  const tabela = doc as unknown as { lastAutoTable?: { finalY: number } };
  let afterY: number = tabela.lastAutoTable?.finalY ?? y + 40;
  afterY += 5;

  // Totais
  doc.setFontSize(8).setFont("helvetica", "bold");
  doc.text("TOTAIS", M, afterY);
  doc.setFont("helvetica", "normal").setFontSize(7);
  const linhaTot = [
    `Produtos: R$ ${moeda(txt(total, "vProd"))}`,
    `Frete: R$ ${moeda(txt(total, "vFrete"))}`,
    `Desconto: R$ ${moeda(txt(total, "vDesc"))}`,
    `ICMS: R$ ${moeda(txt(total, "vICMS"))}`,
  ];
  doc.text(linhaTot.join("    "), M, afterY + 4);
  doc.setFont("helvetica", "bold").setFontSize(10);
  doc.text(`VALOR TOTAL DA NOTA: R$ ${moeda(txt(total, "vNF"))}`, W - M, afterY + 4, { align: "right" });
  afterY += 10;

  // Duplicatas
  if (dups.length) {
    doc.setFont("helvetica", "bold").setFontSize(8);
    doc.text("FATURA / DUPLICATAS", M, afterY);
    afterY += 4;
    autoTable(doc, {
      startY: afterY,
      head: [["Parcela", "Vencimento", "Valor"]],
      body: dups.map((d) => [txt(d, "nDup"), dataBR(txt(d, "dVenc")), `R$ ${moeda(txt(d, "vDup"))}`]),
      styles: { fontSize: 7, cellPadding: 1 },
      headStyles: { fillColor: [11, 61, 46] },
      columnStyles: { 2: { halign: "right" } },
      margin: { left: M, right: M },
      tableWidth: 90,
    });
    afterY = (tabela.lastAutoTable?.finalY ?? afterY) + 6;
  }

  // Informações complementares
  const infCpl = txt(dom, "infCpl");
  if (infCpl) {
    doc.setFont("helvetica", "bold").setFontSize(7);
    doc.text("INFORMAÇÕES COMPLEMENTARES", M, afterY);
    doc.setFont("helvetica", "normal");
    const linhas = doc.splitTextToSize(infCpl, W - 2 * M);
    doc.text(linhas, M, afterY + 4);
  }

  doc.save(nomeArquivo);
}
