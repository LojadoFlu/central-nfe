// Cliente da API de Conciliação da Stone — única classe que conhece o
// protocolo. Roda SÓ no servidor: a chave nunca chega ao navegador.
//
// Modo "cliente Stone" (somos donos do StoneCode): Basic Auth com a chave do
// Stone Portal, sem OAuth e sem o fluxo de consentimento que a Stone exige de
// parceiros conciliadores.
//
// Documentação: https://conciliacao.stone.com.br/reference/overview-da-api-cliente-stone

import * as zlib from "node:zlib";

const BASE = "https://conciliation.stone.com.br/v2/merchant";

/** Layout do arquivo. O 2.4 é o mais recente; o 2.2 é o padrão da API. */
export type LayoutStone = "XML2_2" | "XML2_4";

export interface RespostaArquivo {
  httpStatus: number;
  /** XML já descompactado, quando veio. */
  xml: string | null;
  /** Corpo cru em caso de erro (para a mensagem, sem a chave). */
  erro: string | null;
  bytes: number;
}

/** "2026-08-31" ou Date → "20260831". */
export function dataStone(d: string | Date): string {
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return s.slice(0, 10).replace(/-/g, "");
}

/**
 * Baixa o arquivo de conciliação de UM dia de UM StoneCode.
 *
 * Cuidados que a documentação avisa e custam caro:
 *  • o header `x-user-type: client` é obrigatório — sem ele a API responde 401
 *    como se a chave estivesse errada;
 *  • a resposta vem gzipada; dependendo do content-encoding o fetch já
 *    descompacta, então conferimos os magic bytes antes de tentar de novo;
 *  • o limite é de 7 chamadas por hora para cada par StoneCode + data. Estourar
 *    devolve 429, e insistir só piora — quem chama precisa respeitar.
 */
export async function baixarArquivoConciliacao(opc: {
  stoneCode: string;
  data: string | Date;
  chave: string;
  layout?: LayoutStone;
}): Promise<RespostaArquivo> {
  const layout = opc.layout ?? "XML2_4";
  const url = `${BASE}/${encodeURIComponent(opc.stoneCode)}/conciliation-file/${dataStone(
    opc.data,
  )}?layout=${layout}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      // A chave vai como usuário do Basic, com senha vazia.
      Authorization: `Basic ${Buffer.from(`${opc.chave}:`).toString("base64")}`,
      "x-user-type": "client",
      "Accept-Encoding": "gzip",
    },
  });

  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    return {
      httpStatus: res.status,
      xml: null,
      erro: buf.toString("utf8").slice(0, 400),
      bytes: buf.length,
    };
  }

  let conteudo = buf;
  // 1f 8b = assinatura do gzip. Se o fetch já descompactou, não está aqui.
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    conteudo = zlib.gunzipSync(buf);
  }
  return { httpStatus: res.status, xml: conteudo.toString("utf8"), erro: null, bytes: buf.length };
}

/**
 * Mapa dos elementos do XML: nome → quantas vezes aparece. Serve para conhecer
 * a estrutura real do arquivo antes de escrever o parser — a documentação
 * pública não lista os campos de dentro dos containers.
 */
export function estruturaDoXml(xml: string): { tag: string; qtd: number }[] {
  const contagem = new Map<string, number>();
  const re = /<([A-Za-z_][\w.:-]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    contagem.set(m[1], (contagem.get(m[1]) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([tag, qtd]) => ({ tag, qtd }))
    .sort((a, b) => b.qtd - a.qtd || a.tag.localeCompare(b.tag));
}

/**
 * Primeira ocorrência inteira de um elemento, com o conteúdo. Serve para ver um
 * exemplo real de cada container antes de escrever o parser.
 */
export function amostraDeElemento(xml: string, nome: string, max = 1800): string | null {
  const re = new RegExp(`<${nome}\\b[^>]*>[\\s\\S]*?</${nome}>`);
  const m = xml.match(re);
  if (!m) return null;
  return m[0].slice(0, max);
}
