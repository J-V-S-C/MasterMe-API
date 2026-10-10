# Observabilidade e resposta operacional

O backend usa logs JSON em stdout e métricas Prometheus locais, sem vendor ou
envio de telemetria. Nunca adicione corpo, query string, token, e-mail, owner,
IDs de material/pedido/transação ou conteúdo pedagógico a logs ou labels.

## Endpoints e coleta

- `GET /health`: liveness barata; não consulta dependências e é o healthcheck do
  container. Falha apenas quando o processo HTTP não responde.
- `GET /ready`: consulta `SELECT 1` com timeout curto. É gate pós-deploy e pode
  responder `503` durante oscilação do banco sem reiniciar o container.
- `GET /metrics`: requer `Authorization: Bearer $METRICS_BEARER_TOKEN`. Sem token
  configurado responde `404`; token incorreto responde `401`. A resposta é
  `no-store`. Colete apenas por loopback/rede privada; o Caddy deve negar
  `/metrics`, `/metrics/` e qualquer subpath antes do `reverse_proxy`.

Gere o token com um gerador criptográfico, mínimo de 32 caracteres, e guarde-o
somente em `/opt/masterme/.env` com modo `600`. Exemplo local de coleta:

```bash
curl --fail -H "Authorization: Bearer $METRICS_BEARER_TOKEN" http://127.0.0.1:3333/metrics
```

As séries HTTP usam somente método allowlisted, template Express e classe de
status. IA usa operação/result; billing usa resultado allowlisted; fila usa
status fixos. Reinício zera counters em memória. Gauges da fila e agregados de
IA/créditos das últimas 24 horas vêm do banco e incluem API e worker; preservam
o último snapshot se a consulta temporariamente falhar.

## SLOs iniciais e alertas

Janela móvel de 30 dias, excluindo manutenção comunicada:

| Sinal | Objetivo | Alerta de aviso | Alerta crítico |
| --- | --- | --- | --- |
| Disponibilidade API | 99,5% de requests fora de 5xx | erro 5xx > 2% por 10 min | > 5% por 5 min |
| Latência | 95% abaixo de 2,5 s, sem SSE | p95 > 2,5 s por 15 min | p95 > 5 s por 10 min |
| Readiness | banco pronto | 3 falhas seguidas | 10 falhas seguidas |
| Extração | fila progride | mais antigo > 5 min | > 15 min ou jobs FAILED crescendo |
| IA | provedor saudável | falhas > 10%/15 min | > 30%/10 min |
| Billing | reconciliação progride | pendências > 10 por 10 min | lease preso/pending > 30 min |

Consultas PromQL de referência:

```promql
sum(rate(masterme_http_requests_total{status_class="5xx"}[5m])) / clamp_min(sum(rate(masterme_http_requests_total[5m])), 0.001)
histogram_quantile(0.95, sum by (le) (rate(masterme_http_request_duration_seconds_bucket{route!="/api/events"}[5m])))
masterme_extraction_oldest_pending_seconds
sum(rate(masterme_ai_provider_calls_total{result="failure"}[15m])) / clamp_min(sum(rate(masterme_ai_provider_calls_total[15m])), 0.001)
masterme_billing_webhooks_pending
```

## Runbooks

### `/ready` em 503

1. Confirme que `/health` responde. Se sim, não reinicie em loop.
2. Verifique conectividade, Session Pooler, limite de conexões e status do
   Supabase. Não imprima `DATABASE_URL`.
3. Confira saturação dos pools API/worker e eventos de deploy/migração.
4. Se persistir, interrompa novo deploy e reverta a imagem; preserve o banco.
   No deploy automatizado, uma falha do gate já tenta restaurar a imagem que
   estava ativa e mantém a execução vermelha com o erro original.

### Falhas ou custo de IA

1. Separe falhas por operação/result e confira logs pelo `requestId`.
2. Ative `AI_CREDITS_ENABLED=false` se houver risco financeiro; isso bloqueia
   novas tentativas sem apagar dados.
3. Confira cota/modelos no Google AI Studio e os fallbacks configurados.
4. Reative somente após validar uma operação controlada e o teto global diário.

### Fila de extração parada

1. Verifique gauges PENDING/PROCESSING/FAILED e idade do mais antigo.
2. Confira memória/disco do worker e logs `processing-*` sem copiar conteúdo.
3. O lease é retomado após cinco minutos; não execute SQL manual concorrente.
4. Reinicie somente o worker se a API estiver saudável; preserve uploads.

### Billing pendente

1. Confira pending/leased e resultados de reconciliação, nunca NSU em tickets.
2. Valide conectividade com InfinitePay e `INFINITEPAY_HANDLE`.
3. Remova o handle para impedir novos checkouts se necessário; entitlements
   confirmados permanecem válidos.
4. Não altere pedidos para `PAID` manualmente. Use a reconciliação autenticada
   depois de o provedor confirmar o pagamento.

### Pressão de recursos

Na VM de 1 GB, confira memória, swap, disco do volume de uploads, conexões e
reinícios dos containers. Mantenha API em 384 MiB, worker em 256 MiB e
`EXTRACTION_CONCURRENCY=1`. Aumentar concorrência sem medir memória e custo não
é uma mitigação segura.
