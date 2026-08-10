// Importador do relatório "Contas a Pagar" do PDVnet (CSV "bandado").
// Cada linha repete um preâmbulo + os rótulos de coluna e traz os dados reais
// depois do rótulo "Valor". Valores em pt-BR ("16.951,98") e datas dd/mm/aa.

export interface TituloPagar {
  empresaId: string | null;
  loja: string;
  categoria: string;
  fornecedor: string;
  parcela: string;
  observacao: string;
  vencimento: string; // yyyy-mm-dd
  valor: number;
}

/** Mapa das lojas do relatório → empresaId (CNPJ) do sistema. Verificado. */
const LOJA_EMPRESA: Record<string, string> = {
  "FLU CLUBE": "30623074000145",
  "FLU TIJUCA": "54224772000136",
  "FLU NOVA AMERICA": "35299009000120",
  "FLU BARRA": "59255964000123",
};

/** Parse de uma linha CSV respeitando aspas (campos podem conter vírgula decimal). */
function parseLinha(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** dd/mm/aa(aa) → yyyy-mm-dd (aa de 2 dígitos vira 20aa). */
function dataBR(s: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec((s || "").trim());
  if (!m) return "";
  const [, d, mo, yRaw] = m;
  const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  const mm = Number(mo), dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${y}-${mo}-${d}`;
}

/** "16.951,98" → 16951.98 */
function valorBR(s: string): number {
  const n = Number(String(s || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function parseContasPagar(texto: string): TituloPagar[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim().length);
  const out: TituloPagar[] = [];
  for (const l of linhas) {
    const f = parseLinha(l);
    const iValor = f.indexOf("Valor"); // último rótulo de cabeçalho; dados vêm depois
    if (iValor < 0) continue;
    // d = [Classi, subtotalGrupo, Vencto, Loja, C.Custo, Nota, Tipo, Fornecedor, Pagamento, Parc, Obs, Valor, ...rodapé]
    const d = f.slice(iValor + 1);
    if (d.length < 12) continue;
    const categoria = (d[0] || "").trim();
    const vencimento = dataBR(d[2] || "");
    const loja = (d[3] || "").trim();
    const fornecedor = (d[7] || "").trim();
    const parcela = (d[9] || "").trim();
    const observacao = (d[10] || "").trim();
    const valor = valorBR(d[11] || "");
    if (!categoria || !vencimento || !(valor > 0)) continue; // pula rótulos/rodapés
    const empresaId = LOJA_EMPRESA[loja.toUpperCase()] ?? null;
    out.push({ empresaId, loja, categoria, fornecedor, parcela, observacao, vencimento, valor });
  }
  return out;
}
