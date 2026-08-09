import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import {
  REGIAO,
  db,
  exigirRole,
  exigirAcao,
  exigirModulo,
  somenteDigitos,
  cnpjBase,
  agoraISO,
} from "./lib/base";
import { lerMetadadosPfx, pfxParaPem } from "./lib/certificado";
import {
  gravarSegredoCertificado,
  lerSegredoCertificado,
  nomeSegredoCertificado,
  gravarSegredoPdvnet,
  lerSegredoPdvnet,
} from "./lib/secrets";
import { PdvnetClient } from "./pdvnet/client";
import { sincronizarVendas, materializarLojas } from "./pdvnet/sincronizar-vendas";
import { parseOFX } from "./banco/ofx";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { consultarDistribuicaoNSU } from "./sefaz/distribuicao";
import { sincronizarEmpresa, gravarItensEParcelas } from "./sefaz/sincronizacao";
import {
  enviarManifestacao,
  DESC_EVENTO,
  EVENTO_CONCLUSIVO,
  type TpEvento,
} from "./sefaz/manifestacao";
import { consultarDistribuicaoCTeNSU, sincronizarCTe } from "./sefaz/cte";
import { consultarDFeNfseRaw, decodeArquivoXml, sincronizarNfse } from "./sefaz/nfse";

const opcoes = { region: REGIAO };

/**
 * Cria/atualiza uma empresa (CNPJ) do grupo. Só admin.
 */
export const nfeSalvarEmpresa = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "empresas.gerir", ["admin"]);
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
    const { uid } = await exigirAcao(req, "certificado.gerir", ["admin"]);
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
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
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
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
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
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
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
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
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
 * NFS-e Nacional (serviços) — SONDAGEM do contrato do ADN. Faz um GET /DFe/{nsu}
 * real e devolve o status HTTP + trecho cru da resposta (JSON), para ajustar o
 * parser ao schema oficial antes do sync definitivo. Só admin/fiscal.
 */
export const nfseSondarContrato = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 60 },
  async (req) => {
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
    const companyId = String(req.data?.companyId ?? "").trim();
    const nsu = String(req.data?.nsu ?? "0").replace(/\D/g, "") || "0";
    const ambiente = req.data?.ambiente === "producao" ? "producao" : "homologacao";
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");

    const snap = await db.collection("nfe_companies").doc(companyId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Empresa não encontrada.");
    const emp = snap.data() as { cnpj: string };

    let cred: { pfxBase64: string; senha: string };
    try {
      cred = await lerSegredoCertificado(cnpjBase(emp.cnpj));
    } catch {
      throw new HttpsError("failed-precondition", "Certificado não instalado para esta empresa.");
    }

    try {
      const { key, cert } = pfxParaPem(cred.pfxBase64, cred.senha);
      const r = await consultarDFeNfseRaw({ ambiente, nsu, key, cert });
      logger.info("nfseSondarContrato", { companyId, ambiente, nsu, httpStatus: r.httpStatus, len: r.body.length });
      await auditar(uid, "nfse.sondar", { companyId, ambiente, nsu, httpStatus: r.httpStatus });

      // Decodifica o 1º documento (base64+gzip → XML) para inspeção do schema.
      let primeiroXml: string | null = null;
      let status: string | null = null;
      let qtd = 0;
      let campos: string[] = [];
      try {
        const j = JSON.parse(r.body) as {
          StatusProcessamento?: string;
          LoteDFe?: Array<Record<string, unknown>>;
        };
        status = j.StatusProcessamento ?? null;
        const lote = Array.isArray(j.LoteDFe) ? j.LoteDFe : [];
        qtd = lote.length;
        if (lote[0]) campos = Object.keys(lote[0]);
        const b64 = lote[0]?.ArquivoXml as string | undefined;
        if (b64) primeiroXml = decodeArquivoXml(b64).slice(0, 4000);
      } catch {
        // resposta não-JSON — retorna o corpo cru abaixo.
      }

      return {
        ok: true,
        ambiente,
        nsu,
        httpStatus: r.httpStatus,
        status,
        qtd,
        camposItem: campos,
        bodyHead: r.body.slice(0, 500),
        primeiroXml,
      };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("nfseSondarContrato falhou", { companyId, ambiente, erro: msg });
      return { ok: false, ambiente, nsu, erro: msg };
    }
  },
);

/** NFS-e Nacional — sincronização real (baixa/parseia/guarda os serviços). Só admin/fiscal. */
export const nfseSincronizarAgora = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 540 },
  async (req) => {
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
    const companyId = String(req.data?.companyId ?? "").trim();
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório.");

    const snap = await db.collection("nfe_companies").doc(companyId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Empresa não encontrada.");
    const emp = snap.data() as { cnpj: string; ambiente?: string };

    let cred: { pfxBase64: string; senha: string };
    try {
      cred = await lerSegredoCertificado(cnpjBase(emp.cnpj));
    } catch {
      throw new HttpsError("failed-precondition", "Certificado não instalado para esta empresa.");
    }

    try {
      const { key, cert } = pfxParaPem(cred.pfxBase64, cred.senha);
      const r = await sincronizarNfse({ id: companyId, cnpj: emp.cnpj, ambiente: emp.ambiente }, key, cert);
      await auditar(uid, "nfse.sincronizar", { companyId, novos: r.novos, ultNSU: r.ultNSU });
      return { ok: true, ...r };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("nfseSincronizarAgora falhou", { companyId, erro: msg });
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
        // NFS-e Nacional (serviços) — ADN, NSU próprio.
        try {
          await sincronizarNfse(alvo, key, cert);
        } catch (e) {
          logger.error("nfeSyncAgendado: NFS-e falhou", { companyId: doc.id, erro: (e as Error).message });
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
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
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
    const { uid } = await exigirAcao(req, "nfe.manifestar", ["admin", "fiscal"]);
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
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
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
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
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
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
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

  const companyIdIn = String(d.companyId ?? "").trim();
  const empresa = await resolverEmpresa(companyIdIn);
  if (companyIdIn && !empresa) throw new HttpsError("invalid-argument", "Empresa inválida.");

  const ref = id
    ? db.collection("nfe_agreements").doc(id)
    : db.collection("nfe_agreements").doc();
  const existe = id ? (await ref.get()).exists : false;

  await ref.set(
    {
      id: ref.id,
      companyId: empresa?.id ?? null,
      empresaNome: empresa?.nome ?? null,
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
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
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
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
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
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const id = String(d.id ?? "").trim();
  const nome = String(d.nome ?? "").trim().slice(0, 120);
  if (!nome) throw new HttpsError("invalid-argument", "Nome da despesa obrigatório.");
  const valor = Number(d.valor);
  if (!Number.isFinite(valor) || valor < 0) throw new HttpsError("invalid-argument", "Valor inválido.");

  const diaNum = Math.floor(Number(d.diaVencimento));
  const diaVencimento = Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 31 ? diaNum : null;
  const now = agoraISO();

  const companyIdIn = String(d.companyId ?? "").trim();
  const empresa = await resolverEmpresa(companyIdIn);
  if (companyIdIn && !empresa) throw new HttpsError("invalid-argument", "Empresa inválida.");

  const ref = id
    ? db.collection("nfe_fixed_expenses").doc(id)
    : db.collection("nfe_fixed_expenses").doc();
  const existe = id ? (await ref.get()).exists : false;

  await ref.set(
    {
      id: ref.id,
      companyId: empresa?.id ?? null,
      empresaNome: empresa?.nome ?? null,
      nome,
      categoria: String(d.categoria ?? "outros").trim().slice(0, 40) || "outros",
      valor,
      recorrencia: ["mensal", "bimestral", "trimestral", "semestral", "anual"].includes(String(d.recorrencia))
        ? String(d.recorrencia)
        : "mensal",
      mesBase:
        Number.isInteger(Number(d.mesBase)) && Number(d.mesBase) >= 1 && Number(d.mesBase) <= 12
          ? Number(d.mesBase)
          : null,
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
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const id = String(d.id ?? "").trim();
  const mes = String(d.mes ?? "");
  const pago = d.pago !== false;
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new HttpsError("invalid-argument", "Mês inválido (YYYY-MM).");

  const ref = db.collection("nfe_fixed_expenses").doc(id);
  const dsnap = await ref.get();
  if (!dsnap.exists) throw new HttpsError("not-found", "Despesa não encontrada.");
  const previsto = (dsnap.data() as { valor?: number }).valor ?? null;
  const now = agoraISO();
  const campo = `pagamentos.${mes}`;

  if (pago) {
    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(d.data ?? "")) ? String(d.data) : `${mes}-01`;
    const valor = Number(d.valor); // valor REAL pago (pode diferir do previsto)
    await ref.update({
      [campo]: {
        pago: true,
        data,
        valor: Number.isFinite(valor) && valor > 0 ? valor : previsto,
        previsto,
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
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const id = String(req.data?.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  await db.collection("nfe_fixed_expenses").doc(id).delete();
  await auditar(uid, "despesaFixa.excluir", { id });
  return { ok: true };
});

// ============ PDVnet (Etapa 2 — integração financeira) ============

/** Salva as credenciais do PDVnet no Secret Manager (a senha nunca fica no Firestore). Só admin. */
export const pdvnetSalvarCredenciais = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin"]);
  const d = req.data ?? {};
  const usuario = String(d.usuario ?? "").trim();
  const senha = String(d.senha ?? "");
  let baseUrl = String(d.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!usuario || !senha || !baseUrl) {
    throw new HttpsError("invalid-argument", "Informe usuário, senha e URL base.");
  }
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = "http://" + baseUrl;
  await gravarSegredoPdvnet({ usuario, senha, baseUrl });
  await db.collection("configuracoes").doc("pdvnet").set(
    { temCredenciais: true, baseUrl, atualizadoPor: uid, atualizadoEm: agoraISO() },
    { merge: true },
  );
  await auditar(uid, "pdvnet.salvarCredenciais", { baseUrl });
  return { ok: true };
});

/** Status da integração PDVnet (tem credenciais? qual baseUrl?). */
export const pdvnetStatus = onCall(opcoes, async (req) => {
  if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Autenticação necessária.");
  const snap = await db.collection("configuracoes").doc("pdvnet").get();
  const d = (snap.data() ?? {}) as { temCredenciais?: boolean; baseUrl?: string };
  return { temCredenciais: !!d.temCredenciais, baseUrl: d.baseUrl ?? null };
});

/**
 * SONDAGEM de vendas: login real + 1 página de /vendas dos últimos N dias.
 * Confirma o contrato (formas de pagamento + ParcelasCartao) antes do sync pleno.
 * Não grava nada. admin/fiscal (ação integracoes.sincronizar).
 */
export const pdvnetSondarVendas = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
    const dias = Math.min(Math.max(Math.floor(Number(req.data?.dias ?? 3)), 1), 31);
    let cred;
    try {
      cred = await lerSegredoPdvnet();
    } catch {
      throw new HttpsError("failed-precondition", "Credenciais do PDVnet não configuradas.");
    }
    const cli = new PdvnetClient(cred);
    const hoje = new Date();
    const ini = new Date(hoje.getTime() - dias * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    try {
      const lojas = await cli.listarLojas();
      const resp = await cli.listarVendas(fmt(ini), fmt(hoje), { pagina: 1, tamanhoPagina: 50 });
      const vendas = resp.Registros ?? [];
      const amostra = vendas.find((v) => (v.ParcelasCartao?.length ?? 0) > 0) ?? vendas[0];
      await auditar(uid, "pdvnet.sondar", { dias, qtd: vendas.length });
      return {
        ok: true,
        periodo: { inicio: fmt(ini), fim: fmt(hoje) },
        totalPagina: vendas.length,
        totalRegistros: resp.PaginacaoInfo?.TotalRegistros ?? null,
        lojas: lojas.map((l) => ({ id: l.Id, nome: l.NomeFantasia || l.RazaoSocial, inativa: l.Inativa })),
        amostra: amostra
          ? {
              id: amostra.Id,
              lojaId: amostra.LojaId,
              dataHora: amostra.DataHora,
              valorTotal: amostra.ValorTotal,
              inativa: amostra.Inativa,
              pagamentos: {
                dinheiro: amostra.ValorDinheiro ?? 0,
                pix: amostra.ValorPix ?? 0,
                cartaoDebito: amostra.ValorCartaoDebito ?? 0,
                cartaoParcelado: amostra.ValorCartaoParcelado ?? 0,
                cartaoRotativo: amostra.ValorCartaoRotativo ?? 0,
                crediario: amostra.ValorCrediario ?? 0,
              },
              parcelasCartao: (amostra.ParcelasCartao ?? []).slice(0, 6),
              documentosFiscais: amostra.DocumentosFiscais ?? [],
              qtdItens: (amostra.Itens ?? []).length,
            }
          : null,
      };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("pdvnetSondarVendas falhou", { erro: msg });
      return { ok: false, erro: msg };
    }
  },
);

/**
 * Sincroniza as vendas do PDVnet (mês corrente por padrão) → sales +
 * sale_payments + card_receivables, escopadas às lojas ativas. admin/fiscal.
 */
export const pdvnetSincronizarVendas = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 540 },
  async (req) => {
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
    let cred;
    try {
      cred = await lerSegredoPdvnet();
    } catch {
      throw new HttpsError("failed-precondition", "Credenciais do PDVnet não configuradas.");
    }
    const cli = new PdvnetClient(cred);
    const hoje = new Date();
    const dias = Math.floor(Number(req.data?.dias ?? 0));
    const ini = dias > 0
      ? new Date(hoje.getTime() - dias * 86_400_000)
      : new Date(hoje.getFullYear(), hoje.getMonth(), 1); // 1º dia do mês corrente
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    try {
      const r = await sincronizarVendas(cli, fmt(ini), fmt(hoje));
      await auditar(uid, "pdvnet.sincronizarVendas", { periodo: `${fmt(ini)}..${fmt(hoje)}`, vendas: r.vendas });
      return { ok: true, periodo: { inicio: fmt(ini), fim: fmt(hoje) }, ...r };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("pdvnetSincronizarVendas falhou", { erro: msg });
      return { ok: false, erro: msg };
    }
  },
);

/**
 * Sincronização AUTOMÁTICA diária das vendas do PDVnet (06:00 BRT).
 * Reprocessa os últimos ~35 dias (mês corrente + virada de mês + atualização das
 * liquidações de cartão). Idempotente (merge). Preserva o agrupamento manual das
 * lojas (materializarLojas respeita ativoSync/grupoNome já definidos).
 */
export const pdvnetSyncVendasAgendado = onSchedule(
  {
    schedule: "every day 06:00",
    timeZone: "America/Sao_Paulo",
    region: REGIAO,
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    let cred;
    try {
      cred = await lerSegredoPdvnet();
    } catch {
      logger.info("pdvnetSyncVendasAgendado: credenciais do PDVnet não configuradas — pulando.");
      return;
    }
    const cli = new PdvnetClient(cred);
    const hoje = new Date();
    const ini = new Date(hoje.getTime() - 35 * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    try {
      const r = await sincronizarVendas(cli, fmt(ini), fmt(hoje));
      logger.info("pdvnetSyncVendasAgendado ok", {
        periodo: `${fmt(ini)}..${fmt(hoje)}`,
        vendas: r.vendas,
        recebiveis: r.recebiveis,
        lojas: r.lojas,
      });
    } catch (e) {
      logger.error("pdvnetSyncVendasAgendado falhou", { erro: (e as Error).message });
    }
  },
);

/** Materializa/atualiza a lista de lojas do PDVnet (sem puxar vendas). admin/fiscal. */
export const pdvnetSincronizarLojas = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
    let cred;
    try {
      cred = await lerSegredoPdvnet();
    } catch {
      throw new HttpsError("failed-precondition", "Credenciais do PDVnet não configuradas.");
    }
    try {
      const ativos = await materializarLojas(new PdvnetClient(cred));
      await auditar(uid, "pdvnet.sincronizarLojas", { ativas: ativos.size });
      return { ok: true, ativas: ativos.size };
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  },
);

/** Edita uma loja (incluir no sync, grupo de exibição, empresa). Só admin. */
export const pdvnetSalvarLoja = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin"]);
  const d = req.data ?? {};
  const lojaId = String(d.lojaId ?? "").trim();
  if (!lojaId) throw new HttpsError("invalid-argument", "lojaId obrigatório.");
  const patch: Record<string, unknown> = { atualizadoEm: agoraISO() };
  if (typeof d.ativoSync === "boolean") patch.ativoSync = d.ativoSync;
  if (d.grupoNome !== undefined) patch.grupoNome = String(d.grupoNome ?? "").trim() || null;
  if (d.empresaId !== undefined) patch.empresaId = d.empresaId ? String(d.empresaId) : null;
  await db.collection("pdv_stores").doc(lojaId).set(patch, { merge: true });
  await auditar(uid, "pdvnet.salvarLoja", { lojaId, ...patch });
  return { ok: true };
});

// ============ TAXAS DE CARTÃO (configuração) ============

/** Cria/edita um cartão e suas taxas (%). Admin/financeiro. */
export const salvarTaxaCartao = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const nome = String(d.nome ?? "").trim().slice(0, 80);
  if (!nome) throw new HttpsError("invalid-argument", "Informe o nome do cartão.");
  const empresaId = String(d.empresaId ?? "").trim();
  if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a loja.");
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const pin = (d.parcelas ?? {}) as Record<string, unknown>;
  const parcelas: Record<string, number> = {};
  for (let i = 2; i <= 10; i++) {
    const v = Number(pin[i] ?? pin[String(i)]);
    if (Number.isFinite(v) && v > 0) parcelas[String(i)] = v;
  }
  const doc = {
    empresaId,
    nome,
    taxaPix: num(d.taxaPix),
    taxaDebito: num(d.taxaDebito),
    taxaCredito: num(d.taxaCredito),
    parcelas,
    taxaAntecipacao: num(d.taxaAntecipacao),
    ativo: d.ativo !== false,
    atualizadoEm: agoraISO(),
    atualizadoPor: uid,
  };
  const ref = d.id ? db.collection("card_rates").doc(String(d.id)) : db.collection("card_rates").doc();
  await ref.set(doc, { merge: true });
  await auditar(uid, "cartao.salvarTaxa", { id: ref.id, nome });
  return { ok: true, id: ref.id };
});

/** Exclui um cartão. Admin/financeiro. */
export const excluirTaxaCartao = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const id = String(req.data?.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  await db.collection("card_rates").doc(id).delete();
  await auditar(uid, "cartao.excluirTaxa", { id });
  return { ok: true };
});

/** Liga/desliga a antecipação por LOJA (define crédito D+1 vs D+30 e a taxa adicional). */
export const salvarConfigCartao = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const empresaId = String(req.data?.empresaId ?? "").trim();
  if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a loja.");
  const antecipacao = req.data?.antecipacao !== false;
  await db.collection("card_settings").doc(empresaId).set(
    { empresaId, antecipacao, atualizadoEm: agoraISO(), atualizadoPor: uid },
    { merge: true },
  );
  await auditar(uid, "cartao.salvarConfig", { empresaId, antecipacao });
  return { ok: true, antecipacao };
});

/** Copia os cartões/taxas + antecipação de uma loja para outra (substitui os do destino). */
export const copiarTaxasCartao = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const de = String(req.data?.de ?? "").trim();
  const para = String(req.data?.para ?? "").trim();
  if (!de || !para || de === para) throw new HttpsError("invalid-argument", "Escolha lojas de origem e destino diferentes.");
  let batch = db.batch();
  let ops = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };
  // apaga os cartões atuais do destino
  const atuais = await db.collection("card_rates").where("empresaId", "==", para).get();
  for (const d of atuais.docs) { batch.delete(d.ref); ops++; if (ops >= 400) await flush(); }
  // clona os da origem
  const origem = await db.collection("card_rates").where("empresaId", "==", de).get();
  for (const d of origem.docs) {
    const x = d.data();
    batch.set(db.collection("card_rates").doc(), { ...x, empresaId: para, atualizadoEm: agoraISO(), atualizadoPor: uid });
    ops++;
    if (ops >= 400) await flush();
  }
  await flush();
  // copia a config de antecipação
  const cfg = (await db.collection("card_settings").doc(de).get()).data() as { antecipacao?: boolean } | undefined;
  await db.collection("card_settings").doc(para).set(
    { empresaId: para, antecipacao: cfg?.antecipacao !== false, atualizadoEm: agoraISO(), atualizadoPor: uid },
    { merge: true },
  );
  await auditar(uid, "cartao.copiar", { de, para, cartoes: origem.size });
  return { ok: true, copiados: origem.size };
});

/**
 * Importa os cartões da loja a partir dos RECEBÍVEIS reais do PDV (últimos 120 dias):
 * cada DescricaoCartao vira um cartão, com as taxas efetivas observadas (débito, crédito
 * à vista e parcelado). Preserva PIX/antecipação já digitados. Mantém alinhado ao cobrado.
 */
export const importarCartoesPDV = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
    const empresaId = String(req.data?.empresaId ?? "").trim();
    if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a loja.");
    const desde = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const snap = await db.collection("card_receivables").where("dia", ">=", desde).get();
    // 1ª passada: agrupa por VENDA (a taxa é constante por venda; o total de parcelas = maior parcela)
    interface Venda { nome: string; taxa: number; total: number }
    const vendas = new Map<string, Venda>();
    for (const doc of snap.docs) {
      const r = doc.data();
      if (String(r.empresaId ?? "") !== empresaId) continue;
      const nome = String(r.descricaoCartao ?? "").trim();
      const taxa = Number(r.taxaPct);
      const vid = String(r.vendaId ?? "");
      if (!nome || !Number.isFinite(taxa) || !vid) continue;
      const key = `${vid}|${nome}`; // separa cartões diferentes na mesma venda (pgto dividido)
      let v = vendas.get(key);
      if (!v) { v = { nome, taxa, total: 0 }; vendas.set(key, v); }
      v.taxa = taxa;
      v.total = Math.max(v.total, Math.round(Number(r.parcela ?? 1) || 1));
    }
    // 2ª passada: classifica cada venda pelo TOTAL de parcelas
    interface Acc { deb: number[]; cred1: number[]; parc: Record<string, number[]> }
    const cards = new Map<string, Acc>();
    for (const v of vendas.values()) {
      let a = cards.get(v.nome);
      if (!a) { a = { deb: [], cred1: [], parc: {} }; cards.set(v.nome, a); }
      if (/debito|débito/i.test(v.nome)) a.deb.push(v.taxa);
      else if (v.total <= 1) a.cred1.push(v.taxa);
      else (a.parc[String(Math.min(10, v.total))] ??= []).push(v.taxa);
    }
    if (cards.size === 0) throw new HttpsError("failed-precondition", "Sem recebíveis de cartão sincronizados nos últimos 120 dias para esta loja.");
    const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 100) / 100 : 0);
    // existentes: preserva PIX/antecipação digitados e reusa o id (upsert por nome)
    const exist = await db.collection("card_rates").where("empresaId", "==", empresaId).get();
    const byNome = new Map<string, { id: string; taxaPix?: number; taxaAntecipacao?: number }>();
    for (const d of exist.docs) { const x = d.data(); byNome.set(String(x.nome), { id: d.id, taxaPix: x.taxaPix, taxaAntecipacao: x.taxaAntecipacao }); }
    let batch = db.batch();
    let ops = 0;
    let n = 0;
    const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };
    for (const [nome, a] of cards) {
      const prev = byNome.get(nome);
      const ref = prev ? db.collection("card_rates").doc(prev.id) : db.collection("card_rates").doc();
      const parcelas: Record<string, number> = {};
      for (const p of Object.keys(a.parc)) parcelas[p] = avg(a.parc[p]);
      batch.set(ref, {
        empresaId, nome,
        taxaPix: prev?.taxaPix ?? 0,
        taxaDebito: avg(a.deb),
        taxaCredito: avg(a.cred1),
        parcelas,
        taxaAntecipacao: prev?.taxaAntecipacao ?? 0,
        ativo: true,
        origem: "pdv",
        atualizadoEm: agoraISO(),
        atualizadoPor: uid,
      }, { merge: true });
      ops++;
      n++;
      if (ops >= 400) await flush();
    }
    await flush();
    await auditar(uid, "cartao.importarPDV", { empresaId, cartoes: n });
    return { ok: true, importados: n };
  },
);

/**
 * Confere os recebíveis de cartão do período contra as taxas cadastradas: para cada
 * VENDA (taxa constante; total de parcelas = maior parcela) compara a taxa cobrada com
 * a esperada (débito / crédito à vista / N parcelas). Aponta divergências e o impacto R$.
 */
export const conferirRecebiveis = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    await exigirModulo(req, "financeiro", ["admin", "fiscal", "financeiro"]);
    const empresaId = String(req.data?.empresaId ?? "").trim();
    if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a loja.");
    const de = String(req.data?.de ?? "").slice(0, 10);
    const ate = String(req.data?.ate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
      throw new HttpsError("invalid-argument", "Período inválido.");
    }
    const cardsSnap = await db.collection("card_rates").where("empresaId", "==", empresaId).get();
    const cadastro = new Map<string, { taxaDebito?: number; taxaCredito?: number; parcelas?: Record<string, number> }>();
    for (const d of cardsSnap.docs) { const x = d.data(); cadastro.set(String(x.nome), x); }
    if (cadastro.size === 0) throw new HttpsError("failed-precondition", "Nenhum cartão cadastrado nesta loja. Cadastre/importe em Taxas de cartão.");

    const rSnap = await db.collection("card_receivables").where("dia", ">=", de).where("dia", "<=", ate).get();
    interface V { nome: string; taxa: number; total: number; valor: number; dia: string }
    const vendas = new Map<string, V>();
    for (const doc of rSnap.docs) {
      const r = doc.data();
      if (String(r.empresaId ?? "") !== empresaId) continue;
      const nome = String(r.descricaoCartao ?? "").trim();
      const taxa = Number(r.taxaPct);
      const vid = String(r.vendaId ?? "");
      if (!nome || !Number.isFinite(taxa) || !vid) continue;
      const key = `${vid}|${nome}`; // separa cartões diferentes na mesma venda (pgto dividido)
      let v = vendas.get(key);
      if (!v) { v = { nome, taxa, total: 0, valor: 0, dia: String(r.dia ?? "").slice(0, 10) }; vendas.set(key, v); }
      v.taxa = taxa;
      v.total = Math.max(v.total, Math.round(Number(r.parcela ?? 1) || 1));
      v.valor += Number(r.valor ?? 0);
    }

    const TOL = 0.05; // pontos percentuais
    let conferidos = 0, taxaOk = 0, divergentes = 0, semCadastro = 0, impactoTotal = 0;
    const divergencias: Array<{ dia: string; cartao: string; parcelas: number; cobrada: number; esperada: number; diff: number; valor: number; impacto: number }> = [];
    for (const v of vendas.values()) {
      conferidos++;
      const card = cadastro.get(v.nome);
      let esperada: number | undefined;
      if (card) {
        if (/debito|débito/i.test(v.nome)) esperada = Number(card.taxaDebito);
        else if (v.total <= 1) esperada = Number(card.taxaCredito);
        else esperada = Number(card.parcelas?.[String(Math.min(10, v.total))]);
      }
      if (!Number.isFinite(esperada as number) || (esperada as number) <= 0) { semCadastro++; continue; }
      const diff = Math.round((v.taxa - (esperada as number)) * 100) / 100;
      if (Math.abs(diff) <= TOL) { taxaOk++; continue; }
      divergentes++;
      const impacto = Math.round(v.valor * diff) / 100; // + = cobraram a mais
      impactoTotal += impacto;
      divergencias.push({ dia: v.dia, cartao: v.nome, parcelas: v.total, cobrada: v.taxa, esperada: esperada as number, diff, valor: Math.round(v.valor * 100) / 100, impacto });
    }
    divergencias.sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto));
    return {
      ok: true, de, ate, empresaId,
      resumo: { conferidos, taxaOk, divergentes, semCadastro, impactoTotal: Math.round(impactoTotal * 100) / 100 },
      divergencias: divergencias.slice(0, 100),
    };
  },
);

/** Resumo de vendas filtrado por período e loja (grupo). Agrega no servidor. */
export const pdvnetResumoVendas = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Autenticação necessária.");
    const d = req.data ?? {};
    const de = String(d.de ?? "");
    const ate = String(d.ate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
      throw new HttpsError("invalid-argument", "Período inválido.");
    }
    const grupoSel = d.grupo ? String(d.grupo) : "";

    const stores = (await db.collection("pdv_stores").get()).docs.map((s) => s.data() as {
      id: number; nome?: string; grupoNome?: string | null; ativoSync?: boolean;
    });
    const grupoDaLoja = new Map<string, string>();
    for (const s of stores) grupoDaLoja.set(String(s.id), s.grupoNome || s.nome || String(s.id));
    const grupos = [...new Set(stores.filter((s) => s.ativoSync).map((s) => s.grupoNome || s.nome || String(s.id)))].sort();
    const lojaIdsSel = grupoSel
      ? new Set(stores.filter((s) => (s.grupoNome || s.nome) === grupoSel).map((s) => String(s.id)))
      : null;
    const dentro = (lojaId: unknown) => !lojaIdsSel || lojaIdsSel.has(String(lojaId));

    let totalVendido = 0, count = 0;
    const salesSnap = await db.collection("sales").where("dia", ">=", de).where("dia", "<=", ate).get();
    for (const doc of salesSnap.docs) {
      const s = doc.data();
      if (s.cancelada || !dentro(s.lojaId)) continue;
      totalVendido += s.valorTotal || 0;
      count++;
    }
    const porForma: Record<string, number> = {};
    const paySnap = await db.collection("sale_payments").where("dia", ">=", de).where("dia", "<=", ate).get();
    for (const doc of paySnap.docs) {
      const p = doc.data();
      if (!dentro(p.lojaId)) continue;
      porForma[p.forma] = (porForma[p.forma] || 0) + (p.valor || 0);
    }
    let totalRecebiveis = 0, totalLiquido = 0, recebiveis = 0;
    const recSnap = await db.collection("card_receivables").where("dia", ">=", de).where("dia", "<=", ate).get();
    for (const doc of recSnap.docs) {
      const r = doc.data();
      if (!dentro(r.lojaId)) continue;
      totalRecebiveis += r.valor || 0;
      totalLiquido += r.liquido ?? r.valor ?? 0;
      recebiveis++;
    }
    return { ok: true, de, ate, grupo: grupoSel || null, grupos, count, totalVendido, porForma, totalRecebiveis, totalLiquido, recebiveis };
  },
);

const PERIODO_REC: Record<string, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
/** Lista de meses YYYY-MM entre de..ate (inclusivo). */
function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  let y = Number(de.slice(0, 4));
  let m = Number(de.slice(5, 7));
  const fim = ate.slice(0, 7);
  for (let i = 0; i < 120; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > fim) break;
    out.push(ym);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
/** A despesa fixa incide no mês ym conforme a recorrência? */
function incideNoMes(x: Record<string, unknown>, ym: string): boolean {
  const p = PERIODO_REC[String(x.recorrencia ?? "mensal")] ?? 1;
  if (p === 1) return true;
  const mesBase = Number(x.mesBase ?? 1);
  const m = Number(ym.slice(5, 7));
  return ((((m - mesBase) % p) + p) % p) === 0;
}

/** Subtrai n dias de uma data YYYY-MM-DD (UTC, sem drift de fuso). */
function menosDiasISO(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) - n));
  return dt.toISOString().slice(0, 10);
}
/** Soma n dias a uma data YYYY-MM-DD (UTC, sem drift de fuso). */
function maisDiasISO(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y) return "";
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + n));
  return dt.toISOString().slice(0, 10);
}
/**
 * Data em que o cartão cai na conta (antecipação ON): D+1; se cair no fim de
 * semana, empurra para segunda (sex→seg, sáb→seg, dom→seg). A venda inteira do
 * dia (à vista ou parcelada) cai junto. Base: regra do lojista, confirmada no extrato.
 */
function dataCreditoCartao(diaISO: string): string {
  const [y, m, d] = diaISO.slice(0, 10).split("-").map(Number);
  if (!y) return "";
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const dow = dt.getUTCDay();
  if (dow === 6) dt.setUTCDate(dt.getUTCDate() + 2);
  else if (dow === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** Flags de antecipação por loja (default: LIGADA). Map empresaId → antecipacao. */
async function carregarAntecipacao(): Promise<Map<string, boolean>> {
  const m = new Map<string, boolean>();
  const snap = await db.collection("card_settings").get();
  for (const doc of snap.docs) {
    const x = doc.data();
    m.set(String(x.empresaId ?? doc.id), x.antecipacao !== false);
  }
  return m;
}
/**
 * Recebíveis de cartão com a DATA DE CRÉDITO correta por loja, respeitando o
 * toggle de antecipação. Antecipação LIGADA: crédito D+1 (fim de semana → segunda),
 * a venda inteira junto. DESLIGADA: crédito na DATA DE VENCIMENTO real do recebível
 * (parcelado cai mês a mês; à vista ~D+30). Só devolve o que cai em [de, ate].
 */
async function recebiveisNoCredito(
  de: string, ate: string, daEmpresa: (cid: string) => boolean,
): Promise<Array<{ empresaId: string; liquido: number; credito: string; dia: string }>> {
  const ant = await carregarAntecipacao();
  const d10 = (s: unknown) => (s ? String(s).slice(0, 10) : "");
  const out: Array<{ empresaId: string; liquido: number; credito: string; dia: string }> = [];
  // LIGADA — pela data da venda (crédito D+1 / fds→seg)
  const qOn = await db.collection("card_receivables")
    .where("dia", ">=", menosDiasISO(de, 4)).where("dia", "<=", ate).get();
  for (const doc of qOn.docs) {
    const r = doc.data();
    const cid = String(r.empresaId ?? "");
    if (!daEmpresa(cid) || ant.get(cid) === false) continue;
    const credito = dataCreditoCartao(d10(r.dia));
    if (!credito || credito < de || credito > ate) continue;
    out.push({ empresaId: cid, liquido: Number(r.liquido ?? r.valor ?? 0), credito, dia: d10(r.dia) });
  }
  // DESLIGADA — pela data de vencimento real do recebível
  const qOff = await db.collection("card_receivables")
    .where("dataVencimento", ">=", de).where("dataVencimento", "<", maisDiasISO(ate, 1)).get();
  for (const doc of qOff.docs) {
    const r = doc.data();
    const cid = String(r.empresaId ?? "");
    if (!daEmpresa(cid) || ant.get(cid) !== false) continue;
    const credito = d10(r.dataVencimento);
    if (!credito || credito < de || credito > ate) continue;
    out.push({ empresaId: cid, liquido: Number(r.liquido ?? r.valor ?? 0), credito, dia: d10(r.dia) });
  }
  return out;
}

/**
 * Fluxo de caixa consolidado no intervalo [de, ate], por dia.
 * ENTRADAS: recebíveis de cartão (valor LÍQUIDO real, na data de liquidação/vencimento)
 * + PIX/dinheiro (na data da venda). SAÍDAS: parcelas de NF-e, despesas fixas previstas
 * e parcelas de acordos. Realizado (passado/pago) vs previsto (futuro/a pagar) separados.
 * Tudo rastreável à origem; "pago" continua manual — nada é inventado.
 */
export const fluxoCaixa = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    await exigirModulo(req, "financeiro", ["admin", "fiscal", "financeiro"]);
    const d = req.data ?? {};
    const de = String(d.de ?? "").slice(0, 10);
    const ate = String(d.ate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
      throw new HttpsError("invalid-argument", "Período inválido.");
    }
    const empresaId = d.empresaId ? String(d.empresaId) : "";
    const hoje = agoraISO().slice(0, 10);
    const d10 = (s: unknown) => (s ? String(s).slice(0, 10) : "");
    const noRange = (dia: string) => !!dia && dia >= de && dia <= ate;
    const daEmpresa = (cid: unknown) => !empresaId || String(cid ?? "") === empresaId;

    interface Bucket { entrada: number; saida: number; entradaReal: number; saidaReal: number }
    const dias = new Map<string, Bucket>();
    const buck = (dia: string): Bucket => {
      let b = dias.get(dia);
      if (!b) { b = { entrada: 0, saida: 0, entradaReal: 0, saidaReal: 0 }; dias.set(dia, b); }
      return b;
    };
    const tot = { entrada: 0, saida: 0, entradaReal: 0, saidaReal: 0 };
    const porOrigem: Record<string, number> = { cartao: 0, avista: 0, nfe: 0, despesas: 0, acordos: 0 };
    const entrada = (dia: string, valor: number, real: boolean, origem: string) => {
      if (!noRange(dia) || !(valor > 0)) return;
      const b = buck(dia); b.entrada += valor; if (real) b.entradaReal += valor;
      tot.entrada += valor; if (real) tot.entradaReal += valor; porOrigem[origem] += valor;
    };
    const saida = (dia: string, valor: number, real: boolean, origem: string) => {
      if (!noRange(dia) || !(valor > 0)) return;
      const b = buck(dia); b.saida += valor; if (real) b.saidaReal += valor;
      tot.saida += valor; if (real) tot.saidaReal += valor; porOrigem[origem] += valor;
    };

    // ENTRADAS — cartões (líquido) na data de crédito real de cada loja (respeita
    // o toggle de antecipação: LIGADA = D+1/fds→seg; DESLIGADA = data de vencimento).
    const proxCartaoMap = new Map<string, number>(); // créditos de cartão a cair (dia >= hoje)
    const recebiveis = await recebiveisNoCredito(de, ate, (cid) => daEmpresa(cid));
    for (const r of recebiveis) {
      const val = r.liquido;
      entrada(r.credito, val, r.credito <= hoje, "cartao");
      if (r.credito >= hoje && val > 0) proxCartaoMap.set(r.credito, (proxCartaoMap.get(r.credito) ?? 0) + val);
    }
    const proximosCartao = [...proxCartaoMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dia, valor]) => ({ dia, valor }));
    // ENTRADAS — PIX/dinheiro (na data da venda)
    const spSnap = await db.collection("sale_payments").where("dia", ">=", de).where("dia", "<=", ate).get();
    for (const doc of spSnap.docs) {
      const p = doc.data();
      if (!daEmpresa(p.empresaId)) continue;
      if (p.forma !== "dinheiro" && p.forma !== "pix") continue;
      const dia = d10(p.dia);
      entrada(dia, Number(p.valor ?? 0), dia <= hoje, "avista");
    }

    // SAÍDAS — contas a pagar das NF-e
    const parcSnap = await db.collection("nfe_installments").get();
    for (const doc of parcSnap.docs) {
      const p = doc.data();
      if (!daEmpresa(p.companyId)) continue;
      const pago = p.statusPagamento === "pago";
      const dia = d10(pago ? p.dataPagamento : p.vencimento);
      saida(dia, Number((pago ? p.valorPago ?? p.valor : p.valor) ?? 0), pago, "nfe");
    }
    // SAÍDAS — despesas fixas (previsto por mês; realizado ao pagar)
    const mesesRange = mesesEntre(de, ate);
    const despSnap = await db.collection("nfe_fixed_expenses").get();
    for (const doc of despSnap.docs) {
      const x = doc.data();
      if (!daEmpresa(x.companyId) || x.ativo === false) continue;
      for (const ym of mesesRange) {
        if (!incideNoMes(x, ym)) continue;
        const pg = x.pagamentos?.[ym];
        if (pg?.pago) {
          saida(d10(pg.data) || `${ym}-01`, Number(pg.valor ?? x.valor ?? 0), true, "despesas");
        } else {
          const dia = `${ym}-${String(Math.min(Number(x.diaVencimento) || 1, 28)).padStart(2, "0")}`;
          saida(dia, Number(x.valor ?? 0), false, "despesas");
        }
      }
    }
    // SAÍDAS — parcelas de acordos
    const acSnap = await db.collection("nfe_agreements").get();
    for (const doc of acSnap.docs) {
      const a = doc.data();
      if (!daEmpresa(a.companyId)) continue;
      for (const p of (a.parcelas ?? []) as Array<Record<string, unknown>>) {
        const pago = p.statusPagamento === "pago";
        const dia = d10(pago ? p.dataPagamento : p.vencimento);
        saida(dia, Number(p.valor ?? 0), pago, "acordos");
      }
    }

    const linhas = [...dias.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dia, b]) => ({ dia, entrada: b.entrada, saida: b.saida, entradaReal: b.entradaReal, saidaReal: b.saidaReal, saldo: b.entrada - b.saida }));

    return {
      ok: true, de, ate, hoje, empresaId: empresaId || null,
      linhas,
      totais: { ...tot, saldo: tot.entrada - tot.saida },
      porOrigem,
      proximosCartao,
    };
  },
);

/**
 * Central de Pendências: exceções que precisam de ação (PDV × NF-e × contas).
 * Tudo computado de dados reais e rastreável — nada estimado. Cada item linka
 * pra tela de origem. Filosofia do projeto: automatizar o normal, mostrar as exceções.
 */
export const centralPendencias = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    await exigirModulo(req, "financeiro", ["admin", "fiscal", "financeiro"]);
    const empresaId = req.data?.empresaId ? String(req.data.empresaId) : "";
    const hoje = agoraISO().slice(0, 10);
    const d10 = (s: unknown) => (s ? String(s).slice(0, 10) : "");
    const daEmpresa = (cid: unknown) => !empresaId || String(cid ?? "") === empresaId;
    const menosDias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

    type Sev = "critico" | "atencao" | "info";
    const pend: Array<{ chave: string; titulo: string; descricao: string; severidade: Sev; qtd: number; valor: number; href: string }> = [];

    // Contas a pagar (NF-e): vencidas + a vencer em 7 dias
    let vencQtd = 0, vencVal = 0, prox7Qtd = 0, prox7Val = 0;
    const seteDias = menosDias(-7);
    for (const doc of (await db.collection("nfe_installments").get()).docs) {
      const p = doc.data();
      if (p.statusPagamento === "pago" || !daEmpresa(p.companyId)) continue;
      const dia = d10(p.vencimento);
      if (!dia) continue;
      if (dia < hoje) { vencQtd++; vencVal += Number(p.valor ?? 0); }
      else if (dia <= seteDias) { prox7Qtd++; prox7Val += Number(p.valor ?? 0); }
    }
    if (vencQtd) pend.push({ chave: "contasVencidas", titulo: `${vencQtd} conta(s) vencida(s)`, descricao: "Contas a pagar das NF-e em atraso.", severidade: "critico", qtd: vencQtd, valor: vencVal, href: "/financeiro" });
    if (prox7Qtd) pend.push({ chave: "contas7d", titulo: `${prox7Qtd} conta(s) vencem em 7 dias`, descricao: "Contas a pagar próximas do vencimento.", severidade: "atencao", qtd: prox7Qtd, valor: prox7Val, href: "/financeiro" });

    // NOTA: "recebíveis de cartão atrasados" (venceram sem liquidar) NÃO é confiável hoje —
    // o PDV não popula `dataLiquidacao` (conferido: 0 de 2638 preenchidos), então TODO
    // recebível passado apareceria como atrasado (falso-positivo). Só reativar após confirmar
    // que o PDV preenche a liquidação (ou usar conciliação bancária como fonte da verdade).

    // Acordos em atraso
    let acQtd = 0, acVal = 0;
    for (const doc of (await db.collection("nfe_agreements").get()).docs) {
      const a = doc.data();
      if (!daEmpresa(a.companyId)) continue;
      for (const p of (a.parcelas ?? []) as Array<Record<string, unknown>>) {
        if (p.statusPagamento === "pago") continue;
        const dia = d10(p.vencimento);
        if (dia && dia < hoje) { acQtd++; acVal += Number(p.valor ?? 0); }
      }
    }
    if (acQtd) pend.push({ chave: "acordosAtrasados", titulo: `${acQtd} parcela(s) de acordo em atraso`, descricao: "Parcelas de acordos vencidas e não pagas.", severidade: "atencao", qtd: acQtd, valor: acVal, href: "/acordos" });

    // Notas sem XML completo (manifestação pendente)
    let nxQtd = 0;
    for (const doc of (await db.collection("nfe_documents").get()).docs) {
      const dcto = doc.data();
      if (!daEmpresa(dcto.companyId)) continue;
      if (dcto.temXmlCompleto === false) nxQtd++;
    }
    if (nxQtd) pend.push({ chave: "notasSemXml", titulo: `${nxQtd} nota(s) sem XML completo`, descricao: "Manifeste (Ciência) para destravar o XML/DANFE.", severidade: "info", qtd: nxQtd, valor: 0, href: "/notas" });

    const ordem: Record<Sev, number> = { critico: 0, atencao: 1, info: 2 };
    pend.sort((a, b) => ordem[a.severidade] - ordem[b.severidade] || b.valor - a.valor);
    const resumo = {
      criticas: pend.filter((p) => p.severidade === "critico").length,
      atencao: pend.filter((p) => p.severidade === "atencao").length,
      info: pend.filter((p) => p.severidade === "info").length,
    };
    return { ok: true, hoje, empresaId: empresaId || null, pendencias: pend, resumo };
  },
);

/**
 * Importa um extrato bancário OFX (parse server-side) e persiste os lançamentos
 * em bank_transactions (dedup por FITID) + o saldo/período em bank_accounts.
 * A conta é identificada pela empresa. Nada é inventado — só o que vem no arquivo.
 */
export const importarExtrato = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 300 },
  async (req) => {
    const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
    const ofx = String(req.data?.ofx ?? "");
    const empresaId = String(req.data?.empresaId ?? "").trim();
    if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a empresa (conta).");
    if (ofx.length < 50 || !ofx.includes("<STMTTRN>")) throw new HttpsError("invalid-argument", "Arquivo OFX inválido.");
    const ext = parseOFX(ofx);
    if (ext.transacoes.length === 0) throw new HttpsError("failed-precondition", "Nenhum lançamento no arquivo.");
    const now = agoraISO();
    let batch = db.batch();
    let ops = 0;
    const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };
    for (const t of ext.transacoes) {
      const ref = db.collection("bank_transactions").doc(`${empresaId}_${t.fitid}`);
      batch.set(ref, { ...t, empresaId, dia: t.data, origem: "ofx", org: ext.org, importadoEm: now }, { merge: true });
      ops++;
      if (ops >= 400) await flush();
    }
    await flush();
    await db.collection("bank_accounts").doc(empresaId).set(
      {
        empresaId, org: ext.org, fid: ext.fid, curdef: ext.curdef,
        saldo: ext.saldo, saldoData: ext.saldoData, dtStart: ext.dtStart, dtEnd: ext.dtEnd,
        ultimoImport: now, ultimoImportPor: uid,
      },
      { merge: true },
    );
    await auditar(uid, "banco.importarExtrato", { empresaId, transacoes: ext.transacoes.length, saldo: ext.saldo });
    return { ok: true, transacoes: ext.transacoes.length, saldo: ext.saldo, saldoData: ext.saldoData, org: ext.org, periodo: { de: ext.dtStart, ate: ext.dtEnd } };
  },
);

/** Extrato do banco (conta + lançamentos + totais por categoria) no intervalo. */
export const extratoBanco = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    await exigirModulo(req, "financeiro", ["admin", "fiscal", "financeiro"]);
    const empresaId = String(req.data?.empresaId ?? "").trim();
    if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a empresa (conta).");
    const de = String(req.data?.de ?? "").slice(0, 10);
    const ate = String(req.data?.ate ?? "").slice(0, 10);
    const conta = (await db.collection("bank_accounts").doc(empresaId).get()).data() ?? null;
    const snap = await db.collection("bank_transactions").where("empresaId", "==", empresaId).get();
    const txs: Array<{ fitid: string; tipo: string; data: string; valor: number; memo: string; categoria: string }> = [];
    let creditos = 0, debitos = 0;
    const porCategoria: Record<string, number> = {};
    for (const doc of snap.docs) {
      const t = doc.data();
      const dia = String(t.dia ?? "");
      if ((de && dia < de) || (ate && dia > ate)) continue;
      const valor = Number(t.valor ?? 0);
      if (valor >= 0) creditos += valor; else debitos += valor;
      porCategoria[t.categoria] = (porCategoria[t.categoria] ?? 0) + valor;
      txs.push({ fitid: t.fitid, tipo: t.tipo, data: dia, valor, memo: t.memo, categoria: t.categoria });
    }
    txs.sort((a, b) => b.data.localeCompare(a.data));
    return { ok: true, conta, creditos, debitos, saldoMov: creditos + debitos, porCategoria, total: txs.length, transacoes: txs.slice(0, 300) };
  },
);

/**
 * Conciliação do período: o que o BANCO recebeu (cartão/PIX no extrato) × o que o
 * PDV PREVIU (recebíveis de cartão pelo líquido + PIX das vendas), por empresa.
 * Diferença = exceção a investigar. Tudo de dado real, rastreável.
 */
export const conciliacao = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    await exigirModulo(req, "financeiro", ["admin", "fiscal", "financeiro"]);
    const empresaId = String(req.data?.empresaId ?? "").trim();
    if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a empresa (conta).");
    const de = String(req.data?.de ?? "").slice(0, 10);
    const ate = String(req.data?.ate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
      throw new HttpsError("invalid-argument", "Período inválido.");
    }
    const d10 = (s: unknown) => (s ? String(s).slice(0, 10) : "");

    // acumulador por dia
    interface Dia { bancoCartao: number; bancoPix: number; previstoCartao: number; previstoPix: number }
    const dias = new Map<string, Dia>();
    const bd = (dia: string): Dia => {
      let x = dias.get(dia);
      if (!x) { x = { bancoCartao: 0, bancoPix: 0, previstoCartao: 0, previstoPix: 0 }; dias.set(dia, x); }
      return x;
    };

    // BANCO (extrato) — por categoria, no período (pela data do lançamento)
    let bancoCartao = 0, bancoPix = 0, bancoOutrasEnt = 0, bancoSaidas = 0;
    const bt = await db.collection("bank_transactions").where("empresaId", "==", empresaId).get();
    for (const doc of bt.docs) {
      const t = doc.data();
      const dia = d10(t.dia);
      if (dia < de || dia > ate) continue;
      const v = Number(t.valor ?? 0);
      if (t.categoria === "cartao_credito" || t.categoria === "cartao_debito") { bancoCartao += v; bd(dia).bancoCartao += v; }
      else if (t.categoria === "pix_venda") { bancoPix += v; bd(dia).bancoPix += v; }
      else if (v > 0) bancoOutrasEnt += v;
      else bancoSaidas += v;
    }

    // PREVISTO (PDV) — cartão (líquido) na DATA DE CRÉDITO real desta loja (respeita o
    // toggle de antecipação: LIGADA = D+1/fds→seg; DESLIGADA = data de vencimento);
    // PIX das vendas por dia.
    let previstoCartao = 0;
    const rc = await recebiveisNoCredito(de, ate, (cid) => cid === empresaId);
    for (const r of rc) {
      previstoCartao += r.liquido;
      bd(r.credito).previstoCartao += r.liquido;
    }
    let previstoPix = 0;
    const sp = await db.collection("sale_payments").where("dia", ">=", de).where("dia", "<=", ate).get();
    for (const doc of sp.docs) {
      const p = doc.data();
      if (String(p.empresaId ?? "") !== empresaId || p.forma !== "pix") continue;
      const v = Number(p.valor ?? 0);
      previstoPix += v;
      bd(d10(p.dia)).previstoPix += v;
    }

    // MANUAL (lojas offline, ex.: Maracanã) — vendas que passaram na MÁQUINA desta loja
    // caem no banco DESTA loja. O lançamento é BRUTO; converto para LÍQUIDO pela taxa MÉDIA
    // cadastrada desta loja (por forma/nº de parcelas) e somo no previsto. Dinheiro não entra.
    let debS = 0, debN = 0, cr1S = 0, cr1N = 0, pixS = 0, pixN = 0;
    const parcAgg = new Map<string, { s: number; n: number }>();
    const crCards = await db.collection("card_rates").where("empresaId", "==", empresaId).get();
    for (const d of crCards.docs) {
      const x = d.data();
      if (Number(x.taxaDebito) > 0) { debS += Number(x.taxaDebito); debN++; }
      if (Number(x.taxaCredito) > 0) { cr1S += Number(x.taxaCredito); cr1N++; }
      if (Number(x.taxaPix) > 0) { pixS += Number(x.taxaPix); pixN++; }
      const par = (x.parcelas ?? {}) as Record<string, number>;
      for (const [k, val] of Object.entries(par)) {
        if (Number(val) > 0) { const a = parcAgg.get(k) ?? { s: 0, n: 0 }; a.s += Number(val); a.n++; parcAgg.set(k, a); }
      }
    }
    const media = (s: number, n: number) => (n ? s / n : 0);
    const taxaDeb = media(debS, debN), taxaCr1 = media(cr1S, cr1N), taxaPixM = media(pixS, pixN);
    const taxaParc = (n: number) => { const a = parcAgg.get(String(n)); return a ? a.s / a.n : 0; };
    const liquidar = (valor: number, taxa: number) => valor * (1 - taxa / 100);
    // antecipação desta loja (define a data de crédito do cartão manual)
    const cfgSnap = await db.collection("card_settings").doc(empresaId).get();
    const antecipacaoLoja = (cfgSnap.data()?.antecipacao) !== false;

    let manualCartao = 0, manualPix = 0;
    const man = await db.collection("manual_sales").where("maquinaEmpresaId", "==", empresaId).get();
    for (const doc of man.docs) {
      const m = doc.data();
      const diaV = d10(m.dia);
      const valor = Number(m.valor ?? 0);
      if (!diaV || !(valor > 0)) continue;
      const forma = String(m.forma ?? "");
      if (forma === "pix") {
        if (diaV < de || diaV > ate) continue;
        const liq = liquidar(valor, taxaPixM);
        previstoPix += liq; manualPix += liq; bd(diaV).previstoPix += liq;
      } else if (forma === "cartaoDebito" || forma === "cartaoCredito" || forma === "cartaoParcelado") {
        // antecipação ligada → D+1/fds→seg; desligada → estimativa D+30 (manual não tem vencimento por parcela)
        const credito = antecipacaoLoja ? dataCreditoCartao(diaV) : maisDiasISO(diaV, 30);
        if (!credito || credito < de || credito > ate) continue;
        const taxa = forma === "cartaoDebito" ? taxaDeb
          : forma === "cartaoCredito" ? taxaCr1
            : taxaParc(Math.max(2, Math.min(10, Math.round(Number(m.parcelas) || 2))));
        const liq = liquidar(valor, taxa);
        previstoCartao += liq; manualCartao += liq; bd(credito).previstoCartao += liq;
      }
      // dinheiro: fica na loja, não vai ao banco → ignora
    }

    const porDia = [...dias.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dia, x]) => ({
        dia,
        bancoCartao: x.bancoCartao, previstoCartao: x.previstoCartao, difCartao: x.bancoCartao - x.previstoCartao,
        bancoPix: x.bancoPix, previstoPix: x.previstoPix, difPix: x.bancoPix - x.previstoPix,
      }));

    return {
      ok: true, de, ate, empresaId,
      banco: { cartao: bancoCartao, pix: bancoPix, outrasEntradas: bancoOutrasEnt, saidas: bancoSaidas },
      previsto: { cartao: previstoCartao, pix: previstoPix },
      manual: { cartao: manualCartao, pix: manualPix },
      dif: { cartao: bancoCartao - previstoCartao, pix: bancoPix - previstoPix },
      porDia,
    };
  },
);

// ============ VENDAS MANUAIS (lojas offline, ex.: Maracanã) ============

const FORMAS_MANUAIS = ["dinheiro", "pix", "cartaoDebito", "cartaoCredito", "cartaoParcelado"];

/** Lança/edita uma venda manual (total por dia, forma e máquina/loja). Admin/financeiro. */
export const salvarVendaManual = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const empresaId = String(d.empresaId ?? "").trim();
  const dia = String(d.dia ?? "").slice(0, 10);
  const forma = String(d.forma ?? "").trim();
  const valor = Number(d.valor);
  if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a loja.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new HttpsError("invalid-argument", "Data inválida.");
  if (!FORMAS_MANUAIS.includes(forma)) throw new HttpsError("invalid-argument", "Meio de pagamento inválido.");
  if (!Number.isFinite(valor) || valor <= 0) throw new HttpsError("invalid-argument", "Valor inválido.");
  // dinheiro não passa em máquina; cartão/pix caem no banco da loja da máquina
  const maquinaEmpresaId = forma === "dinheiro" ? "" : String(d.maquinaEmpresaId ?? "").trim();
  if (forma !== "dinheiro" && !maquinaEmpresaId) throw new HttpsError("invalid-argument", "Escolha a máquina (loja) por onde passou.");
  const parcelas = forma === "cartaoParcelado" ? Math.round(Number(d.parcelas) || 0) : 0;
  if (forma === "cartaoParcelado" && (parcelas < 2 || parcelas > 12)) throw new HttpsError("invalid-argument", "Informe o número de parcelas (2 a 12).");
  const doc = { empresaId, dia, forma, parcelas, maquinaEmpresaId: maquinaEmpresaId || null, valor, origem: "manual", atualizadoEm: agoraISO(), atualizadoPor: uid };
  const ref = d.id ? db.collection("manual_sales").doc(String(d.id)) : db.collection("manual_sales").doc();
  await ref.set(doc, { merge: true });
  await auditar(uid, "manual.salvarVenda", { id: ref.id, empresaId, dia, forma, valor });
  return { ok: true, id: ref.id };
});

/** Exclui uma venda manual. Admin/financeiro. */
export const excluirVendaManual = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const id = String(req.data?.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  await db.collection("manual_sales").doc(id).delete();
  await auditar(uid, "manual.excluirVenda", { id });
  return { ok: true };
});

/** Resolve a empresa (nfe_companies) para associar a registros manuais. */
async function resolverEmpresa(companyId: string): Promise<{ id: string; nome: string } | null> {
  if (!companyId) return null;
  const snap = await db.collection("nfe_companies").doc(companyId).get();
  if (!snap.exists) return null;
  const e = snap.data() as { razaoSocial?: string; nomeFantasia?: string };
  return { id: companyId, nome: e.nomeFantasia || e.razaoSocial || companyId };
}

// ============ GESTÃO DE USUÁRIOS E PERFIS (RBAC) ============

/**
 * Autocadastro: o usuário recém-criado (já autenticado no Firebase Auth) cria
 * seu próprio registro como PENDENTE. Sem acesso até um admin aprovar.
 */
export const nfeRegistrarUsuario = onCall(opcoes, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Autenticação necessária.");
  const nome = String(req.data?.nome ?? "").trim().slice(0, 120);
  const email = String(req.auth?.token?.email ?? req.data?.email ?? "").trim();
  const ref = db.collection("nfe_users").doc(uid);
  const snap = await ref.get();
  if (snap.exists) return { ok: true, status: (snap.data() as { status?: string }).status ?? "pendente" };
  const now = agoraISO();
  await ref.set({ uid, nome, email, status: "pendente", roleId: null, empresas: [], criadoEm: now });
  await auditar(uid, "usuario.autocadastro", { email, nome });
  return { ok: true, status: "pendente" };
});

/**
 * Aprova/atualiza um usuário: define status, perfil e empresas de escopo.
 * Grava nos claims (status, roleId, companyIds) e no doc. Só admin.
 */
export const nfeAprovarUsuario = onCall(opcoes, async (req) => {
  const { uid: adminUid } = exigirRole(req, ["admin"]);
  const d = req.data ?? {};
  const alvo = String(d.uid ?? "").trim();
  if (!alvo) throw new HttpsError("invalid-argument", "uid obrigatório.");
  const status = ["ativo", "pendente", "inativo"].includes(String(d.status)) ? String(d.status) : "ativo";
  const roleId = d.roleId ? String(d.roleId) : null;
  const empresas = Array.isArray(d.empresas) ? [...new Set(d.empresas.map((x: unknown) => String(x)))] : [];
  if (roleId) {
    const r = await db.collection("nfe_roles").doc(roleId).get();
    if (!r.exists) throw new HttpsError("invalid-argument", "Perfil inválido.");
  }
  const now = agoraISO();
  await db.collection("nfe_users").doc(alvo).set(
    { status, roleId, empresas, aprovadoPor: adminUid, aprovadoEm: now, updatedAt: now },
    { merge: true },
  );
  // Claims: preserva um eventual role="admin"; adiciona status/roleId/companyIds.
  const rec = await getAuth().getUser(alvo);
  const atuais = (rec.customClaims ?? {}) as Record<string, unknown>;
  await getAuth().setCustomUserClaims(alvo, { ...atuais, status, roleId, companyIds: empresas });
  await auditar(adminUid, "usuario.aprovar", { alvo, status, roleId, empresas: empresas.length });
  return { ok: true };
});

/** Cria/atualiza um perfil (conjunto de módulos + ações permitidos). Só admin. */
export const nfeSalvarPerfil = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin"]);
  const d = req.data ?? {};
  const id = String(d.id ?? "").trim();
  const nome = String(d.nome ?? "").trim().slice(0, 80);
  if (!nome) throw new HttpsError("invalid-argument", "Nome do perfil obrigatório.");
  const modulos = Array.isArray(d.modulos) ? [...new Set(d.modulos.map((x: unknown) => String(x)))] : [];
  const acoes = Array.isArray(d.acoes) ? [...new Set(d.acoes.map((x: unknown) => String(x)))] : [];
  const now = agoraISO();
  const ref = id ? db.collection("nfe_roles").doc(id) : db.collection("nfe_roles").doc();
  const existe = id ? (await ref.get()).exists : false;
  await ref.set(
    {
      id: ref.id,
      nome,
      descricao: String(d.descricao ?? "").trim().slice(0, 200) || null,
      modulos,
      acoes,
      updatedAt: now,
      ...(existe ? {} : { createdAt: now, createdBy: uid }),
    },
    { merge: true },
  );
  await auditar(uid, existe ? "perfil.atualizar" : "perfil.criar", { id: ref.id, nome });
  return { ok: true, id: ref.id };
});

/** Exclui um perfil. Só admin. */
export const nfeExcluirPerfil = onCall(opcoes, async (req) => {
  const { uid } = exigirRole(req, ["admin"]);
  const id = String(req.data?.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  await db.collection("nfe_roles").doc(id).delete();
  await auditar(uid, "perfil.excluir", { id });
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
