# Central NF-e

Central Fiscal, Financeira e de Compras das NF-e emitidas contra os CNPJs da
empresa. Consulta oficial à SEFAZ via **NFeDistribuicaoDFe** (NT 2014.002),
armazenamento do XML original, parser, dashboard, financeiro, fornecedores,
manifestação e alertas.

App **irmão** de `crm-flu` e `estoque-balancer` no mesmo workspace, reusando o
design system, o padrão de autenticação e o molde de Cloud Functions do CRM,
porém em **projeto Firebase dedicado** (isolamento de dados).

> Stack: Next.js (App Router) na Netlify · Firebase Auth/Firestore/Storage ·
> Cloud Functions v2 (`southamerica-east1`) · Google Secret Manager · PWA.

---

## Estado atual (o que já existe neste repositório)

| Etapa | Escopo | Status |
|------|--------|--------|
| 1 | Scaffold, tema, Auth (RBAC), shell mobile-first (bottom-nav) + desktop, PWA | **Código escrito** |
| 2 | Empresas + Certificado (upload seguro → Secret Manager), metadados/validade | **Código escrito** |
| 3–15 | SEFAZ/NSU, XML, parser, notas, dashboard, financeiro, fornecedores, manifestação, relatórios, alertas | **Não iniciado** |

> ⚠️ **Ainda não foi buildado nem implantado.** Este ambiente de
> desenvolvimento não tinha Node instalado e o projeto Firebase dedicado ainda
> não foi criado. Rode os passos abaixo no seu ambiente para validar.

### Verificação e execução (rodar no seu ambiente, com Node 20)

```bash
cd central-nfe
npm install
npm run typecheck      # valida os tipos do front
npm run dev            # http://localhost:3000
```

Funções:

```bash
cd central-nfe/functions
npm install
npm run build          # compila as Cloud Functions
```

---

## Provisionamento (uma vez)

1. **Criar o projeto Firebase** dedicado (console Firebase) — ex. `central-nfe`.
   Ative **Authentication** (E-mail/Senha), **Firestore**, **Storage** e faça o
   upgrade para o plano **Blaze** (necessário para Functions + Secret Manager).
2. **Front (`.env.local`)** — copie `.env.local.example` e preencha os
   `NEXT_PUBLIC_FIREBASE_*` do projeto novo. Nenhum segredo aqui.
3. **Habilitar APIs** no projeto: Cloud Functions, Cloud Scheduler,
   **Secret Manager**, Cloud Build.
4. **Permissão do Secret Manager** para a service account das Functions
   (a conta `...@appspot.gserviceaccount.com` ou a runtime SA da v2) precisa de
   `roles/secretmanager.admin` (criar/versionar) — ver `docs/certificate-security.md`.
5. **Deploy**:
   ```bash
   firebase use <id-do-projeto>
   firebase deploy --only firestore:rules,storage,firestore:indexes,functions
   ```
   Front: conectar o diretório `central-nfe/` na Netlify (build `npm run build`,
   plugin `@netlify/plugin-nextjs`) e configurar as env `NEXT_PUBLIC_*`.
6. **Primeiro usuário admin**: crie o usuário no Auth e defina o custom claim
   `role: "admin"` (script `firebase-admin` `setCustomUserClaims`).

---

## Perfis (RBAC via custom claims)

- **admin** — acesso total; único que instala/altera certificado e empresas.
- **fiscal** — NF-e, XMLs, eventos e **manifestação**.
- **financeiro** — NF-e e informações financeiras.
- **consulta** — somente leitura.

O cliente **nunca** escreve dado fiscal: toda escrita passa por Cloud Functions
(Admin SDK). Ver `firestore.rules`.

---

## Estrutura

```
central-nfe/
├─ src/
│  ├─ app/                 # App Router: (auth)/login, (app)/{inicio,notas,...}
│  ├─ components/          # ui/ (design system) + layout/ (shell, bottom-nav)
│  └─ lib/                 # firebase, auth (roles), nav, nfe (types, repo)
├─ functions/             # Cloud Functions v2 (certificado, empresas, e Etapas 3+)
├─ firestore.rules        # cliente lê; backend escreve; segredo inacessível
├─ storage.rules          # XML só backend escreve/apaga
├─ firestore.indexes.json # índices compostos (documentos, parcelas, itens...)
└─ docs/                  # arquitetura, segurança do certificado, sync SEFAZ, Firestore
```

## Documentação

- [`docs/sefaz-sync.md`](docs/sefaz-sync.md) — NFeDistribuicaoDFe, NSU, consumo indevido (656).
- [`docs/certificate-security.md`](docs/certificate-security.md) — certificado, Secret Manager, mTLS.
- [`docs/firestore-structure.md`](docs/firestore-structure.md) — coleções e índices.

## Princípios inegociáveis

- XML original salvo **cru** (nunca reconstruído) e **nunca apagado** pela interface.
- Certificado/senha **só** no Secret Manager — nunca no front, no banco ou em logs.
- NSU **nunca** reiniciado arbitrariamente; consulta incremental e idempotente.
- Manifestações conclusivas **só** por ação explícita de usuário autorizado.
- "Pago" **nunca** inferido do XML (depende de conciliação futura).
- Homologação e produção separadas; produção nunca em teste automatizado.
