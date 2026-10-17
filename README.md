# MasterMe — Backend

API e worker do MasterMe. O backend transforma materiais técnicos em conceitos
navegáveis, avalia explicações por conceito e gera Projetos de prática com foco
determinístico. Usa o SDK oficial `@google/genai`, structured output validado por
Zod e contexto explícito; não usa RAG, embeddings, LangChain ou LangGraph.

## Acesso

- Health check: <https://masterme-api.duckdns.org/health>
- Frontend Repo: <https://github.com/J-V-S-C/MasterMe-Front>

O domínio público é atendido pelo Caddy na OCI, que encerra HTTPS e encaminha
as requisições para a API disponível somente em `127.0.0.1:3333` na VPS.

## Executar

```bash
bun install
cp .env.example .env
# preencha GEMINI_API_KEY e DATABASE_URL
bun run generate
bun run migrate
bun run dev
```

Verificação local:

```bash
bun run validate
```

## Arquitetura

A arquitetura-alvo é um monólito modular orientado por DDD. Em cada módulo,
HTTP valida e traduz erros; aplicação coordena casos de uso e transações;
domínio protege invariantes sem depender de frameworks; infraestrutura
implementa portas para PostgreSQL, SDKs, arquivos e fila; `main` compõe API e
worker. Módulos não importam detalhes internos uns dos outros. Agregados com
ciclo de vida encapsulam transições; snapshots, DTOs e entradas externas usam
Zod. Não criar abstrações ou classes sem regra atual.

Prisma ORM foi escolhido para a persistência, com migração incremental dos
adapters e baseline compatível com o schema existente. Tipos gerados pelo ORM
não atravessam para domínio ou HTTP; SQL seguro continua permitido para locking
e consultas específicas. OpenAPI acompanha cada mudança de contrato. A stack
OpenTelemetry, Prometheus e Grafana é a direção escolhida para observabilidade;
instrumentação, coleta, armazenamento, dashboards e alertas só estarão
entregues quando operarem juntos. A lista abaixo descreve o estado atual, não
a conclusão dessa migração arquitetural ou operacional.

- Express recebe e valida params/bodies antes dos controllers.
- `src/main/factories/` monta repositório → service → controller por recurso;
  `src/infra/http/routes/` apenas associa middleware e handlers. O worker usa
  factories de services e não instancia controllers.
- Contratos de repositório ficam em `src/application/repositories/`; gateways
  externos ficam em `src/application/ports/`. Adapters
  PostgreSQL e em memória ficam em `src/infra/repositories/`. A implementação
  em memória serve somente aos testes.
- Interfaces e tipos nomeados da API dos serviços ficam em
  `src/application/contracts/`, agrupados por serviço; tipos exclusivos de
  persistência permanecem com o contrato do repositório.
- O workspace 2.0 usa `LearningWorkspaceService` e uma porta de repositório
  em `src/application/`; Prisma, parser editorial, leases e transações ficam
  em `src/infra/repositories/prisma/prisma-learning-workspace.repository.ts`.
  Operações CRUD ainda são encaminhadas pelo serviço e a decisão transacional
  de sugestão permanece no adapter; refinar esses contratos é uma migração
  arquitetural pendente.
- `server.ts` escolhe o processo; `src/main` compõe API/worker e
  `src/infra/http/app.ts` configura middleware e routers.
- `StudySessionAggregate` e `BillingOrderAggregate` protegem parte das
  invariantes do domínio; a migração dos demais fluxos ainda está em andamento.
- `PracticeFocusService` é um serviço de domínio puro que ordena o foco sem
  chamar IA; `MasterMeService` ainda concentra casos de uso legados.
- Repositórios em PostgreSQL e em memória isolam persistência e testes.
- `GeminiMasterMeGateway` extrai conceitos, avalia respostas e gera somente os
  campos textuais do Projeto de prática.
- Upload e extração usam fila PostgreSQL, worker separado e progresso por SSE.
- O SSE usa `LISTEN/NOTIFY` para acordar conexões e a tabela de eventos para
  replay após reconexão; não há consulta ao banco a cada segundo por cliente.

## Rotas principais

| Método | Rota                                   | Finalidade                                                  |
| ------ | -------------------------------------- | ----------------------------------------------------------- |
| POST   | `/api/materials`                       | Cria material textual.                                      |
| GET    | `/api/materials`                       | Lista metadados sem enviar o conteúdo completo.             |
| GET    | `/api/materials/:id`                   | Recupera o conteúdo de um material sob demanda.             |
| POST   | `/api/materials/upload`                | Envia PDF, Markdown ou TXT.                                 |
| POST   | `/api/materials/:id/extract`           | Enfileira uma extração.                                     |
| DELETE | `/api/materials/:id/extract`           | Cancela uma extração ativa e descarta seu resultado tardio. |
| GET    | `/api/materials/:id/status`            | Consulta processamento assíncrono.                          |
| GET    | `/api/events`                          | Acompanha eventos via SSE.                                  |
| GET    | `/api/materials/:id/knowledge-map`     | Retorna mapa, status da explicação e do caso-limite.        |
| POST   | `/api/materials/:id/localize`          | Localiza conteúdo gerado sem alterar evidências.            |
| POST   | `/api/concepts/:id/sessions`           | Inicia explicação de qualquer conceito.                     |
| POST   | `/api/sessions/:id/answers`            | Avalia resposta inicial; `PASSED` conclui a explicação.     |
| POST   | `/api/sessions/:id/edge-case`          | Cria ou recupera caso-limite opt-in.                        |
| POST   | `/api/sessions/:id/edge-case/answers`  | Avalia o caso sem rebaixar a explicação.                    |
| GET    | `/api/materials/:id/confidences`       | Lista autoconfianças existentes.                            |
| PUT    | `/api/concepts/:id/confidence`         | Cria ou atualiza confiança de 1 a 5.                        |
| DELETE | `/api/concepts/:id/confidence`         | Remove confiança.                                           |
| GET    | `/api/materials/:id/performance`       | Expõe desempenho determinístico por conceito.               |
| GET    | `/api/materials/:id/practice-context`  | Agrega mapa, confiança, desempenho e projetos.              |
| POST   | `/api/materials/:id/practice-focus`    | Pré-visualiza o foco sem consumir IA.                        |
| POST   | `/api/materials/:id/practice-projects` | Gera ou recupera do cache um Projeto de prática.            |
| GET    | `/api/materials/:id/practice-projects` | Lista projetos do material.                                 |
| GET    | `/api/practice-projects/:id`           | Recupera um projeto.                                        |
| GET    | `/api/ai-usage/today`                  | Telemetria legada de chamadas e tokens do dia.            |
| GET    | `/api/billing/catalog`                 | Catálogo público e pesos de créditos.                     |
| POST   | `/api/billing/checkouts`               | Cria checkout hospedado idempotente para plano fixo.      |
| POST   | `/api/billing/orders/:id/reconcile`    | Reconcilia um pedido do usuário com a InfinitePay.        |
| GET    | `/api/billing/me`                      | Plano, saldo e estimativas conservadoras.                 |

`/api/sessions/:id/stress-replies` e as rotas de `isomorphic-problem` continuam
temporariamente disponíveis para o frontend legado. Novos consumidores devem
usar Teste de caso-limite e Projeto de prática.

Swagger UI local: `http://localhost:3333/docs`. Documento bruto: `/openapi.json`.
Ambos ficam desativados quando `NODE_ENV=production`.

## Observabilidade

`/health` é liveness sem dependências; `/ready` testa o banco com timeout e é o
gate de deploy. `/metrics` expõe RED, IA, créditos, fila e billing em Prometheus
somente com bearer operacional e fica desabilitado (`404`) sem configuração.
Labels usam enums e templates de rota, nunca IDs ou conteúdo. Counters em
memória reiniciam com o processo; gauges da fila e agregados de IA/créditos das
últimas 24 horas vêm do banco. O endpoint Prometheus atual não equivale a
Prometheus coletando, Grafana visualizando ou tracing OpenTelemetry em produção.

## Segurança, entitlement e créditos de IA

- O plano gratuito recebe 24 créditos/dia e 120 por mês-calendário. Essencial recebe 120/dia e 1.500 por vigência de 30 dias; Pro recebe 180/dia e 15.000 por vigência de 365 dias.
- Avaliação custa 2 créditos; caso-limite/problema 4; localização 6; projeto 8; extração 12. Cada fallback real reserva novamente o peso antes da chamada.
- O consumo é reservado atomicamente no PostgreSQL e respeita simultaneamente limite diário, limite do período, `AI_GLOBAL_DAILY_CREDIT_LIMIT` e o kill switch `AI_CREDITS_ENABLED`.
- `GET /api/billing/me` é a fonte autoritativa de saldo. `GET /api/ai-usage/today` permanece temporariamente apenas para telemetria compatível de chamadas/tokens.
- Cache hit não consome quota. A interface mostra o saldo interno do MasterMe, que é independente dos limites do projeto no Google AI Studio.
- A API limita rajadas globais por IP e aplica um limite por usuário somente nas rotas capazes de consumir IA. Produção deve manter também rate limiting no Caddy/Cloudflare.
- A chave Gemini permanece somente no backend e deve ser exclusiva, restrita e rotacionada.

## Cobrança InfinitePay

- `INFINITEPAY_HANDLE` vazio é o modo de lançamento gratuito: o catálogo expõe
  somente `FREE`; checkout, reconciliação HTTP e webhook respondem `404`, e o
  reconciliador não roda. `GET /api/billing/me` e reservas de créditos continuam
  ativos. Ativar pagamentos exige configurar o provedor e publicar o frontend
  correspondente na mesma release.
- Essencial (R$ 29,90/30 dias) e Pro (R$ 249,00/365 dias) são pagamentos únicos, sem renovação automática.
- Recompras estendem somente o mesmo tier. Se Essencial e Pro estiverem ativos ao mesmo tempo, Pro tem prioridade e apenas seus créditos são consumidos; vigência e saldo Essencial não são promovidos nem incorporados ao Pro.
- O frontend envia somente `planId` e `Idempotency-Key`; preço, descrição, redirects e webhook são definidos pelo backend a partir de `PUBLIC_APP_URL`.
- O webhook é apenas um gatilho. Entitlement só é concedido após `payment_check` server-to-server confirmar pagamento e valor, com pedido, transação e concessão idempotentes.
- Eventos concorrentes são admitidos atomicamente, com no máximo cinco pendências por pedido. O reconciliador em memória coalesce gatilhos e leases no PostgreSQL limitam todas as réplicas a cinco eventos ativos, no máximo um por pedido. `paid=false` encerra aquele evento; replay idêntico permanece terminal e somente um sinal realmente novo cria outra tentativa.
- A API nunca recebe nem armazena dados de cartão. Registros de pagamento guardam apenas IDs técnicos, valor, plano e estado necessários à conciliação.

## Projeto de prática

O frontend expõe apenas foco automático e seleção manual. Como contrato interno e para compatibilidade, o body de geração aceita `focusMode` igual a `OVERVIEW`, `MANUAL`,
`CONFIDENCE`, `PERFORMANCE` ou `COMBINED`, além de `conceptIds` quando o modo
permitir. Ranking e razões são calculados antes do Gemini. Modos sem dados
retornam `422`, sem fallback oculto. Entradas semanticamente idênticas usam
cache em `practice_projects`.

## Cache e atualização em tempo real

- Leituras privadas estáveis retornam `ETag` e `Cache-Control: private,
  max-age=0, must-revalidate`; dados voláteis, mutações, quota e SSE usam
  `no-store`.
- Eventos são filtrados por `owner_id`, persistidos antes da notificação e
  aceitam `Last-Event-ID` para replay seguro.
- A listagem de materiais nunca inclui o texto integral. Consumidores devem
  buscar `/api/materials/:id` apenas para o material ativo.

## Idioma e avaliação pedagógica

- Materiais novos usam `pt-BR` por padrão e aceitam `pt-BR` ou `en-US`.
- Conceitos, perguntas, diagnósticos e projetos são gerados no idioma do material; o trecho-fonte permanece literal.
- Conteúdo antigo pode ser localizado por `POST /api/materials/:id/localize`. A operação consome quota de IA, é idempotente quando o idioma já coincide e não altera IDs, relações, evidências ou sessões existentes.
- `INCOMPLETE` representa uma resposta semanticamente correta, mas ambígua ou incompleta. `LOGICAL_BREAK` fica reservado a contradição, causalidade invertida ou mecanismo incorreto.
- Perguntas de definição ou simples valor de retorno são descartadas e substituídas por desafios causais.

## Docker

O Compose inicia API e worker; o PostgreSQL é externo no Supabase e o frontend permanece fora do Docker.

```bash
docker compose up --build
```

O PostgreSQL de produção fica no Supabase. Apenas os arquivos enviados ficam no
volume Docker `material_uploads` da VPS; por isso esse volume deve ser incluído
na estratégia de backup enquanto não houver object storage.

## Limites do MVP

- Os créditos exibidos são a proteção interna do produto; eles não consultam o saldo remoto do Google em tempo real.
- PDFs sem texto selecionável são rejeitados; não há OCR.
- O Projeto de prática não recebe, executa ou avalia uma solução.
- Arquivos brutos ficam em volume local; produção deve usar object storage.

Este README é o guia operacional deste repositório. Em um clone independente,
o código, os testes, migrações, OpenAPI e workflows definem o comportamento
executável; contexto de produto externo não substitui contratos versionados.
Mudanças com código devem registrar objetivo, aceite e riscos no plano da fase
ou no PR, executar `bun run validate` e receber revisão independente antes de
serem marcadas concluídas. O `agents.md` do workspace principal reúne as
convenções de engenharia quando o backend está no workspace MasterMe.

## Deploy OCI e proteção de produção

Backend e frontend são repositórios Git independentes. `development` integra;
`main` publica. O frontend roda no Cloudflare Workers; API, worker e uploads
ficam na OCI; PostgreSQL fica no Supabase. A imagem backend é publicada no
GHCR por SHA. A VM precisa de Docker Engine, Compose e proxy HTTPS. O proxy
encaminha para `127.0.0.1:3333` e preserva o SSE em `/api/events`.

Use a URL **Session pooler** do Supabase na porta 5432 com `sslmode=require`;
encode caracteres reservados da senha na URL. API e worker usam pools
independentes (`DATABASE_POOL_MAX=3` como valor operacional inicial). A partir
do backend, `bun run migrate` executa migrations com ledger/checksum e advisory
lock; schema parcial ou migration histórica alterada deve falhar, nunca ser
reaplicada silenciosamente. Migrações são aditivas e não são revertidas pelo
rollback da imagem.

Na VM, copie `deploy/.env.example` para `/opt/masterme/.env` com modo `600`.
Defina `DATABASE_URL`, `SUPABASE_URL` HTTPS, `GEMINI_API_KEY`, `PUBLIC_APP_URL`
HTTPS canônica, `AI_GLOBAL_DAILY_CREDIT_LIMIT` e `AI_CREDITS_ENABLED`.
O exemplo limita o consumo global a 240 créditos/dia (até dez cotas gratuitas
completas); ajuste esse teto ao orçamento e à demanda antes da promoção.
Deixe `INFINITEPAY_HANDLE` e `METRICS_BEARER_TOKEN` vazios no lançamento gratuito:
pagamentos e `/metrics` ficam desativados. Um token de métricas de pelo menos
32 caracteres só deve ser configurado quando houver coleta privada operacional.
`OBSERVABILITY_DB_TIMEOUT_MS=1000` limita sondagens. Chaves ficam apenas na
VM, nunca no GitHub, no frontend ou em logs. O environment `production` do
GitHub requer `OCI_HOST`, `OCI_SSH_USER`, `OCI_SSH_KEY` e `OCI_KNOWN_HOSTS`.
Obtenha a host key por canal confiável; não aceite uma chave desconhecida no
workflow. O usuário SSH de deploy precisa de acesso controlado ao Docker.

Exemplo Caddy; a regra de métricas vem **antes** do proxy:

```caddyfile
api.seudominio.com {
  @operational path /metrics /metrics/*
  respond @operational 404
  request_body {
    max_size 9MB
  }
  reverse_proxy 127.0.0.1:3333
}
```

Exponha publicamente somente 80/443. Aplique rate limiting no proxy para API,
upload, SSE e webhook. O teto de 9 MB interrompe multipart antes do processo;
a API aceita até 8 MiB de arquivo. Defina timeout para uploads lentos. O
webhook InfinitePay é público e aceita no máximo 16 KiB na API; ele apenas
aciona reconciliação, e entitlement depende de `payment_check` confirmado.
Não exigir sessão de usuário para esse webhook. `/metrics` só pode ser coletado
por loopback/rede privada com bearer operacional; sem token configurado retorna
`404`, token incorreto retorna `401`.

O CI exige PostgreSQL 17 descartável para integrações, auditoria de
dependências, typecheck, testes, validação do Compose e smoke da imagem
production-only com filesystem somente leitura. O CD repete o gate antes de
publicar para não depender da ordem dos workflows paralelos. A publicação
automática ocorre somente em `main`; execução manual em outra branch deve ser
recusada. O deploy confirma `/ready` após migrações e atualização da API e do
worker em execução. `/health` continua liveness do container; esse gate não
substitui um teste ponta a ponta de extração no ambiente real.

Primeiro lançamento: migrar o banco, publicar backend, confirmar `/health` no
domínio e `/ready` via loopback, publicar frontend, testar upload, SSE,
cancelamento e extração. Se cobrança estiver ativa, fazer um pagamento
controlado e confirmar valor, plano, entitlement único e replay idempotente.
Antes de release, verificar backup do banco, volume `material_uploads`, disco,
memória, custo de Gemini e imagem anterior. Nunca copiar segredos para a
evidência de release.

Para rollback manual, usar um SHA anterior sem reverter schema:

```bash
cd /opt/masterme
MASTERME_IMAGE=ghcr.io/OWNER/masterme-backend:COMMIT_SHA docker compose --env-file .env -f compose.yml up -d
```

`deploy/deploy-and-verify.sh` salva a imagem anterior em
`/opt/masterme/.previous-image` e tenta restaurá-la se a nova API falhar em
`/ready`; o workflow mantém exit code de falha. Falha anterior ao gate de
readiness exige diagnóstico e rollback manual. Dados financeiros e migrações
aditivas permanecem. Em incidente de custo, defina `AI_CREDITS_ENABLED=false`;
em incidente isolado de checkout, remova `INFINITEPAY_HANDLE` sem revogar
entitlements existentes. Na VM de 1 GB, manter API em 384 MiB, worker em
256 MiB e `EXTRACTION_CONCURRENCY=1` até medir capacidade. Preserve backups
do volume local; object storage ainda é evolução pendente.

## Observabilidade e resposta operacional

Logs JSON em stdout e métricas locais não enviam conteúdo, query, token,
e-mail, owner ou IDs de material/pedido/transação. `GET /health` testa processo;
`GET /ready` consulta banco com timeout; `GET /metrics` expõe séries
allowlisted com bearer. Coleta privada local:

```bash
curl --fail -H "Authorization: Bearer $METRICS_BEARER_TOKEN" http://127.0.0.1:3333/metrics
```

Objetivos iniciais, sujeitos a ajuste com dados reais: API sem 5xx em 99,5%
dos requests em janela de 30 dias; p95 abaixo de 2,5 s fora de SSE; investigar
fila com job mais antigo acima de 5 min e tratar acima de 15 min como crítico;
investigar falhas do provedor acima de 10% em 15 min. O plano só declara
alertas operantes quando Prometheus/Grafana e destino de alertas estiverem
configurados, coletando e validados em produção.

- `/ready` em `503`: confirmar `/health`, Session pooler e saturação dos pools;
  não imprimir `DATABASE_URL`. Se persistir, parar deploy e restaurar imagem.
- Falha/custo de IA: separar operação e resultado, conferir logs por request ID
  e quota no provedor. Desligar novas tentativas com
  `AI_CREDITS_ENABLED=false` se necessário; reativar após teste controlado.
- Fila parada: conferir PENDING/PROCESSING/FAILED, idade do job, memória e
  disco do worker. O lease é retomado após cinco minutos; não executar SQL
  manual concorrente. Reiniciar apenas worker se API estiver saudável.
- Billing pendente: conferir pendências e conectividade com InfinitePay;
  nunca forçar `PAID` no banco. Usar reconciliação autenticada após confirmação
  do provedor. Remover handle impede novos checkouts.
