import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatBRL, formatarData, formatarDataHora } from "@/lib/utils";
import type { LinhaApuracao, ResultadoCompetencia } from "./tipos";
import { STATUS_LABEL } from "./tipos";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function mesExtenso(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${MESES[mes - 1]}/${ano}`;
}
function brl(n: number | null | undefined): string {
  return n == null ? "—" : formatBRL(n);
}
function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

/**
 * Relatório de fechamento de comissões (§44) — o papel que vai junto com a folha.
 * Uma linha por pessoa; no fim, o total que a empresa deve pagar.
 */
export function gerarPdfFolha(apuracao: ResultadoCompetencia, empresa?: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const M = 12;
  let y = 15;

  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text(`Fechamento de comissões — ${mesExtenso(apuracao.competencia)}`, M, y);
  y += 6;

  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(
    `${empresa ? empresa + "  ·  " : ""}Período ${formatarData(apuracao.periodo.de)} a ${formatarData(
      apuracao.periodo.ate,
    )}  ·  Situação: ${STATUS_LABEL[apuracao.status]}  ·  Pagamento em ${formatarData(apuracao.pagamentoEm)}`,
    M,
    y,
  );
  y += 5;
  doc.text(
    `Faturamento ${formatBRL(apuracao.totais.faturamento)}  ·  Comissões ${formatBRL(
      apuracao.totais.comissaoTotal,
    )}  ·  Piso garantido ${formatBRL(apuracao.totais.pisoUtilizado)}  ·  Folha variável ${formatBRL(
      apuracao.totais.valorDevido,
    )}`,
    M,
    y,
  );
  y += 3;

  const linha = (l: LinhaApuracao) => [
    l.funcionarioNome,
    l.cargoNome ?? "—",
    l.lojaNome ?? "—",
    brl(l.vendaConsiderada),
    brl(l.metaConsiderada),
    pct(l.atingimentoPct),
    brl(l.comissaoBase),
    brl(l.bonusTotal),
    l.ajustesTotal ? brl(l.ajustesTotal) : "—",
    brl(l.comissaoTotal),
    brl(l.piso),
    brl(l.valorDevido),
  ];

  autoTable(doc, {
    startY: y + 2,
    margin: { left: M, right: M },
    head: [
      [
        "Funcionário",
        "Cargo",
        "Loja",
        "Venda",
        "Meta",
        "% meta",
        "Comissão",
        "Bônus",
        "Ajustes",
        "Total",
        "Piso",
        "Valor devido",
      ],
    ],
    body: apuracao.linhas.map(linha),
    foot: [
      [
        "TOTAL",
        "",
        "",
        formatBRL(apuracao.totais.faturamento),
        "",
        "",
        formatBRL(apuracao.totais.comissaoBase),
        formatBRL(apuracao.totais.bonus),
        formatBRL(apuracao.totais.ajustes),
        formatBRL(apuracao.totais.comissaoTotal),
        "",
        formatBRL(apuracao.totais.valorDevido),
      ],
    ],
    styles: { fontSize: 7.5, cellPadding: 1.4 },
    headStyles: { fillColor: [30, 41, 59], fontSize: 7.5 },
    footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
      11: { halign: "right", fontStyle: "bold" },
    },
  });

  const depois = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  doc.setFontSize(7.5).setTextColor(110);
  doc.text(
    apuracao.congelado
      ? `Valores congelados no fechamento${apuracao.fechadoEm ? ` de ${formatarDataHora(apuracao.fechadoEm)}` : ""}. "Valor devido" = maior entre piso garantido e comissão.`
      : 'Competência ainda aberta — os valores podem mudar até o fechamento. "Valor devido" = maior entre piso garantido e comissão.',
    M,
    Math.min(depois + 6, 200),
  );

  doc.save(`fechamento-comissoes-${apuracao.competencia}.pdf`);
}
