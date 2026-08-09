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

// ---- CT-e (fretes) ----

export interface CteDocumento {
  id: string;
  companyId?: string;
  chCTe?: string | null;
  cnpjEmit?: string | null;
  xNomeEmit?: string | null;
  vTPrest?: number | null;
  dhEmi?: string | null;
  nCT?: string | null;
  serie?: string | null;
  tpCTe?: string | null;
  ufIni?: string | null;
  ufFim?: string | null;
  xNomeRem?: string | null;
  xNomeDest?: string | null;
  situacao?: string | null;
  schema?: string;
  temXmlCompleto?: boolean;
  nsu?: string;
  storagePath?: string;
}

/** Lista os CT-e (fretes) mais recentes. */
export async function listarCTes(max = 300): Promise<CteDocumento[]> {
  const { db } = fb();
  const q = query(collection(db, "cte_documents"), orderBy("dhEmi", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as CteDocumento[];
}

/** Estado de sincronização de CT-e de uma empresa. */
export async function obterCteSyncState(companyId: string): Promise<SyncEstado | null> {
  const { db } = fb();
  const d = await getDoc(doc(db, "cte_sync_state", companyId));
  return d.exists() ? ({ id: d.id, ...(d.data() as object) } as SyncEstado) : null;
}

/** Testa a conexão com o CTeDistribuicaoDFe. */
export async function testarConexaoCTe(companyId: string): Promise<ResultadoConexao> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "cteTestarConexao");
  const res = await fn({ companyId });
  return res.data as ResultadoConexao;
}

/** Dispara a sincronização real de CT-e de uma empresa. */
export async function sincronizarCTeAgora(companyId: string): Promise<ResultadoSync> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "cteSincronizarAgora");
  const res = await fn({ companyId });
  return res.data as ResultadoSync;
}

// ---- NFS-e (serviços) ----

export interface NfseDocumento {
  id: string;
  companyId?: string;
  chNFSe?: string | null;
  cnpjPrest?: string | null;
  xNomePrest?: string | null;
  vServ?: number | null;
  vLiq?: number | null;
  dhEmi?: string | null;
  nNFSe?: string | null;
  municipio?: string | null;
  xTribNac?: string | null;
  xDescServ?: string | null;
  cStat?: string | null;
  nsu?: string;
  storagePath?: string;
}

/** Lista as NFS-e (serviços) mais recentes. */
export async function listarNfses(max = 300): Promise<NfseDocumento[]> {
  const { db } = fb();
  const q = query(collection(db, "nfse_documents"), orderBy("dhEmi", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as NfseDocumento[];
}

/** Estado de sincronização de NFS-e de uma empresa. */
export async function obterNfseSyncState(companyId: string): Promise<SyncEstado | null> {
  const { db } = fb();
  const d = await getDoc(doc(db, "nfse_sync_state", companyId));
  return d.exists() ? ({ id: d.id, ...(d.data() as object) } as SyncEstado) : null;
}

/** Dispara a sincronização real de NFS-e de uma empresa. */
export async function sincronizarNfseAgora(
  companyId: string,
): Promise<{ ok: boolean; novos?: number; status?: string | null; ultNSU?: string; erro?: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfseSincronizarAgora");
  const res = await fn({ companyId });
  return res.data as { ok: boolean; novos?: number; status?: string | null; ultNSU?: string; erro?: string };
}

// ---- Acordos (renegociação de dívidas com fornecedores) ----

export interface ParcelaAcordo {
  n: number;
  valor: number;
  vencimento: string; // YYYY-MM-DD
  statusPagamento: "pendente" | "pago";
  dataPagamento?: string | null;
}

export interface Acordo {
  id: string;
  companyId?: string | null;
  empresaNome?: string | null;
  cnpjFornecedor?: string | null;
  nomeFornecedor: string;
  descricao?: string | null;
  observacao?: string | null;
  parcelas: ParcelaAcordo[];
  valorAcordado?: number;
  valorOriginal?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Lista os acordos (mais recentes primeiro). */
export async function listarAcordos(): Promise<Acordo[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "nfe_agreements"));
  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Acordo[];
  return arr.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Cria/atualiza um acordo. */
export async function salvarAcordo(input: {
  id?: string;
  companyId?: string;
  cnpjFornecedor?: string;
  nomeFornecedor: string;
  descricao?: string;
  observacao?: string;
  valorOriginal?: number;
  parcelas: Array<{ valor: number; vencimento: string; statusPagamento?: string; dataPagamento?: string }>;
}): Promise<{ ok: boolean; id: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeSalvarAcordo");
  const res = await fn(input);
  return res.data as { ok: boolean; id: string };
}

/** Marca uma parcela de acordo como paga ou reabre. */
export async function baixarParcelaAcordo(input: {
  acordoId: string;
  indice: number;
  pago: boolean;
  dataPagamento?: string;
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeBaixarParcelaAcordo");
  const res = await fn(input);
  return res.data as { ok: boolean };
}

/** Exclui um acordo. */
export async function excluirAcordo(acordoId: string): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeExcluirAcordo");
  const res = await fn({ acordoId });
  return res.data as { ok: boolean };
}

// ---- Despesas fixas (recorrentes) ----

export interface PagamentoDespesa {
  pago: boolean;
  data?: string;
  valor?: number | null; // valor REAL pago
  previsto?: number | null; // valor previsto na hora da baixa
}

export type Recorrencia = "mensal" | "bimestral" | "trimestral" | "semestral" | "anual";

export interface DespesaFixa {
  id: string;
  companyId?: string | null;
  empresaNome?: string | null;
  nome: string;
  categoria?: string;
  valor: number; // valor previsto
  recorrencia?: Recorrencia;
  mesBase?: number | null; // 1-12, âncora para recorrências não mensais
  diaVencimento?: number | null;
  beneficiario?: string | null;
  observacao?: string | null;
  ativo?: boolean;
  pagamentos?: Record<string, PagamentoDespesa>;
  createdAt?: string;
  updatedAt?: string;
}

/** Lista as despesas fixas (ativas primeiro, depois por nome). */
export async function listarDespesasFixas(): Promise<DespesaFixa[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "nfe_fixed_expenses"));
  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DespesaFixa[];
  return arr.sort((a, b) => {
    if ((a.ativo !== false) !== (b.ativo !== false)) return a.ativo !== false ? -1 : 1;
    return (a.nome ?? "").localeCompare(b.nome ?? "");
  });
}

/** Cria/atualiza uma despesa fixa. */
export async function salvarDespesaFixa(input: {
  id?: string;
  companyId?: string;
  nome: string;
  categoria?: string;
  valor: number;
  recorrencia?: Recorrencia;
  mesBase?: number;
  diaVencimento?: number;
  beneficiario?: string;
  observacao?: string;
  ativo?: boolean;
}): Promise<{ ok: boolean; id: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeSalvarDespesaFixa");
  const res = await fn(input);
  return res.data as { ok: boolean; id: string };
}

/** Marca uma despesa fixa como paga (ou reabre) num mês (YYYY-MM). */
export async function pagarDespesaFixa(input: {
  id: string;
  mes: string;
  pago: boolean;
  data?: string;
  valor?: number;
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfePagarDespesaFixa");
  const res = await fn(input);
  return res.data as { ok: boolean };
}

/** Exclui uma despesa fixa. */
export async function excluirDespesaFixa(id: string): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeExcluirDespesaFixa");
  const res = await fn({ id });
  return res.data as { ok: boolean };
}

/** Baixa em lote: marca várias parcelas como pagas (mesma data/obs). */
export async function baixarParcelasLote(input: {
  parcelaIds: string[];
  dataPagamento?: string;
  obsPagamento?: string;
}): Promise<{ ok: boolean; total: number }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeBaixarParcelasLote");
  const res = await fn(input);
  return res.data as { ok: boolean; total: number };
}

export interface Item {
  id: string;
  companyId?: string;
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

/** Estado de sincronização de NF-e de uma empresa. */
export async function obterSyncState(companyId: string): Promise<SyncEstado | null> {
  const { db } = fb();
  const d = await getDoc(doc(db, "nfe_sync_state", companyId));
  return d.exists() ? ({ id: d.id, ...(d.data() as object) } as SyncEstado) : null;
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

// ---- PDVnet (integração financeira) ----

export async function pdvnetSalvarCredenciais(input: {
  usuario: string;
  senha: string;
  baseUrl: string;
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "pdvnetSalvarCredenciais");
  const res = await fn(input);
  return res.data as { ok: boolean };
}

export async function pdvnetStatus(): Promise<{ temCredenciais: boolean; baseUrl: string | null }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "pdvnetStatus");
  const res = await fn({});
  return res.data as { temCredenciais: boolean; baseUrl: string | null };
}

export interface SondagemVendas {
  ok: boolean;
  erro?: string;
  periodo?: { inicio: string; fim: string };
  totalPagina?: number;
  totalRegistros?: number | null;
  lojas?: { id: number; nome?: string; inativa?: boolean }[];
  amostra?: {
    id: string;
    lojaId?: number;
    dataHora?: string;
    valorTotal?: number;
    inativa?: boolean;
    pagamentos?: Record<string, number>;
    parcelasCartao?: Record<string, unknown>[];
    documentosFiscais?: { TipoDocumento?: number; Chave?: string; Numero?: string }[];
    qtdItens?: number;
  } | null;
}

export async function pdvnetSondarVendas(dias = 3): Promise<SondagemVendas> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "pdvnetSondarVendas");
  const res = await fn({ dias });
  return res.data as SondagemVendas;
}

// ---- Lojas (PDVnet) ----

export interface StorePdv {
  id: number;
  nome?: string;
  grupoNome?: string | null;
  empresaId?: string | null;
  ativoSync?: boolean;
  varejo?: boolean;
  inativa?: boolean;
}

export async function listarStores(): Promise<StorePdv[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "pdv_stores"));
  const arr = snap.docs.map((d) => ({ id: Number(d.id), ...(d.data() as object) })) as StorePdv[];
  return arr.sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? ""));
}

export async function pdvnetSincronizarLojas(): Promise<{ ok: boolean; ativas?: number; erro?: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "pdvnetSincronizarLojas");
  const res = await fn({});
  return res.data as { ok: boolean; ativas?: number; erro?: string };
}

export async function pdvnetSalvarLoja(input: {
  lojaId: string | number;
  ativoSync?: boolean;
  grupoNome?: string;
  empresaId?: string | null;
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "pdvnetSalvarLoja");
  const res = await fn({ ...input, lojaId: String(input.lojaId) });
  return res.data as { ok: boolean };
}

export interface ResumoVendasFiltrado {
  ok: boolean;
  de: string;
  ate: string;
  grupo: string | null;
  grupos: string[];
  count: number;
  totalVendido: number;
  porForma: Record<string, number>;
  totalRecebiveis: number;
  totalLiquido: number;
  recebiveis: number;
}

export async function pdvnetResumoVendas(de: string, ate: string, grupo?: string): Promise<ResumoVendasFiltrado> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "pdvnetResumoVendas");
  const res = await fn({ de, ate, grupo: grupo || undefined });
  return res.data as ResumoVendasFiltrado;
}

export interface FluxoDia {
  dia: string;
  entrada: number;
  saida: number;
  entradaReal: number;
  saidaReal: number;
  saldo: number;
}
export interface FluxoCaixa {
  ok: boolean;
  de: string;
  ate: string;
  hoje: string;
  empresaId: string | null;
  linhas: FluxoDia[];
  totais: { entrada: number; saida: number; entradaReal: number; saidaReal: number; saldo: number };
  porOrigem: Record<string, number>;
}
export async function obterFluxoCaixa(de: string, ate: string, empresaId?: string): Promise<FluxoCaixa> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "fluxoCaixa");
  const res = await fn({ de, ate, empresaId: empresaId || undefined });
  return res.data as FluxoCaixa;
}

export interface Pendencia {
  chave: string;
  titulo: string;
  descricao: string;
  severidade: "critico" | "atencao" | "info";
  qtd: number;
  valor: number;
  href: string;
}
export interface Pendencias {
  ok: boolean;
  hoje: string;
  empresaId: string | null;
  pendencias: Pendencia[];
  resumo: { criticas: number; atencao: number; info: number };
}
export async function obterPendencias(empresaId?: string): Promise<Pendencias> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "centralPendencias");
  const res = await fn({ empresaId: empresaId || undefined });
  return res.data as Pendencias;
}

export interface TxBanco {
  fitid: string;
  tipo: string;
  data: string;
  valor: number;
  memo: string;
  categoria: string;
}
export interface ContaBanco {
  empresaId: string;
  org: string | null;
  fid: string | null;
  curdef: string | null;
  saldo: number | null;
  saldoData: string | null;
  dtStart: string | null;
  dtEnd: string | null;
  ultimoImport: string | null;
}
export interface ExtratoBanco {
  ok: boolean;
  conta: ContaBanco | null;
  creditos: number;
  debitos: number;
  saldoMov: number;
  porCategoria: Record<string, number>;
  total: number;
  transacoes: TxBanco[];
}
export async function importarExtrato(ofx: string, empresaId: string): Promise<{ ok: boolean; transacoes: number; saldo: number | null; saldoData: string | null; org: string | null; periodo: { de: string | null; ate: string | null } }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "importarExtrato");
  const res = await fn({ ofx, empresaId });
  return res.data as { ok: boolean; transacoes: number; saldo: number | null; saldoData: string | null; org: string | null; periodo: { de: string | null; ate: string | null } };
}
export async function obterExtrato(empresaId: string, de?: string, ate?: string): Promise<ExtratoBanco> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "extratoBanco");
  const res = await fn({ empresaId, de: de || undefined, ate: ate || undefined });
  return res.data as ExtratoBanco;
}

// ---- Vendas (PDVnet) ----

export interface ResumoVendas {
  ultimaSync?: string;
  periodoInicio?: string;
  periodoFim?: string;
  vendas?: number;
  recebimentos?: number;
  recebiveis?: number;
  lojas?: number;
  totalVendido?: number;
  totalRecebiveis?: number;
  totalLiquido?: number;
  porForma?: Record<string, number>;
}

export interface Sale {
  id: string;
  lojaNome?: string;
  lojaId?: number;
  empresaId?: string | null;
  dataHora?: string;
  valorTotal?: number;
  cancelada?: boolean;
  docChave?: string | null;
  qtdItens?: number;
}

export interface CardReceivable {
  id: string;
  descricaoCartao?: string | null;
  valor?: number;
  taxaPct?: number | null;
  liquido?: number | null;
  parcela?: number;
  dataVencimento?: string | null;
  dataLiquidacao?: string | null;
  status?: string;
  lojaId?: number;
}

export async function pdvnetSincronizarVendas(
  dias = 0,
): Promise<{ ok: boolean; erro?: string; vendas?: number; recebiveis?: number; totalVendido?: number }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "pdvnetSincronizarVendas");
  const res = await fn({ dias });
  return res.data as { ok: boolean; erro?: string; vendas?: number; recebiveis?: number; totalVendido?: number };
}

export async function obterResumoVendas(): Promise<ResumoVendas | null> {
  const { db } = fb();
  const d = await getDoc(doc(db, "pdv_sync_state", "vendas"));
  return d.exists() ? (d.data() as ResumoVendas) : null;
}

export async function listarSales(max = 100): Promise<Sale[]> {
  const { db } = fb();
  const q = query(collection(db, "sales"), orderBy("dataHora", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Sale[];
}

export async function listarRecebiveis(max = 100): Promise<CardReceivable[]> {
  const { db } = fb();
  const q = query(collection(db, "card_receivables"), orderBy("dataVencimento", "asc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as CardReceivable[];
}

// ---- Usuários e perfis (RBAC) ----

export interface Usuario {
  uid: string;
  email?: string;
  nome?: string;
  status?: "pendente" | "ativo" | "inativo";
  roleId?: string | null;
  empresas?: string[];
  criadoEm?: string;
  aprovadoEm?: string;
}

/** Lista todos os usuários (admin). */
export async function listarUsuarios(): Promise<Usuario[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "nfe_users"));
  const arr = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as object) })) as Usuario[];
  return arr.sort((a, b) => (a.criadoEm ?? "").localeCompare(b.criadoEm ?? ""));
}

/** Lista os perfis definidos. */
export async function listarPerfis(): Promise<
  { id: string; nome: string; descricao?: string | null; modulos: string[]; acoes: string[] }[]
> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "nfe_roles"));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }))
    .sort((a, b) => ((a as { nome?: string }).nome ?? "").localeCompare((b as { nome?: string }).nome ?? "")) as never;
}

/** Autocadastro: cria o registro pendente do usuário recém-autenticado. */
export async function registrarUsuario(nome: string): Promise<{ ok: boolean; status: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeRegistrarUsuario");
  const res = await fn({ nome });
  return res.data as { ok: boolean; status: string };
}

/** Aprova/atualiza um usuário (status, perfil, empresas). */
export async function aprovarUsuario(input: {
  uid: string;
  roleId?: string | null;
  empresas?: string[];
  status?: "pendente" | "ativo" | "inativo";
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeAprovarUsuario");
  const res = await fn(input);
  return res.data as { ok: boolean };
}

/** Cria/atualiza um perfil. */
export async function salvarPerfil(input: {
  id?: string;
  nome: string;
  descricao?: string;
  modulos: string[];
  acoes: string[];
}): Promise<{ ok: boolean; id: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeSalvarPerfil");
  const res = await fn(input);
  return res.data as { ok: boolean; id: string };
}

/** Exclui um perfil. */
export async function excluirPerfil(id: string): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeExcluirPerfil");
  const res = await fn({ id });
  return res.data as { ok: boolean };
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
