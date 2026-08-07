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
import { consultarDistribuicaoNSU } from "./sefaz/distribuicao";
import { sincronizarEmpresa } from "./sefaz/sincronizacao";

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
        await sincronizarEmpresa(
          { id: doc.id, cnpj: emp.cnpj, uf: emp.uf, ambiente: emp.ambiente },
          key,
          cert,
        );
      } catch (e) {
        logger.error("nfeSyncAgendado: empresa falhou", { companyId: doc.id, erro: (e as Error).message });
      }
    }
  },
);

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
