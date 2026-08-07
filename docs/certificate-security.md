# Segurança do Certificado Digital

O certificado A1 (ICP-Brasil, `.pfx`/`.p12`) autentica a empresa junto à SEFAZ
(mTLS) e assina os eventos de manifestação (XML-DSig). É o segredo mais sensível
do sistema.

## Regra absoluta

- **Nunca** no código, no Git, no frontend, em arquivos públicos ou em logs.
- **Nunca** expor a chave privada nem devolver o `.pfx`/senha ao navegador.
- Senha **nunca** em texto aberto fora do Secret Manager.

## Fluxo de cadastro (implementado)

```
Navegador (admin)
  └─ lê o .pfx como base64 (em memória, não persiste)     [certificado/page.tsx]
  └─ chama a callable nfeCadastrarCertificado(companyId, pfxBase64, senha)  (HTTPS)
        └─ Cloud Function                                   [functions/src/index.ts]
             ├─ exige role "admin"
             ├─ VALIDA abrindo o keystore com a senha (node-forge)  [lib/certificado.ts]
             ├─ extrai metadados: série, emissor, validade, CNPJ do titular
             ├─ confere que o CNPJ do certificado == CNPJ da empresa
             ├─ grava { pfxBase64, senha } no Secret Manager  [lib/secrets.ts]
             │     secret: nfe-cert-<cnpjBase>  (versão nova a cada upload)
             ├─ grava SÓ metadados em nfe_certificates/{companyId}
             └─ registra auditoria (audit_logs); retorna só metadados
```

O frontend recebe de volta **apenas metadados** (série, emissor, validade,
situação, dias restantes). O `.pfx` e a senha jamais retornam.

## Armazenamento (Secret Manager)

- Um segredo por CNPJ base: `nfe-cert-<8-primeiros-digitos>`.
- Payload = JSON `{ pfxBase64, senha }`. Cada novo upload adiciona uma **versão**
  (renovação de certificado não perde histórico; `latest` é a vigente).
- Leitura só pelo backend (sync/manifestação), via `lerSegredoCertificado`.

### IAM necessário

A service account de runtime das Functions v2 precisa de:

- `roles/secretmanager.admin` — criar segredo e adicionar versões (cadastro), ou
  o par mais restrito `secretmanager.secretVersionAdder` + criação prévia dos
  segredos. Para leitura no runtime basta `roles/secretmanager.secretAccessor`.

> Alternativa mais restritiva: separar a função de **cadastro** (com permissão de
> criação) das funções de **uso** (só `secretAccessor`).

## Metadados exibidos (nfe_certificates)

empresa, CNPJ, razão social, número de série, emissor, validade início/fim,
situação (`válido` / `vencendo` / `vencido`) e dias restantes. Alertas de
expiração em 30/15/7/1 dias entram na Etapa 13.

## mTLS (Etapas 3–4)

A consulta à SEFAZ usa o mesmo certificado na conexão TLS (autenticação mútua),
montada com `https.Agent({ pfx, passphrase })` **dentro da Cloud Function** —
nunca no navegador. Riscos conhecidos (TLS legado / OpenSSL 3 do Node 20) são
tratados no cliente SOAP; validar o handshake primeiro em **homologação**.
