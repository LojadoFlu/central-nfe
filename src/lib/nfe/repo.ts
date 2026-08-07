"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getBytes, getDownloadURL, ref as storageRef } from "firebase/storage";
import { getFirebase } from "@/lib/firebase/client";
import type { Company, CertificateMeta } from "./types";

function fb() {
  const f = getFirebase();
  if (!f) throw new Error("Firebase não configurado.");
  return f;
}

/** Lista empresas (leitura client SDK; escrita é via callable). */
export async function listarEmpresas(): Promise<Company[]> {
  const { db } = fb();
  const q = query(collection(db, "nfe_companies"), orderBy("razaoSocial"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Company[];
}

export async function obterCertificado(
  companyId: string,
): Promise<CertificateMeta | null> {
  const { db } = fb();
  const d = await getDoc(doc(db, "nfe_certificates", companyId));
  return d.exists() ? ({ id: d.id, ...(d.data() as object) } as CertificateMeta) : null;
}

export async function listarCertificados(): Promise<CertificateMeta[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "nfe_certificates"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as CertificateMeta[];
}

// ---- Callables (escrita passa sempre pelo backend) ----

export async function salvarEmpresa(input: Partial<Company>): Promise<{ id: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeSalvarEmpresa");
  const res = await fn(input);
  return res.data as { id: string };
}

export interface RetornoCertificado {
  ok: boolean;
  numeroSerie: string;
  emissor: string;
  validadeInicio: string;
  validadeFim: string;
  situacao: string;
  diasRestantes: number;
}

/** Envia o .pfx (base64) + senha ao backend. O arquivo não é guardado no client. */
export async function cadastrarCertificado(input: {
  companyId: string;
  pfxBase64: string;
  senha: string;
}): Promise<RetornoCertificado> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeCadastrarCertificado");
  const res = await fn(input);
  return res.data as RetornoCertificado;
}

export interface ResultadoConexao {
  ok: boolean;
  ambiente?: string;
  cStat?: string | null;
  xMotivo?: string | null;
  ultNSU?: string | null;
  maxNSU?: string | null;
  verAplic?: string | null;
  httpStatus?: number;
  erro?: string;
}

/** Testa a conexão com a SEFAZ (uma chamada distDFeInt) para uma empresa. */
export async function testarConexao(companyId: string): Promise<ResultadoConexao> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeTestarConexao");
  const res = await fn({ companyId });
  return res.data as ResultadoConexao;
}

export interface ResultadoSync {
  ok: boolean;
  novos?: number;
  iteracoes?: number;
  cStat?: string | null;
  xMotivo?: string | null;
  ultNSU?: string;
  maxNSU?: string;
  bloqueado?: boolean;
  erro?: string;
}

/** Dispara a sincronização real (baixa/guarda/parseia as NF-e) de uma empresa. */
export async function sincronizarAgora(companyId: string): Promise<ResultadoSync> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeSincronizarAgora");
  const res = await fn({ companyId });
  return res.data as ResultadoSync;
}

export interface NfeDocumento {
  id: string;
  companyId?: string;
  chNFe?: string | null;
  cnpjEmit?: string | null;
  xNomeEmit?: string | null;
  vNF?: number | null;
  dhEmi?: string | null;
  nNF?: string | null;
  serie?: string | null;
  situacao?: string | null;
  schema?: string;
  temXmlCompleto?: boolean;
  nsu?: string;
  storagePath?: string;
  hashSha256?: string;
}

/** Lista as NF-e (documentos) mais recentes. */
export async function listarDocumentos(max = 50): Promise<NfeDocumento[]> {
  const { db } = fb();
  const q = query(collection(db, "nfe_documents"), orderBy("dhEmi", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as NfeDocumento[];
}

/** Obtém um documento (NF-e) pelo id. */
export async function obterDocumento(id: string): Promise<NfeDocumento | null> {
  const { db } = fb();
  const d = await getDoc(doc(db, "nfe_documents", id));
  return d.exists() ? ({ id: d.id, ...(d.data() as object) } as NfeDocumento) : null;
}

/** Lê o XML original (do Storage) como texto. */
export async function baixarXmlTexto(storagePath: string): Promise<string> {
  const { storage } = fb();
  const bytes = await getBytes(storageRef(storage, storagePath));
  return new TextDecoder("utf-8").decode(bytes);
}

/** URL de download do XML original (do Storage). */
export async function urlDownloadXml(storagePath: string): Promise<string> {
  const { storage } = fb();
  return getDownloadURL(storageRef(storage, storagePath));
}

/** Lê um arquivo File como base64 puro (sem o prefixo data:). */
export function arquivoParaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
