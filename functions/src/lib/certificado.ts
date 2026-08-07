import * as forge from "node-forge";

export interface CertMetadata {
  numeroSerie: string;
  emissor: string;
  titular: string;
  cnpj: string | null; // extraído do titular quando presente
  validadeInicio: string; // ISO
  validadeFim: string; // ISO
}

/** Nome comum (CN) e demais campos de um conjunto de atributos X.509. */
function campo(attrs: forge.pki.CertificateField[], shortName: string): string {
  const a = attrs.find((x) => x.shortName === shortName);
  return (a?.value as string) ?? "";
}

/**
 * Valida o PFX (a senha precisa abrir o keystore) e extrai METADADOS.
 * Não retorna nem loga a chave privada. Lança se a senha estiver errada
 * ou o arquivo for inválido.
 */
export function lerMetadadosPfx(pfxBase64: string, senha: string): CertMetadata {
  const der = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(der);
  // Se a senha estiver errada, isto lança — é a nossa validação.
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[
    forge.pki.oids.certBag
  ];
  if (!certBags || certBags.length === 0) {
    throw new Error("Certificado não encontrado no arquivo.");
  }

  // O certificado do titular é o que tem chave privada associada; na prática,
  // pegamos o de validade mais longa que não seja da cadeia raiz (heurística
  // simples: o primeiro certBag costuma ser o do titular no A1 e-CNPJ).
  const cert = certBags[0].cert;
  if (!cert) throw new Error("Certificado inválido.");

  const titular = campo(cert.subject.attributes, "CN");
  const emissor = campo(cert.issuer.attributes, "CN");
  // CNPJ costuma vir no CN como "RAZAO SOCIAL:00000000000000".
  const cnpjMatch = titular.match(/(\d{14})/);

  return {
    numeroSerie: cert.serialNumber,
    emissor,
    titular,
    cnpj: cnpjMatch ? cnpjMatch[1] : null,
    validadeInicio: cert.validity.notBefore.toISOString(),
    validadeFim: cert.validity.notAfter.toISOString(),
  };
}

/**
 * Converte o PFX (A1, possivelmente com algoritmos legados RC2/3DES) em PEM
 * usando node-forge (JS puro) — evita o erro "Unsupported PKCS12 PFX data" do
 * OpenSSL 3 ao usar o certificado no mTLS do Node. Retorna chave + cadeia PEM.
 */
export function pfxParaPem(pfxBase64: string, senha: string): { key: string; cert: string } {
  const der = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);

  // Chave privada (encriptada = pkcs8ShroudedKeyBag; senão keyBag).
  let keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ];
  if (!keyBags || keyBags.length === 0) {
    keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
  }
  const key = keyBags && keyBags[0]?.key;
  if (!key) throw new Error("Chave privada não encontrada no certificado.");
  const keyPem = forge.pki.privateKeyToPem(key);

  // Certificados (folha + cadeia). O Node escolhe a folha que casa com a chave.
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[
    forge.pki.oids.certBag
  ];
  if (!certBags || certBags.length === 0) {
    throw new Error("Certificado não encontrado no arquivo.");
  }
  const certPem = certBags
    .map((b) => (b.cert ? forge.pki.certificateToPem(b.cert) : ""))
    .join("");

  return { key: keyPem, cert: certPem };
}
