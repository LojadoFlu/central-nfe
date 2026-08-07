import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

// Cliente do Secret Manager. Usa as credenciais padrão da função (ADC).
const client = new SecretManagerServiceClient();

/** projectId do ambiente de execução da função. */
function projectId(): string {
  const p =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.PROJECT_ID;
  if (!p) throw new Error("projectId não disponível no ambiente da função.");
  return p;
}

/** Nome do segredo do certificado por CNPJ base. */
export function nomeSegredoCertificado(cnpjBase: string): string {
  return `nfe-cert-${cnpjBase}`;
}

/**
 * Grava (cria/versiona) o payload do certificado no Secret Manager.
 * `payload` é o JSON { pfxBase64, senha } — nunca vai para logs nem Firestore.
 * Retorna o nome curto do segredo (secretRef) para guardar como metadado.
 */
export async function gravarSegredoCertificado(
  cnpjBase: string,
  payload: string,
): Promise<string> {
  const parent = `projects/${projectId()}`;
  const secretId = nomeSegredoCertificado(cnpjBase);
  const secretName = `${parent}/secrets/${secretId}`;

  // Cria o segredo se ainda não existir.
  try {
    await client.getSecret({ name: secretName });
  } catch {
    await client.createSecret({
      parent,
      secretId,
      secret: { replication: { automatic: {} } },
    });
  }

  await client.addSecretVersion({
    parent: secretName,
    payload: { data: Buffer.from(payload, "utf8") },
  });

  return secretId;
}

/** Lê o payload mais recente do certificado (uso backend: sync/manifestação). */
export async function lerSegredoCertificado(
  cnpjBase: string,
): Promise<{ pfxBase64: string; senha: string }> {
  const name = `projects/${projectId()}/secrets/${nomeSegredoCertificado(
    cnpjBase,
  )}/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  const data = version.payload?.data?.toString();
  if (!data) throw new Error("Segredo do certificado vazio ou inexistente.");
  return JSON.parse(data);
}
