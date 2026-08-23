import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatBRL, formatarData, formatCNPJ } from "@/lib/utils";
import type { PedidoCompra, ConcilPedido } from "./repo";

const STATUS_LABEL: Record<string, string> = {
  ok: "Atendido", parcial: "Faltou", sobra: "Sobra", excesso: "Excesso", nao_entregue: "Não entregue",
};
/** nNF/serie a partir da chave de acesso (44 dígitos). */
function nfDaChave(ch: string): string {
  const c = String(ch ?? "").replace(/\D/g, "");
  if (c.length !== 44) return c.slice(-6) || "?";
  const serie = c.slice(22, 25).replace(/^0+/, "") || "0";
  const nNF = c.slice(25, 34).replace(/^0+/, "") || "?";
  return `${nNF}/${serie}`;
}

/** Gera o PDF do relatório de conciliação de um pedido (NF, destinatário, remetente, divergências). */
export function gerarPdfPedido(pedido: PedidoCompra, concil: ConcilPedido, destinatario: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 14;
  let y = 16;

  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text("Relatório de conciliação — Pedido de compra", M, y);
  y += 7;

  doc.setFont("helvetica", "normal").setFontSize(9);
  const linhaInfo = (rot: string, val: string) => { doc.setFont("helvetica", "bold"); doc.text(rot, M, y); doc.setFont("helvetica", "normal"); doc.text(val, M + 32, y); y += 5; };
  linhaInfo("Remetente:", `${pedido.fornecedorNome}${pedido.cnpjFornecedor ? "  ·  " + formatCNPJ(pedido.cnpjFornecedor) : ""}`);
  linhaInfo("Destinatário:", destinatario);
  linhaInfo("Data do pedido:", formatarData(pedido.data) + (pedido.dataEntrega ? `   ·   Entrega prevista: ${formatarData(pedido.dataEntrega)}` : ""));
  const nfsTxt = (concil.nfs ?? []).map(nfDaChave).join(", ") || "—";
  linhaInfo("NF(s):", `${nfsTxt}${concil.entrega ? "   ·   " + (concil.entrega.status === "no_prazo" ? "No prazo" : concil.entrega.status === "atrasado" ? `Atrasado ${concil.entrega.difDias}d` : `Adiantado ${-concil.entrega.difDias}d`) : ""}`);

  // Resumo
  y += 2;
  const r = concil.resumo;
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text(r.atendidoIntegral ? "Pedido atendido" : "Pedido incompleto", M, y); y += 5;
  doc.setFont("helvetica", "normal");
  doc.text(`Unidades: ${r.totalQtdPedido} -> ${r.totalQtdNf}  (dif ${r.difQtd > 0 ? "+" : ""}${r.difQtd})     Valor: ${formatBRL(r.totalPedido)} -> ${formatBRL(r.totalNf)}  (dif ${r.difValor > 0 ? "+" : ""}${formatBRL(r.difValor)})`, M, y);
  y += 3;

  // Divergências: linhas com status != ok OU valor divergente + extras.
  const divs = concil.linhas.filter((l) => l.status !== "ok" || l.unitDiverge || l.totalDiverge);
  const body = divs.map((l) => [
    l.codigo + (l.tamanho ? `\n${l.tamanho}` : ""),
    l.nome,
    `${l.qtdPedido} -> ${l.qtdNf}${l.dif !== 0 ? `\n(${l.dif > 0 ? "+" : ""}${l.dif})` : ""}`,
    `${formatBRL(l.valorUnitPedido)}\n${formatBRL(l.valorUnitNf)}${l.unitDiverge ? " *" : ""}`,
    `${formatBRL(l.valorTotalPedido)}\n${formatBRL(l.valorTotalNf)}${l.totalDiverge ? " *" : ""}`,
    STATUS_LABEL[l.status] ?? l.status,
  ]);
  for (const e of concil.extras) {
    body.push([e.codigo, e.nome, `0 -> ${e.qtdNf}`, `-\n${formatBRL(e.valorUnitNf)}`, `-\n${formatBRL(e.valorTotalNf)}`, "Não casou"]);
  }

  autoTable(doc, {
    startY: y + 3,
    head: [["Código", "Produto", "Qtd ped->NF", "Unit ped/NF", "Total ped/NF", "Status"]],
    body: body.length ? body : [["—", "Sem divergências", "", "", "", ""]],
    styles: { fontSize: 7.5, cellPadding: 1.5, valign: "middle" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7.5 },
    columnStyles: { 0: { cellWidth: 24 }, 2: { halign: "right", cellWidth: 22 }, 3: { halign: "right", cellWidth: 30 }, 4: { halign: "right", cellWidth: 30 }, 5: { cellWidth: 22 } },
    margin: { left: M, right: M },
  });

  const yEnd = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  doc.setFontSize(7).setTextColor(120);
  doc.text("* valor divergente entre pedido e NF.  Gerado por Financeiro Loja do Flu.", M, Math.min(yEnd + 6, 288));

  doc.save(`conciliacao-${pedido.fornecedorNome}-${pedido.data}.pdf`.replace(/[^\w.-]+/g, "_"));
}
