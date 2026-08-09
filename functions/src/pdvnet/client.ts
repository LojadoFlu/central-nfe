// PDVnet Integration Service — porte do PdvnetClient do CRM (crm-flu).
// Única classe que conhece o protocolo do PDVnet. Roda SÓ no servidor.

import type {
  PdvListaResponse,
  PdvLoja,
  PdvRede,
  PdvTokenAcesso,
  PdvVenda,
} from "./types";

export interface PdvnetConfig {
  baseUrl: string; // ex.: http://<host>.pdvnet.com.br/pdvapi
  usuario: string;
  senha: string;
}

export interface PaginaOpcoes {
  pagina?: number;
  tamanhoPagina?: number;
}

export class PdvnetClient {
  private token: string | null = null;
  private expiraEmMs = 0;

  constructor(private readonly cfg: PdvnetConfig) {}

  private url(path: string, query?: Record<string, string | number | undefined>): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, "");
    const u = new URL(base + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private async garantirToken(): Promise<string> {
    const agora = Date.now();
    if (this.token && agora < this.expiraEmMs - 60_000) return this.token;
    const res = await fetch(this.url("/api/public/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Usuario: this.cfg.usuario, Senha: this.cfg.senha }),
    });
    if (!res.ok) throw new Error(`PDVnet login falhou (HTTP ${res.status}).`);
    const data = (await res.json()) as PdvTokenAcesso;
    if (!data?.Token) throw new Error("PDVnet login não retornou token.");
    this.token = data.Token;
    this.expiraEmMs = agora + (data.ExpiraEm ?? 3600) * 1000;
    return this.token;
  }

  private async erroDetalhado(res: Response, path: string): Promise<Error> {
    let corpo = "";
    try {
      corpo = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
    } catch {
      /* ignora */
    }
    return new Error(`PDVnet GET ${path} → HTTP ${res.status}${corpo ? `: ${corpo}` : ""}`);
  }

  private async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const token = await this.garantirToken();
    const res = await fetch(this.url(path, query), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.status === 401) {
      this.token = null;
      const novo = await this.garantirToken();
      const retry = await fetch(this.url(path, query), {
        headers: { Authorization: `Bearer ${novo}`, Accept: "application/json" },
      });
      if (!retry.ok) throw await this.erroDetalhado(retry, path);
      return (await retry.json()) as T;
    }
    if (!res.ok) throw await this.erroDetalhado(res, path);
    return (await res.json()) as T;
  }

  async listarRedes(): Promise<PdvRede[]> {
    const r = await this.get<PdvListaResponse<PdvRede>>("/api/public/redes", { tamanhoPagina: 50 });
    return r.Registros ?? [];
  }

  /** Todas as lojas (percorre todas as páginas — a rede tem >50 lojas). */
  async listarLojas(): Promise<PdvLoja[]> {
    const todas: PdvLoja[] = [];
    let pagina = 1;
    for (;;) {
      const r = await this.get<PdvListaResponse<PdvLoja>>("/api/public/lojas", {
        pagina,
        tamanhoPagina: 50,
      });
      const reg = r.Registros ?? [];
      todas.push(...reg);
      if (reg.length === 0 || !r.PaginacaoInfo?.TemProximaPagina) break;
      pagina += 1;
      if (pagina > 40) break; // trava de segurança
    }
    return todas;
  }

  /** Uma página de vendas no intervalo [inicio, fim] (datas yyyy-MM-dd). */
  async listarVendas(
    inicio: string,
    fim: string,
    opc: PaginaOpcoes = {},
  ): Promise<PdvListaResponse<PdvVenda>> {
    return this.get<PdvListaResponse<PdvVenda>>("/api/public/vendas", {
      inicio,
      fim,
      pagina: opc.pagina ?? 1,
      tamanhoPagina: opc.tamanhoPagina ?? 50,
    });
  }

  /** Percorre TODAS as páginas de vendas do intervalo. */
  async percorrerVendas(
    inicio: string,
    fim: string,
    onPagina: (vendas: PdvVenda[]) => Promise<void>,
    tamanhoPagina = 50,
  ): Promise<number> {
    let pagina = 1;
    let total = 0;
    for (;;) {
      const resp = await this.listarVendas(inicio, fim, { pagina, tamanhoPagina });
      const registros = resp.Registros ?? [];
      if (registros.length === 0) break;
      await onPagina(registros);
      total += registros.length;
      if (!resp.PaginacaoInfo?.TemProximaPagina) break;
      pagina += 1;
    }
    return total;
  }
}
