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
  return n == null
    ? "—"
    : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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

// ── Folha por loja: piso × gratificação ──────────────────────────────────────
// O que a loja precisa ver depois do fechamento é simples: quanto cada um tem
// garantido e quanto ganhou além disso. Gratificação = total − piso; nunca é
// negativa, porque o valor devido já é o MAIOR entre piso e comissão.

export interface PessoaFolha {
  nome: string;
  cargo: string;
  piso: number;
  gratificacao: number;
  total: number;
}

export interface FolhaDaLoja {
  lojaId: number | null;
  lojaNome: string;
  pessoas: PessoaFolha[];
  piso: number;
  gratificacao: number;
  total: number;
}

const cent = (n: number) => Math.round(n * 100) / 100;

/** Agrupa a apuração por loja, já com piso e gratificação de cada pessoa. */
export function folhaPorLoja(linhas: LinhaApuracao[]): FolhaDaLoja[] {
  const porLoja = new Map<number | null, FolhaDaLoja>();
  for (const l of linhas) {
    const chave = l.lojaId ?? null;
    const grupo = porLoja.get(chave) ?? {
      lojaId: chave,
      // Supervisor de rede não é lotado em loja nenhuma: responde pelo grupo.
      lojaNome: l.lojaNome ?? "Rede (sem loja)",
      pessoas: [],
      piso: 0,
      gratificacao: 0,
      total: 0,
    };
    const piso = cent(Math.min(l.piso ?? 0, l.valorDevido));
    const gratificacao = cent(l.valorDevido - piso);
    grupo.pessoas.push({
      nome: l.funcionarioNome,
      cargo: l.cargoNome ?? "sem cargo",
      piso,
      gratificacao,
      total: cent(l.valorDevido),
    });
    grupo.piso = cent(grupo.piso + piso);
    grupo.gratificacao = cent(grupo.gratificacao + gratificacao);
    grupo.total = cent(grupo.total + l.valorDevido);
    porLoja.set(chave, grupo);
  }
  const lista = [...porLoja.values()];
  for (const g of lista) {
    g.pessoas.sort((a, b) => a.cargo.localeCompare(b.cargo) || a.nome.localeCompare(b.nome));
  }
  // Loja nenhuma por último: é a exceção, não o corpo do relatório.
  return lista.sort((a, b) =>
    a.lojaId == null ? 1 : b.lojaId == null ? -1 : a.lojaNome.localeCompare(b.lojaNome),
  );
}

/**
 * Uma página por loja, com piso e gratificação de cada funcionário — o papel
 * que vai para a loja depois do fechamento.
 */
export function gerarPdfPorLoja(apuracao: ResultadoCompetencia, empresa?: string): void {
  montarPdfPorLoja(apuracao, empresa).save(`folha-por-loja-${apuracao.competencia}.pdf`);
}

/** Monta o documento (sem salvar) — o script de conferência usa daqui. */
export function montarPdfPorLoja(apuracao: ResultadoCompetencia, empresa?: string): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const M = 14;
  const lojas = folhaPorLoja(apuracao.linhas);

  lojas.forEach((loja, i) => {
    if (i > 0) doc.addPage();
    let y = 18;
    doc.setFont("helvetica", "bold").setFontSize(14);
    doc.text(loja.lojaNome, M, y);
    y += 6;
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(
      `Folha de ${mesExtenso(apuracao.competencia)}${empresa ? "  ·  " + empresa : ""}  ·  Pagamento em ${formatarData(
        apuracao.pagamentoEm,
      )}  ·  ${STATUS_LABEL[apuracao.status]}`,
      M,
      y,
    );

    autoTable(doc, {
      startY: y + 4,
      margin: { left: M, right: M },
      head: [["Funcionário", "Cargo", "Piso", "Gratificação", "Total"]],
      body: loja.pessoas.map((p) => [
        p.nome,
        p.cargo,
        formatBRL(p.piso),
        formatBRL(p.gratificacao),
        formatBRL(p.total),
      ]),
      foot: [
        [
          `TOTAL — ${loja.pessoas.length} pessoa${loja.pessoas.length === 1 ? "" : "s"}`,
          "",
          formatBRL(loja.piso),
          formatBRL(loja.gratificacao),
          formatBRL(loja.total),
        ],
      ],
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: [30, 41, 59], fontSize: 9 },
      footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
      columnStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right", fontStyle: "bold" },
      },
    });

    const depois = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    doc.setFontSize(7.5).setTextColor(110);
    doc.text(
      apuracao.congelado
        ? `Valores congelados no fechamento${apuracao.fechadoEm ? ` de ${formatarDataHora(apuracao.fechadoEm)}` : ""}. Gratificação = total − piso.`
        : "Competência ainda aberta — os valores podem mudar até o fechamento. Gratificação = total − piso.",
      M,
      Math.min(depois + 6, 285),
    );
    doc.setTextColor(20);
  });

  if (lojas.length > 1) {
    doc.addPage();
    let y = 18;
    doc.setFont("helvetica", "bold").setFontSize(14);
    doc.text(`Resumo da rede — ${mesExtenso(apuracao.competencia)}`, M, y);
    y += 4;
    autoTable(doc, {
      startY: y + 4,
      margin: { left: M, right: M },
      head: [["Loja", "Pessoas", "Piso", "Gratificação", "Total"]],
      body: lojas.map((l) => [
        l.lojaNome,
        String(l.pessoas.length),
        formatBRL(l.piso),
        formatBRL(l.gratificacao),
        formatBRL(l.total),
      ]),
      foot: [
        [
          "TOTAL",
          String(lojas.reduce((s, l) => s + l.pessoas.length, 0)),
          formatBRL(cent(lojas.reduce((s, l) => s + l.piso, 0))),
          formatBRL(cent(lojas.reduce((s, l) => s + l.gratificacao, 0))),
          formatBRL(apuracao.totais.valorDevido),
        ],
      ],
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: [30, 41, 59], fontSize: 9 },
      footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right", fontStyle: "bold" },
      },
    });
  }

  return doc;
}
