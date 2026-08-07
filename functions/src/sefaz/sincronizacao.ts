import * as crypto from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { db, somenteDigitos } from "../lib/base";
import { consultarDistribuicaoNSU, type DocZip } from "./distribuicao";
import { parseDoc, normalizarBusca } from "./parser";

const MAX_ITER_POR_RUN = 20; // teto por execução (respeita timeout e evita loops)
const RECUO_656_MS = 60 * 60 * 1000; // 1h de recuo no consumo indevido

export interface ResultadoSync {
  novos: number;
  iteracoes: number;
  cStat: string | null;
  xMotivo: string | null;
  ultNSU: string;
  maxNSU: string;
  bloqueado: boolean;
}

function menorQue(a: string, b: string): boolean {
  // compara NSU (15 dígitos) numericamente via BigInt
  try { return BigInt(a) < BigInt(b); } catch { return false; }
}

/** Sincroniza uma empresa: loop distNSU até esgotar, persistindo tudo. */
export async function sincronizarEmpresa(
  emp: { id: string; cnpj: string; uf: string; ambiente?: string },
  key: string,
  cert: string,
): Promise<ResultadoSync> {
  const companyId = emp.id;
  const cnpj = somenteDigitos(emp.cnpj);
  const ambiente = emp.ambiente === "producao" ? "producao" : "homologacao";
  const stateRef = db.collection("nfe_sync_state").doc(companyId);
  const st = (await stateRef.get()).data() as { ultNSU?: string; maxNSU?: string } | undefined;

  let ultNSU = st?.ultNSU || "0";
  let maxNSU = st?.maxNSU || "0";
  let cStat: string | null = null;
  let xMotivo: string | null = null;
  let novos = 0;
  let iter = 0;
  let bloqueado = false;

  while (iter < MAX_ITER_POR_RUN) {
    iter++;
    const r = await consultarDistribuicaoNSU({ ambiente, uf: emp.uf, cnpj, ultNSU, key, cert });
    cStat = r.cStat;
    xMotivo = r.xMotivo;
    if (r.maxNSU) maxNSU = r.maxNSU;

    // Consumo indevido: recua ≥ 1h e para.
    if (r.cStat === "656") {
      bloqueado = true;
      await stateRef.set(
        {
          companyId, cnpj, ultNSU, maxNSU,
          status: "bloqueado", ultimoCStat: r.cStat, ultimaMensagem: r.xMotivo,
          ultimaSync: new Date().toISOString(),
          proximaSync: new Date(Date.now() + RECUO_656_MS).toISOString(),
        },
        { merge: true },
      );
      break;
    }

    // Processa documentos do lote.
    for (const d of r.docs) {
      try {
        await salvarDoc(companyId, cnpj, d);
        novos++;
      } catch (e) {
        // não perde o controle do NSU por causa de 1 doc; loga e segue
        console.error("Falha ao salvar doc NSU", d.nsu, (e as Error).message);
      }
    }

    if (r.ultNSU) ultNSU = r.ultNSU;

    // Persiste avanço a cada lote (idempotente/retomável).
    await stateRef.set(
      {
        companyId, cnpj, ultNSU, maxNSU,
        status: "ok", ultimoCStat: r.cStat, ultimaMensagem: r.xMotivo,
        ultimaSync: new Date().toISOString(), proximaSync: null,
      },
      { merge: true },
    );

    // Condições de parada.
    if (r.cStat === "137") break;            // nada novo
    if (r.docs.length === 0) break;          // lote vazio
    if (!menorQue(ultNSU, maxNSU)) break;    // ultNSU alcançou maxNSU
  }

  // Log de integração (sem dados sensíveis).
  await db.collection("nfe_sync_logs").add({
    companyId, cnpj, ambiente,
    ultNSU, maxNSU, novos, iteracoes: iter, cStat, xMotivo,
    at: new Date().toISOString(),
  });

  return { novos, iteracoes: iter, cStat, xMotivo, ultNSU, maxNSU, bloqueado };
}

/** Salva o XML cru no Storage e os metadados no Firestore (idempotente). */
async function salvarDoc(companyId: string, cnpj: string, d: DocZip): Promise<void> {
  const p = parseDoc(d.xml, d.schema);
  const hash = crypto.createHash("sha256").update(d.xml).digest("hex");

  const base = p.dhEmi ? new Date(p.dhEmi) : new Date();
  const ano = String(base.getUTCFullYear());
  const mes = String(base.getUTCMonth() + 1).padStart(2, "0");
  const nomeArq = `${p.chNFe || "nsu"}_${d.nsu}.xml`;
  const storagePath = `nfe/${cnpj}/${ano}/${mes}/${nomeArq}`;

  await getStorage()
    .bucket()
    .file(storagePath)
    .save(Buffer.from(d.xml, "utf8"), { contentType: "application/xml", resumable: false });

  const now = new Date().toISOString();

  if (p.tipo === "evento") {
    const id = `${p.chNFe || "nsu"}_${p.tpEvento || "ev"}_${d.nsu}`;
    await db.collection("nfe_events").doc(id).set(
      {
        companyId, chNFe: p.chNFe, tpEvento: p.tpEvento, descEvento: p.descEvento,
        cStat: p.situacao, nsu: d.nsu, schema: d.schema, storagePath, hashSha256: hash,
        dhEvento: p.dhEmi, updatedAt: now, createdAt: now,
      },
      { merge: true },
    );
    return;
  }

  // NF-e (resumo ou completa). id = chave (idempotente: procNFe enriquece resNFe).
  const id = p.chNFe || `nsu_${d.nsu}`;
  await db.collection("nfe_documents").doc(id).set(
    {
      companyId,
      chNFe: p.chNFe,
      cnpjEmit: p.cnpjEmit ? somenteDigitos(p.cnpjEmit) : null,
      xNomeEmit: p.xNomeEmit,
      xNomeBusca: normalizarBusca(p.xNomeEmit),
      vNF: p.vNF,
      dhEmi: p.dhEmi,
      nNF: p.nNF,
      serie: p.serie,
      situacao: p.situacao,
      schema: d.schema,
      // completo se veio procNFe; senão é só resumo (aguarda manifestação/produção)
      temXmlCompleto: (d.schema || "").toLowerCase().includes("procnfe"),
      nsu: d.nsu,
      storagePath,
      hashSha256: hash,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true },
  );
}
