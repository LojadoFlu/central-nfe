# Sincronização com a SEFAZ — NFeDistribuicaoDFe

> Fonte primária: **NT 2014.002** (Web Service de Distribuição de DF-e de
> Interesse dos Atores da NF-e), servida pelo **Ambiente Nacional (RFB)**.

## ⚠️ Itens a confirmar no PDF oficial antes de produção

Os PDFs oficiais do portal `nfe.fazenda.gov.br` bloquearam leitura automática na
fase de pesquisa. **Confirme manualmente** na
[lista de NTs](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D)
e na [Relação de Serviços Web](https://www.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo%3D):

1. Número exato da **revisão vigente** da NT 2014.002.
2. **Limiar numérico** exato do consumo indevido (rejeição 656) para este serviço.
3. **Intervalo mínimo** oficial entre consultas (a prática consolidada é ~1h).
4. **Janela de disponibilidade** dos documentos na distribuição.
5. **URLs** dos web services (confirmar na Relação de Serviços Web).

Enquanto não confirmados, o sistema opera de forma **conservadora** (intervalo
≥ 1h, avanço estrito de NSU).

## Endpoints (a confirmar na Relação de Serviços Web)

| Ambiente | URL (NFeDistribuicaoDFe) |
|---|---|
| Produção | `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` |
| Homologação | `https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` |

> O AN migrou este serviço para hosts `www1`/`hom1` em 2022. Método SOAP:
> `nfeDistDFeInteresse`. Manifestação (`NFeRecepcaoEvento`) segue em host próprio
> — confirmar.

## Mensagem `distDFeInt` (versão 1.01)

Campos comuns: `tpAmb` (1=prod, 2=homolog), `cUFAutor`, `CNPJ`/`CPF`. Três modos
mutuamente exclusivos:

- **distNSU** (`ultNSU`) — distribuição a partir do último NSU processado.
- **consNSU** (`NSU`) — recupera um NSU específico que faltou.
- **consChNFe** (`chNFe`) — consulta uma NF-e por chave (44 dígitos).

## Máquina de estados do NSU (por CNPJ)

Guardada em `nfe_sync_state/{companyId}`:

```
1. Lê ultNSU salvo.
2. Chama distNSU(ultNSU). A resposta traz ~50 docs, o ultNSU e o maxNSU.
3. Persiste cada docZip (XML cru → Storage; metadados → Firestore) e o ultNSU.
4. Repete com o novo ultNSU até  ultNSU == maxNSU.
5. cStat 137 (nada novo) → para e agenda próximo ciclo (respeitando ~1h).
6. cStat 138 → havia documentos (já processados no laço).
7. cStat 656 (consumo indevido) → marca status "bloqueado" e recua proximaSync ≥ 1h.
```

**Regras de ouro**

- Nunca repetir consulta **sem avançar** o NSU.
- Nunca **reiniciar** o NSU (isso rebaixa e causa reprocessamento/bloqueio).
- Persistir o `ultNSU` a cada lote → retomada exata após falha (idempotência).
- Idempotência do documento: id determinístico por `chNFe` (ou `NSU` para eventos).

## Conteúdo do `docZip`

Cada `<docZip>` tem `NSU` e `schema`, conteúdo **GZip + Base64**:

| schema | conteúdo | quando |
|---|---|---|
| `resNFe` | **resumo** da NF-e | destinatário ainda sem direito ao XML completo |
| `resEvento` | resumo de evento | eventos disponibilizados |
| `procNFe` | **XML completo** (nfeProc) | emitente, ou destinatário **após manifestar** |
| `procEventoNFe` | XML de evento (cancelamento, CC-e, manifestação) | — |

## Manifestação (libera o XML completo)

`NFeRecepcaoEvento` (síncrono). Eventos e códigos `tpEvento`:

| Evento | tpEvento | Justificativa |
|---|---|---|
| Ciência da Operação | 210210 | não |
| Confirmação da Operação | 210200 | não |
| Desconhecimento da Operação | 210220 | não |
| Operação não Realizada | 210240 | **sim** (`xJust`) |

- Eventos são **assinados** (XML-DSig, enveloped) com o certificado do destinatário.
- Após manifestar (Ciência/Confirmação), reconsultar a distribuição para puxar o
  `procNFe` completo.
- Manifestações **conclusivas** (Confirmação/Desconhecimento/Op. não realizada)
  exigem **ação explícita de usuário autorizado** — nunca automáticas.

## Agendamento

`onSchedule` (Cloud Scheduler + Pub/Sub, `America/Sao_Paulo`) — mesmo padrão dos
apps irmãos. A rotina respeita `proximaSync` de cada CNPJ e o recuo do 656. Um
botão **Sincronizar agora** chama a mesma rotina sob demanda.
