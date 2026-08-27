import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina classes Tailwind com segurança (padrão shadcn). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formata número como moeda BRL. */
export function formatBRL(value: number | undefined | null): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value ?? 0);
}

/** Formata CNPJ 00.000.000/0000-00 (aceita com/sem máscara). */
export function formatCNPJ(cnpj: string | undefined | null): string {
  const d = (cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return cnpj ?? "—";
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** Data ISO → dd/MM/aaaa (pt-BR). Vazio → "—". */
export function formatarData(iso: string | undefined | null): string {
  if (!iso) return "—";
  // Data "pura" (YYYY-MM-DD): formata direto, sem converter fuso (evita off-by-one).
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (so) return `${so[3]}/${so[2]}/${so[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

/** Data ISO → dd/MM/aaaa HH:mm (pt-BR). */
export function formatarDataHora(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/** Normaliza texto para busca (sem acento/caixa). */
export function normalizar(s: string | undefined | null): string {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Dias restantes até uma data (negativo = atrasado). */
export function diasAte(iso: string | undefined | null): number | null {
  if (!iso) return null;
  // Data "pura" (YYYY-MM-DD): interpreta no fuso local (evita off-by-one).
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = so ? new Date(Number(so[1]), Number(so[2]) - 1, Number(so[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hoje = new Date();
  const ms = d.setHours(0, 0, 0, 0) - hoje.setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** Abreviação do dia da semana de uma data YYYY-MM-DD (fuso local). */
export function diaSemana(iso: string | undefined | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return DIAS_SEMANA[dt.getDay()] ?? "";
}

/**
 * Data em que o cartão cai na conta, pela regra: D+1; se cair no fim de semana,
 * empurra para segunda (sexta→seg, sábado→seg, domingo→seg). Entrada/saída YYYY-MM-DD.
 * Obs.: é uma PROJEÇÃO — o dado real do PDV (dataVencimento) é a fonte quando existe.
 */
export function dataCredito(vendaISO: string | undefined | null): string {
  if (!vendaISO) return "";
  const [y, m, d] = vendaISO.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + 1); // D+1
  const dow = dt.getDay();
  if (dow === 6) dt.setDate(dt.getDate() + 2); // sábado → segunda
  else if (dow === 0) dt.setDate(dt.getDate() + 1); // domingo → segunda
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Vencimento de uma despesa fixa num mês (ym = "YYYY-MM"), a partir do dia cadastrado.
 * Dias 1–28: literal (sempre existem). Dias 29–31: significam "fim do mês" → último dia
 * ÚTIL do mês (último dia; se cair em sábado/domingo, recua para a sexta). Nunca vaza p/ o mês seguinte.
 */
export function vencimentoDoMes(ym: string, diaVencimento?: number | null): string {
  const [y, m] = ym.split("-").map(Number);
  const ultimoDia = new Date(y, m, 0).getDate(); // dias do mês m
  const dv = Number(diaVencimento) || 1;
  let dia = dv >= 29 ? ultimoDia : Math.min(dv, ultimoDia);
  if (dv >= 29) {
    const dow = new Date(y, m - 1, dia).getDay(); // 0=Dom … 6=Sáb
    if (dow === 6) dia -= 1;      // sábado → sexta
    else if (dow === 0) dia -= 2; // domingo → sexta
  }
  return `${ym}-${String(dia).padStart(2, "0")}`;
}
