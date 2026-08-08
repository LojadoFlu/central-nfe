"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
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

export interface ResultadoManifestacao {
  ok: boolean;
  cStatLote?: string | null;
  cStatEvento?: string | null;
  xMotivoEvento?: string | null;
  nProt?: string | null;
  erro?: string;
}

/** Envia um evento de manifestação do destinatário à SEFAZ. */
export async function manifestar(input: {
  companyId: string;
  chNFe: string;
  tpEvento: string;
  xJust?: string;
}): Promise<ResultadoManifestacao> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeManifestar");
  const res = await fn(input);
  return res.data as ResultadoManifestacao;
}

export interface NfeDocumento {
  id: string;
  companyId?: string;
  manifestStatus?: string;
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

/** Documentos (NF-e) de um fornecedor (por CNPJ do emitente). */
export async function documentosDoFornecedor(cnpjEmit: string): Promise<NfeDocumento[]> {
  const { db } = fb();
  const q = query(
    collection(db, "nfe_documents"),
    where("cnpjEmit", "==", cnpjEmit),
    orderBy("dhEmi", "desc"),
    limit(300),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as NfeDocumento[];
}

/** Obtém um documento (NF-e) pelo id. */
export async function obterDocumento(id: string): Promise<NfeDocumento | null> {
  const { db } = fb();
  const d = await getDoc(doc(db, "nfe_documents", id));
  return d.exists() ? ({ id: d.id, ...(d.data() as object) } as NfeDocumento) : null;
}

export interface Parcela {
  id: string;
  companyId?: string;
  chNFe?: string;
  cnpjEmit?: string | null;
  xNomeEmit?: string | null;
  nDup?: string;
  vencimento?: string | null;
  valor?: number | null;
  statusPagamento?: string;
  dataPagamento?: string | null;
  valorPago?: number | null;
  obsPagamento?: string | null;
  baixadoEm?: string | null;
}

/** Marca uma parcela como paga (baixa) ou reabre. Passa pelo backend. */
export async function baixarParcela(input: {
  parcelaId: string;
  pago: boolean;
  dataPagamento?: string;
  valorPago?: number;
  obsPagamento?: string;
}): Promise<{ ok: boolean; statusPagamento: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeBaixarParcela");
  const res = await fn(input);
  return res.data as { ok: boolean; statusPagamento: string };
}

export interface Item {
  id: string;
  chNFe?: string;
  cnpjEmit?: string | null;
  xNomeEmit?: string | null;
  dhEmi?: string | null;
  descricao?: string | null;
  cProd?: string | null;
  ean?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  unidade?: string | null;
  quantidade?: number | null;
  valorUnitario?: number | null;
  valorTotal?: number | null;
}

export interface SyncEstado {
  id: string;
  companyId?: string;
  cnpj?: string;
  status?: string;
  ultimoCStat?: string;
  ultimaMensagem?: string;
  ultimaSync?: string;
  proximaSync?: string | null;
  ultNSU?: string;
  maxNSU?: string;
}

/** Estados de sincronização (por CNPJ). */
export async function listarSyncStates(): Promise<SyncEstado[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "nfe_sync_state"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as SyncEstado[];
}

/** Lista parcelas (contas a pagar) ordenadas por vencimento. */
export async function listarParcelas(max = 300): Promise<Parcela[]> {
  const { db } = fb();
  const q = query(collection(db, "nfe_installments"), orderBy("vencimento", "asc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Parcela[];
}

/** Parcelas de uma NF-e específica. */
export async function parcelasDoDocumento(chNFe: string): Promise<Parcela[]> {
  const { db } = fb();
  const q = query(collection(db, "nfe_installments"), where("chNFe", "==", chNFe));
  const snap = await getDocs(q);
  return (snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Parcela[]).sort((a, b) =>
    (a.nDup ?? "").localeCompare(b.nDup ?? ""),
  );
}

/** Itens (produtos) de uma NF-e específica. */
export async function itensDoDocumento(chNFe: string): Promise<Item[]> {
  const { db } = fb();
  const q = query(collection(db, "nfe_items"), where("chNFe", "==", chNFe));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Item[];
}

/** Todos os itens (para relatórios de produtos). */
export async function listarItens(max = 1000): Promise<Item[]> {
  const { db } = fb();
  const q = query(collection(db, "nfe_items"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Item[];
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
