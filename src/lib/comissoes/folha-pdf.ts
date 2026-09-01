import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatBRL, formatarData, formatarDataHora } from "@/lib/utils";
import type { LinhaApuracao, ResultadoCompetencia } from "./tipos";
import { custoDaLinha } from "./custo";
import { STATUS_LABEL } from "./tipos";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function mesExtenso(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${MESES[mes - 1]}/${ano}`;
}
// Tricolor, amostrado do próprio arquivo do escudo.
const GRENA: [number, number, number] = [159, 2, 47];
const VERDE: [number, number, number] = [0, 105, 64];
const CINZA_CLARO: [number, number, number] = [245, 247, 246];

/**
 * O escudo em data URI, para o jsPDF. Sem ele o relatório sai igual, só que
 * sem a marca — nunca vale derrubar a folha por causa da imagem.
 */
async function carregarEscudo(): Promise<string | null> {
  try {
    // Versão reduzida (173 × 200): o escudo grande virava PDF de 900 kB, e a
    // folha vai por e-mail.
    const r = await fetch("/escudo-flu-pdf.png");
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("escudo"));
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Faixa grená com o escudo, título e subtítulo. Devolve o Y livre abaixo. */
function cabecalhoFlu(
  doc: jsPDF,
  opts: { titulo: string; subtitulo: string; escudo?: string | null },
): number {
  const larguraPagina = doc.internal.pageSize.getWidth();
  const M = 14;
  const altura = 26;
  doc.setFillColor(...GRENA);
  doc.rect(0, 0, larguraPagina, altura, "F");
  doc.setFillColor(...VERDE);
  doc.rect(0, altura, larguraPagina, 1.6, "F");

  let x = M;
  if (opts.escudo) {
    const h = 16;
    // Proporção do arquivo (173 × 200): esticar o escudo seria pior que não pô-lo.
    // O alias faz o jsPDF gravar o escudo UMA vez e reusar em todas as páginas
    // — sem ele o arquivo engorda uma cópia por loja.
    doc.addImage(opts.escudo, "PNG", x, 5, (h * 173) / 200, h, "escudo-flu");
    x += (h * 173) / 200 + 6;
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold").setFontSize(15);
  doc.text(opts.titulo, x, 13);
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  doc.text(opts.subtitulo, x, 19.5);
  doc.setTextColor(20, 20, 20);
  return altura + 1.6;
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
  /** Retirada de produto, falta, suspensão — já saiu do total. */
  desconto: number;
  /** Dias não trabalhados no mês (falta + suspensão). */
  faltas: number;
  total: number;
}

export interface FolhaDaLoja {
  lojaId: number | null;
  lojaNome: string;
  pessoas: PessoaFolha[];
  piso: number;
  gratificacao: number;
  desconto: number;
  faltas: number;
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
      desconto: 0,
      faltas: 0,
      total: 0,
    };
    // Mesma conta do dashboard — os dois papéis contam a mesma história.
    const { piso, comissao: gratificacao, desconto } = custoDaLinha(l);
    grupo.pessoas.push({
      nome: l.funcionarioNome,
      cargo: l.cargoNome ?? "sem cargo",
      piso,
      gratificacao,
      desconto,
      faltas: l.faltas?.dias ?? 0,
      total: cent(l.valorDevido),
    });
    grupo.piso = cent(grupo.piso + piso);
    grupo.gratificacao = cent(grupo.gratificacao + gratificacao);
    grupo.desconto = cent(grupo.desconto + desconto);
    grupo.faltas += l.faltas?.dias ?? 0;
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
export async function gerarPdfPorLoja(apuracao: ResultadoCompetencia, empresa?: string): Promise<void> {
  const doc = montarPdfPorLoja(apuracao, { empresa, escudo: await carregarEscudo() });
  doc.save(`folha-por-loja-${apuracao.competencia}.pdf`);
}

/** Monta o documento (sem salvar) — o script de conferência usa daqui. */
export function montarPdfPorLoja(
  apuracao: ResultadoCompetencia,
  opts: { empresa?: string; escudo?: string | null } = {},
): jsPDF {
  const { empresa, escudo } = opts;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const M = 14;
  const lojas = folhaPorLoja(apuracao.linhas);

  lojas.forEach((loja, i) => {
    if (i > 0) doc.addPage();
    const y = cabecalhoFlu(doc, {
      titulo: loja.lojaNome,
      subtitulo: `Folha de ${mesExtenso(apuracao.competencia)}${empresa ? "  ·  " + empresa : ""}  ·  Pagamento em ${formatarData(
        apuracao.pagamentoEm,
      )}  ·  ${STATUS_LABEL[apuracao.status]}`,
      escudo,
    });

    // A coluna de desconto só aparece onde houve desconto: numa loja sem
    // retirada nem falta ela seria uma fila de zeros.
    const direita = { halign: "right" as const };
    autoTable(doc, {
      startY: y + 8,
      margin: { left: M, right: M },
      head: [
        [
          "Funcionário",
          "Cargo",
          { content: "Piso", styles: direita },
          { content: "Gratificação", styles: direita },
          { content: "Desconto", styles: direita },
          { content: "Total", styles: direita },
          { content: "Faltas/Suspensões", styles: direita },
        ],
      ],
      body: loja.pessoas.map((p) => [
        p.nome,
        p.cargo,
        formatBRL(p.piso),
        formatBRL(p.gratificacao),
        p.desconto ? `- ${formatBRL(p.desconto)}` : "—",
        formatBRL(p.total),
        p.faltas ? String(p.faltas) : "—",
      ]),
      foot: [
        [
          `TOTAL — ${loja.pessoas.length} pessoa${loja.pessoas.length === 1 ? "" : "s"}`,
          "",
          formatBRL(loja.piso),
          formatBRL(loja.gratificacao),
          loja.desconto ? `- ${formatBRL(loja.desconto)}` : "—",
          formatBRL(loja.total),
          loja.faltas ? String(loja.faltas) : "—",
        ],
      ],
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: VERDE, fontSize: 9 },
      alternateRowStyles: { fillColor: CINZA_CLARO },
      footStyles: { fillColor: CINZA_CLARO, textColor: GRENA, fontStyle: "bold" },
      // Nome e cargo à esquerda, números à direita; o total em negrito.
      columnStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right", fontStyle: "bold" },
        6: { halign: "right" },
      },
    });

    const depois = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    doc.setFontSize(7.5).setTextColor(110).setCharSpace(0);
    doc.text(
      apuracao.congelado
        ? `Valores congelados no fechamento${apuracao.fechadoEm ? ` de ${formatarDataHora(apuracao.fechadoEm)}` : ""}. Total = piso + gratificação - desconto. Faltas e suspensões em dias, sem desconto aqui.`
        : "Competência ainda aberta — os valores podem mudar até o fechamento. Total = piso + gratificação - desconto. Faltas e suspensões em dias, sem desconto aqui.",
      M,
      Math.min(depois + 6, 285),
    );
    doc.setTextColor(20);
  });

  if (lojas.length > 1) {
    const direita = { halign: "right" as const };
    doc.addPage();
    const y = cabecalhoFlu(doc, {
      titulo: "Resumo da rede",
      subtitulo: `Folha de ${mesExtenso(apuracao.competencia)}${empresa ? "  ·  " + empresa : ""}  ·  Pagamento em ${formatarData(
        apuracao.pagamentoEm,
      )}  ·  ${STATUS_LABEL[apuracao.status]}`,
      escudo,
    });
    autoTable(doc, {
      startY: y + 8,
      margin: { left: M, right: M },
      head: [
        [
          "Loja",
          { content: "Pessoas", styles: direita },
          { content: "Piso", styles: direita },
          { content: "Gratificação", styles: direita },
          { content: "Desconto", styles: direita },
          { content: "Total", styles: direita },
          { content: "Faltas/Suspensões", styles: direita },
        ],
      ],
      body: lojas.map((l) => [
        l.lojaNome,
        String(l.pessoas.length),
        formatBRL(l.piso),
        formatBRL(l.gratificacao),
        l.desconto ? `- ${formatBRL(l.desconto)}` : "—",
        formatBRL(l.total),
        l.faltas ? String(l.faltas) : "—",
      ]),
      foot: [
        [
          "TOTAL",
          String(lojas.reduce((s, l) => s + l.pessoas.length, 0)),
          formatBRL(cent(lojas.reduce((s, l) => s + l.piso, 0))),
          formatBRL(cent(lojas.reduce((s, l) => s + l.gratificacao, 0))),
          formatBRL(cent(lojas.reduce((s, l) => s + l.desconto, 0))),
          formatBRL(apuracao.totais.valorDevido),
          String(lojas.reduce((s, l) => s + l.faltas, 0)),
        ],
      ],
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: VERDE, fontSize: 9 },
      alternateRowStyles: { fillColor: CINZA_CLARO },
      footStyles: { fillColor: CINZA_CLARO, textColor: GRENA, fontStyle: "bold" },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right", fontStyle: "bold" },
        6: { halign: "right" },
      },
    });
  }

  return doc;
}
