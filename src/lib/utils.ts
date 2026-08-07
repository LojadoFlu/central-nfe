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

/** Dias restantes até uma data (negativo = atrasado). */
export function diasAte(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hoje = new Date();
  const ms = d.setHours(0, 0, 0, 0) - hoje.setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}
