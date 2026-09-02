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
  finNFe?: string | null;   // 4 = devolução
  natOp?: string | null;
  isDevolucao?: boolean;
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
  contasPagamento?: ContaPagamento[] | null;
  migradoAcordo?: boolean;
  acordoId?: string | null;
  baixadoEm?: string | null;
  contestacao?: Contestacao | null;
}

/** Marca/desmarca uma parcela como migrada para acordo (só registro, sem baixa). */
export async function migrarParcelaAcordo(input: {
  parcelaId: string;
  migrado: boolean;
  acordoId?: string;
}): Promise<{ ok: boolean; migradoAcordo: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeMigrarParcelaAcordo");
  const res = await fn(input);
  return res.data as { ok: boolean; migradoAcordo: boolean };
}

/** Uma conta de pagamento (rateio): de qual empresa/conta saiu e quanto. */
export interface ContaPagamento {
  empresaId: string;
  valor: number;
}

/** Marca uma parcela como paga (baixa) ou reabre. Passa pelo backend. */
export async function baixarParcela(input: {
  parcelaId: string;
  pago: boolean;
  dataPagamento?: string;
  valorPago?: number;
  obsPagamento?: string;
  contasPagamento?: ContaPagamento[];
}): Promise<{ ok: boolean; statusPagamento: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeBaixarParcela");
  const res = await fn(input);
  return res.data as { ok: boolean; statusPagamento: string };
}

export interface Contestacao {
  status: "aberta" | "resolvida";
  motivo: "valor" | "parcelas" | "outro";
  descricao: string;
  valorCorreto?: number | null;
  parcelasCorreto?: number | null;
  criadoPor?: string; criadoEm?: string;
  resolucao?: "aprovada" | "cancelada";
  obsResolucao?: string | null;
  resolvidoPor?: string; resolvidoEm?: string;
}
/** Abre contestação de divergência na parcela (bloqueia o pagamento até resolver). */
export async function contestarParcela(input: {
  parcelaId: string; motivo: "valor" | "parcelas" | "outro"; descricao: string;
  valorCorreto?: number; parcelasCorreto?: number;
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  return (await httpsCallable(functions, "nfeContestarParcela")(input)).data as { ok: boolean };
}
/** Resolve/aprova (ou cancela) a contestação — libera o pagamento. Só admin. */
export async function resolverContestacao(input: {
  parcelaId: string; resolucao: "aprovada" | "cancelada"; obs?: string;
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  return (await httpsCallable(functions, "nfeResolverContestacao")(input)).data as { ok: boolean };
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
  contasPagamento?: ContaPagamento[] | null;
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
  contasPagamento?: ContaPagamento[];
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
  contasPagamento?: ContaPagamento[] | null;
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
  qtdParcelas?: number | null; // nº de parcelas (vazio = permanente)
  fimVigencia?: string | null; // YYYY-MM do último mês (calculado no backend)
  beneficiario?: string | null;
  observacao?: string | null;
  ativo?: boolean;
  pagamentos?: Record<string, PagamentoDespesa>;
  origem?: string; // "pdv-import" quando veio do relatório do PDV
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
  qtdParcelas?: number | null;
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
  contasPagamento?: ContaPagamento[];
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfePagarDespesaFixa");
  const res = await fn(input);
  return res.data as { ok: boolean };
}

/** Categorias das despesas manuais (sem NF / extraordinárias). */
export const CATEGORIAS_DESPESA_MANUAL: { key: string; label: string }[] = [
  { key: "limpeza", label: "Material de limpeza" },
  { key: "escritorio", label: "Material de escritório" },
  { key: "transporte", label: "Transporte / Uber / combustível" },
  { key: "alimentacao", label: "Alimentação" },
  { key: "manutencao", label: "Manutenção / reparos" },
  { key: "marketing", label: "Marketing / brindes" },
  { key: "taxas", label: "Taxas / cartório / correio" },
  { key: "rh", label: "RH / pessoal" },
  { key: "outros", label: "Outros" },
];

export interface DespesaManual {
  id: string;
  empresaId: string;
  empresaNome?: string | null;
  dia: string; // YYYY-MM-DD
  descricao: string;
  fornecedor?: string | null; // quem prestou o serviço / vendeu os produtos
  categoria: string;
  valor: number;
  formaPagamento?: "dinheiro" | "pix";
  contaEmpresaId?: string | null; // conta bancária (empresa) de onde saiu o PIX
  pago?: boolean;                 // false = conta a pagar (dia = vencimento). Ausente = pago (legado).
  dataPagamento?: string | null;  // quando foi paga (pode diferir do vencimento)
  criadoEm?: string;
  atualizadoEm?: string;
}

/** Lista as despesas manuais (mais recentes primeiro). */
export async function listarDespesasManuais(): Promise<DespesaManual[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "manual_expenses"));
  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DespesaManual[];
  return arr.sort((a, b) => (b.dia ?? "").localeCompare(a.dia ?? ""));
}

/** Cria/atualiza uma despesa manual (sem NF / extraordinária). */
export async function salvarDespesaManual(input: {
  id?: string;
  empresaId: string;
  dia: string;
  descricao: string;
  fornecedor?: string;
  categoria: string;
  valor: number;
  formaPagamento?: "dinheiro" | "pix";
  contaEmpresaId?: string;
  pago?: boolean;
  dataPagamento?: string;
}): Promise<{ ok: boolean; id: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "salvarDespesaManual");
  const res = await fn(input);
  return res.data as { ok: boolean; id: string };
}

/** Baixa (ou reabre) o pagamento de uma despesa manual. */
export async function baixarDespesaManual(input: { id: string; pago: boolean; dataPagamento?: string; contasPagamento?: ContaPagamento[] }): Promise<{ ok: boolean; pago: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "baixarDespesaManual");
  const res = await fn(input);
  return res.data as { ok: boolean; pago: boolean };
}

/** Exclui uma despesa manual. */
export async function excluirDespesaManual(id: string): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "excluirDespesaManual");
  const res = await fn({ id });
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
  contaEmpresaId?: string;
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
// ── Stone (conciliação de cartão) ───────────────────────────────────────────

export interface TesteStone {
  ok: boolean;
  httpStatus?: number;
  dia?: string;
  layout?: string;
  bytes?: number;
  tamanhoXml?: number;
  estrutura?: { tag: string; qtd: number }[];
  amostra?: string;
  dica?: string;
  detalhe?: string | null;
}

/** A chave vai daqui direto para o cofre no servidor — não fica no navegador. */
export async function salvarCredenciaisStone(input: {
  empresaId: string;
  stoneCode: string;
  chave: string;
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "stoneSalvarCredenciais");
  return (await fn(input)).data as { ok: boolean };
}

export async function testarStone(input: {
  empresaId: string;
  dia?: string;
  layout?: string;
}): Promise<TesteStone> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "stoneTestar");
  return (await fn(input)).data as TesteStone;
}

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

/** Define manualmente o pagamento de uma NF-e sem parcelas (parcelado ou à vista quitado). */
export async function definirPagamento(input: {
  chNFe: string;
  parcelas: Array<{ vencimento: string; valor: number; pago?: boolean; dataPagamento?: string; contaPagamento?: string }>;
}): Promise<{ ok: boolean; parcelas: number }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeDefinirPagamento");
  const res = await fn(input);
  return res.data as { ok: boolean; parcelas: number };
}

export interface NotaPendente {
  id: string;
  chNFe: string | null;
  companyId: string | null;
  cnpjEmit: string | null;
  xNomeEmit: string | null;
  vNF: number | null;
  dhEmi: string | null;
  nNF: string | null;
  serie: string | null;
}
/** Varredura: NF-e sem nenhuma parcela cadastrada (pagamento a definir). */
export async function pagamentosPendentes(empresaId?: string): Promise<NotaPendente[]> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfePagamentosPendentes");
  const res = await fn({ empresaId: empresaId || undefined });
  return (res.data as { ok: boolean; pendentes: NotaPendente[] }).pendentes ?? [];
}

/** Lote: marca várias NF-e como pagas à vista na data de emissão de cada uma. */
export async function definirPagamentoLoteEmissao(
  chaves: string[],
): Promise<{ ok: boolean; criadas: number; puladas: number; semValor: number }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "nfeDefinirPagamentoLoteEmissao");
  const res = await fn({ chaves });
  return res.data as { ok: boolean; criadas: number; puladas: number; semValor: number };
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
  maquinaEmpresaId?: string | null;
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
  maquinaEmpresaId?: string | null;
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
  totalRecebiveis: number;   // bruto vendido no cartão no período
  totalLiquido: number;      // líquido previsto (bruto − taxa)
  recebiveis: number;
  cartaoAReceber?: number;   // saldo em aberto (crédito ainda não chegou), respeitando antecipação
  liquidoAReceber?: number;  // líquido do que está em aberto
  cartaoCreditado?: number;  // bruto que já caiu na conta
  hoje?: string;
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
  proximosCartao: { dia: string; valor: number }[];
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
  contaId?: string | null;
  tipo: string;
  data: string;
  valor: number;
  memo: string;
  categoria: string;
}
export interface ContaBanco {
  empresaId: string;
  org: string | null;
  fid?: string | null;
  curdef: string | null;
  saldo: number | null;
  saldoData: string | null;
  dtStart: string | null;
  dtEnd: string | null;
  ultimoImport: string | null;
  nContas?: number;
}
export interface ContaBancoItem {
  contaId: string | null;
  org: string | null;
  acctId: string | null;
  saldo: number;
  saldoData: string | null;
  ultimoImport: string | null;
}
export interface ExtratoBanco {
  ok: boolean;
  conta: ContaBanco | null;
  contas?: ContaBancoItem[]; // contas individuais da loja (várias por loja)
  creditos: number;
  debitos: number;
  saldoMov: number;
  porCategoria: Record<string, number>;
  total: number;
  transacoes: TxBanco[];
}
export async function importarExtrato(ofx: string, empresaId: string): Promise<{ ok: boolean; transacoes: number; saldo: number | null; saldoData: string | null; org: string | null; contaId?: string; acctId?: string | null; periodo: { de: string | null; ate: string | null } }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "importarExtrato");
  const res = await fn({ ofx, empresaId });
  return res.data as { ok: boolean; transacoes: number; saldo: number | null; saldoData: string | null; org: string | null; contaId?: string; acctId?: string | null; periodo: { de: string | null; ate: string | null } };
}
export async function obterExtrato(empresaId: string, de?: string, ate?: string): Promise<ExtratoBanco> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "extratoBanco");
  const res = await fn({ empresaId, de: de || undefined, ate: ate || undefined });
  return res.data as ExtratoBanco;
}
/** Leitura leve do saldo do banco de uma empresa (sem carregar os lançamentos).
 * Uma loja pode ter VÁRIAS contas (bank_accounts/{empresaId}_{contaId}); consolida
 * o saldo de todas e usa a saldoData mais recente. */
export async function obterContaBanco(empresaId: string): Promise<{ saldo: number | null; saldoData: string | null } | null> {
  const { db } = fb();
  const snap = await getDocs(query(collection(db, "bank_accounts"), where("empresaId", "==", empresaId)));
  if (snap.empty) return null;
  let saldo = 0;
  let temSaldo = false;
  let saldoData: string | null = null;
  for (const docSnap of snap.docs) {
    const d = docSnap.data() as { saldo?: number | null; saldoData?: string | null };
    if (d.saldo != null) { saldo += Number(d.saldo) || 0; temSaldo = true; }
    if (d.saldoData && (!saldoData || d.saldoData > saldoData)) saldoData = d.saldoData;
  }
  return { saldo: temSaldo ? Math.round(saldo * 100) / 100 : null, saldoData };
}

export interface DiaConc {
  dia: string;
  bancoCartao: number;
  previstoCartao: number;
  difCartao: number;
  bancoPix: number;
  previstoPix: number;
  difPix: number;
}
export interface Conciliacao {
  ok: boolean;
  de: string;
  ate: string;
  empresaId: string;
  banco: { cartao: number; pix: number; outrasEntradas: number; saidas: number };
  previsto: { cartao: number; pix: number };
  manual?: { cartao: number; pix: number };
  dif: { cartao: number; pix: number };
  // Validação da taxa da Stone (agregada): bruto × taxa app (taxaApp) vs o que caiu (taxaStone).
  // `confiavel` = extrato cobre ≥ ~60 dias; abaixo disso o descasamento da antecipação distorce.
  taxaCartao?: { bruto: number; taxaApp: number; taxaStone: number; extratoDias: number; confiavel: boolean };
  porDia: DiaConc[];
}
export async function obterConciliacao(empresaId: string, de: string, ate: string): Promise<Conciliacao> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "conciliacao");
  const res = await fn({ empresaId, de, ate });
  return res.data as Conciliacao;
}

// ——— Recebimento de compras (SEFAZ × entrada na loja) ———
export interface NotaCompra {
  chNFe: string;
  companyId: string;
  lojaNome: string;
  cnpjEmit: string;
  xNomeEmit: string | null;
  nNF: string | null;
  serie: string | null;
  vNF: number;
  dhEmi: string | null;
  situacao: string | null;
  recebida: boolean;
  recebidaOrigem: string | null; // "manual" | "pdvnet" | null
  recebidaEm: string | null;
}
export interface NotasCompraResp {
  ok: boolean;
  de: string;
  ate: string;
  total: { qtd: number; valor: number };
  recebidas: { qtd: number; valor: number };
  pendentes: { qtd: number; valor: number };
  itens: NotaCompra[];
}
export async function listarNotasCompra(
  de: string,
  ate: string,
  companyId = "",
  status: "todas" | "pendentes" | "recebidas" = "todas",
): Promise<NotasCompraResp> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "notasCompra");
  const res = await fn({ de, ate, companyId, status });
  return res.data as NotasCompraResp;
}
export async function marcarNotaRecebida(chNFe: string, recebida: boolean): Promise<void> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "marcarNotaRecebida");
  await fn({ chNFe, recebida });
}

// ——— DRE gerencial (competência) ———
export type CmvOrigem = "percentual" | "real_gerencial" | "real_aquisicao" | "compras";
export interface DRE {
  ok: boolean;
  de: string;
  ate: string;
  empresaId: string | null;
  cmvPct: number;
  cmvBase: "gerencial" | "aquisicao";
  cmvOrigem: CmvOrigem;
  receitaVendas: number; // líquida (já sem descontos)
  receitaManual: number;
  descontos?: number;
  cmv: number;
  compras: number;
  cmvReal: number;
  cmvRealAquisicao: number;
  cmvRealGerencial: number;
  custoCobertura: number;
  lucroBruto: number;
  margemBruta: number;
  taxasCartao: number;
  despesasFixas: number;
  despesasManuais: number;
  fretes: number;
  servicos: number;
  resultado: number;
  margemLiquida: number;
}
export async function obterDRE(de: string, ate: string, empresaId = "", cmvPct = 0, cmvBase: "gerencial" | "aquisicao" = "gerencial"): Promise<DRE> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "dreGerencial");
  const res = await fn({ de, ate, empresaId, cmvPct, cmvBase });
  return res.data as DRE;
}

// ——— Conciliação de saídas (banco × obrigações pagas) ———
export interface PagaSemBanco {
  tipo: string;
  descricao: string;
  valor: number;
  data: string;
  ref: string;
}
export interface DebitoSemConta {
  fitid: string;
  dia: string;
  valor: number;
  memo: string;
}
export interface ConciliacaoSaidas {
  ok: boolean;
  de: string;
  ate: string;
  empresaId: string | null;
  banco: { totalSaidas: number; porCategoria: Record<string, number>; qtd: number };
  pagas: { total: number; qtd: number; porTipo: { fornecedor: number; despesa: number; acordo: number } };
  conciliado: { valor: number; qtd: number };
  pagasSemBanco: PagaSemBanco[];
  debitosSemConta: DebitoSemConta[];
  pagasSemBancoTotal: number;
  debitosSemContaTotal: number;
}
export async function obterConciliacaoSaidas(de: string, ate: string, empresaId = ""): Promise<ConciliacaoSaidas> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "conciliacaoSaidas");
  const res = await fn({ de, ate, empresaId });
  return res.data as ConciliacaoSaidas;
}

// ——— Import de contas a pagar do PDV → despesas fixas ———
export interface ImportContasResumo {
  qtd: number; // despesas fixas que seriam criadas
  titulos: number; // títulos considerados (já sem mercadoria)
  total: number; // total mensal
  semEmpresa: number;
  semCategoria: number;
  ignoradosMercadoria: number; // títulos de mercadoria deixados de fora
  porCategoria: { categoria: string; qtd: number; valor: number }[];
  porLoja: { loja: string; qtd: number; valor: number }[];
}
export interface ImportContasResp {
  ok: boolean;
  dryRun: boolean;
  importados?: number;
  titulos?: number;
  removidos?: number;
  resumo: ImportContasResumo;
}
export async function importarContasPagar(texto: string, dryRun: boolean): Promise<ImportContasResp> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "importarContasPagar");
  const res = await fn({ texto, dryRun });
  return res.data as ImportContasResp;
}

// ——— DRE comparativo (mês a mês / lojas lado a lado) ———
export interface DREColuna {
  chave: string;
  rotulo: string;
  incompleto?: boolean;
  cmvOrigem?: CmvOrigem;
  cmvReal?: number;
  custoCobertura?: number;
  receitaVendas: number;
  receitaManual: number;
  cmv: number;
  compras: number;
  lucroBruto: number;
  margemBruta: number;
  taxasCartao: number;
  despesasFixas: number;
  despesasManuais: number;
  fretes: number;
  servicos: number;
  resultado: number;
  margemLiquida: number;
}
export interface DREComparativo {
  ok: boolean;
  eixo: "mes" | "loja";
  de: string;
  ate: string;
  cmvPct: number;
  empresaId: string | null;
  colunas: DREColuna[];
  total: Omit<DREColuna, "chave" | "rotulo">;
}
export async function obterDREComparativo(
  eixo: "mes" | "loja",
  de: string,
  ate: string,
  empresaId = "",
  cmvPct = 0,
  cmvBase: "gerencial" | "aquisicao" = "gerencial",
): Promise<DREComparativo> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "dreComparativo");
  const res = await fn({ eixo, de, ate, empresaId, cmvPct, cmvBase });
  return res.data as DREComparativo;
}

// ——— Taxas de cartão (configuração por loja) ———
export interface TaxaCartao {
  id: string;
  empresaId: string;
  nome: string;
  taxaPix: number;
  taxaDebito: number;
  taxaCredito: number;
  parcelas: Record<string, number>; // { "2": 4.03, ... "10": 8.5 }
  taxaAntecipacao: number;
  ativo: boolean;
}
export async function listarTaxasCartao(empresaId: string): Promise<TaxaCartao[]> {
  const { db } = fb();
  const snap = await getDocs(query(collection(db, "card_rates"), where("empresaId", "==", empresaId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as TaxaCartao)
    .sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? ""));
}
export async function obterConfigCartao(empresaId: string): Promise<{ antecipacao: boolean }> {
  const { db } = fb();
  const snap = await getDoc(doc(db, "card_settings", empresaId));
  const d = snap.exists() ? (snap.data() as { antecipacao?: boolean }) : {};
  return { antecipacao: d.antecipacao !== false };
}
export async function salvarTaxaCartao(t: Partial<TaxaCartao> & { nome: string; empresaId: string }): Promise<{ ok: boolean; id: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "salvarTaxaCartao");
  return (await fn(t)).data as { ok: boolean; id: string };
}
export async function excluirTaxaCartao(id: string): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "excluirTaxaCartao");
  return (await fn({ id })).data as { ok: boolean };
}
export async function salvarConfigCartao(empresaId: string, antecipacao: boolean): Promise<{ ok: boolean; antecipacao: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "salvarConfigCartao");
  return (await fn({ empresaId, antecipacao })).data as { ok: boolean; antecipacao: boolean };
}
export async function copiarTaxasCartao(de: string, para: string): Promise<{ ok: boolean; copiados: number }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "copiarTaxasCartao");
  return (await fn({ de, para })).data as { ok: boolean; copiados: number };
}
export async function importarCartoesPDV(empresaId: string): Promise<{ ok: boolean; importados: number }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "importarCartoesPDV");
  return (await fn({ empresaId })).data as { ok: boolean; importados: number };
}

// ——— Vendas manuais (lojas offline, ex.: Maracanã) ———
export interface VendaManual {
  id: string;
  empresaId: string;
  dia: string;
  forma: string;
  parcelas?: number; // nº de parcelas quando cartão parcelado
  maquinaEmpresaId: string | null;
  valor: number;
}
export interface AgAvulsa { chave: string; n: number; bruto: number; liquido: number }
export interface ResumoAvulsas {
  ok: boolean; de: string; ate: string; empresaId: string;
  total: { qtd: number; bruto: number; liquido: number; dinheiro: number; cartaoPix: number; taxas: number };
  porForma: AgAvulsa[];
  porMaquina: AgAvulsa[];
  porDia: AgAvulsa[];
}
export async function obterResumoAvulsas(empresaId: string, de: string, ate: string): Promise<ResumoAvulsas> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "resumoAvulsas");
  return (await fn({ empresaId, de, ate })).data as ResumoAvulsas;
}
export async function listarVendasManuais(empresaId: string, de: string, ate: string): Promise<VendaManual[]> {
  const { db } = fb();
  const snap = await getDocs(query(collection(db, "manual_sales"), where("empresaId", "==", empresaId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as VendaManual)
    .filter((v) => (!de || v.dia >= de) && (!ate || v.dia <= ate))
    .sort((a, b) => (b.dia).localeCompare(a.dia));
}
export async function salvarVendaManual(v: { id?: string; empresaId: string; dia: string; forma: string; parcelas?: number; maquinaEmpresaId?: string; valor: number }): Promise<{ ok: boolean; id: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "salvarVendaManual");
  return (await fn(v)).data as { ok: boolean; id: string };
}
export async function excluirVendaManual(id: string): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "excluirVendaManual");
  return (await fn({ id })).data as { ok: boolean };
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

// ---- Pedidos de compra ----

export interface ItemPedido {
  codigo: string;
  nome: string;
  cor?: string | null;
  tamanho?: string | null;
  qtd: number;
  valorUnit: number;
  valorTotal: number;
}
export interface PedidoCompra {
  id: string;
  empresaId: string;
  empresaNome?: string | null;
  fornecedorNome: string;
  cnpjFornecedor?: string | null;
  data: string; // YYYY-MM-DD
  dataEntrega?: string | null;
  itens: ItemPedido[];
  totalQtd?: number;
  totalValor?: number;
  nfs?: string[];
  // Resumo leve da última conciliação (persistido pelo backend) — usado pelo painel.
  resumoConcil?: {
    atendidoIntegral: boolean;
    totalQtdPedido?: number;
    totalQtdNf?: number;
    difQtd?: number;
    entregaStatus?: string | null;
    entregaRealizada?: string | null;
    em?: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Lista os pedidos de compra (mais recentes primeiro). */
export async function listarPedidos(): Promise<PedidoCompra[]> {
  const { db } = fb();
  const snap = await getDocs(collection(db, "purchase_orders"));
  const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as PedidoCompra[];
  return arr.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
}
/** Um pedido pelo id. */
export async function obterPedido(id: string): Promise<PedidoCompra | null> {
  const { db } = fb();
  const s = await getDoc(doc(db, "purchase_orders", id));
  return s.exists() ? ({ id: s.id, ...(s.data() as object) } as PedidoCompra) : null;
}
/** Cria/atualiza um pedido de compra. */
export async function salvarPedido(input: {
  id?: string; empresaId: string; fornecedorNome: string; cnpjFornecedor?: string; data: string; dataEntrega?: string;
  itens: Array<{ codigo: string; nome: string; cor?: string; tamanho?: string; qtd: number; valorUnit: number; valorTotal?: number }>;
}): Promise<{ ok: boolean; id: string }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "salvarPedidoCompra");
  const res = await fn(input);
  return res.data as { ok: boolean; id: string };
}
/** Exclui um pedido. */
export async function excluirPedido(id: string): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "excluirPedidoCompra");
  const res = await fn({ id });
  return res.data as { ok: boolean };
}
/** Associa/desassocia uma NF (chave) a um pedido. */
export async function associarNf(pedidoId: string, chNFe: string, add: boolean): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "associarNfPedido");
  const res = await fn({ pedidoId, chNFe, add });
  return res.data as { ok: boolean };
}

export interface LinhaConcilPedido {
  codigo: string; nome: string; cor?: string | null; tamanho?: string | null;
  qtdPedido: number; valorUnitPedido: number; valorTotalPedido: number;
  qtdNf: number; valorUnitNf: number; valorTotalNf: number;
  dif: number; status: "ok" | "parcial" | "sobra" | "excesso" | "nao_entregue";
  unitDiverge: boolean; totalDiverge: boolean;
}
export interface ExtraNf { codigo: string; nome: string; qtdNf: number; valorUnitNf: number; valorTotalNf: number }
export interface ConcilPedido {
  ok: boolean;
  linhas: LinhaConcilPedido[];
  extras: ExtraNf[];
  resumo: {
    itensPedido: number; ok: number; parcial: number; sobra: number; excesso: number; naoEntregue: number; valorDivergente: number; extras: number;
    totalQtdPedido: number; totalQtdNf: number; difQtd: number;
    totalPedido: number; totalNf: number; difValor: number; atendidoIntegral: boolean;
    pedidosCompartilhados?: number;
  };
  nfs: string[];
  chaveFornecedor: string;
  entrega: { prevista: string; realizada: string; difDias: number; status: "adiantado" | "no_prazo" | "atrasado" } | null;
}
/** Concilia o pedido com as NFs associadas. */
export async function conciliarPedido(pedidoId: string): Promise<ConcilPedido> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "conciliarPedidoCompra");
  const res = await fn({ pedidoId });
  return res.data as ConcilPedido;
}
/** Bloqueia o pagamento das NFs do pedido (abre contestação nas parcelas). Admin libera no Financeiro. */
export async function bloquearPagamentoPedido(input: { pedidoId: string; motivo: "valor" | "parcelas" | "outro"; descricao: string }): Promise<{ ok: boolean; bloqueadas: number; jaBloqueadas: number; pagas: number; semParcela: number }> {
  const { functions } = fb();
  const res = await httpsCallable(functions, "contestarNfsPedido")(input);
  return res.data as { ok: boolean; bloqueadas: number; jaBloqueadas: number; pagas: number; semParcela: number };
}

export interface MapaFornecedor { chave: string; fornecedorNome?: string; map: Record<string, string> }
/** Lê o mapeamento de colunas salvo de um fornecedor. */
export async function obterMapaFornecedor(chave: string): Promise<MapaFornecedor | null> {
  const { db } = fb();
  const s = await getDoc(doc(db, "supplier_maps", chave));
  return s.exists() ? (s.data() as MapaFornecedor) : null;
}
/** Salva o mapeamento de colunas de um fornecedor. */
export async function salvarMapaFornecedor(chave: string, fornecedorNome: string, map: Record<string, string>): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "salvarMapaFornecedor");
  const res = await fn({ chave, fornecedorNome, map });
  return res.data as { ok: boolean };
}

/** De-para manual (por fornecedor): liga o cProd da NF a um item do pedido. */
export async function salvarDePara(input: {
  chave: string; nfCProd: string; codigo?: string; tamanho?: string; remover?: boolean;
}): Promise<{ ok: boolean }> {
  const { functions } = fb();
  const fn = httpsCallable(functions, "salvarDeParaFornecedor");
  const res = await fn(input);
  return res.data as { ok: boolean };
}
