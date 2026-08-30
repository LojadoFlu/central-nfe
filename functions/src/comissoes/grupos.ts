// Agrupamento de lojas — FUNÇÕES PURAS.
//
// O PDV às vezes tem duas filiais para o que, na operação, é UMA loja (a Barra
// é 582 + 912). No PDV isso não pode ser unificado; aqui pode. A junção já
// existe em `pdv_stores.grupoNome`, que a tela de Lojas (PDV) edita — este
// módulo só a transforma em regra de cálculo.
//
// A loja CANÔNICA de um grupo é a de menor id. É ela que aparece nas metas, no
// cadastro do funcionário e no fechamento; as irmãs somam nela.

export interface LojaBruta {
  id: number;
  nome?: string | null;
  grupoNome?: string | null;
  empresaId?: string | null;
  ativoSync?: boolean;
}

export interface Grupos {
  /** lojaId (qualquer filial) → lojaId canônico do grupo. */
  canonicoDe: Map<number, number>;
  /** lojaId canônico → nome do grupo. */
  nomeDoGrupo: Map<number, string>;
  /** lojaId canônico → empresaId (CNPJ) do grupo. */
  empresaDoGrupo: Map<number, string | null>;
  /** lojaId canônico → todas as filiais que compõem o grupo. */
  membros: Map<number, number[]>;
}

function chave(l: LojaBruta): string {
  const g = (l.grupoNome ?? "").trim();
  if (g) return g.toUpperCase();
  const n = (l.nome ?? "").trim();
  return n ? n.toUpperCase() : `LOJA ${l.id}`;
}

export function construirGrupos(lojas: LojaBruta[]): Grupos {
  const porChave = new Map<string, LojaBruta[]>();
  for (const l of lojas) {
    const k = chave(l);
    const arr = porChave.get(k) ?? [];
    arr.push(l);
    porChave.set(k, arr);
  }

  const canonicoDe = new Map<number, number>();
  const nomeDoGrupo = new Map<number, string>();
  const empresaDoGrupo = new Map<number, string | null>();
  const membros = new Map<number, number[]>();

  for (const [, arr] of porChave) {
    const ids = arr.map((l) => l.id).sort((a, b) => a - b);
    const canonico = ids[0];
    for (const id of ids) canonicoDe.set(id, canonico);
    const principal = arr.find((l) => l.id === canonico) ?? arr[0];
    nomeDoGrupo.set(
      canonico,
      (principal.grupoNome ?? "").trim() || (principal.nome ?? "").trim() || `Loja ${canonico}`,
    );
    // Empresa do grupo: a da loja canônica; se ela não tiver, a primeira irmã que tiver.
    const empresa =
      principal.empresaId ?? arr.find((l) => l.empresaId)?.empresaId ?? null;
    empresaDoGrupo.set(canonico, empresa);
    membros.set(canonico, ids);
  }

  return { canonicoDe, nomeDoGrupo, empresaDoGrupo, membros };
}

/** Converte um lojaId qualquer no canônico do grupo. Desconhecido volta igual. */
export function canonizar(g: Grupos, lojaId: number | null | undefined): number | null {
  if (lojaId == null) return null;
  return g.canonicoDe.get(lojaId) ?? lojaId;
}

/** Canoniza uma lista de lojas, sem repetir. */
export function canonizarLista(g: Grupos, lojas: number[] | null | undefined): number[] {
  const out = new Set<number>();
  for (const l of lojas ?? []) {
    const c = canonizar(g, l);
    if (c != null) out.add(c);
  }
  return [...out].sort((a, b) => a - b);
}

/** Só as lojas canônicas (uma linha por grupo), ordenadas pelo nome. */
export function lojasCanonicas(g: Grupos): { id: number; nome: string; membros: number[] }[] {
  return [...g.nomeDoGrupo.entries()]
    .map(([id, nome]) => ({ id, nome, membros: g.membros.get(id) ?? [id] }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}
