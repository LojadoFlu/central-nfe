// Motor de remuneração variável (§37) — FUNÇÃO PURA, sem Firestore.
// Recebe vendas já consolidadas + regra vigente + metas + bônus + ajustes e
// devolve o valor devido com a memória de cálculo linha a linha (§38).
//
// Toda a política (percentuais, faixas, metas, piso) vem de fora. Aqui só existe
// a MECÂNICA. Nada de "vendedor ganha 2%" escrito no código (§46).

import type {
  Ajuste,
  Bonus,
  Competencia,
  Componente,
  EntradaApuracao,
  EscopoVenda,
  Faixa,
  Funcionario,
  LinhaMemoria,
  Meta,
  Regra,
  ResultadoApuracao,
} from "./tipos";

/** Arredonda em centavos (evita 0,1+0,2 e centavo fantasma no fechamento). */
export function centavos(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pct(n: number): string {
  return `${(Number(n) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}
function brl(n: number): string {
  return (Number(n) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Competência dentro da vigência (inclusiva nas duas pontas). "YYYY-MM" (§33). */
export function vigente(
  item: { vigenciaDe: Competencia; vigenciaAte?: Competencia | null },
  competencia: Competencia,
): boolean {
  if (!item.vigenciaDe) return false;
  if (competencia < item.vigenciaDe) return false;
  if (item.vigenciaAte && competencia > item.vigenciaAte) return false;
  return true;
}

/**
 * Especificidade do escopo (§36): funcionário (4) > cargo (2) > loja (1), somados.
 * Assim funcionário+loja (5) vence funcionário (4), que vence cargo+loja (3),
 * cargo (2) e a regra geral (0) — "sempre a regra mais específica".
 * Retorna -1 quando o escopo NÃO se aplica ao funcionário.
 */
export function especificidade(
  escopo: { funcionarioId?: string | null; cargoId?: string | null; lojaId?: number | null },
  f: Funcionario,
): number {
  let p = 0;
  if (escopo.funcionarioId) {
    if (escopo.funcionarioId !== f.id) return -1;
    p += 4;
  }
  if (escopo.cargoId) {
    if (escopo.cargoId !== f.cargoId) return -1;
    p += 2;
  }
  if (escopo.lojaId != null) {
    if (escopo.lojaId !== f.lojaId) return -1;
    p += 1;
  }
  return p;
}

/**
 * Códigos do PDV desta pessoa, sem repetir. Aceita o campo antigo (um código
 * só) e o novo (vários) — a mesma pessoa pode ter um código por filial.
 */
export function codigosPdv(f: Funcionario): string[] {
  const todos = [...(f.pdvVendedorIds ?? []), ...(f.pdvVendedorId ? [f.pdvVendedorId] : [])]
    .map((c) => (c ?? "").trim())
    .filter(Boolean);
  return [...new Set(todos)];
}

/**
 * Piso que vale para a pessoa (§5, §10): o do cargo, salvo acordo individual.
 * Devolve também de onde veio — a memória de cálculo mostra isso, senão ninguém
 * entende por que dois vendedores do mesmo cargo têm pisos diferentes.
 */
export function pisoEfetivo(
  f: Funcionario,
  pisoDoCargo: Map<string, number | null>,
): { valor: number | null; origem: "funcionario" | "cargo" | null } {
  if (f.pisoGarantido != null) return { valor: f.pisoGarantido, origem: "funcionario" };
  const doCargo = f.cargoId ? (pisoDoCargo.get(f.cargoId) ?? null) : null;
  if (doCargo != null) return { valor: doCargo, origem: "cargo" };
  return { valor: null, origem: null };
}

/** Escolhe a regra vigente mais específica para o funcionário na competência. */
export function escolherRegra(
  regras: Regra[],
  f: Funcionario,
  competencia: Competencia,
): Regra | null {
  let melhor: Regra | null = null;
  let melhorP = -1;
  for (const r of regras) {
    if (!r.ativo) continue;
    if (!vigente(r, competencia)) continue;
    const p = especificidade(r, f);
    if (p < 0) continue;
    // Empate: fica a de vigência mais recente (a última alteração vale).
    if (p > melhorP || (p === melhorP && melhor && r.vigenciaDe > melhor.vigenciaDe)) {
      melhor = r;
      melhorP = p;
    }
  }
  return melhor;
}

/** Bônus aplicáveis (vigentes + escopo compatível) ao funcionário. */
export function bonusAplicaveis(
  todos: Bonus[],
  f: Funcionario,
  competencia: Competencia,
): Bonus[] {
  return todos.filter(
    (b) => b.ativo && vigente(b, competencia) && especificidade(b, f) >= 0,
  );
}

/**
 * Meta PRÓPRIA do funcionário na competência (§9): a que foi cadastrada para
 * ele ou para o cargo dele.
 *
 * Meta de escopo só-loja NÃO conta aqui. Ela é o alvo da LOJA — e como o
 * escopo de loja casa com qualquer funcionário dela, ela entrava como meta
 * individual de todo mundo: cada vendedor recebia a meta inteira da loja em
 * vez da parte dele.
 */
export function escolherMeta(
  metas: Meta[],
  f: Funcionario,
  competencia: Competencia,
): number | null {
  let melhor: number | null = null;
  let melhorP = -1;
  for (const m of metas) {
    if (m.competencia !== competencia) continue;
    if (!m.funcionarioId && !m.cargoId) continue; // meta da loja, não da pessoa
    const p = especificidade(m, f);
    if (p < 0) continue;
    if (p > melhorP) {
      melhor = m.valor;
      melhorP = p;
    }
  }
  return melhor;
}

/** Meta da LOJA na competência (escopo só-loja, sem cargo/funcionário). */
export function escolherMetaLoja(
  metas: Meta[],
  lojaId: number | null,
  competencia: Competencia,
): number | null {
  if (lojaId == null) return null;
  const m = metas.find(
    (x) =>
      x.competencia === competencia &&
      x.lojaId === lojaId &&
      !x.funcionarioId &&
      !x.cargoId,
  );
  return m ? m.valor : null;
}

function faixasOrdenadas(faixas: Faixa[]): Faixa[] {
  return [...(faixas ?? [])].sort((a, b) => a.de - b.de);
}

/** Converte o piso de uma faixa para R$ (quando as faixas são % da meta). */
function limiteEmReais(f: Faixa, baseFaixa: string, meta: number | null): number {
  if (baseFaixa !== "percentualMeta") return f.de;
  if (!meta || meta <= 0) return 0;
  return (f.de / 100) * meta;
}

interface ResultadoComponente {
  valor: number;
  linhas: LinhaMemoria[];
}

/** Calcula UM componente da regra (venda própria, venda da loja, grupo…). */
function calcularComponente(
  c: Componente,
  e: EntradaApuracao,
  atingimentos: Record<EscopoVenda, number | null>,
): ResultadoComponente {
  const linhas: LinhaMemoria[] = [];
  const vendas = e.vendas[c.escopoVenda];
  const base = c.baseCalculo === "bruta" ? vendas.bruta : vendas.liquida;
  const meta = e.metas[c.escopoVenda];

  // Condição (ex.: só paga se a loja bateu a meta).
  if (c.condicao) {
    const at = atingimentos[
      c.condicao.tipo === "atingimentoIndividual"
        ? "individual"
        : c.condicao.tipo === "atingimentoLoja"
          ? "loja"
          : "grupo"
    ];
    const ok = at != null && at >= c.condicao.minimoPct;
    if (!ok) {
      linhas.push({
        rotulo: c.rotulo,
        detalhe: `Não pago — exige atingimento de ${pct(c.condicao.minimoPct)}${
          at != null ? ` (ficou em ${pct(at)})` : " (meta não cadastrada)"
        }`,
        valor: 0,
        informativa: true,
      });
      return { valor: 0, linhas };
    }
  }

  const faixas = faixasOrdenadas(c.faixas);
  if (faixas.length === 0 || base <= 0) {
    linhas.push({
      rotulo: c.rotulo,
      detalhe: base <= 0 ? "Sem venda no período" : "Regra sem faixas cadastradas",
      valor: 0,
      informativa: true,
    });
    return { valor: 0, linhas };
  }

  // Posição do funcionário na tabela: em R$ ou em % da meta.
  const posicao =
    c.baseFaixa === "percentualMeta"
      ? meta && meta > 0
        ? (base / meta) * 100
        : 0
      : base;

  if (c.modelo === "integral") {
    // A faixa atingida vale para TUDO que foi vendido (§8 — Tipo A).
    let escolhida: Faixa | null = null;
    for (const f of faixas) if (posicao >= f.de) escolhida = f;
    if (!escolhida) {
      linhas.push({
        rotulo: c.rotulo,
        detalhe: `Abaixo da primeira faixa (${
          c.baseFaixa === "percentualMeta" ? pct(faixas[0].de) : brl(faixas[0].de)
        })`,
        valor: 0,
        informativa: true,
      });
      return { valor: 0, linhas };
    }
    const valor = centavos((base * escolhida.percentual) / 100);
    linhas.push({
      rotulo: `${c.rotulo}${escolhida.rotulo ? ` · ${escolhida.rotulo}` : ""}`,
      detalhe: `${brl(base)} × ${pct(escolhida.percentual)} (faixa integral a partir de ${
        c.baseFaixa === "percentualMeta" ? pct(escolhida.de) : brl(escolhida.de)
      })`,
      valor,
    });
    return { valor, linhas };
  }

  // Progressivo: cada fatia usa o percentual da sua faixa (§8 — Tipo B).
  let total = 0;
  for (let i = 0; i < faixas.length; i++) {
    const ini = limiteEmReais(faixas[i], c.baseFaixa, meta);
    const fim =
      i + 1 < faixas.length ? limiteEmReais(faixas[i + 1], c.baseFaixa, meta) : Infinity;
    const fatia = Math.max(0, Math.min(base, fim) - ini);
    if (fatia <= 0) continue;
    const v = centavos((fatia * faixas[i].percentual) / 100);
    total += v;
    linhas.push({
      rotulo: `${c.rotulo}${faixas[i].rotulo ? ` · ${faixas[i].rotulo}` : ""}`,
      detalhe: `${brl(fatia)} × ${pct(faixas[i].percentual)} (fatia de ${brl(ini)}${
        fim === Infinity ? " em diante" : ` a ${brl(fim)}`
      })`,
      valor: v,
    });
  }
  return { valor: centavos(total), linhas };
}

/**
 * Escopo do gatilho quando o bônus é de ATINGIMENTO (meta, supermeta…).
 * `null` para bônus que não são degraus de meta — "melhor vendedor da loja",
 * "sempre" — que continuam somando normalmente.
 */
function escopoDoDegrau(b: Bonus): EscopoVenda | null {
  // Preso a outro bônus, ele é prêmio somado — não degrau concorrente da
  // mesma escada. Senão o VA disputaria o lugar da supermeta de quem ele
  // depende, e um anularia o outro.
  if (b.dependeDe) return null;
  switch (b.gatilho.tipo) {
    case "atingimentoIndividual":
      return "individual";
    case "atingimentoLoja":
      return "loja";
    case "atingimentoGrupo":
      return "grupo";
    default:
      return null;
  }
}

/** Nome de tela da categoria do desconto. Categoria nova sai como veio. */
function rotuloDesconto(categoria: string): string {
  const mapa: Record<string, string> = {
    retirada: "retirada de produto",
    falta: "falta",
    suspensao: "suspensão",
    outro: "outro",
  };
  return mapa[categoria] ?? categoria;
}

/** Prêmio de um bônus, já resolvido em R$. */
function calcularBonus(b: Bonus, e: EntradaApuracao): number {
  if (b.premio.tipo === "fixo") return centavos(b.premio.valor);
  const escopo: EscopoVenda = b.premio.escopoVenda ?? "individual";
  const vendas = e.vendas[escopo];
  const base = b.premio.baseCalculo === "bruta" ? vendas.bruta : vendas.liquida;
  return centavos((base * b.premio.valor) / 100);
}

function gatilhoAtendido(
  b: Bonus,
  e: EntradaApuracao,
  atingimentos: Record<EscopoVenda, number | null>,
): { ok: boolean; motivo: string } {
  const g = b.gatilho;
  const min = g.minimoPct ?? 100;
  switch (g.tipo) {
    case "sempre":
      return { ok: true, motivo: "sem condição" };
    case "melhorVendedorLoja": {
      const ok = !!e.extras?.melhorVendedorLoja;
      return { ok, motivo: ok ? "melhor vendedor da loja" : "não foi o melhor vendedor da loja" };
    }
    case "atingimentoIndividual":
    case "atingimentoLoja":
    case "atingimentoGrupo": {
      const escopo: EscopoVenda =
        g.tipo === "atingimentoIndividual"
          ? "individual"
          : g.tipo === "atingimentoLoja"
            ? "loja"
            : "grupo";
      const at = atingimentos[escopo];
      if (at == null) return { ok: false, motivo: "meta não cadastrada" };
      return {
        ok: at >= min,
        motivo: `atingimento ${pct(at)} (exige ${pct(min)})`,
      };
    }
    // Meta secundária (PA, VA): não sai de venda, vem marcada a cada mês.
    case "indicador": {
      const ind = (e.indicadores ?? []).find((i) => i.id === g.indicadorId);
      if (!ind) return { ok: false, motivo: "meta secundária não cadastrada" };
      return {
        ok: ind.atingido,
        motivo: ind.atingido ? `${ind.nome} batido` : `${ind.nome} não batido`,
      };
    }
    default:
      return { ok: false, motivo: "gatilho desconhecido" };
  }
}

/**
 * Exigência extra do bônus, além do gatilho — é o que prende o prêmio de PA à
 * supermeta: sem bater os 125%, o PA não paga nada.
 */
function condicaoAtendida(
  b: Bonus,
  atingimentos: Record<EscopoVenda, number | null>,
): { ok: boolean; motivo: string } {
  const c = b.condicao;
  if (!c) return { ok: true, motivo: "" };
  const escopo: EscopoVenda =
    c.tipo === "atingimentoLoja" ? "loja" : c.tipo === "atingimentoGrupo" ? "grupo" : "individual";
  const at = atingimentos[escopo];
  if (at == null) return { ok: false, motivo: `meta (${escopo}) não cadastrada` };
  return {
    ok: at >= c.minimoPct,
    motivo: `atingimento ${escopo} ${pct(at)} (exige ${pct(c.minimoPct)})`,
  };
}

/**
 * Apuração de UM funcionário em UMA competência.
 * Regra do piso (§5): por padrão vale o MAIOR entre piso e comissão — nunca a soma.
 */
export function apurar(e: EntradaApuracao): ResultadoApuracao {
  const memoria: LinhaMemoria[] = [];
  const divergencias: string[] = [];
  const f = e.funcionario;

  const atingimentos: Record<EscopoVenda, number | null> = {
    individual:
      e.metas.individual && e.metas.individual > 0
        ? (e.vendas.individual.liquida / e.metas.individual) * 100
        : null,
    loja:
      e.metas.loja && e.metas.loja > 0
        ? (e.vendas.loja.liquida / e.metas.loja) * 100
        : null,
    grupo:
      e.metas.grupo && e.metas.grupo > 0
        ? (e.vendas.grupo.liquida / e.metas.grupo) * 100
        : null,
  };

  if (!f.cargoId) divergencias.push("Funcionário sem cargo definido.");
  if (f.pisoGarantido == null) divergencias.push("Funcionário sem piso cadastrado.");
  if (!e.regra) divergencias.push("Nenhuma regra de comissão vigente para este funcionário.");

  // 1) Comissão base — soma dos componentes da regra.
  let comissaoBase = 0;
  // Meta de referência da pessoa = o escopo MAIS ABRANGENTE da regra dela.
  // O gerente é medido pela loja; o supervisor, pelo grupo de lojas; o vendedor,
  // pela venda própria. É o que aparece como "meta" e "% atingido" na tela.
  //
  // Sem regra cadastrada, a regra não pode dizer nada — aí vale o formato da
  // pessoa: quem tem lojas marcadas para supervisionar é medido pelo grupo, e
  // quem não vende no PDV, pela loja. Sem isso, um supervisor recém-cadastrado
  // aparecia medido por uma venda própria que ele nem faz.
  const escopos = new Set((e.regra?.componentes ?? []).map((c) => c.escopoVenda));
  // Uma loja marcada já basta: supervisor de uma loja só é medido por ela,
  // não pela venda que ele mesmo faz no balcão.
  const supervisiona = (e.funcionario.lojasGrupo ?? []).length >= 1;
  // Caixa não é medida por venda: nem a da loja (que não é dela), nem a do
  // balcão. Fica no escopo individual, que é o que ela de fato fez.
  const escopoPrincipal: EscopoVenda = e.semComissao
    ? "individual"
    : escopos.has("grupo")
    ? "grupo"
    : escopos.has("loja")
      ? "loja"
      : escopos.size > 0
        ? "individual"
        : supervisiona
          ? "grupo"
          : e.funcionario.semPdv
            ? "loja"
            : "individual";
  if (e.regra) {
    for (const c of e.regra.componentes ?? []) {
      if (c.baseFaixa === "percentualMeta" && !e.metas[c.escopoVenda]) {
        divergencias.push(
          `Meta (${c.escopoVenda}) ausente — a regra "${c.rotulo}" usa faixas por % da meta.`,
        );
      }
      const r = calcularComponente(c, e, atingimentos);
      comissaoBase += r.valor;
      memoria.push(...r.linhas);
    }
  }
  comissaoBase = centavos(comissaoBase);

  // 2) Bônus.
  //
  // Meta e supermeta NÃO acumulam: é um ou outro. Entre os bônus de
  // atingimento do MESMO escopo, paga só o degrau mais alto que a pessoa
  // alcançou — quem faz 125% recebe o percentual da supermeta sobre a venda,
  // e não a supermeta somada à meta.
  // Bônus que não são degrau de meta ("melhor vendedor", "sempre", os presos a
  // outro bônus) continuam somando: são prêmios à parte, não faixas
  // concorrentes.
  const lista = e.bonus ?? [];
  const porId = new Map(lista.map((b) => [b.id, b]));
  const vencedorDoDegrau = new Map<EscopoVenda, Bonus>();
  for (const b of lista) {
    const escopo = escopoDoDegrau(b);
    if (!escopo) continue;
    if (!gatilhoAtendido(b, e, atingimentos).ok) continue;
    if (!condicaoAtendida(b, atingimentos).ok) continue;
    const atual = vencedorDoDegrau.get(escopo);
    const degrau = b.gatilho.minimoPct ?? 100;
    const degrauAtual = atual ? (atual.gatilho.minimoPct ?? 100) : -Infinity;
    // Empate no degrau: fica o de prêmio maior, para não depender da ordem.
    if (degrau > degrauAtual || (degrau === degrauAtual && atual && calcularBonus(b, e) > calcularBonus(atual, e))) {
      vencedorDoDegrau.set(escopo, b);
    }
  }

  // Um bônus pode depender de OUTRO ter pago — é assim que o VA se prende à
  // supermeta: não se repete o "125%" no VA, aponta-se para o bônus da
  // supermeta. Se o degrau dela mudar amanhã, o VA acompanha sozinho.
  // Por isso a decisão vem em rodadas: quem depende só é decidido depois de
  // quem ele espera.
  interface Decisao {
    pago: boolean;
    valor: number;
    detalhe: string;
  }
  const decisao = new Map<string, Decisao>();
  const decidir = (b: Bonus): Decisao | null => {
    if (b.dependeDe) {
      const dono = porId.get(b.dependeDe);
      if (!dono) {
        return {
          pago: false,
          valor: 0,
          detalhe: "o bônus exigido não se aplica a esta pessoa",
        };
      }
      const d = decisao.get(dono.id);
      if (!d) return null; // ainda não sabemos: fica para a próxima rodada
      if (!d.pago) {
        return { pago: false, valor: 0, detalhe: `"${dono.nome}" não pagou` };
      }
    }
    const cond = condicaoAtendida(b, atingimentos);
    if (!cond.ok) return { pago: false, valor: 0, detalhe: cond.motivo };
    const g = gatilhoAtendido(b, e, atingimentos);
    if (!g.ok) return { pago: false, valor: 0, detalhe: g.motivo };
    const escopo = escopoDoDegrau(b);
    const vencedor = escopo ? vencedorDoDegrau.get(escopo) : undefined;
    if (escopo && vencedor && vencedor.id !== b.id) {
      return {
        pago: false,
        valor: 0,
        detalhe: `substituído por "${vencedor.nome}", degrau mais alto atingido (não acumulam)`,
      };
    }
    const dono = b.dependeDe ? porId.get(b.dependeDe) : null;
    const porQue = [
      g.motivo,
      b.condicao ? cond.motivo : null,
      dono ? `com "${dono.nome}" pago` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return { pago: true, valor: calcularBonus(b, e), detalhe: porQue };
  };

  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const b of lista) {
      if (decisao.has(b.id)) continue;
      const d = decidir(b);
      if (d) {
        decisao.set(b.id, d);
        mudou = true;
      }
    }
  }
  // Sobrou alguém sem decisão: só acontece se dois bônus dependerem um do
  // outro. Não paga, e diz o motivo em vez de sumir da memória.
  for (const b of lista) {
    if (!decisao.has(b.id)) {
      decisao.set(b.id, { pago: false, valor: 0, detalhe: "dependência circular entre bônus" });
    }
  }

  // Bônus que existe para esta pessoa mas não vale nesta competência. Sem
  // isso ele simplesmente não aparecia, e a ausência do prêmio não tinha
  // explicação em lugar nenhum — parecia o motor ignorando a regra.
  for (const i of e.bonusForaDeVigencia ?? []) {
    memoria.push({
      rotulo: `Bônus: ${i.nome}`,
      detalhe: `Não pago — ${i.motivo}`,
      valor: 0,
      informativa: true,
    });
  }

  let bonusTotal = 0;
  for (const b of lista) {
    const d = decisao.get(b.id)!;
    if (!d.pago) {
      memoria.push({
        rotulo: `Bônus: ${b.nome}`,
        detalhe: `Não pago — ${d.detalhe}`,
        valor: 0,
        informativa: true,
      });
      continue;
    }
    bonusTotal += d.valor;
    memoria.push({
      rotulo: `Bônus: ${b.nome}`,
      detalhe:
        b.premio.tipo === "fixo"
          ? `Valor fixo — ${d.detalhe}`
          : `${pct(b.premio.valor)} sobre a venda ${b.premio.escopoVenda ?? "individual"} — ${d.detalhe}`,
      valor: d.valor,
    });
  }
  bonusTotal = centavos(bonusTotal);

  // 3) Ajustes (manuais e estornos de venda cancelada).
  let ajustesTotal = 0;
  for (const a of e.ajustes ?? []) {
    ajustesTotal += Number(a.valor) || 0;
    memoria.push({
      rotulo: a.tipo === "estorno" ? "Estorno" : "Ajuste manual",
      detalhe: a.motivo,
      valor: centavos(a.valor),
    });
  }
  ajustesTotal = centavos(ajustesTotal);

  const comissaoTotal = centavos(comissaoBase + bonusTotal + ajustesTotal);
  const piso = centavos(f.pisoGarantido ?? 0);
  const aPagar =
    e.regraPiso === "soma" ? centavos(piso + comissaoTotal) : centavos(Math.max(piso, comissaoTotal));
  const pisoAplicado = e.regraPiso === "maior" && piso > comissaoTotal;

  // 4) Descontos de folha (retirada de produto, falta, suspensão).
  //
  // Saem DEPOIS do piso, ao contrário do ajuste: quem está no piso e levou
  // mercadoria tem de pagar por ela — se o desconto entrasse na comissão, o
  // piso o absorveria e a retirada sairia de graça. Pelo mesmo motivo a caixa,
  // que só tem fixo, também pode ser descontada.
  let descontosTotal = 0;
  for (const d of e.descontos ?? []) {
    const v = centavos(Math.abs(Number(d.valor) || 0));
    if (!v) continue;
    descontosTotal += v;
    memoria.push({
      rotulo: `Desconto${d.categoria ? `: ${rotuloDesconto(d.categoria)}` : ""}`,
      detalhe: d.motivo,
      valor: -v,
    });
  }
  descontosTotal = centavos(descontosTotal);
  const valorDevido = centavos(Math.max(0, aPagar - descontosTotal));
  if (descontosTotal > aPagar) {
    divergencias.push(
      `Descontos de ${brl(descontosTotal)} passam do que a pessoa tem a receber (${brl(
        aPagar,
      )}) — sobra ${brl(centavos(descontosTotal - aPagar))} sem desconto.`,
    );
  }

  if (e.semComissao) {
    memoria.push({
      rotulo: "Fixo do cargo",
      detalhe: "Cargo sem comissão — recebe o piso, sem medição por venda",
      valor: piso,
    });
  } else if (pisoAplicado) {
    memoria.push({
      rotulo: "Piso garantido",
      detalhe: `Comissão de ${brl(comissaoTotal)} ficou abaixo do piso — prevalece o piso`,
      valor: piso,
    });
    if (ajustesTotal !== 0) {
      memoria.push({
        rotulo: "Atenção",
        detalhe: `O ajuste de ${brl(ajustesTotal)} foi absorvido pelo piso (não altera o valor devido).`,
        valor: 0,
        informativa: true,
      });
    }
  }
  if (valorDevido < 0) divergencias.push("Valor devido negativo — confira os ajustes.");

  const vendaConsiderada = centavos(e.vendas[escopoPrincipal].liquida);
  const metaConsiderada = e.metas[escopoPrincipal];

  return {
    funcionarioId: f.id,
    competencia: e.competencia,
    vendaConsiderada,
    metaConsiderada,
    escopoMeta: escopoPrincipal,
    atingimentoPct: atingimentos[escopoPrincipal],
    // Percentual efetivo = o que a pessoa ganhou por real vendido. Precisa
    // incluir o BÔNUS: quem modela meta/supermeta como bônus tem comissaoBase
    // zero, e sem isso o número aparecia como 0% — e, pior, o estorno de venda
    // cancelada (que usa este percentual) devolvia zero. Ajuste fica de fora:
    // é correção pontual, não taxa por real vendido.
    percentualEfetivo:
      vendaConsiderada > 0 ? ((comissaoBase + bonusTotal) / vendaConsiderada) * 100 : null,
    comissaoBase,
    bonusTotal,
    ajustesTotal,
    comissaoTotal,
    piso,
    descontosTotal,
    valorDevido,
    pisoAplicado,
    memoria,
    divergencias,
  };
}

export type { Ajuste, Bonus, Meta, Regra };
