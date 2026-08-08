import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import {
  REGIAO,
  db,
  exigirRole,
  somenteDigitos,
  cnpjBase,
  agoraISO,
} from "./lib/base";
import { lerMetadadosPfx, pfxParaPem } from "./lib/certificado";
import {
  gravarSegredoCertificado,
  lerSegredoCertificado,
  nomeSegredoCertificado,
} from "./lib/secrets";
import { getStorage } from "firebase-admin/storage";
import { consultarDistribuicaoNSU } from "./sefaz/distribuicao";
import { sincronizarEmpresa, gravarItensEParcelas } from "./sefaz/sincronizacao";
import {
  enviarManifestacao,
  DESC_EVENTO,
  EVENTO_CONCLUSIVO,
  type TpEvento,
} from "./sefaz/manifestacao";
import { consultarDistribuicaoCTeNSU, sincronizarCTe } from "./sefaz/cte";

const opcoes = { region: REGIAO };

/**
 * Cria/atualiza uma empresa (CNPJ) do grupo. Só admin.
 */
export const nfeSalvarEmpresa = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin"]);
  const d = req.data ?? {};

  const cnpj = somenteDigitos(String(d.cnpj ?? ""));
  if (cnpj.length !== 14) {
    throw new HttpsError("invalid-argument", "CNPJ inválido (14 dígitos).");
  }
  const razaoSocial = String(d.razaoSocial ?? "").trim();
  if (!razaoSocial) {
    throw new HttpsError("invalid-argument", "Razão social obrigatória.");
  }
  const ambiente = d.ambiente === "producao" ? "producao" : "homologacao";
  const id = String(d.id ?? cnpj);

  const ref = db.collection("nfe_companies").doc(id);
  const existe = (await ref.get()).exists;
  const now = agoraISO();

  await ref.set(
    {
      id,
      cnpj,
      razaoSocial,
      nomeFantasia: String(d.nomeFantasia ?? "").trim() || undefined,
      inscricaoEstadual: String(d.inscricaoEstadual ?? "").trim() || undefined,
      uf: String(d.uf ?? "").trim().toUpperCase().slice(0, 2),
      ambiente,
      ativo: d.ativo === false ? false : true,
      updatedAt: now,
      ...(existe ? {} : { createdAt: now, createdBy: uid }),
    },
    { merge: true },
  );

  await auditar(uid, existe ? "empresa.atualizar" : "empresa.criar", { id, cnpj });
  return { ok: true, id };
});

/**
 * Cadastra/atualiza o certificado A1 de uma empresa.
 * Recebe o PFX (base64) + senha, VALIDA abrindo o keystore, extrai metadados,
 * grava o segredo no Secret Manager e persiste APENAS metadados no Firestore.
 * A senha e o PFX nunca são logados nem retornados. Só admin.
 */
export const nfeCadastrarCertificado = onCall(
  { ...opcoes, memory: "512MiB" },
  async (req) => {
    const { uid } = exigirRole(req, ["admin"]);
    const d = req.data ?? {};

    const companyId = String(d.companyId ?? "").trim();
    const pfxBase64 = String(d.pfxBase64 ?? "");
    const senha = String(d.senha ?? "");
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");
    if (!pfxBase64) throw new HttpsError("invalid-argument", "Arquivo do certificado ausente.");
    if (!senha) throw new HttpsError("invalid-argument", "Senha do certificado ausente.");

    const empSnap = await db.collection("nfe_companies").doc(companyId).get();
    if (!empSnap.exists) {
      throw new HttpsError("not-found", "Empresa não encontrada.");
    }
    const empresa = empSnap.data() as { cnpj: string; razaoSocial?: string };

    // Valida o PFX + senha e extrai metadados (lança se senha errada).
    let meta;
    try {
      meta = lerMetadadosPfx(pfxBase64, senha);
    } catch {
      // Não logamos o erro cru para não vazar detalhes do arquivo/senha.
      throw new HttpsError(
        "invalid-argument",
        "Não foi possível abrir o certificado. Verifique o arquivo e a senha.",
      );
    }

    // Segurança: o CNPJ do certificado deve casar com o CNPJ base da empresa.
    const baseEmpresa = cnpjBase(empresa.cnpj);
    if (meta.cnpj && cnpjBase(meta.cnpj) !== baseEmpresa) {
      throw new HttpsError(
        "failed-precondition",
        "O CNPJ do certificado não corresponde ao da empresa.",
      );
    }

    // Grava o segredo (JSON { pfxBase64, senha }) no Secret Manager.
    const base = baseEmpresa;
    let secretRef: string;
    try {
      secretRef = await gravarSegredoCertificado(
        base,
        JSON.stringify({ pfxBase64, senha }),
      );
    } catch (e) {
      logger.error("Falha ao gravar segredo do certificado", {
        companyId,
        // nunca logar pfx/senha
        erro: (e as Error).message,
      });
      throw new HttpsError("internal", "Falha ao armazenar o certificado com segurança.");
    }

    // Situação a partir da validade.
    const fim = new Date(meta.validadeFim);
    const dias = Math.ceil((fim.getTime() - Date.now()) / 86_400_000);
    const situacao = dias < 0 ? "vencido" : dias <= 30 ? "vencendo" : "valido";
    const now = agoraISO();

    await db.collection("nfe_certificates").doc(companyId).set(
      {
        id: companyId,
        companyId,
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial ?? meta.titular,
        numeroSerie: meta.numeroSerie,
        emissor: meta.emissor,
        validadeInicio: meta.validadeInicio,
        validadeFim: meta.validadeFim,
        secretRef, // referência, nunca o conteúdo
        situacao,
        updatedAt: now,
        createdAt: now,
        createdBy: uid,
      },
      { merge: true },
    );

    await db
      .collection("nfe_companies")
      .doc(companyId)
      .set({ temCertificado: true, updatedAt: now }, { merge: true });

    await auditar(uid, "certificado.cadastrar", {
      companyId,
      numeroSerie: meta.numeroSerie,
      validadeFim: meta.validadeFim,
      secretRef,
    });

    // Retorna só metadados — nunca o segredo.
    return {
      ok: true,
      numeroSerie: meta.numeroSerie,
      emissor: meta.emissor,
      validadeInicio: meta.validadeInicio,
      validadeFim: meta.validadeFim,
      situacao,
      diasRestantes: dias,
    };
  },
);

/**
 * ETAPA 3 — Milestone 1: teste de conexão com a SEFAZ (NFeDistribuicaoDFe).
 * Faz UMA chamada distDFeInt (ultNSU=0) para validar mTLS + rede + SOAP.
 * Não persiste nada ainda — só retorna o cabeçalho do retorno (cStat/xMotivo/NSU).
 */
export const nfeTestarConexao = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 60 },
  async (req) => {
    const { uid } = exigirRole(req, ["admin", "fiscal"]);
    const companyId = String(req.data?.companyId ?? "").trim();
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");

    const snap = await db.collection("nfe_companies").doc(companyId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Empresa não encontrada.");
    const emp = snap.data() as { cnpj: string; uf: string; ambiente?: string };

    let cred: { pfxBase64: string; senha: string };
    try {
      cred = await lerSegredoCertificado(cnpjBase(emp.cnpj));
    } catch {
      throw new HttpsError(
        "failed-precondition",
        "Certificado não instalado para esta empresa. Instale antes de testar a conexão.",
      );
    }

    const ambiente = emp.ambiente === "producao" ? "producao" : "homologacao";
    try {
      const { key, cert } = pfxParaPem(cred.pfxBase64, cred.senha);
      const r = await consultarDistribuicaoNSU({
        ambiente,
        uf: emp.uf,
        cnpj: somenteDigitos(emp.cnpj),
        ultNSU: "0",
        key,
        cert,
      });
      logger.info("nfeTestarConexao", {
        companyId,
        ambiente,
        cStat: r.cStat,
        xMotivo: r.xMotivo,
        httpStatus: r.httpStatus,
      });
      await auditar(uid, "sefaz.testarConexao", {
        companyId,
        ambiente,
        cStat: r.cStat,
        maxNSU: r.maxNSU,
      });
      return { ok: true, ambiente, ...r };
    } catch (e) {
      // Retorna o erro (não lança) para a tela poder mostrar o diagnóstico.
      const msg = (e as Error).message || String(e);
      logger.error("nfeTestarConexao falhou", { companyId, ambiente, erro: msg });
      return { ok: false, ambiente, erro: msg };
    }
  },
);

/**
 * ETAPA 3 — Milestone 2: sincronização real (baixa/guarda/parseia as NF-e).
 * Faz o loop distNSU até esgotar, salva XML cru no Storage e metadados no
 * Firestore, persistindo o NSU (retomável). Só admin/fiscal.
 */
export const nfeSincronizarAgora = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 540 },
  async (req) => {
    const { uid } = exigirRole(req, ["admin", "fiscal"]);
    const companyId = String(req.data?.companyId ?? "").trim();
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");

    const snap = await db.collection("nfe_companies").doc(companyId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Empresa não encontrada.");
    const emp = snap.data() as { cnpj: string; uf: string; ambiente?: string };

    let cred: { pfxBase64: string; senha: string };
    try {
      cred = await lerSegredoCertificado(cnpjBase(emp.cnpj));
    } catch {
      throw new HttpsError("failed-precondition", "Certificado não instalado para esta empresa.");
    }

    try {
      const { key, cert } = pfxParaPem(cred.pfxBase64, cred.senha);
      const r = await sincronizarEmpresa(
        { id: companyId, cnpj: emp.cnpj, uf: emp.uf, ambiente: emp.ambiente },
        key,
        cert,
      );
      await auditar(uid, "sefaz.sincronizar", {
        companyId, novos: r.novos, ultNSU: r.ultNSU, maxNSU: r.maxNSU,
      });
      return { ok: true, ...r };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("nfeSincronizarAgora falhou", { companyId, erro: msg });
      return { ok: false, erro: msg };
    }
  },
);

/**
 * CT-e (fretes) — teste de conexão com o CTeDistribuicaoDFe (Ambiente Nacional).
 * Uma chamada distDFeInt (ultNSU=0) para validar mTLS + contrato SOAP. Só admin/fiscal.
 */
export const cteTestarConexao = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 60 },
  async (req) => {
    const { uid } = exigirRole(req, ["admin", "fiscal"]);
    const companyId = String(req.data?.companyId ?? "").trim();
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");

    const snap = await db.collection("nfe_companies").doc(companyId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Empresa não encontrada.");
    const emp = snap.data() as { cnpj: string; uf: string; ambiente?: string };

    let cred: { pfxBase64: string; senha: string };
    try {
      cred = await lerSegredoCertificado(cnpjBase(emp.cnpj));
    } catch {
      throw new HttpsError("failed-precondition", "Certificado não instalado para esta empresa.");
    }

    const ambiente = emp.ambiente === "producao" ? "producao" : "homologacao";
    try {
      const { key, cert } = pfxParaPem(cred.pfxBase64, cred.senha);
      const r = await consultarDistribuicaoCTeNSU({
        ambiente, uf: emp.uf, cnpj: somenteDigitos(emp.cnpj), ultNSU: "0", key, cert,
      });
      logger.info("cteTestarConexao", { companyId, ambiente, cStat: r.cStat, xMotivo: r.xMotivo, httpStatus: r.httpStatus });
      await auditar(uid, "cte.testarConexao", { companyId, ambiente, cStat: r.cStat, maxNSU: r.maxNSU });
      return { ok: true, ambiente, cStat: r.cStat, xMotivo: r.xMotivo, ultNSU: r.ultNSU, maxNSU: r.maxNSU, verAplic: r.verAplic, httpStatus: r.httpStatus };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("cteTestarConexao falhou", { companyId, ambiente, erro: msg });
      return { ok: false, ambiente, erro: msg };
    }
  },
);

/** CT-e — sincronização real (baixa/guarda/parseia os CT-e). Só admin/fiscal. */
export const cteSincronizarAgora = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 540 },
  async (req) => {
    const { uid } = exigirRole(req, ["admin", "fiscal"]);
    const companyId = String(req.data?.companyId ?? "").trim();
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");

    const snap = await db.collection("nfe_companies").doc(companyId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Empresa não encontrada.");
    const emp = snap.data() as { cnpj: string; uf: string; ambiente?: string };

    let cred: { pfxBase64: string; senha: string };
    try {
      cred = await lerSegredoCertificado(cnpjBase(emp.cnpj));
    } catch {
      throw new HttpsError("failed-precondition", "Certificado não instalado para esta empresa.");
    }

    try {
      const { key, cert } = pfxParaPem(cred.pfxBase64, cred.senha);
      const r = await sincronizarCTe({ id: companyId, cnpj: emp.cnpj, uf: emp.uf, ambiente: emp.ambiente }, key, cert);
      await auditar(uid, "cte.sincronizar", { companyId, novos: r.novos, ultNSU: r.ultNSU, maxNSU: r.maxNSU });
      return { ok: true, ...r };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("cteSincronizarAgora falhou", { companyId, erro: msg });
      return { ok: false, erro: msg };
    }
  },
);

/**
 * Sincronização automática (sem navegador). A cada 6h, percorre as empresas
 * ativas com certificado, respeitando o recuo do 656 (proximaSync).
 */
export const nfeSyncAgendado = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/Sao_Paulo",
    region: REGIAO,
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const empresas = await db.collection("nfe_companies").where("ativo", "==", true).get();
    for (const doc of empresas.docs) {
      const emp = doc.data() as { cnpj: string; uf: string; ambiente?: string; temCertificado?: boolean };
      if (!emp.temCertificado) continue;
      const st = (await db.collection("nfe_sync_state").doc(doc.id).get()).data() as
        | { proximaSync?: string | null }
        | undefined;
      if (st?.proximaSync && new Date(st.proximaSync).getTime() > Date.now()) continue;
      try {
        const cred = await lerSegredoCertificado(cnpjBase(emp.cnpj));
        const { key, cert } = pfxParaPem(cred.pfxBase64, cred.senha);
        const alvo = { id: doc.id, cnpj: emp.cnpj, uf: emp.uf, ambiente: emp.ambiente };
        await sincronizarEmpresa(alvo, key, cert);
        // CT-e (fretes) — NSU próprio; respeita seu próprio recuo 656.
        try {
          await sincronizarCTe(alvo, key, cert);
        } catch (e) {
          logger.error("nfeSyncAgendado: CT-e falhou", { companyId: doc.id, erro: (e as Error).message });
        }
      } catch (e) {
        logger.error("nfeSyncAgendado: empresa falhou", { companyId: doc.id, erro: (e as Error).message });
      }
    }
  },
);

/**
 * Backfill: reprocessa as NF-e COMPLETAS já baixadas, lendo o XML do Storage e
 * extraindo itens (nfe_items) e parcelas (nfe_installments). Idempotente.
 */
export const nfeReprocessarItens = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 540 },
  async (req) => {
    const { uid } = exigirRole(req, ["admin", "fiscal"]);
    const companyId = String(req.data?.companyId ?? "").trim();
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");

    const snap = await db.collection("nfe_documents").where("companyId", "==", companyId).get();
    let docs = 0;
    let itens = 0;
    let parcelas = 0;
    let erros = 0;
    for (const d of snap.docs) {
      const data = d.data() as {
        temXmlCompleto?: boolean;
        storagePath?: string;
        chNFe?: string;
        cnpjEmit?: string | null;
        xNomeEmit?: string | null;
        dhEmi?: string | null;
      };
      if (!data.temXmlCompleto || !data.storagePath || !data.chNFe) continue;
      try {
        const [buf] = await getStorage().bucket().file(data.storagePath).download();
        const r = await gravarItensEParcelas(
          {
            companyId,
            chNFe: data.chNFe,
            cnpjEmit: data.cnpjEmit ?? null,
            xNomeEmit: data.xNomeEmit ?? null,
            dhEmi: data.dhEmi ?? null,
          },
          buf.toString("utf8"),
        );
        docs++;
        itens += r.itens;
        parcelas += r.parcelas;
      } catch (e) {
        erros++;
        logger.error("nfeReprocessarItens: doc falhou", { id: d.id, erro: (e as Error).message });
      }
    }
    await auditar(uid, "nfe.reprocessarItens", { companyId, docs, itens, parcelas, erros });
    return { ok: true, docs, itens, parcelas, erros };
  },
);

/**
 * Manifestação do destinatário (evento oficial à SEFAZ). Só admin/fiscal.
 * Eventos conclusivos exigem confirmação explícita (garantida na UI); a
 * Ciência é provisória. Op. não Realizada (210240) exige xJust 15–255.
 */
export const nfeManifestar = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 60 },
  async (req) => {
    const { uid } = exigirRole(req, ["admin", "fiscal"]);
    const d = req.data ?? {};
    const companyId = String(d.companyId ?? "").trim();
    const chNFe = somenteDigitos(String(d.chNFe ?? ""));
    const tpEvento = String(d.tpEvento ?? "") as TpEvento;
    const xJust = String(d.xJust ?? "").trim();

    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");
    if (chNFe.length !== 44) throw new HttpsError("invalid-argument", "Chave de acesso inválida.");
    if (!DESC_EVENTO[tpEvento]) throw new HttpsError("invalid-argument", "Tipo de evento inválido.");
    if (tpEvento === "210240" && (xJust.length < 15 || xJust.length > 255)) {
      throw new HttpsError("invalid-argument", "Justificativa deve ter entre 15 e 255 caracteres.");
    }

    const empSnap = await db.collection("nfe_companies").doc(companyId).get();
    if (!empSnap.exists) throw new HttpsError("not-found", "Empresa não encontrada.");
    const emp = empSnap.data() as { cnpj: string; ambiente?: string };

    let cred: { pfxBase64: string; senha: string };
    try {
      cred = await lerSegredoCertificado(cnpjBase(emp.cnpj));
    } catch {
      throw new HttpsError("failed-precondition", "Certificado não instalado para esta empresa.");
    }

    const ambiente = emp.ambiente === "producao" ? "producao" : "homologacao";
    const now = agoraISO();
    try {
      const { key, cert } = pfxParaPem(cred.pfxBase64, cred.senha);
      const r = await enviarManifestacao({
        ambiente,
        cnpj: somenteDigitos(emp.cnpj),
        chNFe,
        tpEvento,
        xJust: tpEvento === "210240" ? xJust : undefined,
        key,
        cert,
      });

      // Registra a manifestação (sempre, mesmo se rejeitada — rastreabilidade).
      await db.collection("nfe_manifestations").add({
        companyId,
        chNFe,
        tpEvento,
        descEvento: DESC_EVENTO[tpEvento],
        conclusivo: EVENTO_CONCLUSIVO[tpEvento],
        xJust: tpEvento === "210240" ? xJust : null,
        cStat: r.cStatEvento,
        xMotivo: r.xMotivoEvento,
        nProt: r.nProt,
        dhRegEvento: r.dhRegEvento,
        ok: r.ok,
        uid,
        ambiente,
        at: now,
      });

      // Atualiza o status de manifestação da nota, se aceito.
      if (r.ok) {
        await db.collection("nfe_documents").doc(chNFe).set(
          {
            manifestStatus: DESC_EVENTO[tpEvento],
            manifestTpEvento: tpEvento,
            manifestEm: now,
            updatedAt: now,
          },
          { merge: true },
        );
      }

      await auditar(uid, "sefaz.manifestar", {
        companyId, chNFe, tpEvento, cStat: r.cStatEvento, nProt: r.nProt,
      });
      return { ...r };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("nfeManifestar falhou", { companyId, chNFe, tpEvento, erro: msg });
      return { ok: false, erro: msg };
    }
  },
);

/**
 * Baixa (conciliação) de uma parcela: marca como paga ou reabre.
 * IMPORTANTE: "pago" NUNCA é inferido do XML — é sempre uma ação manual,
 * registrada com autor e horário. Só admin/financeiro.
 */
export const nfeBaixarParcela = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin", "financeiro"]);
  const d = req.data ?? {};
  const parcelaId = String(d.parcelaId ?? "").trim();
  if (!parcelaId) throw new HttpsError("invalid-argument", "parcelaId obrigatório.");
  const pago = d.pago !== false; // default = marcar como paga

  const ref = db.collection("nfe_installments").doc(parcelaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Parcela não encontrada.");
  const now = agoraISO();

  if (pago) {
    const valorPago =
      d.valorPago != null && Number.isFinite(Number(d.valorPago)) ? Number(d.valorPago) : null;
    // dataPagamento em YYYY-MM-DD; default = hoje.
    const dataPagamento = /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataPagamento ?? ""))
      ? String(d.dataPagamento)
      : now.slice(0, 10);
    const obsPagamento = String(d.obsPagamento ?? "").trim().slice(0, 300) || null;
    await ref.set(
      {
        statusPagamento: "pago",
        dataPagamento,
        valorPago,
        obsPagamento,
        baixadoPor: uid,
        baixadoEm: now,
        updatedAt: now,
      },
      { merge: true },
    );
  } else {
    // Reabre: volta a "nao_informado" e limpa os campos da baixa.
    await ref.set(
      {
        statusPagamento: "nao_informado",
        dataPagamento: FieldValue.delete(),
        valorPago: FieldValue.delete(),
        obsPagamento: FieldValue.delete(),
        baixadoPor: FieldValue.delete(),
        baixadoEm: FieldValue.delete(),
        reabertoPor: uid,
        reabertoEm: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  await auditar(uid, pago ? "financeiro.baixarParcela" : "financeiro.reabrirParcela", {
    parcelaId,
    valorPago: d.valorPago ?? null,
    dataPagamento: pago ? String(d.dataPagamento ?? "") : null,
  });
  return { ok: true, statusPagamento: pago ? "pago" : "nao_informado" };
});

/**
 * Baixa em lote: marca várias parcelas como pagas de uma vez (mesma data/obs).
 * Lê o valor real de cada parcela no servidor (valorPago = valor). Só admin/financeiro.
 */
export const nfeBaixarParcelasLote = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin", "financeiro"]);
  const d = req.data ?? {};
  const ids: string[] = Array.isArray(d.parcelaIds)
    ? [...new Set((d.parcelaIds as unknown[]).map((x) => String(x).trim()).filter((s) => s !== ""))]
    : [];
  if (ids.length === 0) throw new HttpsError("invalid-argument", "Nenhuma parcela informada.");
  if (ids.length > 400) throw new HttpsError("invalid-argument", "Máximo de 400 parcelas por lote.");

  const now = agoraISO();
  const dataPagamento = /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataPagamento ?? ""))
    ? String(d.dataPagamento)
    : now.slice(0, 10);
  const obsPagamento = String(d.obsPagamento ?? "").trim().slice(0, 300) || null;

  const refs = ids.map((id) => db.collection("nfe_installments").doc(id));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let total = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const p = snap.data() as { valor?: number };
    batch.set(
      snap.ref,
      {
        statusPagamento: "pago",
        dataPagamento,
        valorPago: typeof p.valor === "number" ? p.valor : null,
        obsPagamento,
        baixadoPor: uid,
        baixadoEm: now,
        updatedAt: now,
      },
      { merge: true },
    );
    total++;
  }
  await batch.commit();
  await auditar(uid, "financeiro.baixarLote", { total, dataPagamento });
  return { ok: true, total };
});

/**
 * Cria/atualiza um ACORDO de renegociação com um fornecedor (dívidas atrasadas).
 * Guarda as parcelas renegociadas (valor + vencimento + status). Só admin/financeiro.
 */
export const nfeSalvarAcordo = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin", "financeiro"]);
  const d = req.data ?? {};
  const id = String(d.id ?? "").trim();
  const nomeFornecedor = String(d.nomeFornecedor ?? "").trim().slice(0, 120);
  if (!nomeFornecedor) throw new HttpsError("invalid-argument", "Fornecedor obrigatório.");

  const parcelasIn = Array.isArray(d.parcelas) ? d.parcelas : [];
  if (parcelasIn.length === 0) throw new HttpsError("invalid-argument", "Inclua ao menos uma parcela.");
  if (parcelasIn.length > 60) throw new HttpsError("invalid-argument", "Máximo de 60 parcelas.");

  const now = agoraISO();
  const parcelas = parcelasIn.map((p: Record<string, unknown>, i: number) => {
    const valor = Number(p.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new HttpsError("invalid-argument", `Valor inválido na parcela ${i + 1}.`);
    }
    const vencimento = String(p.vencimento ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
      throw new HttpsError("invalid-argument", `Vencimento inválido na parcela ${i + 1}.`);
    }
    const pago = p.statusPagamento === "pago";
    const dataPagamento =
      pago && /^\d{4}-\d{2}-\d{2}$/.test(String(p.dataPagamento ?? ""))
        ? String(p.dataPagamento)
        : pago
          ? now.slice(0, 10)
          : null;
    return { n: i + 1, valor, vencimento, statusPagamento: pago ? "pago" : "pendente", dataPagamento };
  });
  const valorAcordado = parcelas.reduce((s: number, p: { valor: number }) => s + p.valor, 0);
  const valorOriginal = Number(d.valorOriginal);

  const ref = id
    ? db.collection("nfe_agreements").doc(id)
    : db.collection("nfe_agreements").doc();
  const existe = id ? (await ref.get()).exists : false;

  await ref.set(
    {
      id: ref.id,
      cnpjFornecedor: somenteDigitos(String(d.cnpjFornecedor ?? "")) || null,
      nomeFornecedor,
      descricao: String(d.descricao ?? "").trim().slice(0, 200) || null,
      observacao: String(d.observacao ?? "").trim().slice(0, 500) || null,
      parcelas,
      valorAcordado,
      valorOriginal: Number.isFinite(valorOriginal) && valorOriginal > 0 ? valorOriginal : null,
      updatedAt: now,
      ...(existe ? {} : { createdAt: now, createdBy: uid }),
    },
    { merge: true },
  );

  await auditar(uid, existe ? "acordo.atualizar" : "acordo.criar", {
    id: ref.id,
    nomeFornecedor,
    valorAcordado,
    parcelas: parcelas.length,
  });
  return { ok: true, id: ref.id };
});

/** Marca uma parcela de um acordo como paga ou reabre. Só admin/financeiro. */
export const nfeBaixarParcelaAcordo = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin", "financeiro"]);
  const d = req.data ?? {};
  const id = String(d.acordoId ?? "").trim();
  const idx = Number(d.indice);
  const pago = d.pago !== false;
  if (!id) throw new HttpsError("invalid-argument", "acordoId obrigatório.");

  const ref = db.collection("nfe_agreements").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Acordo não encontrado.");
  const data = snap.data() as { parcelas?: Array<Record<string, unknown>> };
  const parcelas = Array.isArray(data.parcelas) ? [...data.parcelas] : [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= parcelas.length) {
    throw new HttpsError("invalid-argument", "Parcela inexistente.");
  }
  const now = agoraISO();
  const dataPagamento = pago
    ? /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataPagamento ?? ""))
      ? String(d.dataPagamento)
      : now.slice(0, 10)
    : null;
  parcelas[idx] = {
    ...parcelas[idx],
    statusPagamento: pago ? "pago" : "pendente",
    dataPagamento,
  };
  await ref.set({ parcelas, updatedAt: now }, { merge: true });
  await auditar(uid, pago ? "acordo.baixarParcela" : "acordo.reabrirParcela", { id, indice: idx });
  return { ok: true };
});

/** Exclui um acordo. Só admin/financeiro. */
export const nfeExcluirAcordo = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin", "financeiro"]);
  const id = String(req.data?.acordoId ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "acordoId obrigatório.");
  await db.collection("nfe_agreements").doc(id).delete();
  await auditar(uid, "acordo.excluir", { id });
  return { ok: true };
});

/**
 * Cria/atualiza uma DESPESA FIXA recorrente (aluguel, luz, internet, contabilidade…).
 * Guarda valor mensal previsto + dia de vencimento. Só admin/financeiro.
 */
export const nfeSalvarDespesaFixa = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin", "financeiro"]);
  const d = req.data ?? {};
  const id = String(d.id ?? "").trim();
  const nome = String(d.nome ?? "").trim().slice(0, 120);
  if (!nome) throw new HttpsError("invalid-argument", "Nome da despesa obrigatório.");
  const valor = Number(d.valor);
  if (!Number.isFinite(valor) || valor < 0) throw new HttpsError("invalid-argument", "Valor inválido.");

  const diaNum = Math.floor(Number(d.diaVencimento));
  const diaVencimento = Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 31 ? diaNum : null;
  const now = agoraISO();

  const ref = id
    ? db.collection("nfe_fixed_expenses").doc(id)
    : db.collection("nfe_fixed_expenses").doc();
  const existe = id ? (await ref.get()).exists : false;

  await ref.set(
    {
      id: ref.id,
      nome,
      categoria: String(d.categoria ?? "outros").trim().slice(0, 40) || "outros",
      valor,
      diaVencimento,
      beneficiario: String(d.beneficiario ?? "").trim().slice(0, 120) || null,
      observacao: String(d.observacao ?? "").trim().slice(0, 300) || null,
      ativo: d.ativo === false ? false : true,
      updatedAt: now,
      ...(existe ? {} : { createdAt: now, createdBy: uid, pagamentos: {} }),
    },
    { merge: true },
  );

  await auditar(uid, existe ? "despesaFixa.atualizar" : "despesaFixa.criar", { id: ref.id, nome, valor });
  return { ok: true, id: ref.id };
});

/** Marca uma despesa fixa como paga (ou reabre) num mês (YYYY-MM). Só admin/financeiro. */
export const nfePagarDespesaFixa = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin", "financeiro"]);
  const d = req.data ?? {};
  const id = String(d.id ?? "").trim();
  const mes = String(d.mes ?? "");
  const pago = d.pago !== false;
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new HttpsError("invalid-argument", "Mês inválido (YYYY-MM).");

  const ref = db.collection("nfe_fixed_expenses").doc(id);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Despesa não encontrada.");
  const now = agoraISO();
  const campo = `pagamentos.${mes}`;

  if (pago) {
    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(d.data ?? "")) ? String(d.data) : `${mes}-01`;
    const valor = Number(d.valor);
    await ref.update({
      [campo]: {
        pago: true,
        data,
        valor: Number.isFinite(valor) && valor > 0 ? valor : null,
        por: uid,
        em: now,
      },
      updatedAt: now,
    });
  } else {
    await ref.update({ [campo]: FieldValue.delete(), updatedAt: now });
  }

  await auditar(uid, pago ? "despesaFixa.pagar" : "despesaFixa.reabrir", { id, mes });
  return { ok: true };
});

/** Exclui uma despesa fixa. Só admin/financeiro. */
export const nfeExcluirDespesaFixa = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin", "financeiro"]);
  const id = String(req.data?.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  await db.collection("nfe_fixed_expenses").doc(id).delete();
  await auditar(uid, "despesaFixa.excluir", { id });
  return { ok: true };
});

/** Registra evento de auditoria (rastreabilidade). */
async function auditar(uid: string, acao: string, detalhe: Record<string, unknown>) {
  await db.collection("audit_logs").add({
    uid,
    acao,
    detalhe,
    at: FieldValue.serverTimestamp(),
    atISO: agoraISO(),
  });
}

// Placeholder de referência (não deployar sem billing/Secret Manager):
// nomeSegredoCertificado é reexportado para uso nas Etapas 3–4 (sync/manifestação).
export const _internal = { nomeSegredoCertificado };
