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
  hojeBRT,
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
import { parseContasPagar } from "./financeiro/contas-pagar";
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
      // IMPORTANTE: só mexe no doc se a nota JÁ existir — nunca cria um doc-fantasma
      // (recusa por chave de nota que não está na base não deve virar pendência/pagamento).
      if (r.ok) {
        const ref = db.collection("nfe_documents").doc(chNFe);
        if ((await ref.get()).exists) {
          const recusa = tpEvento === "210220" || tpEvento === "210240"; // desconhecimento / não realizada
          await ref.set(
            {
              manifestStatus: DESC_EVENTO[tpEvento],
              manifestTpEvento: tpEvento,
              manifestEm: now,
              ...(recusa ? { recusada: true } : {}),
              updatedAt: now,
            },
            { merge: true },
          );
        }
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

// ============ RECEBIMENTO DE COMPRAS (SEFAZ × entrada na loja) ============

/**
 * Lista as NF-e de COMPRA (emitente terceiro) capturadas da SEFAZ no período,
 * com o estado de RECEBIMENTO na loja. "Recebida" vem do PDVnet (auto, por chave)
 * ou de marcação MANUAL — nunca é inferida do XML. Só leitura (fiscal/financeiro).
 */
export const notasCompra = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    await exigirModulo(req, "fiscal", ["admin", "fiscal", "financeiro"]);
    const d = req.data ?? {};
    const de = String(d.de ?? "").slice(0, 10);
    const ate = String(d.ate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
      throw new HttpsError("invalid-argument", "Período inválido.");
    }
    const companyId = d.companyId ? String(d.companyId) : "";
    const status = String(d.status ?? "todas"); // todas | pendentes | recebidas

    // mapa companyId → cnpj (identifica COMPRAS: emitente ≠ nós) e nome de exibição
    const emps = await db.collection("nfe_companies").get();
    const cnpjPorId = new Map<string, string>();
    const nomePorId = new Map<string, string>();
    for (const e of emps.docs) {
      const x = e.data();
      cnpjPorId.set(e.id, somenteDigitos(String(x.cnpj ?? "")));
      nomePorId.set(e.id, String(x.nomeFantasia || x.razaoSocial || e.id));
    }

    const snap = await db.collection("nfe_documents")
      .where("dhEmi", ">=", de).where("dhEmi", "<", maisDiasISO(ate, 1)).get();

    interface Item {
      chNFe: string; companyId: string; lojaNome: string; cnpjEmit: string;
      xNomeEmit: string | null; nNF: string | null; serie: string | null;
      vNF: number; dhEmi: string | null; situacao: string | null;
      recebida: boolean; recebidaOrigem: string | null; recebidaEm: string | null;
    }
    const itens: Item[] = [];
    let totQtd = 0, totVal = 0, recQtd = 0, recVal = 0, pendQtd = 0, pendVal = 0;
    for (const doc of snap.docs) {
      const r = doc.data();
      const cid = String(r.companyId ?? "");
      if (companyId && cid !== companyId) continue;
      const meuCnpj = cnpjPorId.get(cid) ?? "";
      const emit = somenteDigitos(String(r.cnpjEmit ?? ""));
      if (!emit || emit === meuCnpj) continue; // só COMPRAS (fornecedor terceiro)
      const recebida = r.recebida === true;
      if (status === "pendentes" && recebida) continue;
      if (status === "recebidas" && !recebida) continue;
      const valor = Number(r.vNF ?? 0);
      totQtd++; totVal += valor;
      if (recebida) { recQtd++; recVal += valor; } else { pendQtd++; pendVal += valor; }
      itens.push({
        chNFe: String(r.chNFe ?? doc.id),
        companyId: cid,
        lojaNome: nomePorId.get(cid) ?? cid,
        cnpjEmit: emit,
        xNomeEmit: r.xNomeEmit ?? null,
        nNF: r.nNF ?? null,
        serie: r.serie ?? null,
        vNF: valor,
        dhEmi: r.dhEmi ?? null,
        situacao: r.situacao ?? null,
        recebida,
        recebidaOrigem: r.recebidaOrigem ?? null,
        recebidaEm: r.recebidaEm ?? null,
      });
    }
    itens.sort((a, b) => String(b.dhEmi ?? "").localeCompare(String(a.dhEmi ?? "")));
    return {
      ok: true, de, ate,
      total: { qtd: totQtd, valor: totVal },
      recebidas: { qtd: recQtd, valor: recVal },
      pendentes: { qtd: pendQtd, valor: pendVal },
      itens,
    };
  },
);

/**
 * Marca/desmarca uma NF-e de compra como RECEBIDA na loja (ação MANUAL).
 * Registrada com autor e horário — nunca inferida. Só admin/fiscal/financeiro.
 */
export const marcarNotaRecebida = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "nfe.receber", ["admin", "fiscal", "financeiro"]);
  const d = req.data ?? {};
  const chNFe = somenteDigitos(String(d.chNFe ?? ""));
  if (chNFe.length !== 44) throw new HttpsError("invalid-argument", "Chave de acesso inválida.");
  const recebida = d.recebida !== false;
  const now = agoraISO();
  await db.collection("nfe_documents").doc(chNFe).set(
    recebida
      ? { recebida: true, recebidaOrigem: "manual", recebidaEm: now, recebidaPor: uid, updatedAt: now }
      : { recebida: false, recebidaOrigem: null, recebidaEm: null, recebidaPor: null, updatedAt: now },
    { merge: true },
  );
  await auditar(uid, "nfe.receber", { chNFe, recebida });
  return { ok: true, chNFe, recebida };
});

/**
 * Valida/normaliza as CONTAS DE PAGAMENTO (rateio) de uma baixa: de qual(is)
 * conta(s) bancária(s) — empresa(s) — o dinheiro saiu e quanto de cada. Pode ser
 * de outra empresa (cross-company) e mais de uma (rateio). A soma tem que bater
 * com o valor pago. Retorna null quando não informado (baixa "legada" = empresa
 * da própria conta a pagar).
 */
function parseContasPagamento(raw: unknown, valorPago: number): Array<{ empresaId: string; valor: number }> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = (raw as Array<Record<string, unknown>>)
    .map((x) => ({ empresaId: String(x?.empresaId ?? "").trim(), valor: Math.round(Number(x?.valor ?? 0) * 100) / 100 }))
    .filter((x) => x.empresaId && x.valor > 0);
  if (out.length === 0) return null;
  const soma = out.reduce((s, x) => s + x.valor, 0);
  if (Math.abs(soma - valorPago) > 0.05) {
    throw new HttpsError("invalid-argument", `A soma das contas de pagamento (R$ ${soma.toFixed(2)}) difere do valor pago (R$ ${valorPago.toFixed(2)}).`);
  }
  return out;
}

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
    // Trava: parcela em contestação (divergência de valor/parcelas) não pode ser paga.
    const cont = snap.data()?.contestacao as { status?: string } | undefined;
    if (cont && cont.status === "aberta") {
      throw new HttpsError("failed-precondition", "Parcela em contestação — resolva a divergência antes de pagar.");
    }
    const valorPago =
      d.valorPago != null && Number.isFinite(Number(d.valorPago)) ? Number(d.valorPago) : null;
    // dataPagamento em YYYY-MM-DD; default = hoje.
    const dataPagamento = /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataPagamento ?? ""))
      ? String(d.dataPagamento)
      : now.slice(0, 10);
    const obsPagamento = String(d.obsPagamento ?? "").trim().slice(0, 300) || null;
    const valorRef = valorPago ?? Number(snap.data()?.valor ?? 0);
    const contasPagamento = parseContasPagamento(d.contasPagamento, valorRef);
    await ref.set(
      {
        statusPagamento: "pago",
        dataPagamento,
        valorPago,
        obsPagamento,
        contasPagamento: contasPagamento ?? FieldValue.delete(),
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
        contasPagamento: FieldValue.delete(),
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
 * Abre uma CONTESTAÇÃO de divergência numa parcela de NF-e (valor cobrado errado,
 * nº de parcelas errado, etc.). Enquanto ABERTA, a parcela não pode ser paga — precisa
 * o fornecedor corrigir e um admin aprovar. admin/financeiro.
 */
export const nfeContestarParcela = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const parcelaId = String(d.parcelaId ?? "").trim();
  if (!parcelaId) throw new HttpsError("invalid-argument", "parcelaId obrigatório.");
  const motivo = ["valor", "parcelas", "outro"].includes(String(d.motivo)) ? String(d.motivo) : "outro";
  const descricao = String(d.descricao ?? "").trim().slice(0, 500);
  if (!descricao) throw new HttpsError("invalid-argument", "Descreva a divergência.");
  const valorCorreto = d.valorCorreto != null && Number.isFinite(Number(d.valorCorreto)) ? Math.round(Number(d.valorCorreto) * 100) / 100 : null;
  const parcelasCorreto = Number.isInteger(Number(d.parcelasCorreto)) && Number(d.parcelasCorreto) > 0 ? Number(d.parcelasCorreto) : null;
  const ref = db.collection("nfe_installments").doc(parcelaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Parcela não encontrada.");
  if (snap.data()?.statusPagamento === "pago") throw new HttpsError("failed-precondition", "Parcela já paga — reabra antes de contestar.");
  const now = agoraISO();
  await ref.set({
    contestacao: { status: "aberta", motivo, descricao, valorCorreto, parcelasCorreto, criadoPor: uid, criadoEm: now },
    updatedAt: now,
  }, { merge: true });
  await auditar(uid, "financeiro.contestarParcela", { parcelaId, motivo });
  return { ok: true };
});

/**
 * Resolve/APROVA a contestação de uma parcela → libera para pagamento (ou cancela).
 * Só ADMIN aprova (a "aprovação da alteração"). resolucao: "aprovada" | "cancelada".
 */
export const nfeResolverContestacao = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin"]);
  const d = req.data ?? {};
  const parcelaId = String(d.parcelaId ?? "").trim();
  if (!parcelaId) throw new HttpsError("invalid-argument", "parcelaId obrigatório.");
  const resolucao = String(d.resolucao) === "cancelada" ? "cancelada" : "aprovada";
  const obs = String(d.obs ?? "").trim().slice(0, 300) || null;
  const ref = db.collection("nfe_installments").doc(parcelaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Parcela não encontrada.");
  const cont = snap.data()?.contestacao as Record<string, unknown> | undefined;
  if (!cont || cont.status !== "aberta") throw new HttpsError("failed-precondition", "Não há contestação aberta nesta parcela.");
  const now = agoraISO();
  await ref.set({
    contestacao: { ...cont, status: "resolvida", resolucao, obsResolucao: obs, resolvidoPor: uid, resolvidoEm: now },
    updatedAt: now,
  }, { merge: true });
  await auditar(uid, "financeiro.resolverContestacao", { parcelaId, resolucao });
  return { ok: true };
});

/**
 * Bloqueia o pagamento das NFs de um PEDIDO DE COMPRA quando a conciliação deu
 * divergência: abre contestação em todas as parcelas (não pagas) das NFs associadas.
 * O admin libera depois na aba Financeiro. admin/financeiro.
 */
export const contestarNfsPedido = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const pedidoId = String(req.data?.pedidoId ?? "").trim();
  if (!pedidoId) throw new HttpsError("invalid-argument", "pedidoId obrigatório.");
  const motivo = ["valor", "parcelas", "outro"].includes(String(req.data?.motivo)) ? String(req.data.motivo) : "valor";
  const descricao = String(req.data?.descricao ?? "").trim().slice(0, 500) || "Divergência na conciliação do pedido de compra.";
  const snap = await db.collection("purchase_orders").doc(pedidoId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Pedido não encontrado.");
  const nfs = Array.isArray(snap.data()?.nfs) ? (snap.data()!.nfs as string[]) : [];
  if (!nfs.length) throw new HttpsError("failed-precondition", "Pedido sem NF associada.");
  const now = agoraISO();
  const batch = db.batch();
  let bloqueadas = 0, jaBloqueadas = 0, pagas = 0, semParcela = 0;
  for (const ch of nfs) {
    const parc = await db.collection("nfe_installments").where("chNFe", "==", ch).get();
    if (parc.empty) { semParcela++; continue; }
    for (const doc of parc.docs) {
      const p = doc.data() as { statusPagamento?: string; contestacao?: { status?: string } };
      if (p.statusPagamento === "pago") { pagas++; continue; }
      if (p.contestacao && p.contestacao.status === "aberta") { jaBloqueadas++; continue; }
      batch.set(doc.ref, {
        contestacao: { status: "aberta", motivo, descricao, valorCorreto: null, parcelasCorreto: null, origem: "pedido", pedidoId, criadoPor: uid, criadoEm: now },
        updatedAt: now,
      }, { merge: true });
      bloqueadas++;
    }
  }
  if (bloqueadas) await batch.commit();
  await auditar(uid, "financeiro.contestarNfsPedido", { pedidoId, nfs: nfs.length, bloqueadas });
  return { ok: true, bloqueadas, jaBloqueadas, pagas, semParcela };
});

/**
 * Marca (ou desmarca) uma parcela de NF-e como MIGRADA PARA ACORDO. Só REGISTRO:
 * a dívida foi renegociada e passou a ser controlada por um acordo — NÃO é
 * pagamento e NÃO gera movimentação financeira (sai do "a pagar" em aberto, não
 * entra no fluxo nem na conciliação). Opcionalmente associa a um acordo existente.
 * Só admin/financeiro.
 */
export const nfeMigrarParcelaAcordo = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const parcelaId = String(d.parcelaId ?? "").trim();
  if (!parcelaId) throw new HttpsError("invalid-argument", "parcelaId obrigatório.");
  const migrado = d.migrado !== false; // default = marcar migrado
  const acordoId = String(d.acordoId ?? "").trim() || null;

  const ref = db.collection("nfe_installments").doc(parcelaId);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Parcela não encontrada.");
  const now = agoraISO();

  if (migrado) {
    await ref.set(
      {
        migradoAcordo: true,
        acordoId,
        // garante que NÃO fique como paga (migração não é pagamento)
        statusPagamento: "nao_informado",
        dataPagamento: FieldValue.delete(),
        valorPago: FieldValue.delete(),
        contasPagamento: FieldValue.delete(),
        migradoPor: uid,
        migradoEm: now,
        updatedAt: now,
      },
      { merge: true },
    );
  } else {
    await ref.set(
      {
        migradoAcordo: FieldValue.delete(),
        acordoId: FieldValue.delete(),
        migradoPor: FieldValue.delete(),
        migradoEm: FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true },
    );
  }
  await auditar(uid, migrado ? "financeiro.migrarAcordo" : "financeiro.desmigrarAcordo", { parcelaId, acordoId });
  return { ok: true, migradoAcordo: migrado };
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
  // Conta única de pagamento p/ o lote (opcional): aplica a cada parcela pelo seu valor.
  const contaLote = String(d.contaEmpresaId ?? "").trim();

  const refs = ids.map((id) => db.collection("nfe_installments").doc(id));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let total = 0, contestadas = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const p = snap.data() as { valor?: number; contestacao?: { status?: string } };
    if (p.contestacao && p.contestacao.status === "aberta") { contestadas++; continue; } // não paga contestadas
    const valorPago = typeof p.valor === "number" ? p.valor : null;
    batch.set(
      snap.ref,
      {
        statusPagamento: "pago",
        dataPagamento,
        valorPago,
        obsPagamento,
        contasPagamento: contaLote && valorPago ? [{ empresaId: contaLote, valor: valorPago }] : FieldValue.delete(),
        baixadoPor: uid,
        baixadoEm: now,
        updatedAt: now,
      },
      { merge: true },
    );
    total++;
  }
  await batch.commit();
  await auditar(uid, "financeiro.baixarLote", { total, dataPagamento, contestadas });
  return { ok: true, total, contestadas };
});

/**
 * Define manualmente o pagamento de uma NF-e que veio SEM parcelas no XML
 * (sem <cobr>/<dup>). Cria as parcelas em nfe_installments (origem="manual").
 * Suporta "à vista e já quitado" (1 parcela paga). NÃO sobrescreve parcelas do
 * XML — só substitui uma definição manual anterior. Só admin/financeiro.
 */
export const nfeDefinirPagamento = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const chNFe = String(d.chNFe ?? "").trim();
  if (!chNFe) throw new HttpsError("invalid-argument", "chNFe obrigatório.");

  const docSnap = await db.collection("nfe_documents").doc(chNFe).get();
  if (!docSnap.exists) throw new HttpsError("not-found", "Nota não encontrada.");
  const nf = docSnap.data() as { companyId?: string; cnpjEmit?: string | null; xNomeEmit?: string | null };

  const entradas = Array.isArray(d.parcelas) ? (d.parcelas as Array<Record<string, unknown>>) : [];
  if (entradas.length === 0) throw new HttpsError("invalid-argument", "Inclua ao menos uma parcela.");
  if (entradas.length > 60) throw new HttpsError("invalid-argument", "Máximo de 60 parcelas.");

  const dataOK = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
  const parcelas = entradas.map((p, i) => {
    const valor = Number(p.valor);
    if (!Number.isFinite(valor) || valor <= 0) throw new HttpsError("invalid-argument", `Valor inválido na parcela ${i + 1}.`);
    if (!dataOK(p.vencimento)) throw new HttpsError("invalid-argument", `Data inválida na parcela ${i + 1}.`);
    const pago = p.pago === true;
    const dataPagamento = pago ? (dataOK(p.dataPagamento) ? String(p.dataPagamento) : String(p.vencimento)) : null;
    // Conta de onde saiu o pagamento (default = empresa que recebeu a NF).
    const contaPagamento = pago ? (String(p.contaPagamento ?? "").trim() || nf.companyId || "") : "";
    return { valor: Math.round(valor * 100) / 100, vencimento: String(p.vencimento), pago, dataPagamento, contaPagamento };
  });

  // Protege parcelas do XML: só é permitido (re)definir quando não há parcela do XML.
  const existentes = await db.collection("nfe_installments").where("chNFe", "==", chNFe).get();
  const temXml = existentes.docs.some((x) => (x.data() as { origem?: string }).origem !== "manual");
  if (temXml) throw new HttpsError("failed-precondition", "Esta nota já tem parcelas do XML — não é possível redefinir.");

  const now = agoraISO();
  // 1) limpa definição manual anterior (commit separado p/ evitar conflito na mesma doc)
  if (!existentes.empty) {
    const del = db.batch();
    existentes.docs.forEach((x) => del.delete(x.ref));
    await del.commit();
  }
  // 2) cria as novas parcelas
  const batch = db.batch();
  parcelas.forEach((p, i) => {
    const nDup = String(i + 1);
    batch.set(db.collection("nfe_installments").doc(`${chNFe}_${nDup}`), {
      companyId: nf.companyId ?? null,
      chNFe,
      cnpjEmit: nf.cnpjEmit ?? null,
      xNomeEmit: nf.xNomeEmit ?? null,
      nDup,
      vencimento: p.vencimento,
      valor: p.valor,
      statusPagamento: p.pago ? "pago" : "nao_informado",
      ...(p.pago ? {
        dataPagamento: p.dataPagamento, valorPago: p.valor, baixadoPor: uid, baixadoEm: now,
        ...(p.contaPagamento ? { contasPagamento: [{ empresaId: p.contaPagamento, valor: p.valor }] } : {}),
      } : {}),
      origem: "manual",
      definidoPor: uid,
      definidoEm: now,
      updatedAt: now,
    });
  });
  await batch.commit();

  await auditar(uid, "nfe.definirPagamento", {
    chNFe, parcelas: parcelas.length, quitadas: parcelas.filter((p) => p.pago).length,
  });
  return { ok: true, parcelas: parcelas.length };
});

/**
 * Varredura: NF-e SEM nenhuma parcela cadastrada (nem XML nem manual) — as que
 * precisam ter o pagamento definido. Ordena por dhEmi desc. Só admin/financeiro.
 */
export const nfePagamentosPendentes = onCall(opcoes, async (req) => {
  await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const empresaId = String(d.empresaId ?? "").trim();

  const comParcela = new Set<string>();
  for (const x of (await db.collection("nfe_installments").get()).docs) {
    const ch = (x.data() as { chNFe?: string }).chNFe;
    if (ch) comParcela.add(ch);
  }
  const docs = (await db.collection("nfe_documents").orderBy("dhEmi", "desc").limit(1500).get()).docs;
  const pendentes: Array<Record<string, unknown>> = [];
  for (const doc of docs) {
    const nf = doc.data() as Record<string, unknown>;
    if (empresaId && nf.companyId !== empresaId) continue;
    if (nf.recusada === true) continue; // nota recusada não é conta a pagar
    const ch = nf.chNFe as string | undefined;
    if (ch && comParcela.has(ch)) continue;
    pendentes.push({
      id: doc.id, chNFe: ch ?? null, companyId: nf.companyId ?? null,
      cnpjEmit: nf.cnpjEmit ?? null, xNomeEmit: nf.xNomeEmit ?? null,
      vNF: nf.vNF ?? null, dhEmi: nf.dhEmi ?? null, nNF: nf.nNF ?? null, serie: nf.serie ?? null,
    });
    if (pendentes.length >= 500) break;
  }
  return { ok: true, pendentes };
});

/**
 * Lote: define o pagamento de várias NF-e sem parcelas como "à vista e já quitado"
 * na DATA DE EMISSÃO de cada nota (1 parcela paga, valor = vNF). Pula as que já
 * têm parcela ou sem valor/data. Só admin/financeiro.
 */
export const nfeDefinirPagamentoLoteEmissao = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const chaves: string[] = Array.isArray(d.chaves)
    ? [...new Set((d.chaves as unknown[]).map((x) => String(x).trim()).filter((s) => s !== ""))]
    : [];
  if (chaves.length === 0) throw new HttpsError("invalid-argument", "Nenhuma nota informada.");
  if (chaves.length > 500) throw new HttpsError("invalid-argument", "Máximo de 500 notas por vez.");

  // Chaves que já têm parcela (não sobrescrever).
  const comParcela = new Set<string>();
  for (const x of (await db.collection("nfe_installments").select("chNFe").get()).docs) {
    const ch = (x.data() as { chNFe?: string }).chNFe;
    if (ch) comParcela.add(ch);
  }
  const alvo = chaves.filter((c) => !comParcela.has(c));

  const now = agoraISO();
  let criadas = 0, puladas = chaves.length - alvo.length, semValor = 0;
  // Lê os documentos em blocos (getAll) e cria as parcelas.
  for (let i = 0; i < alvo.length; i += 300) {
    const bloco = alvo.slice(i, i + 300);
    const refs = bloco.map((ch) => db.collection("nfe_documents").doc(ch));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    let ops = 0;
    for (const snap of snaps) {
      if (!snap.exists) { puladas++; continue; }
      const nf = snap.data() as { vNF?: number; dhEmi?: string; companyId?: string; cnpjEmit?: string | null; xNomeEmit?: string | null };
      const chNFe = snap.id;
      const valor = Number(nf.vNF);
      const dia = String(nf.dhEmi ?? "").slice(0, 10);
      if (!Number.isFinite(valor) || valor <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) { semValor++; continue; }
      const v = Math.round(valor * 100) / 100;
      batch.set(db.collection("nfe_installments").doc(`${chNFe}_1`), {
        companyId: nf.companyId ?? null,
        chNFe,
        cnpjEmit: nf.cnpjEmit ?? null,
        xNomeEmit: nf.xNomeEmit ?? null,
        nDup: "1",
        vencimento: dia,
        valor: v,
        statusPagamento: "pago",
        dataPagamento: dia,
        valorPago: v,
        baixadoPor: uid,
        baixadoEm: now,
        origem: "manual",
        definidoPor: uid,
        definidoEm: now,
        updatedAt: now,
      });
      ops++;
      criadas++;
    }
    if (ops > 0) await batch.commit();
  }

  await auditar(uid, "nfe.definirPagamentoLoteEmissao", { criadas, puladas, semValor });
  return { ok: true, criadas, puladas, semValor };
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
  const valorParc = Number((parcelas[idx] as { valor?: number }).valor ?? 0);
  const contasPagamento = pago ? parseContasPagamento(d.contasPagamento, valorParc) : null;
  parcelas[idx] = {
    ...parcelas[idx],
    statusPagamento: pago ? "pago" : "pendente",
    dataPagamento,
    ...(pago ? { contasPagamento: contasPagamento ?? null } : { contasPagamento: null }),
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
  const snap = id ? await ref.get() : null;
  const existe = snap?.exists ?? false;
  const createdAt = existe ? String((snap!.data() as { createdAt?: string }).createdAt ?? now) : now;

  const recorrencia = ["mensal", "bimestral", "trimestral", "semestral", "anual"].includes(String(d.recorrencia))
    ? String(d.recorrencia) : "mensal";
  const mesBase = Number.isInteger(Number(d.mesBase)) && Number(d.mesBase) >= 1 && Number(d.mesBase) <= 12
    ? Number(d.mesBase) : null;

  // Quantidade de parcelas (opcional): vazio/0 = permanente. Calcula o FIM da vigência
  // (YYYY-MM) respeitando a periodicidade, a partir do mês de criação.
  const qNum = Math.floor(Number(d.qtdParcelas));
  const qtdParcelas = Number.isInteger(qNum) && qNum >= 1 && qNum <= 600 ? qNum : null;
  let fimVigencia: string | null = null;
  if (qtdParcelas) {
    const p = PERIODO_REC[recorrencia] ?? 1;
    let y = Number(createdAt.slice(0, 4));
    let m = Number(createdAt.slice(5, 7));
    // primeira incidência >= mês de criação
    for (let i = 0; i < 36; i++) {
      if (incideNoMes({ recorrencia, mesBase }, `${y}-${String(m).padStart(2, "0")}`)) break;
      m++; if (m > 12) { m = 1; y++; }
    }
    // fim = primeira incidência + (qtd-1) × período
    let em = m + (qtdParcelas - 1) * p;
    y += Math.floor((em - 1) / 12); em = ((em - 1) % 12) + 1;
    fimVigencia = `${y}-${String(em).padStart(2, "0")}`;
  }

  await ref.set(
    {
      id: ref.id,
      companyId: empresa?.id ?? null,
      empresaNome: empresa?.nome ?? null,
      nome,
      categoria: String(d.categoria ?? "outros").trim().slice(0, 40) || "outros",
      valor,
      recorrencia,
      mesBase,
      diaVencimento,
      qtdParcelas,
      fimVigencia,
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
    const valorEfetivo = Number.isFinite(valor) && valor > 0 ? valor : Number(previsto ?? 0);
    const contasPagamento = parseContasPagamento(d.contasPagamento, valorEfetivo);
    await ref.update({
      [campo]: {
        pago: true,
        data,
        valor: Number.isFinite(valor) && valor > 0 ? valor : previsto,
        previsto,
        contasPagamento: contasPagamento ?? null,
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
 * Diagnóstico: itens de vendas específicas (por dia + ids), direto do PDVnet.
 * O nome do produto NÃO vem no /vendas (só VariacaoId = código da etiqueta),
 * então devolvemos código, quantidade, preço, desconto e custo por linha. Só leitura.
 */
export const pdvnetItensVenda = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 300 },
  async (req) => {
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
    const dia = String(req.data?.dia ?? "").slice(0, 10);
    const idsArr: string[] = (Array.isArray(req.data?.ids) ? req.data.ids : []).map((x: unknown) => String(x));
    const ids = new Set<string>(idsArr);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || ids.size === 0) {
      throw new HttpsError("invalid-argument", "Informe dia (yyyy-MM-dd) e ids[].");
    }
    let cred;
    try { cred = await lerSegredoPdvnet(); }
    catch { throw new HttpsError("failed-precondition", "Credenciais do PDVnet não configuradas."); }
    const cli = new PdvnetClient(cred);
    const achadas: Record<string, unknown> = {};
    let pagina = 1;
    for (;;) {
      const resp = await cli.listarVendas(dia, dia, { pagina, tamanhoPagina: 50 });
      const registros = resp.Registros ?? [];
      for (const v of registros) {
        if (!ids.has(String(v.Id))) continue;
        achadas[String(v.Id)] = {
          id: v.Id, dataHora: v.DataHora, lojaId: v.LojaId, vendedorId: v.VendedorId,
          valorTotal: v.ValorTotal, valorDesconto: v.ValorDesconto, valorProdutos: v.ValorProdutos,
          itens: (v.Itens ?? []).map((it) => ({
            seq: it.SequencialItem, variacaoId: it.VariacaoId, qtd: it.Quantidade,
            preco: it.Preco, precoLiquido: it.PrecoLiquido, desconto: it.ValorDesconto,
            acrescimo: it.ValorAcrescimo, custoGerencial: it.PrecoCustoGerencial,
            natureza: it.NaturezaOperacao, inativo: it.Inativo,
          })),
        };
      }
      if (Object.keys(achadas).length >= ids.size) break;
      if (!resp.PaginacaoInfo?.TemProximaPagina) break;
      pagina += 1;
      if (pagina > 200) break; // teto de segurança
    }
    await auditar(uid, "pdvnet.itensVenda", { dia, ids: [...ids], achadas: Object.keys(achadas).length });
    const faltantes = idsArr.filter((id) => !achadas[id]);
    return { ok: true, dia, achadas, faltantes };
  },
);

/**
 * Diagnóstico: soma TODAS as formas de pagamento do PDVnet no período e mede o
 * RESÍDUO (ValorTotal − soma das formas), para achar forma "escondida" que não lemos
 * (como aconteceu com o PIX de maquininha, que vem em ParcelasCartao). Só leitura.
 */
export const pdvnetSondarFormas = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 540 },
  async (req) => {
    const { uid } = await exigirAcao(req, "integracoes.sincronizar", ["admin", "fiscal"]);
    const dias = Math.min(Math.max(Math.floor(Number(req.data?.dias ?? 7)), 1), 31);
    let cred;
    try { cred = await lerSegredoPdvnet(); } catch { throw new HttpsError("failed-precondition", "Credenciais do PDVnet não configuradas."); }
    const cli = new PdvnetClient(cred);
    const hoje = new Date();
    const ini = new Date(hoje.getTime() - dias * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const CAMPOS = ["ValorDinheiro", "ValorPix", "ValorCartaoDebito", "ValorCartaoParcelado", "ValorCartaoRotativo", "ValorCheque", "ValorChequePre", "ValorCrediario", "ValorDuplicata", "ValorVale", "ValorVendaVale", "ValorValeSaida", "ValorDeposito", "ValorOutros", "ValorBonus", "ValorTroco"];
    const LIDOS = new Set(["ValorDinheiro", "ValorPix", "ValorCartaoDebito", "ValorCartaoParcelado", "ValorCartaoRotativo", "ValorCrediario", "ValorCheque", "ValorVale", "ValorDuplicata"]);
    const soma: Record<string, number> = {}; for (const cmp of CAMPOS) soma[cmp] = 0;
    const todasChavesValor = new Map<string, number>(); // qualquer campo "Valor*" visto (mesmo fora do tipo)
    const amostrasResiduo: Array<{ id: unknown; valorTotal: number; residuo: number; campos: Record<string, number> }> = [];
    let vendido = 0, canc = 0, nv = 0, residuoTot = 0, comResiduo = 0, cartaoParcelasTot = 0;
    await cli.percorrerVendas(fmt(ini), fmt(hoje), async (lote) => {
      for (const v of lote) {
        if (v.Inativa) { canc++; continue; }
        nv++; const total = Number(v.ValorTotal ?? 0); vendido += total;
        const raw = v as unknown as Record<string, unknown>;
        let inflow = 0;
        for (const cmp of CAMPOS) { const val = Number(raw[cmp] ?? 0); soma[cmp] += val; if (cmp !== "ValorTroco") inflow += val; }
        // Descobre QUALQUER campo Valor* (inclusive fora do tipo) com valor.
        for (const k of Object.keys(raw)) { if (/^Valor/.test(k)) { const val = Number(raw[k] ?? 0); if (val) todasChavesValor.set(k, (todasChavesValor.get(k) ?? 0) + val); } }
        for (const p of v.ParcelasCartao ?? []) { if (!p.Inativa) cartaoParcelasTot += Number(p.Valor ?? 0); }
        const residuo = Math.round((total - inflow + Number(v.ValorTroco ?? 0)) * 100) / 100; // ValorTotal - formas líquidas
        if (Math.abs(residuo) > 0.5) {
          residuoTot += residuo; comResiduo++;
          if (amostrasResiduo.length < 5) {
            const campos: Record<string, number> = {};
            for (const k of Object.keys(raw)) { if (/^Valor/.test(k)) { const val = Number(raw[k] ?? 0); if (val) campos[k] = Math.round(val * 100) / 100; } }
            amostrasResiduo.push({ id: v.Id, valorTotal: total, residuo, campos });
          }
        }
      }
    });
    await auditar(uid, "pdvnet.sondarFormas", { dias, nv });
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const naoLidosComValor = CAMPOS.filter((cmp) => !LIDOS.has(cmp) && Math.abs(soma[cmp]) > 0.01).map((cmp) => ({ campo: cmp, total: r2(soma[cmp]) }));
    return {
      ok: true, periodo: { inicio: fmt(ini), fim: fmt(hoje) }, vendas: nv, canceladas: canc, totalVendido: r2(vendido),
      porForma: Object.fromEntries(CAMPOS.map((cmp) => [cmp, r2(soma[cmp])])),
      naoLidosComValor,
      cartaoParcelasTotal: r2(cartaoParcelasTot),
      todosCamposValor: Object.fromEntries([...todasChavesValor.entries()].map(([k, v]) => [k, r2(v)])),
      amostrasResiduo,
      residuo: { total: r2(residuoTot), vendasComResiduo: comResiduo, obs: "ValorTotal − formas (>0 = forma de entrada não capturada)" },
    };
  },
);

/**
 * Piso de data das vendas (virada de produção): vendas anteriores NÃO são importadas.
 * Config em `configuracoes/producao`.inicioVendas (AAAA-MM-DD). Evita que o sync diário
 * ressuscite o histórico apagado na virada.
 */
async function inicioVendasProducao(): Promise<string | null> {
  try {
    const snap = await db.collection("configuracoes").doc("producao").get();
    const v = String(snap.data()?.inicioVendas ?? "");
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch { return null; }
}

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
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    // Janela explícita (de/ate) tem prioridade — permite backfill fatiado; senão usa dias/mês.
    const de0 = String(req.data?.de ?? "");
    const ate0 = String(req.data?.ate ?? "");
    let inicio: string, fim: string;
    if (/^\d{4}-\d{2}-\d{2}$/.test(de0) && /^\d{4}-\d{2}-\d{2}$/.test(ate0) && de0 <= ate0) {
      inicio = de0; fim = ate0;
    } else {
      const dias = Math.floor(Number(req.data?.dias ?? 0));
      const ini = dias > 0
        ? new Date(hoje.getTime() - dias * 86_400_000)
        : new Date(hoje.getFullYear(), hoje.getMonth(), 1); // 1º dia do mês corrente
      inicio = fmt(ini); fim = fmt(hoje);
    }
    // Piso de produção: nunca importar vendas antes do início configurado.
    const floor = await inicioVendasProducao();
    if (floor && inicio < floor) inicio = floor;
    if (inicio > fim) return { ok: true, periodo: { inicio, fim }, vendas: 0, recebiveis: 0, lojas: 0 };
    try {
      const r = await sincronizarVendas(cli, inicio, fim);
      await auditar(uid, "pdvnet.sincronizarVendas", { periodo: `${inicio}..${fim}`, vendas: r.vendas });
      return { ok: true, periodo: { inicio, fim }, ...r };
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
    // Piso de produção: não ressuscitar vendas anteriores ao início configurado.
    const floor = await inicioVendasProducao();
    let inicio = fmt(ini);
    if (floor && inicio < floor) inicio = floor;
    const fimA = fmt(hoje);
    if (inicio > fimA) { logger.info("pdvnetSyncVendasAgendado: nada a sincronizar (antes do início de produção)."); return; }
    try {
      const r = await sincronizarVendas(cli, inicio, fimA);
      logger.info("pdvnetSyncVendasAgendado ok", {
        periodo: `${inicio}..${fimA}`,
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
  // Loja da máquina de cartão: empresa cujo BANCO recebe o cartão/PIX (para conciliação).
  // Vazio = a própria loja. Ex.: NAOUSAR passa na máquina da SXCG.
  if (d.maquinaEmpresaId !== undefined) patch.maquinaEmpresaId = d.maquinaEmpresaId ? String(d.maquinaEmpresaId) : null;
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
    // "A receber" real = recebíveis cuja DATA DE CRÉDITO ainda não chegou (hoje).
    // Antecipação LIGADA: crédito D+1 (fds→seg). DESLIGADA: data de vencimento real.
    const antMap = await carregarAntecipacao();
    const taxasApp = await carregarTaxasApp(); // líquido pelas taxas do APP (não do PDVnet)
    // Data de HOJE no fuso do Brasil (não UTC): à noite o UTC já virou o dia seguinte,
    // o que zerava o "a receber" de sex/sáb (que creditam na segunda).
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    let totalRecebiveis = 0, totalLiquido = 0, recebiveis = 0;
    let cartaoAReceber = 0, liquidoAReceber = 0, cartaoCreditado = 0;
    const recSnap = await db.collection("card_receivables").where("dia", ">=", de).where("dia", "<=", ate).get();
    for (const doc of recSnap.docs) {
      const r = doc.data();
      if (!dentro(r.lojaId)) continue;
      const cidTaxa = String(r.conciliaEmpresaId ?? r.empresaId ?? "");
      const valor = r.valor || 0;
      const liq = liquidoApp(valor, taxaAppDe(taxasApp.get(cidTaxa), r.descricaoCartao, Number(r.parcela ?? 1) || 1));
      totalRecebiveis += valor;      // bruto vendido no cartão no período
      totalLiquido += liq;           // líquido previsto (bruto − taxa do APP)
      recebiveis++;
      const cid = String(r.conciliaEmpresaId ?? r.empresaId ?? ""); // loja onde o dinheiro cai
      const antOn = antMap.get(cid) !== false; // default: antecipação ligada
      const credito = antOn ? dataCreditoCartao(String(r.dia ?? "").slice(0, 10)) : String(r.dataVencimento ?? "").slice(0, 10);
      if (credito && credito > hoje) { cartaoAReceber += valor; liquidoAReceber += liq; } // ainda não creditado
      else cartaoCreditado += valor;                                                       // já caiu na conta
    }
    return {
      ok: true, de, ate, grupo: grupoSel || null, grupos, count, totalVendido, porForma,
      totalRecebiveis, totalLiquido, recebiveis,
      cartaoAReceber, liquidoAReceber, cartaoCreditado, hoje,
    };
  },
);

/**
 * DRE gerencial (regime de COMPETÊNCIA) por loja/período. Linhas de fontes reais:
 * Receita de vendas (PDV + manual) − CMV (compras do período OU % informado) = Lucro bruto;
 * menos Taxas de cartão, Despesas fixas, Fretes (CT-e) e Serviços (NFS-e) = Resultado.
 * Acordos ficam de fora (quitação de dívida, não despesa nova). Só leitura.
 */
interface DREResultado {
  de: string; ate: string; empresaId: string | null; cmvPct: number; cmvBase: string; cmvOrigem: string;
  receitaVendas: number; receitaManual: number; descontos: number; cmv: number; compras: number;
  cmvReal: number; cmvRealAquisicao: number; cmvRealGerencial: number; custoCobertura: number;
  lucroBruto: number; margemBruta: number; taxasCartao: number; despesasFixas: number;
  despesasManuais: number; fretes: number; servicos: number; resultado: number; margemLiquida: number;
}
/** Núcleo do DRE gerencial (competência). Reutilizado pelo comparativo. */
async function calcularDRE(de: string, ate: string, empresaId: string, cmvPct: number, cmvBase = "gerencial"): Promise<DREResultado> {
  const daEmpresa = (cid: unknown) => !empresaId || String(cid ?? "") === empresaId;
  // Number seguro: um campo gravado como texto não-numérico vira 0 em vez de NaN
  // (NaN num acumulador retornado quebra a serialização do callable → "Internal").
  const n0 = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };

  const emps = await db.collection("nfe_companies").get();
  const cnpjPorId = new Map<string, string>();
  for (const e of emps.docs) cnpjPorId.set(e.id, somenteDigitos(String((e.data() as { cnpj?: string }).cnpj ?? "")));

  // RECEITA LÍQUIDA — vendas PDV (competência = dia da venda). ValorTotal do PDVnet é o
  // valor CHEIO (antes do desconto); a receita real = ValorTotal − descontos.
  let receitaVendas = 0, descontos = 0, cmvRealAquisicao = 0, cmvRealGerencial = 0, itensTot = 0, itensComCusto = 0;
  const salesSnap = await db.collection("sales").where("dia", ">=", de).where("dia", "<=", ate).get();
  for (const doc of salesSnap.docs) {
    const s = doc.data();
    if (s.cancelada || !daEmpresa(s.empresaId)) continue;
    const desc = n0(s.valorDesconto) + n0(s.valorDescontoPromocional);
    descontos += desc;
    receitaVendas += n0(s.valorTotal) - desc; // líquido
    cmvRealAquisicao += n0(s.custoAquisicao);
    cmvRealGerencial += n0(s.custoGerencial);
    itensTot += n0(s.qtdItens);
    itensComCusto += n0(s.itensComCusto);
  }
  // TAXAS DE CARTÃO — pela TAXA DO APP (não pelo líquido do PDVnet), competência = dia da venda
  let taxasCartao = 0;
  const taxasApp = await carregarTaxasApp();
  const recSnap = await db.collection("card_receivables").where("dia", ">=", de).where("dia", "<=", ate).get();
  for (const doc of recSnap.docs) {
    const r = doc.data();
    if (!daEmpresa(r.empresaId)) continue;
    const cidTaxa = String(r.conciliaEmpresaId ?? r.empresaId ?? "");
    const bruto = n0(r.valor);
    taxasCartao += n0(bruto - liquidoApp(bruto, taxaAppDe(taxasApp.get(cidTaxa), r.descricaoCartao, Number(r.parcela ?? 1) || 1)));
  }

  // MANUAL — receita da loja offline; taxa estimada pela taxa MÉDIA da loja da máquina
  const agg = new Map<string, { debS: number; debN: number; cr1S: number; cr1N: number; pixS: number; pixN: number; parc: Map<string, { s: number; n: number }> }>();
  for (const doc of (await db.collection("card_rates").get()).docs) {
    const x = doc.data(); const cid = String(x.empresaId ?? "");
    if (!cid) continue;
    let a = agg.get(cid);
    if (!a) { a = { debS: 0, debN: 0, cr1S: 0, cr1N: 0, pixS: 0, pixN: 0, parc: new Map() }; agg.set(cid, a); }
    if (Number(x.taxaDebito) > 0) { a.debS += Number(x.taxaDebito); a.debN++; }
    if (Number(x.taxaCredito) > 0) { a.cr1S += Number(x.taxaCredito); a.cr1N++; }
    if (Number(x.taxaPix) > 0) { a.pixS += Number(x.taxaPix); a.pixN++; }
    for (const [k, v] of Object.entries((x.parcelas ?? {}) as Record<string, number>)) {
      if (Number(v) > 0) { const p = a.parc.get(k) ?? { s: 0, n: 0 }; p.s += Number(v); p.n++; a.parc.set(k, p); }
    }
  }
  const taxaMedia = (cid: string, forma: string, parcelas: number): number => {
    const a = agg.get(cid); if (!a) return 0;
    if (forma === "cartaoDebito") return a.debN ? a.debS / a.debN : 0;
    if (forma === "cartaoCredito") return a.cr1N ? a.cr1S / a.cr1N : 0;
    if (forma === "pix") return a.pixN ? a.pixS / a.pixN : 0;
    if (forma === "cartaoParcelado") { const p = a.parc.get(String(parcelas)); return p ? p.s / p.n : 0; }
    return 0;
  };
  let receitaManual = 0, taxaManual = 0;
  const manSnap = await db.collection("manual_sales").where("dia", ">=", de).where("dia", "<=", ate).get();
  for (const doc of manSnap.docs) {
    const m = doc.data();
    if (!daEmpresa(m.empresaId)) continue;
    const valor = n0(m.valor);
    if (!(valor > 0)) continue;
    receitaManual += valor;
    const forma = String(m.forma ?? "");
    if (forma !== "dinheiro") {
      const parcelas = Math.max(2, Math.min(10, Math.round(Number(m.parcelas) || 2)));
      taxaManual += n0(valor * (taxaMedia(String(m.maquinaEmpresaId ?? ""), forma, parcelas) / 100));
    }
  }
  receitaVendas += receitaManual;
  taxasCartao += taxaManual;

  // COMPRAS (proxy de CMV) — NF-e de fornecedor terceiro (competência = dhEmi)
  let compras = 0;
  const nfSnap = await db.collection("nfe_documents").where("dhEmi", ">=", de).where("dhEmi", "<", maisDiasISO(ate, 1)).get();
  for (const doc of nfSnap.docs) {
    const r = doc.data(); const cid = String(r.companyId ?? "");
    if (!daEmpresa(cid)) continue;
    const emit = somenteDigitos(String(r.cnpjEmit ?? ""));
    if (!emit || emit === (cnpjPorId.get(cid) ?? "")) continue; // exclui emissões próprias
    compras += n0(r.vNF);
  }

  // DESPESAS FIXAS (competência mensal). No mês pago, usa o VALOR REAL pago; senão, o previsto.
  let despesasFixas = 0;
  const meses = mesesEntre(de, ate);
  for (const doc of (await db.collection("nfe_fixed_expenses").get()).docs) {
    const x = doc.data();
    if (!daEmpresa(x.companyId) || x.ativo === false) continue;
    const inicio = x.createdAt ? String(x.createdAt).slice(0, 7) : ""; // não retroagir antes da criação
    const fim = x.fimVigencia ? String(x.fimVigencia) : ""; // qtd de parcelas limitada
    const pagamentos = (x.pagamentos ?? {}) as Record<string, { pago?: boolean; valor?: number }>;
    for (const ym of meses) {
      if (!incideNoMes(x, ym) || (inicio && ym < inicio) || (fim && ym > fim)) continue;
      const pg = pagamentos[ym];
      despesasFixas += pg?.pago ? n0(pg.valor ?? x.valor) : n0(x.valor);
    }
  }
  // DESPESAS MANUAIS (sem NF / extraordinárias) — competência = dia
  let despesasManuais = 0;
  for (const doc of (await db.collection("manual_expenses").where("dia", ">=", de).where("dia", "<=", ate).get()).docs) {
    const x = doc.data();
    if (!daEmpresa(x.empresaId)) continue;
    despesasManuais += n0(x.valor);
  }
  // FRETES (CT-e) e SERVIÇOS (NFS-e) — competência = dhEmi
  let fretes = 0;
  for (const doc of (await db.collection("cte_documents").where("dhEmi", ">=", de).where("dhEmi", "<", maisDiasISO(ate, 1)).get()).docs) {
    const r = doc.data(); if (daEmpresa(r.companyId)) fretes += n0(r.vTPrest);
  }
  let servicos = 0;
  for (const doc of (await db.collection("nfse_documents").where("dhEmi", ">=", de).where("dhEmi", "<", maisDiasISO(ate, 1)).get()).docs) {
    const r = doc.data(); if (daEmpresa(r.companyId)) servicos += n0(r.vServ);
  }

  // CMV: prioridade (1) % informado; (2) CUSTO REAL dos itens vendidos (padrão); (3) compras (fallback).
  const cmvReal = cmvBase === "aquisicao" ? cmvRealAquisicao : cmvRealGerencial;
  let cmv: number, cmvOrigem: string;
  if (cmvPct > 0) { cmv = receitaVendas * (cmvPct / 100); cmvOrigem = "percentual"; }
  else if (cmvReal > 0) { cmv = cmvReal; cmvOrigem = cmvBase === "aquisicao" ? "real_aquisicao" : "real_gerencial"; }
  else { cmv = compras; cmvOrigem = "compras"; }
  const custoCobertura = itensTot > 0 ? itensComCusto / itensTot : 0;
  const lucroBruto = receitaVendas - cmv;
  const resultado = lucroBruto - taxasCartao - despesasFixas - despesasManuais - fretes - servicos;
  const pct = (v: number) => (receitaVendas > 0 ? (v / receitaVendas) * 100 : 0);

  return {
    de, ate, empresaId: empresaId || null, cmvPct, cmvBase, cmvOrigem,
    receitaVendas, receitaManual, descontos: Math.round(descontos * 100) / 100, cmv, compras,
    cmvReal, cmvRealAquisicao, cmvRealGerencial, custoCobertura,
    lucroBruto, margemBruta: pct(lucroBruto),
    taxasCartao, despesasFixas, despesasManuais, fretes, servicos,
    resultado, margemLiquida: pct(resultado),
  };
}

export const dreGerencial = onCall(
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
    const cmvPct = Math.max(0, Math.min(100, Number(d.cmvPct) || 0));
    const cmvBase = d.cmvBase === "aquisicao" ? "aquisicao" : "gerencial";
    return { ok: true, ...(await calcularDRE(de, ate, empresaId, cmvPct, cmvBase)) };
  },
);

/** Primeiro e último dia (YYYY-MM-DD) de um mês YYYY-MM. */
function limitesMes(ym: string): { de: string; ate: string } {
  const y = Number(ym.slice(0, 4)); const m = Number(ym.slice(5, 7));
  const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { de: `${ym}-01`, ate: `${ym}-${String(ult).padStart(2, "0")}` };
}

/**
 * DRE comparativo: mesma estrutura do DRE, mas em várias colunas.
 * eixo="mes": um DRE por mês do intervalo (mesma loja/consolidado) → tendência.
 * eixo="loja": um DRE por empresa no período → ranking de rentabilidade.
 * Reusa calcularDRE (bate 1:1 com o DRE individual). Só leitura (financeiro).
 */
export const dreComparativo = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 300 },
  async (req) => {
    await exigirModulo(req, "financeiro", ["admin", "fiscal", "financeiro"]);
    const d = req.data ?? {};
    const eixo = d.eixo === "loja" ? "loja" : "mes";
    const de = String(d.de ?? "").slice(0, 10);
    const ate = String(d.ate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
      throw new HttpsError("invalid-argument", "Período inválido.");
    }
    const cmvPct = Math.max(0, Math.min(100, Number(d.cmvPct) || 0));
    const cmvBase = d.cmvBase === "aquisicao" ? "aquisicao" : "gerencial";

    interface Coluna extends DREResultado { chave: string; rotulo: string; incompleto: boolean }
    const colunas: Coluna[] = [];
    // coluna "incompleta" = dado de um lado faltando, distorcendo a margem. Sinaliza, não esconde:
    //  (a) receita implausivelmente baixa vs custo (mês fora da janela do sync de vendas), ou
    //  (b) CMV vindo de "compras" (sem custo real nem %) com compras ~0 vs receita (NF-e fora da janela SEFAZ ~90d).
    // Com CMV real (itens) ou CMV% informado, (b) deixa de valer.
    const ehIncompleto = (r: DREResultado): boolean => {
      if (r.receitaVendas <= 0) return true;
      const custo = r.compras + r.despesasFixas + r.despesasManuais + r.fretes + r.servicos;
      if (custo > 0 && r.receitaVendas < custo * 0.5) return true;
      if (r.cmvOrigem === "compras" && r.compras < r.receitaVendas * 0.15) return true;
      return false;
    };

    if (eixo === "mes") {
      const empresaId = d.empresaId ? String(d.empresaId) : "";
      const meses = mesesEntre(de, ate).slice(0, 24); // teto de segurança
      for (const ym of meses) {
        const { de: md, ate: ma } = limitesMes(ym);
        const dre = await calcularDRE(md, ma, empresaId, cmvPct, cmvBase);
        colunas.push({ ...dre, chave: ym, rotulo: ym, incompleto: ehIncompleto(dre) });
      }
    } else {
      // uma coluna por empresa (todas as cadastradas)
      const emps = (await db.collection("nfe_companies").get()).docs
        .map((e) => ({ id: e.id, nome: String((e.data() as { nomeFantasia?: string; razaoSocial?: string }).nomeFantasia || (e.data() as { razaoSocial?: string }).razaoSocial || e.id) }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      for (const emp of emps.slice(0, 30)) {
        const dre = await calcularDRE(de, ate, emp.id, cmvPct, cmvBase);
        // pula lojas totalmente vazias no período (sem receita nem custo nem despesa)
        if (dre.receitaVendas === 0 && dre.compras === 0 && dre.despesasFixas === 0 && dre.fretes === 0 && dre.servicos === 0) continue;
        colunas.push({ ...dre, chave: emp.id, rotulo: emp.nome, incompleto: ehIncompleto(dre) });
      }
    }

    // TOTAL (soma das colunas) — só faz sentido somar valores, margem recalculada
    const soma = (k: keyof DREResultado) => colunas.reduce((s, c) => s + (Number(c[k]) || 0), 0);
    const recT = soma("receitaVendas");
    const lbT = soma("lucroBruto");
    const resT = soma("resultado");
    const total = {
      receitaVendas: recT, receitaManual: soma("receitaManual"),
      cmv: soma("cmv"), compras: soma("compras"),
      lucroBruto: lbT, margemBruta: recT > 0 ? (lbT / recT) * 100 : 0,
      taxasCartao: soma("taxasCartao"), despesasFixas: soma("despesasFixas"),
      despesasManuais: soma("despesasManuais"),
      fretes: soma("fretes"), servicos: soma("servicos"),
      resultado: resT, margemLiquida: recT > 0 ? (resT / recT) * 100 : 0,
    };

    return { ok: true, eixo, de, ate, cmvPct, empresaId: eixo === "mes" ? (d.empresaId ? String(d.empresaId) : null) : null, colunas, total };
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
/** Diferença em dias (a − b) entre duas datas YYYY-MM-DD (UTC). */
function diasEntreISO(a: string, b: string): number {
  const [ya, ma, da] = a.slice(0, 10).split("-").map(Number);
  const [yb, mb, db] = b.slice(0, 10).split("-").map(Number);
  if (!ya || !yb) return 999;
  const ta = Date.UTC(ya, (ma || 1) - 1, da || 1);
  const tb = Date.UTC(yb, (mb || 1) - 1, db || 1);
  return Math.round((ta - tb) / 86_400_000);
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
// ——— Taxas de cartão do APP (fonte da verdade p/ líquido; NÃO usamos a taxa do PDVnet) ———
// Regra do usuário (2026-08): calcular todo líquido/taxa pelas taxas CADASTRADAS no APP
// (card_rates, por bandeira), não pelo líquido que o PDVnet traz.
interface CartaoRate { taxaDebito: number; taxaCredito: number; taxaPix: number; parcelas: Record<string, number> }
interface TaxasLoja { porCartao: Map<string, CartaoRate>; mediaDeb: number; mediaCr1: number; mediaPix: number; parcMedia: Map<string, number> }
const normNome = (s: unknown) => String(s ?? "").toUpperCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/[^A-Z0-9]/g, "");
async function carregarTaxasApp(): Promise<Map<string, TaxasLoja>> {
  const acc = new Map<string, { cartoes: Map<string, CartaoRate>; debS: number; debN: number; cr1S: number; cr1N: number; pixS: number; pixN: number; parcAgg: Map<string, { s: number; n: number }> }>();
  for (const d of (await db.collection("card_rates").get()).docs) {
    const x = d.data(); const cid = String(x.empresaId ?? ""); if (!cid) continue;
    let L = acc.get(cid); if (!L) { L = { cartoes: new Map(), debS: 0, debN: 0, cr1S: 0, cr1N: 0, pixS: 0, pixN: 0, parcAgg: new Map() }; acc.set(cid, L); }
    const parcelas: Record<string, number> = {};
    for (const [k, v] of Object.entries((x.parcelas ?? {}) as Record<string, number>)) parcelas[k] = Number(v) || 0;
    L.cartoes.set(normNome(x.nome), { taxaDebito: Number(x.taxaDebito) || 0, taxaCredito: Number(x.taxaCredito) || 0, taxaPix: Number(x.taxaPix) || 0, parcelas });
    if (Number(x.taxaDebito) > 0) { L.debS += Number(x.taxaDebito); L.debN++; }
    if (Number(x.taxaCredito) > 0) { L.cr1S += Number(x.taxaCredito); L.cr1N++; }
    if (Number(x.taxaPix) > 0) { L.pixS += Number(x.taxaPix); L.pixN++; }
    for (const [k, v] of Object.entries(parcelas)) if (v > 0) { const a = L.parcAgg.get(k) ?? { s: 0, n: 0 }; a.s += v; a.n++; L.parcAgg.set(k, a); }
  }
  const out = new Map<string, TaxasLoja>();
  for (const [cid, L] of acc) {
    const parcMedia = new Map<string, number>(); for (const [k, a] of L.parcAgg) parcMedia.set(k, a.n ? a.s / a.n : 0);
    out.set(cid, { porCartao: L.cartoes, mediaDeb: L.debN ? L.debS / L.debN : 0, mediaCr1: L.cr1N ? L.cr1S / L.cr1N : 0, mediaPix: L.pixN ? L.pixS / L.pixN : 0, parcMedia });
  }
  return out;
}
/** Taxa % do APP para um recebível: casa pela bandeira (descricaoCartao); senão média da loja. */
function ehRecebivelPix(descricaoCartao: unknown): boolean {
  return /pix/i.test(String(descricaoCartao ?? ""));
}
function taxaAppDe(L: TaxasLoja | undefined, descricaoCartao: unknown, parcela: number): number {
  if (!L) return 0;
  const desc = String(descricaoCartao ?? "");
  const isDeb = /DEBITO|DÉBITO/i.test(desc);
  const card = L.porCartao.get(normNome(desc));
  if (/pix/i.test(desc)) return card?.taxaPix ?? L.mediaPix; // STONE PIX usa a taxa de PIX, não de cartão
  if (card) {
    if (isDeb) return card.taxaDebito;
    if (parcela >= 2) return card.parcelas[String(parcela)] || L.parcMedia.get(String(parcela)) || card.taxaCredito;
    return card.taxaCredito;
  }
  if (isDeb) return L.mediaDeb;
  if (parcela >= 2) return L.parcMedia.get(String(parcela)) || L.mediaCr1;
  return L.mediaCr1;
}
/** Líquido de um recebível pela taxa do APP (bruto − taxa%). */
function liquidoApp(bruto: number, taxaPct: number): number {
  return Math.round(bruto * (1 - taxaPct / 100) * 100) / 100;
}

/**
 * Recebíveis de cartão com a DATA DE CRÉDITO correta por loja, respeitando o
 * toggle de antecipação. Antecipação LIGADA: crédito D+1 (fim de semana → segunda),
 * a venda inteira junto. DESLIGADA: crédito na DATA DE VENCIMENTO real do recebível
 * (parcelado cai mês a mês; à vista ~D+30). Só devolve o que cai em [de, ate].
 * LÍQUIDO calculado pelas TAXAS DO APP (não pelo líquido do PDVnet).
 */
async function recebiveisNoCredito(
  de: string, ate: string, daEmpresa: (cid: string) => boolean,
): Promise<Array<{ empresaId: string; liquido: number; bruto: number; credito: string; dia: string; pix: boolean }>> {
  const ant = await carregarAntecipacao();
  const taxasApp = await carregarTaxasApp();
  const d10 = (s: unknown) => (s ? String(s).slice(0, 10) : "");
  const liqDe = (r: FirebaseFirestore.DocumentData, cid: string) =>
    liquidoApp(Number(r.valor ?? 0), taxaAppDe(taxasApp.get(cid), r.descricaoCartao, Number(r.parcela ?? 1) || 1));
  const out: Array<{ empresaId: string; liquido: number; bruto: number; credito: string; dia: string; pix: boolean }>= [];
  // LIGADA — pela data da venda (crédito D+1 / fds→seg)
  const qOn = await db.collection("card_receivables")
    .where("dia", ">=", menosDiasISO(de, 4)).where("dia", "<=", ate).get();
  for (const doc of qOn.docs) {
    const r = doc.data();
    const cid = String(r.conciliaEmpresaId ?? r.empresaId ?? ""); // loja da máquina (onde o dinheiro cai)
    if (!daEmpresa(cid)) continue;
    // Loja SEM antecipação é tratada pela data de vencimento (branch abaixo) — EXCETO recebível
    // sem dataVencimento, que ali some do resultado (o where(">=") descarta null); aqui ele
    // entra com crédito estimado D+1 em vez de desaparecer.
    if (ant.get(cid) === false && r.dataVencimento) continue;
    const credito = dataCreditoCartao(d10(r.dia));
    if (!credito || credito < de || credito > ate) continue;
    out.push({ empresaId: cid, liquido: liqDe(r, cid), bruto: Number(r.valor ?? 0), credito, dia: d10(r.dia), pix: ehRecebivelPix(r.descricaoCartao) });
  }
  // DESLIGADA — pela data de vencimento real do recebível
  const qOff = await db.collection("card_receivables")
    .where("dataVencimento", ">=", de).where("dataVencimento", "<", maisDiasISO(ate, 1)).get();
  for (const doc of qOff.docs) {
    const r = doc.data();
    const cid = String(r.conciliaEmpresaId ?? r.empresaId ?? ""); // loja da máquina (onde o dinheiro cai)
    if (!daEmpresa(cid) || ant.get(cid) !== false) continue;
    const credito = d10(r.dataVencimento);
    if (!credito || credito < de || credito > ate) continue;
    out.push({ empresaId: cid, liquido: liqDe(r, cid), bruto: Number(r.valor ?? 0), credito, dia: d10(r.dia), pix: ehRecebivelPix(r.descricaoCartao) });
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
    const hoje = hojeBRT(); // fuso de SP: senão, à noite (UTC = amanhã) marca crédito futuro como já recebido
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
    // Toda origem já inicializada; o += usa (?? 0) para nunca virar NaN se surgir uma nova.
    const porOrigem: Record<string, number> = { cartao: 0, avista: 0, nfe: 0, despesas: 0, despesasManuais: 0, acordos: 0 };
    const entrada = (dia: string, valor: number, real: boolean, origem: string) => {
      if (!noRange(dia) || !(valor > 0)) return;
      const b = buck(dia); b.entrada += valor; if (real) b.entradaReal += valor;
      tot.entrada += valor; if (real) tot.entradaReal += valor; porOrigem[origem] = (porOrigem[origem] ?? 0) + valor;
    };
    const saida = (dia: string, valor: number, real: boolean, origem: string) => {
      if (!noRange(dia) || !(valor > 0)) return;
      const b = buck(dia); b.saida += valor; if (real) b.saidaReal += valor;
      tot.saida += valor; if (real) tot.saidaReal += valor; porOrigem[origem] = (porOrigem[origem] ?? 0) + valor;
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
    // ENTRADAS — PIX/dinheiro/depósito (na data da venda), sem taxa (valor cheio).
    const spSnap = await db.collection("sale_payments").where("dia", ">=", de).where("dia", "<=", ate).get();
    for (const doc of spSnap.docs) {
      const p = doc.data();
      if (p.forma !== "dinheiro" && p.forma !== "pix" && p.forma !== "deposito") continue;
      // dinheiro fica na loja física (empresaId); pix e depósito caem no banco da loja da máquina.
      const naConta = p.forma === "pix" || p.forma === "deposito";
      const cid = naConta ? (p.conciliaEmpresaId ?? p.empresaId) : p.empresaId;
      if (!daEmpresa(cid)) continue;
      const dia = d10(p.dia);
      entrada(dia, Number(p.valor ?? 0), dia <= hoje, "avista");
    }

    // Saída de uma obrigação: quando PAGA com contas de pagamento, o caixa sai da(s)
    // conta(s) pagadora(s) (rateio/cross-company); senão, cai na empresa da obrigação.
    const saidaObrig = (dia: string, valorTotal: number, pago: boolean, origem: string, companyIdFallback: unknown, contasPagamento: unknown) => {
      const splits = pago && Array.isArray(contasPagamento) && contasPagamento.length
        ? (contasPagamento as Array<Record<string, unknown>>)
          .map((c) => ({ empresaId: String(c.empresaId ?? ""), valor: Number(c.valor ?? 0) }))
          .filter((c) => c.empresaId && c.valor > 0)
        : [{ empresaId: String(companyIdFallback ?? ""), valor: valorTotal }];
      for (const sp of splits) {
        if (!daEmpresa(sp.empresaId) || !(sp.valor > 0)) continue;
        saida(dia, sp.valor, pago, origem);
      }
    };

    // SAÍDAS — contas a pagar das NF-e
    const parcSnap = await db.collection("nfe_installments").get();
    for (const doc of parcSnap.docs) {
      const p = doc.data();
      if (p.migradoAcordo === true) continue; // virou acordo — o acordo carrega o fluxo
      const pago = p.statusPagamento === "pago";
      const dia = d10(pago ? p.dataPagamento : p.vencimento);
      const valor = Number((pago ? p.valorPago ?? p.valor : p.valor) ?? 0);
      saidaObrig(dia, valor, pago, "nfe", p.companyId, p.contasPagamento);
    }
    // SAÍDAS — despesas fixas (previsto por mês; realizado ao pagar)
    const mesesRange = mesesEntre(de, ate);
    const despSnap = await db.collection("nfe_fixed_expenses").get();
    for (const doc of despSnap.docs) {
      const x = doc.data();
      if (x.ativo === false) continue;
      const inicio = x.createdAt ? String(x.createdAt).slice(0, 7) : ""; // não retroagir antes da criação
      const fim = x.fimVigencia ? String(x.fimVigencia) : ""; // qtd de parcelas limitada
      for (const ym of mesesRange) {
        if (!incideNoMes(x, ym) || (inicio && ym < inicio) || (fim && ym > fim)) continue;
        const pg = x.pagamentos?.[ym];
        if (pg?.pago) {
          saidaObrig(d10(pg.data) || `${ym}-01`, Number(pg.valor ?? x.valor ?? 0), true, "despesas", x.companyId, pg.contasPagamento);
        } else {
          const dia = `${ym}-${String(Math.min(Number(x.diaVencimento) || 1, 28)).padStart(2, "0")}`;
          saidaObrig(dia, Number(x.valor ?? 0), false, "despesas", x.companyId, null);
        }
      }
    }
    // SAÍDAS — despesas manuais. Paga → saída REAL na data do pagamento; não paga → saída
    // PREVISTA no vencimento (dia). O caixa sai da conta do pagamento (contaEmpresaId no PIX;
    // a própria empresa no dinheiro). Compat: doc sem `pago` = pago (comportamento antigo).
    // Não paga cai por vencimento (dia); paga pode ter dataPagamento fora da janela → busca ampla.
    const dmSnap = await db.collection("manual_expenses").get();
    for (const doc of dmSnap.docs) {
      const x = doc.data();
      const cid = x.contaEmpresaId ?? x.empresaId;
      if (!daEmpresa(cid)) continue;
      const pago = x.pago !== false;
      const dia = pago ? d10(x.dataPagamento ?? x.dia) : d10(x.dia);
      saida(dia, Number(x.valor ?? 0), pago, "despesasManuais");
    }
    // SAÍDAS — parcelas de acordos
    const acSnap = await db.collection("nfe_agreements").get();
    for (const doc of acSnap.docs) {
      const a = doc.data();
      for (const p of (a.parcelas ?? []) as Array<Record<string, unknown>>) {
        const pago = p.statusPagamento === "pago";
        const dia = d10(pago ? p.dataPagamento : p.vencimento);
        saidaObrig(dia, Number(p.valor ?? 0), pago, "acordos", a.companyId, p.contasPagamento);
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
    const hoje = hojeBRT(); // fuso de SP: senão, à noite (UTC = amanhã) conta como vencida a conta que vence hoje
    const d10 = (s: unknown) => (s ? String(s).slice(0, 10) : "");
    const n0 = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; }; // NaN → 0 (não quebra o callable)
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
      if (dia < hoje) { vencQtd++; vencVal += n0(p.valor); }
      else if (dia <= seteDias) { prox7Qtd++; prox7Val += n0(p.valor); }
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
        if (dia && dia < hoje) { acQtd++; acVal += n0(p.valor); }
      }
    }
    if (acQtd) pend.push({ chave: "acordosAtrasados", titulo: `${acQtd} parcela(s) de acordo em atraso`, descricao: "Parcelas de acordos vencidas e não pagas.", severidade: "atencao", qtd: acQtd, valor: acVal, href: "/acordos" });

    // Notas sem XML completo (manifestação pendente). Filtra no Firestore (índice de campo
    // único, automático) em vez de varrer nfe_documents inteira só para contar as com false.
    let nxQtd = 0;
    for (const doc of (await db.collection("nfe_documents").where("temXmlCompleto", "==", false).get()).docs) {
      const dcto = doc.data();
      if (!daEmpresa(dcto.companyId)) continue;
      nxQtd++;
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

/** Categoria do PDV → chave de despesa fixa (só as confiáveis; resto fica em branco). */
function categoriaDespesaFixa(c: string): string {
  const s = (c || "").toLowerCase();
  if (/alug/.test(s)) return "aluguel";
  if (/sal[aá]ri|folha/.test(s)) return "salarios";
  if (/simples|imposto|tribut|inss|fgts|\bdas\b|icms|iss/.test(s)) return "impostos";
  if (/telefone|internet|telecom/.test(s)) return "telefone";
  if (/condom/.test(s)) return "condominio";
  if (/energia|\bluz\b|el[eé]tr/.test(s)) return "energia";
  if (/[aá]gua|esgoto/.test(s)) return "agua";
  if (/cont[aá]bil/.test(s)) return "contabilidade";
  if (/software|sistema|licen/.test(s)) return "software";
  if (/royal|franqui/.test(s)) return "royalties";
  return ""; // não casou → em branco (usuário escolhe ao editar)
}

/** True para títulos de COMPRA DE MERCADORIA — não são despesa fixa (fornecedor de mercadoria). */
function ehMercadoria(categoria: string): boolean {
  return /mercadoria/i.test(categoria || "");
}

/**
 * Importa o relatório "Contas a Pagar" do PDV (CSV) e cria DESPESAS FIXAS
 * (nfe_fixed_expenses), agrupando parcelas mensais iguais num registro só.
 * Os campos que casam são preenchidos (nome, valor, loja, dia, categoria quando
 * reconhecida); o que NÃO casa fica em branco para o usuário completar ao editar
 * (mesma máscara de um lançamento manual). dryRun (padrão) só devolve a prévia;
 * o import real faz FULL-REPLACE das despesas fixas origem="pdv-import" (as manuais
 * são preservadas). Admin/financeiro.
 */
export const importarContasPagar = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 300 },
  async (req) => {
    const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
    const texto = String(req.data?.texto ?? "");
    const dryRun = req.data?.dryRun !== false; // padrão = só prévia
    if (texto.length < 20) throw new HttpsError("invalid-argument", "Arquivo vazio ou inválido.");
    const todos = parseContasPagar(texto);
    if (!todos.length) {
      throw new HttpsError("failed-precondition", "Nenhum título reconhecido. Confira se é o relatório 'Contas a Pagar' do PDV (CSV).");
    }
    // Fornecedores de MERCADORIA não são despesa fixa — ficam de fora (serviços entram).
    const titulos = todos.filter((t) => !ehMercadoria(t.categoria));
    const ignoradosMercadoria = todos.length - titulos.length;

    // AGRUPA por (empresa, nome, valor) — colapsa TODAS as parcelas mensais iguais numa despesa
    // fixa só (mesmo que o dia de vencimento varie); o dia é o MAIS COMUM entre as parcelas.
    interface Grupo { empresaId: string | null; loja: string; nome: string; categoria: string; beneficiario: string; valor: number; dias: Map<number, number>; qtd: number }
    const grupos = new Map<string, Grupo>();
    for (const t of titulos) {
      const nome = (t.observacao || t.fornecedor || t.categoria).slice(0, 120);
      const diaN = Number(t.vencimento.slice(8, 10));
      const key = `${t.empresaId ?? "?"}|${nome.toLowerCase()}|${t.valor.toFixed(2)}`;
      let g = grupos.get(key);
      if (!g) { g = { empresaId: t.empresaId, loja: t.loja, nome, categoria: categoriaDespesaFixa(t.categoria), beneficiario: t.fornecedor, valor: t.valor, dias: new Map(), qtd: 0 }; grupos.set(key, g); }
      if (diaN >= 1 && diaN <= 31) g.dias.set(diaN, (g.dias.get(diaN) ?? 0) + 1);
      g.qtd++;
    }
    // dia de vencimento = o mais frequente do grupo
    const diaMaisComum = (dias: Map<number, number>): number | null => {
      let melhor: number | null = null, max = 0;
      for (const [d, n] of dias) if (n > max) { max = n; melhor = d; }
      return melhor;
    };
    const lista = [...grupos.values()];

    // Prévia
    const porCategoria: Record<string, { qtd: number; valor: number }> = {};
    const porLoja: Record<string, { qtd: number; valor: number }> = {};
    let totalMensal = 0, semEmpresa = 0, semCategoria = 0;
    for (const g of lista) {
      totalMensal += g.valor;
      const ck = g.categoria || "(a classificar)";
      (porCategoria[ck] ??= { qtd: 0, valor: 0 }); porCategoria[ck].qtd++; porCategoria[ck].valor += g.valor;
      const lk = g.loja || "(sem loja)";
      (porLoja[lk] ??= { qtd: 0, valor: 0 }); porLoja[lk].qtd++; porLoja[lk].valor += g.valor;
      if (!g.empresaId) semEmpresa++;
      if (!g.categoria) semCategoria++;
    }
    const resumo = {
      qtd: lista.length, titulos: titulos.length, total: totalMensal, semEmpresa, semCategoria, ignoradosMercadoria,
      porCategoria: Object.entries(porCategoria).map(([k, v]) => ({ categoria: k, ...v })).sort((a, b) => b.valor - a.valor),
      porLoja: Object.entries(porLoja).map(([k, v]) => ({ loja: k, ...v })).sort((a, b) => b.valor - a.valor),
    };

    if (dryRun) return { ok: true, dryRun: true, resumo };

    // IMPORT REAL — cria as despesas fixas (full-replace das origem="pdv-import").
    const emps = await db.collection("nfe_companies").get();
    const nomeEmp = new Map<string, string>();
    for (const e of emps.docs) { const x = e.data(); nomeEmp.set(e.id, String(x.nomeFantasia || x.razaoSocial || e.id)); }

    const now = agoraISO();
    const antigos = await db.collection("nfe_fixed_expenses").where("origem", "==", "pdv-import").get();
    let batch = db.batch(); let ops = 0;
    const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };
    for (const doc of antigos.docs) { batch.delete(doc.ref); if (++ops >= 400) await flush(); }
    await flush();
    for (const g of lista) {
      const ref = db.collection("nfe_fixed_expenses").doc();
      batch.set(ref, {
        id: ref.id,
        companyId: g.empresaId,
        empresaNome: g.empresaId ? (nomeEmp.get(g.empresaId) ?? null) : null,
        nome: g.nome,
        categoria: g.categoria,        // "" quando não casou → editável em branco
        valor: g.valor,
        recorrencia: "mensal",         // parcelas mensais → mensal (editável)
        mesBase: null,                 // em branco
        diaVencimento: diaMaisComum(g.dias),
        beneficiario: g.beneficiario || null,
        observacao: null,              // em branco p/ completar ao editar
        ativo: true,
        pagamentos: {},
        origem: "pdv-import",
        importadoEm: now, importadoPor: uid,
        createdAt: now, createdBy: uid, updatedAt: now,
      });
      if (++ops >= 400) await flush();
    }
    await flush();
    await auditar(uid, "financeiro.importarContasPagar", { despesas: lista.length, titulos: titulos.length, removidos: antigos.size });
    return { ok: true, dryRun: false, importados: lista.length, titulos: titulos.length, removidos: antigos.size, resumo };
  },
);

/**
 * Importa um extrato bancário OFX (parse server-side) e persiste os lançamentos
 * em bank_transactions (dedup por conteúdo) + o saldo/período por conta em bank_accounts.
 * Uma loja pode ter várias contas (bank_accounts/{empresaId}_{contaId}).
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
    const contaId = ext.contaId; // identifica a conta DENTRO da loja (permite várias por loja)
    for (const t of ext.transacoes) {
      // Dedup por conta + chave de CONTEÚDO (não FITID) — reimportar o mesmo período não duplica,
      // e contas diferentes da mesma loja não colidem mesmo com lançamentos idênticos.
      const ref = db.collection("bank_transactions").doc(`${empresaId}_${contaId}_${t.chave}`);
      batch.set(ref, { ...t, empresaId, contaId, dia: t.data, origem: "ofx", org: ext.org, importadoEm: now }, { merge: true });
      // Auto-cura: remove o gêmeo do esquema ANTIGO (id sem contaId), de antes do multi-conta.
      batch.delete(db.collection("bank_transactions").doc(`${empresaId}_${t.chave}`));
      ops += 2;
      if (ops >= 400) await flush();
    }
    await flush();
    // Remove o doc de conta antigo (id == empresaId, uma conta por loja) — substituído pelo por-conta.
    await db.collection("bank_accounts").doc(empresaId).delete().catch(() => {});
    // Uma conta por (loja, contaId) — várias contas por loja convivem em docs separados.
    await db.collection("bank_accounts").doc(`${empresaId}_${contaId}`).set(
      {
        empresaId, contaId, org: ext.org, fid: ext.fid, curdef: ext.curdef,
        bankId: ext.bankId, acctId: ext.acctId, acctType: ext.acctType,
        saldo: ext.saldo, saldoData: ext.saldoData, dtStart: ext.dtStart, dtEnd: ext.dtEnd,
        ultimoImport: now, ultimoImportPor: uid,
      },
      { merge: true },
    );
    await auditar(uid, "banco.importarExtrato", { empresaId, contaId, transacoes: ext.transacoes.length, saldo: ext.saldo });
    return { ok: true, transacoes: ext.transacoes.length, saldo: ext.saldo, saldoData: ext.saldoData, org: ext.org, contaId, acctId: ext.acctId, periodo: { de: ext.dtStart, ate: ext.dtEnd } };
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
    // Uma loja pode ter VÁRIAS contas — consolida o saldo/período de todas.
    const contasSnap = await db.collection("bank_accounts").where("empresaId", "==", empresaId).get();
    const contasArr = contasSnap.docs.map((d) => d.data());
    let conta: Record<string, unknown> | null = null;
    if (contasArr.length) {
      const orgs = [...new Set(contasArr.map((a) => a.org).filter(Boolean))] as string[];
      const pick = (campo: string, ultimo: boolean) => {
        const vals = contasArr.map((a) => a[campo]).filter(Boolean).map(String).sort();
        return (ultimo ? vals[vals.length - 1] : vals[0]) ?? null;
      };
      conta = {
        empresaId,
        saldo: contasArr.reduce((s, a) => s + (Number(a.saldo ?? 0) || 0), 0),
        saldoData: pick("saldoData", true),
        ultimoImport: pick("ultimoImport", true),
        dtStart: pick("dtStart", false), dtEnd: pick("dtEnd", true),
        curdef: (contasArr[0].curdef as string) ?? null,
        org: contasArr.length > 1 ? `${orgs.join(" · ") || "Banco"} · ${contasArr.length} contas` : (orgs[0] ?? "Conta"),
        nContas: contasArr.length,
      };
    }
    const contas = contasArr.map((a) => ({
      contaId: a.contaId ?? null, org: a.org ?? null, acctId: a.acctId ?? null,
      saldo: Number(a.saldo ?? 0) || 0, saldoData: a.saldoData ?? null, ultimoImport: a.ultimoImport ?? null,
    }));
    const snap = await db.collection("bank_transactions").where("empresaId", "==", empresaId).get();
    const txs: Array<{ fitid: string; contaId: string | null; tipo: string; data: string; valor: number; memo: string; categoria: string }> = [];
    let creditos = 0, debitos = 0;
    const porCategoria: Record<string, number> = {};
    for (const doc of snap.docs) {
      const t = doc.data();
      const dia = String(t.dia ?? "");
      if ((de && dia < de) || (ate && dia > ate)) continue;
      const valor = Number(t.valor ?? 0);
      if (valor >= 0) creditos += valor; else debitos += valor;
      porCategoria[t.categoria] = (porCategoria[t.categoria] ?? 0) + valor;
      txs.push({ fitid: t.fitid, contaId: t.contaId ?? null, tipo: t.tipo, data: dia, valor, memo: t.memo, categoria: t.categoria });
    }

    // LANÇAMENTOS VIRTUAIS — despesas manuais pagas por PIX desta conta. Aparecem no
    // extrato até o OFX trazer o mesmo débito; aí são absorvidas (sem duplicar).
    const ofxDeb = txs.filter((t) => t.valor < 0).map((t) => ({ valor: t.valor, data: t.data, usado: false }));
    const diffDias = (a: string, b: string) => Math.abs((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000);
    const dmSnap = await db.collection("manual_expenses").where("contaEmpresaId", "==", empresaId).get();
    for (const doc of dmSnap.docs) {
      const x = doc.data();
      if (x.formaPagamento !== "pix") continue;
      const dia = String(x.dia ?? "");
      if (!dia || (de && dia < de) || (ate && dia > ate)) continue;
      const v = -Math.abs(Number(x.valor ?? 0));
      if (v === 0) continue;
      const m = ofxDeb.find((o) => !o.usado && Math.abs(o.valor - v) < 0.01 && diffDias(o.data, dia) <= 3);
      if (m) { m.usado = true; continue; } // já veio no OFX → não duplica
      debitos += v;
      porCategoria["pagamento"] = (porCategoria["pagamento"] ?? 0) + v;
      txs.push({ fitid: `dm-${doc.id}`, contaId: null, tipo: "DEBIT", data: dia, valor: v, memo: `${String(x.descricao ?? "Despesa")} (despesa manual)`, categoria: "pagamento" });
    }

    txs.sort((a, b) => b.data.localeCompare(a.data));
    return { ok: true, conta, contas, creditos, debitos, saldoMov: creditos + debitos, porCategoria, total: txs.length, transacoes: txs.slice(0, 300) };
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
    // Settlement: lojas cujo dinheiro (cartão/PIX/máquina) cai NA CONTA de outra loja.
    // Ex.: SXCG → Barra. `configuracoes/conciliacao.settlement` = { lojaOrigem: lojaConta }.
    const setSnap = await db.collection("configuracoes").doc("conciliacao").get();
    const settlement = (setSnap.exists ? ((setSnap.data() as { settlement?: Record<string, string> }).settlement ?? {}) : {});
    const settle = (cid: string) => settlement[cid] ?? cid;                   // resolve p/ a loja da conta
    const aliases = Object.entries(settlement).filter(([, v]) => v === empresaId).map(([k]) => k); // lojas que caem nesta empresa
    const maquinasAlvo = [empresaId, ...aliases].slice(0, 10);                 // p/ manual_sales (Firestore "in" ≤ 10)

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
    let cartaoMinDia = "", cartaoMaxDia = ""; // cobertura do extrato de cartão no período
    const bt = await db.collection("bank_transactions").where("empresaId", "==", empresaId).get();
    for (const doc of bt.docs) {
      const t = doc.data();
      const dia = d10(t.dia);
      if (dia < de || dia > ate) continue;
      const v = Number(t.valor ?? 0);
      if (t.categoria === "cartao_credito" || t.categoria === "cartao_debito") {
        bancoCartao += v; bd(dia).bancoCartao += v;
        if (!cartaoMinDia || dia < cartaoMinDia) cartaoMinDia = dia;
        if (dia > cartaoMaxDia) cartaoMaxDia = dia;
      } else if (t.categoria === "pix_venda") { bancoPix += v; bd(dia).bancoPix += v; }
      else if (v > 0) bancoOutrasEnt += v;
      else bancoSaidas += v;
    }

    // PREVISTO (PDV) — cartão (líquido) na DATA DE CRÉDITO real desta loja (respeita o
    // toggle de antecipação: LIGADA = D+1/fds→seg; DESLIGADA = data de vencimento);
    // PIX das vendas por dia.
    let previstoCartao = 0, brutoCartao = 0, previstoPix = 0;
    const rc = await recebiveisNoCredito(de, ate, (cid) => settle(cid) === empresaId);
    for (const r of rc) {
      // PIX da maquininha (STONE PIX) vem como recebível de cartão — vai pro PIX, não pro cartão.
      if (r.pix) { previstoPix += r.liquido; bd(r.credito).previstoPix += r.liquido; }
      else { previstoCartao += r.liquido; brutoCartao += r.bruto; bd(r.credito).previstoCartao += r.liquido; }
    }
    const sp = await db.collection("sale_payments").where("dia", ">=", de).where("dia", "<=", ate).get();
    for (const doc of sp.docs) {
      const p = doc.data();
      if (settle(String(p.conciliaEmpresaId ?? p.empresaId ?? "")) !== empresaId || p.forma !== "pix") continue;
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
    const man = await db.collection("manual_sales").where("maquinaEmpresaId", "in", maquinasAlvo).get();
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
        previstoCartao += liq; manualCartao += liq; brutoCartao += valor; bd(credito).previstoCartao += liq;
        // brutoCartao inclui a venda manual/avulsa (ex.: Maracanã na máquina desta loja) p/ a taxa não distorcer
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

    // TAXA efetiva do cartão: esperada (app) × real da Stone (o que caiu no banco).
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const taxaApp = brutoCartao > 0 ? r2((1 - previstoCartao / brutoCartao) * 100) : 0;
    const taxaStone = brutoCartao > 0 ? r2((1 - bancoCartao / brutoCartao) * 100) : 0;
    const diasCob = cartaoMinDia && cartaoMaxDia
      ? Math.round((new Date(`${cartaoMaxDia}T00:00:00`).getTime() - new Date(`${cartaoMinDia}T00:00:00`).getTime()) / 86_400_000) + 1
      : 0;
    return {
      ok: true, de, ate, empresaId,
      banco: { cartao: bancoCartao, pix: bancoPix, outrasEntradas: bancoOutrasEnt, saidas: bancoSaidas },
      previsto: { cartao: previstoCartao, pix: previstoPix },
      manual: { cartao: manualCartao, pix: manualPix },
      dif: { cartao: bancoCartao - previstoCartao, pix: bancoPix - previstoPix },
      // Validação da taxa da Stone (agregada). Só é confiável num extrato longo (≥ ~60 dias);
      // extrato curto tem descasamento de datas da antecipação.
      taxaCartao: { bruto: r2(brutoCartao), taxaApp, taxaStone, extratoDias: diasCob, confiavel: diasCob >= 60 },
      porDia,
    };
  },
);

/**
 * Conciliação de SAÍDAS: o que SAIU do banco (débitos) × o que registramos como PAGO
 * (contas de fornecedor, despesas fixas e parcelas de acordo). Casa por valor (±1% / ±R$1)
 * e data (±3 dias). Exceções são o ouro: "pago no sistema mas sem débito no banco" e
 * "débito de pagamento no banco sem conta registrada". Só leitura (financeiro).
 */
export const conciliacaoSaidas = onCall(
  { ...opcoes, memory: "512MiB", timeoutSeconds: 120 },
  async (req) => {
    await exigirModulo(req, "financeiro", ["admin", "fiscal", "financeiro"]);
    const dd = req.data ?? {};
    const de = String(dd.de ?? "").slice(0, 10);
    const ate = String(dd.ate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
      throw new HttpsError("invalid-argument", "Período inválido.");
    }
    const empresaId = dd.empresaId ? String(dd.empresaId) : "";
    const d10 = (s: unknown) => (s ? String(s).slice(0, 10) : "");
    const daEmpresa = (cid: unknown) => !empresaId || String(cid ?? "") === empresaId;
    const noRange = (dia: string) => !!dia && dia >= de && dia <= ate;

    // BANCO — todos os débitos (saídas) no período
    interface Debito { fitid: string; dia: string; valor: number; memo: string; categoria: string; usado: boolean }
    const debitos: Debito[] = [];
    const porCategoria: Record<string, number> = {};
    let totalSaidas = 0;
    const bt = empresaId
      ? await db.collection("bank_transactions").where("empresaId", "==", empresaId).get()
      : await db.collection("bank_transactions").get();
    for (const doc of bt.docs) {
      const t = doc.data();
      const dia = d10(t.dia);
      if (!noRange(dia)) continue;
      const valor = Number(t.valor ?? 0);
      if (valor >= 0) continue; // só saídas
      totalSaidas += valor;
      porCategoria[String(t.categoria ?? "outros")] = (porCategoria[String(t.categoria ?? "outros")] ?? 0) - valor;
      debitos.push({ fitid: String(t.fitid ?? doc.id), dia, valor, memo: String(t.memo ?? ""), categoria: String(t.categoria ?? "outros"), usado: false });
    }

    // OBRIGAÇÕES pagas no período (dataPagamento em [de,ate])
    interface Paga { tipo: string; descricao: string; valor: number; data: string; ref: string; conciliado: boolean }
    const pagas: Paga[] = [];
    // Atribui o pagamento à(s) CONTA(S) que pagaram (contasPagamento): rateio e
    // cross-company. Sem contasPagamento, cai na empresa da própria obrigação.
    const pushPaga = (tipo: string, descricao: string, valorTotal: number, data: string, ref: string, companyIdFallback: unknown, contasPagamento: unknown) => {
      const splits = Array.isArray(contasPagamento) && contasPagamento.length
        ? (contasPagamento as Array<Record<string, unknown>>)
          .map((c) => ({ empresaId: String(c.empresaId ?? ""), valor: Number(c.valor ?? 0) }))
          .filter((c) => c.empresaId && c.valor > 0)
        : [{ empresaId: String(companyIdFallback ?? ""), valor: valorTotal }];
      splits.forEach((sp, k) => {
        if (!daEmpresa(sp.empresaId) || !(sp.valor > 0)) return;
        pagas.push({ tipo, descricao, valor: sp.valor, data, ref: splits.length > 1 ? `${ref}#${k}` : ref, conciliado: false });
      });
    };
    // fornecedores (nfe_installments)
    for (const doc of (await db.collection("nfe_installments").get()).docs) {
      const p = doc.data();
      if (p.statusPagamento !== "pago") continue;
      const data = d10(p.dataPagamento);
      if (!noRange(data)) continue;
      const valor = Number(p.valorPago ?? p.valor ?? 0);
      if (!(valor > 0)) continue;
      pushPaga("fornecedor", String(p.xNomeEmit || p.cnpjEmit || "Fornecedor"), valor, data, doc.id, p.companyId, p.contasPagamento);
    }
    // despesas fixas (pagamentos.{ym})
    for (const doc of (await db.collection("nfe_fixed_expenses").get()).docs) {
      const x = doc.data();
      const pgs = (x.pagamentos ?? {}) as Record<string, { pago?: boolean; data?: string; valor?: number; contasPagamento?: unknown }>;
      for (const [ym, pg] of Object.entries(pgs)) {
        if (!pg?.pago) continue;
        const data = d10(pg.data) || `${ym}-01`;
        if (!noRange(data)) continue;
        const valor = Number(pg.valor ?? x.valor ?? 0);
        if (!(valor > 0)) continue;
        pushPaga("despesa", String(x.nome || x.categoria || "Despesa fixa"), valor, data, `${doc.id}_${ym}`, x.companyId, pg.contasPagamento);
      }
    }
    // acordos (parcelas pagas)
    for (const doc of (await db.collection("nfe_agreements").get()).docs) {
      const a = doc.data();
      const parcelas = (a.parcelas ?? []) as Array<Record<string, unknown>>;
      parcelas.forEach((p, i) => {
        if (p.statusPagamento !== "pago") return;
        const data = d10(p.dataPagamento);
        if (!noRange(data)) return;
        const valor = Number(p.valorPago ?? p.valor ?? 0);
        if (!(valor > 0)) return;
        pushPaga("acordo", String(a.nomeFornecedor || a.fornecedorNome || a.credor || "Acordo"), valor, data, `${doc.id}_${i}`, a.companyId, p.contasPagamento);
      });
    }

    // MATCHING — para cada conta paga, acha um débito compatível ainda não usado
    const proximo = (alvo: number, dataPg: string): Debito | null => {
      const tol = Math.max(1, alvo * 0.01);
      let melhor: Debito | null = null; let melhorDist = 999;
      for (const dbt of debitos) {
        if (dbt.usado) continue;
        if (Math.abs(Math.abs(dbt.valor) - alvo) > tol) continue;
        const dist = Math.abs(diasEntreISO(dbt.dia, dataPg));
        if (dist > 3) continue;
        if (dist < melhorDist) { melhor = dbt; melhorDist = dist; }
      }
      return melhor;
    };
    let conciliadoValor = 0, conciliadoQtd = 0;
    for (const pg of pagas) {
      const m = proximo(pg.valor, pg.data);
      if (m) { m.usado = true; pg.conciliado = true; conciliadoValor += pg.valor; conciliadoQtd++; }
    }

    // EXCEÇÕES
    const pagasSemBanco = pagas.filter((p) => !p.conciliado)
      .sort((a, b) => b.valor - a.valor);
    // débitos de PAGAMENTO no banco sem conta casada (transferências/tarifas são saídas legítimas sem conta)
    const debitosSemConta = debitos.filter((dbt) => !dbt.usado && dbt.categoria === "pagamento")
      .map((dbt) => ({ fitid: dbt.fitid, dia: dbt.dia, valor: dbt.valor, memo: dbt.memo }))
      .sort((a, b) => a.valor - b.valor);

    const totalPago = pagas.reduce((s, p) => s + p.valor, 0);
    const porTipo = {
      fornecedor: pagas.filter((p) => p.tipo === "fornecedor").reduce((s, p) => s + p.valor, 0),
      despesa: pagas.filter((p) => p.tipo === "despesa").reduce((s, p) => s + p.valor, 0),
      acordo: pagas.filter((p) => p.tipo === "acordo").reduce((s, p) => s + p.valor, 0),
    };

    return {
      ok: true, de, ate, empresaId: empresaId || null,
      banco: { totalSaidas: Math.abs(totalSaidas), porCategoria, qtd: debitos.length },
      pagas: { total: totalPago, qtd: pagas.length, porTipo },
      conciliado: { valor: conciliadoValor, qtd: conciliadoQtd },
      pagasSemBanco: pagasSemBanco.slice(0, 100),
      debitosSemConta: debitosSemConta.slice(0, 100),
      pagasSemBancoTotal: pagasSemBanco.reduce((s, p) => s + p.valor, 0),
      debitosSemContaTotal: debitosSemConta.reduce((s, p) => s + Math.abs(p.valor), 0),
    };
  },
);

// ============ VENDAS MANUAIS (lojas offline, ex.: Maracanã) ============

const FORMAS_MANUAIS = ["dinheiro", "pix", "cartaoDebito", "cartaoCredito", "cartaoParcelado"];

/**
 * Resumo das vendas avulsas (ex.: Maracanã) no período: bruto E líquido (após a taxa
 * do APP, pela loja da MÁQUINA e forma/parcelas), por forma, por máquina e por dia.
 * Dinheiro não tem taxa. Só leitura.
 */
export const resumoAvulsas = onCall(opcoes, async (req) => {
  await exigirModulo(req, "financeiro", ["admin", "fiscal", "financeiro"]);
  const empresaId = String(req.data?.empresaId ?? "").trim();
  if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a loja.");
  const de = String(req.data?.de ?? "").slice(0, 10);
  const ate = String(req.data?.ate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) throw new HttpsError("invalid-argument", "Período inválido.");
  const taxas = await carregarTaxasApp();
  const taxaManual = (maq: string, forma: string, parc: number): number => {
    const L = taxas.get(maq); if (!L) return 0;
    if (forma === "pix") return L.mediaPix;
    if (forma === "cartaoDebito") return L.mediaDeb;
    if (forma === "cartaoCredito") return L.mediaCr1;
    if (forma === "cartaoParcelado") return L.parcMedia.get(String(Math.max(2, Math.min(10, Math.round(parc || 2))))) ?? L.mediaCr1;
    return 0; // dinheiro
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  interface Ag { bruto: number; liquido: number; n: number }
  const porForma = new Map<string, Ag>(), porMaquina = new Map<string, Ag>(), porDia = new Map<string, Ag>();
  const add = (m: Map<string, Ag>, k: string, b: number, l: number) => { const g = m.get(k) ?? { bruto: 0, liquido: 0, n: 0 }; g.bruto += b; g.liquido += l; g.n++; m.set(k, g); };
  let totalB = 0, totalL = 0, dinB = 0, n = 0;
  const snap = await db.collection("manual_sales").where("empresaId", "==", empresaId).get();
  for (const doc of snap.docs) {
    const m = doc.data();
    const dia = String(m.dia ?? "").slice(0, 10);
    if (dia < de || dia > ate) continue;
    const valor = Number(m.valor ?? 0) || 0; if (valor <= 0) continue;
    const forma = String(m.forma ?? ""); const maq = String(m.maquinaEmpresaId ?? "");
    const taxa = forma === "dinheiro" ? 0 : taxaManual(maq, forma, Number(m.parcelas) || 2);
    const liq = Math.round(valor * (1 - taxa / 100) * 100) / 100;
    totalB += valor; totalL += liq; n++; if (forma === "dinheiro") dinB += valor;
    add(porForma, forma, valor, liq);
    add(porMaquina, forma === "dinheiro" ? "(dinheiro na loja)" : (maq || "(sem máquina)"), valor, liq);
    add(porDia, dia, valor, liq);
  }
  const dump = (mp: Map<string, Ag>) => [...mp.entries()].map(([chave, g]) => ({ chave, n: g.n, bruto: r2(g.bruto), liquido: r2(g.liquido) }));
  return {
    ok: true, de, ate, empresaId,
    total: { qtd: n, bruto: r2(totalB), liquido: r2(totalL), dinheiro: r2(dinB), cartaoPix: r2(totalB - dinB), taxas: r2(totalB - totalL) },
    porForma: dump(porForma).sort((a, b) => b.bruto - a.bruto),
    porMaquina: dump(porMaquina).sort((a, b) => b.bruto - a.bruto),
    porDia: dump(porDia).sort((a, b) => b.chave.localeCompare(a.chave)),
  };
});

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

/**
 * Cria/atualiza uma DESPESA MANUAL (sem NF / extraordinária: limpeza, escritório,
 * uber, etc.). Entra no DRE (competência = dia) e no fluxo de caixa (saída paga na
 * data). Admin/financeiro.
 */
export const salvarDespesaManual = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const empresaId = String(d.empresaId ?? "").trim();
  const dia = String(d.dia ?? "").slice(0, 10);
  const descricao = String(d.descricao ?? "").trim().slice(0, 200);
  const fornecedor = String(d.fornecedor ?? "").trim().slice(0, 160) || null; // quem prestou o serviço / vendeu
  const categoria = String(d.categoria ?? "").trim().slice(0, 40) || "outros";
  const valor = Number(d.valor);
  // Forma de pagamento: dinheiro (não toca no banco) ou pix (débito na conta escolhida).
  const formaPagamento = d.formaPagamento === "pix" ? "pix" : "dinheiro";
  const contaEmpresaId = formaPagamento === "pix" ? (String(d.contaEmpresaId ?? "").trim() || empresaId) : null;
  // pago=false → vira conta a pagar (vencimento = dia). Default pago (compat + entrada rápida).
  const pago = d.pago !== false;
  const dataPagamento = pago
    ? (/^\d{4}-\d{2}-\d{2}$/.test(String(d.dataPagamento ?? "")) ? String(d.dataPagamento) : dia)
    : null;
  if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a empresa.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new HttpsError("invalid-argument", "Data inválida.");
  if (!descricao) throw new HttpsError("invalid-argument", "Informe a descrição.");
  if (!Number.isFinite(valor) || valor <= 0) throw new HttpsError("invalid-argument", "Valor inválido.");
  const emp = await resolverEmpresa(empresaId);
  const now = agoraISO();
  const doc: Record<string, unknown> = {
    empresaId, empresaNome: emp?.nome ?? null, dia, descricao, fornecedor, categoria,
    formaPagamento, contaEmpresaId, pago, dataPagamento,
    valor: Math.round(valor * 100) / 100, atualizadoEm: now, atualizadoPor: uid,
  };
  if (!d.id) { doc.criadoEm = now; doc.criadoPor = uid; }
  const ref = d.id ? db.collection("manual_expenses").doc(String(d.id)) : db.collection("manual_expenses").doc();
  await ref.set(doc, { merge: true });
  await auditar(uid, "manual.salvarDespesa", { id: ref.id, empresaId, dia, categoria, valor });
  return { ok: true, id: ref.id };
});

/** Exclui uma despesa manual. Admin/financeiro. */
export const excluirDespesaManual = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const id = String(req.data?.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  await db.collection("manual_expenses").doc(id).delete();
  await auditar(uid, "manual.excluirDespesa", { id });
  return { ok: true };
});

/** Baixa (ou reabre) o pagamento de uma despesa manual. "pago" é manual, com data e autor. */
export const baixarDespesaManual = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro"]);
  const d = req.data ?? {};
  const id = String(d.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  const pago = d.pago !== false;
  const ref = db.collection("manual_expenses").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Despesa não encontrada.");
  const now = agoraISO();
  if (pago) {
    const dataPagamento = /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataPagamento ?? ""))
      ? String(d.dataPagamento) : (String(snap.data()?.dia ?? "").slice(0, 10) || now.slice(0, 10));
    await ref.set({ pago: true, dataPagamento, baixadoPor: uid, baixadoEm: now, atualizadoEm: now, atualizadoPor: uid }, { merge: true });
  } else {
    await ref.set({ pago: false, dataPagamento: null, atualizadoEm: now, atualizadoPor: uid }, { merge: true });
  }
  await auditar(uid, "manual.baixarDespesa", { id, pago });
  return { ok: true, pago };
});

// ============ PEDIDOS DE COMPRA ============

/** Cria/atualiza um pedido de compra (loja + fornecedor + data + itens). Admin/financeiro/fiscal. */
export const salvarPedidoCompra = onCall({ ...opcoes, memory: "512MiB" }, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro", "fiscal"]);
  const d = req.data ?? {};
  const empresaId = String(d.empresaId ?? "").trim();
  const fornecedorNome = String(d.fornecedorNome ?? "").trim().slice(0, 160);
  const cnpjFornecedor = String(d.cnpjFornecedor ?? "").replace(/\D/g, "") || null;
  const data = String(d.data ?? "").slice(0, 10);
  const dataEntrega = /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataEntrega ?? "")) ? String(d.dataEntrega) : null;
  if (!empresaId) throw new HttpsError("invalid-argument", "Selecione a loja.");
  if (!fornecedorNome) throw new HttpsError("invalid-argument", "Informe o fornecedor.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new HttpsError("invalid-argument", "Data inválida.");
  const itensIn = Array.isArray(d.itens) ? (d.itens as Array<Record<string, unknown>>) : [];
  if (itensIn.length === 0) throw new HttpsError("invalid-argument", "Inclua ao menos um item.");
  if (itensIn.length > 5000) throw new HttpsError("invalid-argument", "Máximo de 5000 itens.");
  const itens = itensIn.map((it) => {
    const qtd = Number(it.qtd) || 0;
    const valorUnit = Number(it.valorUnit) || 0;
    const valorTotal = Number(it.valorTotal) || Math.round(qtd * valorUnit * 100) / 100;
    return {
      codigo: String(it.codigo ?? "").trim().slice(0, 60),
      nome: String(it.nome ?? "").trim().slice(0, 200),
      cor: String(it.cor ?? "").trim().slice(0, 60) || null,
      tamanho: String(it.tamanho ?? "").trim().slice(0, 40) || null,
      qtd, valorUnit: Math.round(valorUnit * 100) / 100, valorTotal: Math.round(valorTotal * 100) / 100,
    };
  }).filter((it) => (it.codigo || it.nome) && it.qtd > 0); // ignora itens com quantidade zero
  const totalQtd = Math.round(itens.reduce((s, it) => s + it.qtd, 0) * 1000) / 1000;
  const totalValor = Math.round(itens.reduce((s, it) => s + it.valorTotal, 0) * 100) / 100;
  const emp = await resolverEmpresa(empresaId);
  const now = agoraISO();
  const id = String(d.id ?? "").trim();
  const ref = id ? db.collection("purchase_orders").doc(id) : db.collection("purchase_orders").doc();
  const existe = id ? (await ref.get()).exists : false;
  await ref.set({
    id: ref.id, empresaId, empresaNome: emp?.nome ?? null, fornecedorNome, cnpjFornecedor,
    data, dataEntrega, itens, totalQtd, totalValor, updatedAt: now,
    ...(existe ? {} : { nfs: [], createdAt: now, createdBy: uid }),
  }, { merge: true });
  await auditar(uid, existe ? "pedido.atualizar" : "pedido.criar", { id: ref.id, fornecedorNome, itens: itens.length });
  return { ok: true, id: ref.id };
});

/** Exclui um pedido de compra. */
export const excluirPedidoCompra = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro", "fiscal"]);
  const id = String(req.data?.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id obrigatório.");
  await db.collection("purchase_orders").doc(id).delete();
  await auditar(uid, "pedido.excluir", { id });
  return { ok: true };
});

/** Associa/desassocia uma NF (chave) a um pedido de compra. */
export const associarNfPedido = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro", "fiscal"]);
  const d = req.data ?? {};
  const id = String(d.pedidoId ?? "").trim();
  const chNFe = String(d.chNFe ?? "").replace(/\D/g, "");
  const add = d.add !== false;
  if (!id) throw new HttpsError("invalid-argument", "pedidoId obrigatório.");
  if (chNFe.length !== 44) throw new HttpsError("invalid-argument", "Chave inválida (44 dígitos).");
  await db.collection("purchase_orders").doc(id).set(
    { nfs: add ? FieldValue.arrayUnion(chNFe) : FieldValue.arrayRemove(chNFe), updatedAt: agoraISO() },
    { merge: true },
  );
  await auditar(uid, add ? "pedido.associarNf" : "pedido.desassociarNf", { id, chNFe });
  // Atualiza o resumo de conciliação (pro painel saber se ficou incompleto/atrasado).
  await computarConciliacao(id).catch(() => {});
  return { ok: true };
});

/** Núcleo da conciliação (reusado pela callable e ao associar/remover NF). Além de devolver
 * o detalhamento, PERSISTE um resumo leve (`resumoConcil`) no pedido — o painel usa isso pra
 * marcar atrasos sem reprocessar tudo. */
async function computarConciliacao(id: string) {
  const snap = await db.collection("purchase_orders").doc(id).get();
  if (!snap.exists) throw new HttpsError("not-found", "Pedido não encontrado.");
  const pedido = snap.data() as { itens?: Array<Record<string, unknown>>; nfs?: string[]; fornecedorNome?: string; cnpjFornecedor?: string | null; dataEntrega?: string | null };
  const chaves = Array.isArray(pedido.nfs) ? pedido.nfs : [];
  const itensPed = pedido.itens ?? [];
  let maxDhEmi = ""; // data mais recente entre as NFs (data efetiva de entrega)

  const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const normCod = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, ""); // só alfanumérico
  // De-para manual salvo por fornecedor: cProd da NF (normalizado) → código+tamanho do pedido.
  const chaveForn = String(pedido.cnpjFornecedor ?? "").replace(/\D/g, "") || norm(pedido.fornecedorNome).replace(/\s+/g, "-").slice(0, 60) || "sem-fornecedor";
  const mapDoc = await db.collection("supplier_maps").doc(chaveForn).get();
  const dePara = (mapDoc.exists ? ((mapDoc.data() as { dePara?: Record<string, { codigo?: string; tamanho?: string }> }).dePara ?? {}) : {});
  // Tamanho aparece como TOKEN isolado na descrição (evita "M" casar dentro de "HOME").
  const tokenPresente = (descNorm: string, tam: string) => {
    const t = norm(tam).trim();
    if (!t) return false;
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(descNorm);
  };

  // Todos os itens das NFs associadas (para casar 1 a 1, marcando os usados).
  const nfItens: Array<{ cProd: string; cNorm: string; descNorm: string; nome: string; qtd: number; valor: number; unit: number; usado: boolean }> = [];
  let nfValorTotal = 0;
  for (const ch of chaves) {
    const its = await db.collection("nfe_items").where("chNFe", "==", ch).get();
    for (const doc of its.docs) {
      const it = doc.data();
      const v = Number(it.valorTotal ?? 0) || 0;
      nfValorTotal += v;
      const dh = String(it.dhEmi ?? "").slice(0, 10);
      if (dh && dh > maxDhEmi) maxDhEmi = dh;
      nfItens.push({
        cProd: String(it.cProd ?? "").trim(), cNorm: normCod(it.cProd), descNorm: norm(it.descricaoBusca ?? it.descricao),
        nome: String(it.descricao ?? ""), qtd: Number(it.quantidade ?? 0) || 0, valor: v, unit: Number(it.valorUnitario ?? 0) || 0, usado: false,
      });
    }
  }
  // Uma NF pode atender VÁRIOS pedidos. Junto todos os pedidos que compartilham
  // alguma dessas NFs e aloco as quantidades da NF entre eles (o mais antigo puxa
  // primeiro), pra não contar a NF inteira em cada pedido.
  const copedMap = new Map<string, { id: string; itens: Array<Record<string, unknown>>; createdAt: string }>();
  copedMap.set(id, { id, itens: itensPed, createdAt: String((snap.data() as { createdAt?: string }).createdAt ?? "") });
  for (const ch of chaves) {
    const q = await db.collection("purchase_orders").where("nfs", "array-contains", ch).get();
    for (const doc of q.docs) {
      if (copedMap.has(doc.id)) continue;
      const dd = doc.data() as { itens?: Array<Record<string, unknown>>; createdAt?: string };
      copedMap.set(doc.id, { id: doc.id, itens: dd.itens ?? [], createdAt: String(dd.createdAt ?? "") });
    }
  }
  const copeds = [...copedMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const compartilhada = copeds.length > 1;

  // Demanda de todos os pedidos (na ordem de criação) contra a piscina de itens da NF.
  interface Dem { cpId: string; it: Record<string, unknown>; pc: string; pt: string; palavras: string[]; got: number; valorNf: number }
  const demanda: Dem[] = [];
  for (const cp of copeds) for (const it of cp.itens) {
    demanda.push({ cpId: cp.id, it, pc: normCod(it.codigo), pt: norm(it.tamanho ?? "").trim(), palavras: norm(it.nome ?? "").split(/\s+/).filter((w) => w.length >= 3), got: 0, valorNf: 0 });
  }

  // Pontua o quão bem um item da NF casa com um item do pedido (código, código+tamanho
  // concatenado, prefixo, contido, e semelhança de NOME).
  const pontuar = (p: { pc: string; pt: string; palavras: string[] }, n: { cNorm: string; descNorm: string }): number => {
    let s = 0;
    const pct = p.pc + p.pt;
    if (p.pc && n.cNorm === p.pc) s += 100;
    else if (pct && n.cNorm === pct) s += 100;
    else if (p.pc && p.pt && n.cNorm.startsWith(p.pc) && n.cNorm.slice(p.pc.length).includes(p.pt)) s += 90;
    else if (p.pc.length >= 3 && n.cNorm.includes(p.pc)) s += 60;
    else if (n.cNorm.length >= 3 && p.pc.includes(n.cNorm)) s += 55;
    if (p.palavras.length) {
      const hits = p.palavras.filter((w) => n.descNorm.includes(w)).length;
      s += Math.round((hits / p.palavras.length) * 60);
    }
    if (p.pt && tokenPresente(n.descNorm, p.pt)) s += 15;
    return s;
  };

  const pool = nfItens.map((n) => ({ ...n, saldo: n.qtd }));
  const LIMIAR = 55;
  for (const dm of demanda) {
    let need = Number(dm.it.qtd ?? 0) || 0;
    if (need <= 0) continue;
    const cands = pool.map((n) => {
      const dp = dePara[n.cNorm];
      const forcado = !!dp && normCod(dp.codigo) === dm.pc && norm(dp.tamanho ?? "").trim() === dm.pt;
      return { n, sc: forcado ? 999 : pontuar(dm, n) };
    }).filter((x) => x.n.saldo > 0.0001 && x.sc >= LIMIAR).sort((a, b) => b.sc - a.sc);
    for (const { n } of cands) {
      if (need <= 0.0001) break;
      const take = Math.min(need, n.saldo);
      if (take <= 0) continue;
      dm.got += take; dm.valorNf += take * n.unit; n.saldo -= take; need -= take;
    }
  }

  const linhas = demanda.filter((dm) => dm.cpId === id).map((dm) => {
    const it = dm.it;
    const qtdPed = Number(it.qtd ?? 0) || 0;
    const qtdNf = Math.round(dm.got * 1000) / 1000;
    const dif = Math.round((qtdNf - qtdPed) * 1000) / 1000;
    const status = (qtdPed === 0 && qtdNf > 0) ? "excesso"
      : qtdNf === 0 ? "nao_entregue" : dif < -0.001 ? "parcial" : dif > 0.001 ? "sobra" : "ok";
    const vtPed = Number(it.valorTotal ?? 0) || 0;
    const vuPed = (vtPed > 0 && qtdPed > 0) ? Math.round((vtPed / qtdPed) * 100) / 100 : (Number(it.valorUnit ?? 0) || 0);
    const vuNf = dm.got > 0 ? Math.round((dm.valorNf / dm.got) * 100) / 100 : 0; // unit médio ponderado
    const vtNf = Math.round(dm.valorNf * 100) / 100;
    const unitDiverge = vuPed > 0 && qtdNf > 0 && Math.abs(vuNf - vuPed) > 0.01;
    const totalDiverge = vtPed > 0 && qtdNf > 0 && Math.abs(vtNf - vtPed) > 0.01;
    return {
      codigo: String(it.codigo ?? "").trim(), nome: String(it.nome ?? ""), cor: (it.cor as string) ?? null, tamanho: (it.tamanho as string) ?? null,
      qtdPedido: qtdPed, valorUnitPedido: vuPed, valorTotalPedido: vtPed,
      qtdNf, valorUnitNf: vuNf, valorTotalNf: vtNf,
      dif, status, unitDiverge, totalDiverge,
    };
  }).filter((l) => !(l.qtdPedido === 0 && l.qtdNf === 0));

  // Extras: saldo da NF não alocado a NENHUM pedido — agrega por código.
  const extrasMap = new Map<string, { nome: string; qtd: number; valor: number; unit: number }>();
  for (const n of pool) {
    if (n.saldo <= 0.0001) continue;
    const g = extrasMap.get(n.cProd) ?? { nome: n.nome, qtd: 0, valor: 0, unit: n.unit };
    g.qtd += n.saldo; g.valor += n.saldo * n.unit;
    extrasMap.set(n.cProd, g);
  }
  const extras = [...extrasMap.entries()].map(([cod, g]) => ({
    codigo: cod, nome: g.nome, qtdNf: Math.round(g.qtd * 1000) / 1000, valorTotalNf: Math.round(g.valor * 100) / 100,
    valorUnitNf: Math.round(g.unit * 100) / 100,
  }));
  const totalPedido = (pedido.itens ?? []).reduce((s, it) => s + (Number(it.valorTotal ?? 0) || 0), 0);
  const totalQtdPedido = itensPed.reduce((s, it) => s + (Number(it.qtd ?? 0) || 0), 0);
  // NF do pedido = o que foi alocado a ele (+ extras quando a NF não é compartilhada).
  const gotP = demanda.filter((dm) => dm.cpId === id);
  const totalQtdAlloc = gotP.reduce((s, dm) => s + dm.got, 0);
  const totalNfAlloc = gotP.reduce((s, dm) => s + dm.valorNf, 0);
  const extrasQtd = extras.reduce((s, e) => s + e.qtdNf, 0);
  const extrasValor = extras.reduce((s, e) => s + e.valorTotalNf, 0);
  const totalQtdNf = Math.round((totalQtdAlloc + (compartilhada ? 0 : extrasQtd)) * 1000) / 1000;
  const totalNfR = Math.round((totalNfAlloc + (compartilhada ? 0 : extrasValor)) * 100) / 100;
  const totalPedR = Math.round(totalPedido * 100) / 100;
  const resumo = {
    itensPedido: linhas.length,
    ok: linhas.filter((l) => l.status === "ok").length,
    parcial: linhas.filter((l) => l.status === "parcial").length,
    sobra: linhas.filter((l) => l.status === "sobra").length,
    excesso: linhas.filter((l) => l.status === "excesso").length,
    naoEntregue: linhas.filter((l) => l.status === "nao_entregue").length,
    valorDivergente: linhas.filter((l) => l.unitDiverge || l.totalDiverge).length,
    extras: extras.length,
    totalQtdPedido: Math.round(totalQtdPedido * 1000) / 1000,
    totalQtdNf: Math.round(totalQtdNf * 1000) / 1000,
    difQtd: Math.round((totalQtdNf - totalQtdPedido) * 1000) / 1000,
    totalPedido: totalPedR,
    totalNf: totalNfR,
    difValor: Math.round((totalNfR - totalPedR) * 100) / 100,
    atendidoIntegral: linhas.length > 0 && linhas.every((l) => l.status === "ok" || l.status === "sobra" || l.status === "excesso"),
    pedidosCompartilhados: compartilhada ? copeds.length : 0, // >0 = a(s) NF(s) atende(m) outros pedidos
  };
  // Comparação de prazo: data prevista de entrega × data da NF (mais recente).
  // Até 7 dias de diferença = no prazo; antes = adiantado; depois = atrasado.
  let entrega: { prevista: string; realizada: string; difDias: number; status: string } | null = null;
  if (pedido.dataEntrega && maxDhEmi) {
    const difDias = Math.round((new Date(`${maxDhEmi}T00:00:00`).getTime() - new Date(`${pedido.dataEntrega}T00:00:00`).getTime()) / 86_400_000);
    const status = difDias < -7 ? "adiantado" : difDias > 7 ? "atrasado" : "no_prazo";
    entrega = { prevista: pedido.dataEntrega, realizada: maxDhEmi, difDias, status };
  }
  // Resumo leve no pedido, pro painel marcar atrasos sem reconciliar tudo de novo.
  await snap.ref.update({
    resumoConcil: {
      atendidoIntegral: resumo.atendidoIntegral,
      totalQtdPedido: resumo.totalQtdPedido,
      totalQtdNf: resumo.totalQtdNf,
      difQtd: resumo.difQtd,
      entregaStatus: entrega ? entrega.status : null,
      entregaRealizada: entrega ? entrega.realizada : null,
      em: agoraISO(),
    },
  }).catch(() => {});
  return { ok: true, linhas, extras, resumo, entrega, nfs: chaves, chaveFornecedor: chaveForn };
}

/** Concilia um pedido: itens do pedido × itens das NFs associadas (casa por código = cProd). */
export const conciliarPedidoCompra = onCall({ ...opcoes, memory: "512MiB", timeoutSeconds: 120 }, async (req) => {
  await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro", "fiscal"]);
  const id = String(req.data?.pedidoId ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "pedidoId obrigatório.");
  return computarConciliacao(id);
});

/** Salva o mapeamento de colunas de um fornecedor (reuso no próximo import). */
export const salvarMapaFornecedor = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro", "fiscal"]);
  const d = req.data ?? {};
  const chave = String(d.chave ?? "").trim().slice(0, 120);
  if (!chave) throw new HttpsError("invalid-argument", "chave do fornecedor obrigatória.");
  const map = (d.map && typeof d.map === "object") ? d.map : {};
  await db.collection("supplier_maps").doc(chave).set(
    { chave, fornecedorNome: String(d.fornecedorNome ?? "").slice(0, 160), map, atualizadoEm: agoraISO(), atualizadoPor: uid },
    { merge: true },
  );
  return { ok: true };
});

/** De-para manual (por fornecedor): liga o cProd de um item da NF a um item do
 * pedido (código + tamanho), quando o batimento automático não conseguiu. Reusado
 * nas próximas conciliações do fornecedor. Admin/financeiro/fiscal. */
export const salvarDeParaFornecedor = onCall(opcoes, async (req) => {
  const { uid } = await exigirAcao(req, "financeiro.baixar", ["admin", "financeiro", "fiscal"]);
  const d = req.data ?? {};
  const chave = String(d.chave ?? "").trim().slice(0, 120);
  const nfCProd = String(d.nfCProd ?? "").trim();
  if (!chave || !nfCProd) throw new HttpsError("invalid-argument", "chave e nfCProd obrigatórios.");
  const nfNorm = nfCProd.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  if (!nfNorm) throw new HttpsError("invalid-argument", "cProd inválido.");
  const ref = db.collection("supplier_maps").doc(chave);
  if (d.remover === true) {
    await ref.set({ chave }, { merge: true });
    await ref.update({ [`dePara.${nfNorm}`]: FieldValue.delete(), atualizadoEm: agoraISO() }).catch(() => {});
  } else {
    const codigo = String(d.codigo ?? "").trim();
    if (!codigo) throw new HttpsError("invalid-argument", "código do pedido obrigatório.");
    await ref.set(
      { chave, dePara: { [nfNorm]: { codigo, tamanho: String(d.tamanho ?? "").trim() } }, atualizadoEm: agoraISO(), atualizadoPor: uid },
      { merge: true },
    );
  }
  await auditar(uid, "pedido.dePara", { chave, nfCProd });
  return { ok: true };
});

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
