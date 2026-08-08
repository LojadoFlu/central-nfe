"use client";

import { jsPDF } from "jspdf";

// DANFSe — Documento Auxiliar da NFS-e (padrão nacional SNNFSe).
// Gerado do XML da NFS-e (ns http://www.sped.fazenda.gov.br/nfse).

function el(root: Element | Document, tag: string): Element | null {
  return root.getElementsByTagName(tag)[0] ?? null;
}
function txt(root: Element | Document | null, tag: string): string {
  if (!root) return "";
  return el(root, tag)?.textContent?.trim() ?? "";
}
function moeda(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0,00";
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
  const so = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (so) return `${so[3]}/${so[2]}/${so[1]}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function horaBR(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

export function gerarDanfse(xml: string, nomeArquivo: string): void {
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const infNFSe = el(dom, "infNFSe");
  const idMatch = xml.match(/Id="NFS(\d{40,60})"/);
  const chave = idMatch ? idMatch[1] : txt(dom, "chNFSe");
  const emit = el(dom, "emit");
  const enderEmit = el(emit ?? dom, "enderNac");
  const toma = el(dom, "toma");
  const enderToma = el(toma ?? dom, "end");
  const valores = el(dom, "valores"); // primeiro <valores> = nível infNFSe (BC/ISSQN/vLiq)

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 6;
  const R = 210 - M;
  const Wt = R - M;

  const rect = (x: number, y: number, w: number, h: number) => {
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h);
  };
  const cap = (x: number, y: number, t: string) => {
    doc.setFont("helvetica", "normal").setFontSize(5);
    doc.text(t, x + 1, y + 2.4);
  };
  const val = (
    x: number, y: number, w: number, t: string,
    size = 8, bold = false, align: "left" | "center" | "right" = "left",
  ) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    const px = align === "right" ? x + w - 1 : align === "center" ? x + w / 2 : x + 1;
    doc.text(t ?? "", px, y, { align, maxWidth: w - 2 });
  };
  const field = (
    x: number, y: number, w: number, h: number, label: string, value: string,
    opts: { size?: number; bold?: boolean; align?: "left" | "center" | "right" } = {},
  ) => {
    rect(x, y, w, h);
    cap(x, y, label);
    val(x, y + h - 1.6, w, value, opts.size ?? 8, opts.bold, opts.align ?? "left");
  };

  let y = M;

  // ---------- CABEÇALHO ----------
  const hcab = 26;
  const emitW = 96;
  const midW = 46;
  const chaveW = Wt - emitW - midW;

  // Prestador
  rect(M, y, emitW, hcab);
  doc.setFont("helvetica", "bold").setFontSize(8.5);
  doc.text(txt(emit, "xNome"), M + 2, y + 4.5, { maxWidth: emitW - 4 });
  doc.setFont("helvetica", "normal").setFontSize(6);
  doc.text(`CNPJ: ${cnpjMask(txt(emit, "CNPJ"))}`, M + 2, y + 9);
  doc.text(`${txt(enderEmit, "xLgr")}, ${txt(enderEmit, "nro")} - ${txt(enderEmit, "xBairro")}`, M + 2, y + 12.5, { maxWidth: emitW - 4 });
  doc.text(`${txt(dom, "xLocEmi")}/${txt(enderEmit, "UF")}  CEP: ${cep(txt(enderEmit, "CEP"))}`, M + 2, y + 16);
  doc.text(`Fone: ${txt(emit, "fone")}  ${txt(emit, "email")}`, M + 2, y + 19.5, { maxWidth: emitW - 4 });
  doc.setFont("helvetica", "bold").setFontSize(6);
  doc.text("PRESTADOR DO SERVIÇO", M + 2, y + 23.5);

  // Bloco central
  const mx = M + emitW;
  rect(mx, y, midW, hcab);
  doc.setFont("helvetica", "bold").setFontSize(9.5);
  doc.text("DANFSe", mx + midW / 2, y + 4.5, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(4.4);
  doc.text("Documento Auxiliar da NFS-e", mx + midW / 2, y + 7.5, { align: "center" });
  doc.setFontSize(6);
  doc.text(`Número: ${txt(dom, "nNFSe")}`, mx + 2, y + 11.5);
  doc.text(`Competência: ${dataBR(txt(dom, "dCompet"))}`, mx + 2, y + 14.5);
  doc.text(`Emissão: ${dataBR(txt(dom, "dhProc") || txt(dom, "dhEmi"))} ${horaBR(txt(dom, "dhProc"))}`, mx + 2, y + 17.5);
  doc.text(`Situação: ${txt(dom, "cStat") === "100" || txt(dom, "cStat") === "107" ? "Autorizada" : txt(dom, "cStat")}`, mx + 2, y + 20.5);
  doc.text(`Município: ${txt(dom, "xLocPrestacao")}`, mx + 2, y + 23.5, { maxWidth: midW - 4 });

  // Chave
  const cx = mx + midW;
  rect(cx, y, chaveW, hcab);
  cap(cx, y, "CHAVE DE ACESSO DA NFS-e");
  doc.setFont("courier", "bold").setFontSize(7.5);
  doc.text((chave || "").replace(/(\d{4})/g, "$1 ").trim(), cx + chaveW / 2, y + 9, { align: "center", maxWidth: chaveW - 3 });
  doc.setFont("helvetica", "normal").setFontSize(5);
  doc.text("Consulte a autenticidade em nfse.gov.br", cx + chaveW / 2, y + 15, { align: "center" });
  doc.text("(informe a chave de acesso acima)", cx + chaveW / 2, y + 18, { align: "center" });
  y += hcab;

  // ---------- TOMADOR ----------
  doc.setFont("helvetica", "bold").setFontSize(6);
  doc.text("TOMADOR DO SERVIÇO", M, y + 3);
  y += 4;
  field(M, y, Wt * 0.58, 7, "NOME / RAZÃO SOCIAL", txt(toma, "xNome"), { size: 7.5 });
  field(M + Wt * 0.58, y, Wt * 0.42, 7, "CNPJ / CPF", cnpjMask(txt(toma, "CNPJ") || txt(toma, "CPF")), { size: 7.5 });
  y += 7;
  field(M, y, Wt, 7, "ENDEREÇO", `${txt(enderToma, "xLgr")}, ${txt(enderToma, "nro")}${txt(enderToma, "xCpl") ? " - " + txt(enderToma, "xCpl") : ""} - ${txt(enderToma, "xBairro")}  CEP: ${cep(txt(el(enderToma ?? dom, "endNac") ?? enderToma ?? dom, "CEP"))}`, { size: 7 });
  y += 7;

  // ---------- SERVIÇO ----------
  doc.setFont("helvetica", "bold").setFontSize(6);
  doc.text("SERVIÇO PRESTADO", M, y + 3);
  y += 4;
  field(M, y, Wt * 0.5, 7, "TRIBUTAÇÃO NACIONAL", txt(dom, "xTribNac"), { size: 6.5 });
  field(M + Wt * 0.5, y, Wt * 0.3, 7, "CÓD. TRIB. NACIONAL", txt(dom, "cTribNac"), { size: 6.5 });
  field(M + Wt * 0.8, y, Wt * 0.2, 7, "MUNICÍPIO", txt(dom, "xLocPrestacao"), { size: 6.5 });
  y += 7;

  // Discriminação
  rect(M, y, Wt, 26);
  cap(M, y, "DISCRIMINAÇÃO DOS SERVIÇOS");
  doc.setFont("helvetica", "normal").setFontSize(7);
  doc.text(doc.splitTextToSize(txt(dom, "xDescServ"), Wt - 4), M + 1.5, y + 5.5);
  y += 26;

  // ---------- VALORES ----------
  doc.setFont("helvetica", "bold").setFontSize(6);
  doc.text("VALORES", M, y + 3);
  y += 4;
  const c5 = Wt / 5;
  field(M, y, c5, 8, "VALOR DO SERVIÇO", `R$ ${moeda(txt(dom, "vServ"))}`, { size: 7, align: "right" });
  field(M + c5, y, c5, 8, "BASE DE CÁLCULO", `R$ ${moeda(txt(valores, "vBC"))}`, { size: 7, align: "right" });
  field(M + 2 * c5, y, c5, 8, "ALÍQUOTA ISSQN", `${moeda(txt(valores, "pAliqAplic") || txt(dom, "pAliqAplic"))}%`, { size: 7, align: "right" });
  field(M + 3 * c5, y, c5, 8, "VALOR ISSQN", `R$ ${moeda(txt(valores, "vISSQN"))}`, { size: 7, align: "right" });
  rect(M + 4 * c5, y, c5, 8);
  cap(M + 4 * c5, y, "VALOR LÍQUIDO");
  val(M + 4 * c5, y + 6, c5, `R$ ${moeda(txt(valores, "vLiq") || txt(dom, "vLiq"))}`, 8.5, true, "right");
  y += 8;

  // Rodapé
  doc.setFont("helvetica", "normal").setFontSize(5.5);
  doc.text(
    `NFS-e nº ${txt(dom, "nNFSe")} · chave ${chave} · emitida em ${dataBR(txt(dom, "dhProc"))}. Documento auxiliar — o XML original tem validade jurídica.`,
    M,
    y + 4,
    { maxWidth: Wt },
  );

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
