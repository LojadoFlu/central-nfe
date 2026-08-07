# Estrutura do Firestore

Coleções com prefixo `nfe_` (isolamento lógico). **O XML original nunca fica no
Firestore** — vai para o Storage; aqui ficam metadados + referência. Documentos
não são "gigantes": itens, parcelas e eventos são coleções próprias.

## Coleções

| Coleção | Papel | ID / idempotência |
|---|---|---|
| `nfe_companies` | Empresas/CNPJs do grupo | id próprio (ou CNPJ) |
| `nfe_certificates` | **Só metadados** do certificado (validade, série, emissor, `secretRef`) | `companyId` |
| `nfe_sync_state` | NSU por CNPJ: `ultNSU`, `maxNSU`, `status`, `proximaSync` | `companyId` |
| `nfe_sync_logs` | Logs de integração (data, cStat, qtd, tempo) | auto |
| `nfe_documents` | Metadados do DF-e (chave, emit, valores, situação, manifestação) | `chNFe` (ou `NSU`) |
| `nfe_items` | Itens (busca por produto/NCM) | `chNFe_nItem` |
| `nfe_installments` | Duplicatas/parcelas (contas a vencer/vencidas) | `chNFe_nDup` |
| `nfe_payments` | Pagamento **informado** no XML (≠ pago) | `chNFe` |
| `nfe_events` | Cancelamento, CC-e, etc. | `chNFe_tpEvento_seq` |
| `nfe_manifestations` | Manifestações enviadas por nós | auto |
| `nfe_suppliers` | Fornecedores agregados (total, ticket, última compra) | CNPJ emitente |
| `nfe_alerts` | Central de alertas | auto |
| `nfe_users` | Perfil/papel do usuário | `uid` |
| `audit_logs` | Auditoria (rastreabilidade) | auto |

## Storage

```
/nfe/{cnpj}/{ano}/{mes}/{chNFe}.xml   ← XML original cru (+ resumos/eventos)
```

Metadado no Firestore guarda `storagePath` + `hashSha256` para rastreabilidade
até o arquivo original.

## Índices compostos (ver `firestore.indexes.json`)

- `nfe_documents`: `(companyId, dhEmi↓)`, `(cnpjEmit, dhEmi↓)`, `(situacao, dhEmi↓)`, `(manifestStatus, dhEmi↓)`
- `nfe_installments`: `(companyId, situacao, vencimento↑)`, `(companyId, vencimento↑)`
- `nfe_items`: `(descricaoBusca, dhEmi↓)`, `(ncm, dhEmi↓)`
- `nfe_suppliers`: `(companyId, totalComprado↓)`

## Boas práticas de escala

- Paginação por cursor (`startAfter`), filtros no backend, virtualização de lista.
- Busca textual: campo `descricaoBusca`/`nomeBusca` normalizado (sem acento/caixa),
  no mesmo padrão do `packages/core` do CRM.
- `db.settings({ ignoreUndefinedProperties: true })` no Admin SDK.
- Nunca carregar milhares de documentos no navegador de uma vez.
