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
bun run migrate
bun run dev
```

Verificação local:

```bash
bun run typecheck
bun test
```

## Arquitetura

- Express recebe e valida params/bodies antes dos controllers.
- `MasterMeService` aplica a jornada e as transições de sessão.
- `PracticeFocusService` calcula desempenho, normaliza sinais e ordena o foco
  sem chamar IA.
- Repositórios em PostgreSQL e em memória isolam persistência e testes.
- `GeminiMasterMeGateway` extrai conceitos, avalia respostas e gera somente os
  campos textuais do Projeto de prática.
- Upload e extração usam fila PostgreSQL, worker separado e progresso por SSE.

## Rotas principais

| Método | Rota                                   | Finalidade                                                  |
| ------ | -------------------------------------- | ----------------------------------------------------------- |
| POST   | `/api/materials`                       | Cria material textual.                                      |
| POST   | `/api/materials/upload`                | Envia PDF, Markdown ou TXT.                                 |
| POST   | `/api/materials/:id/extract`           | Enfileira uma extração.                                     |
| DELETE | `/api/materials/:id/extract`           | Cancela uma extração ativa e descarta seu resultado tardio. |
| GET    | `/api/materials/:id/status`            | Consulta processamento assíncrono.                          |
| GET    | `/api/events`                          | Acompanha eventos via SSE.                                  |
| GET    | `/api/materials/:id/knowledge-map`     | Retorna mapa, status da explicação e do caso-limite.        |
| POST   | `/api/concepts/:id/sessions`           | Inicia explicação de qualquer conceito.                     |
| POST   | `/api/sessions/:id/answers`            | Avalia resposta inicial; `PASSED` conclui a explicação.     |
| POST   | `/api/sessions/:id/edge-case`          | Cria ou recupera caso-limite opt-in.                        |
| POST   | `/api/sessions/:id/edge-case/answers`  | Avalia o caso sem rebaixar a explicação.                    |
| GET    | `/api/materials/:id/confidences`       | Lista autoconfianças existentes.                            |
| PUT    | `/api/concepts/:id/confidence`         | Cria ou atualiza confiança de 1 a 5.                        |
| DELETE | `/api/concepts/:id/confidence`         | Remove confiança.                                           |
| GET    | `/api/materials/:id/performance`       | Expõe desempenho determinístico por conceito.               |
| POST   | `/api/materials/:id/practice-projects` | Gera ou recupera do cache um Projeto de prática.            |
| GET    | `/api/materials/:id/practice-projects` | Lista projetos do material.                                 |
| GET    | `/api/practice-projects/:id`           | Recupera um projeto.                                        |
| GET    | `/api/ai-usage/today`                  | Uso privado, tokens e quota diária restante.              |

`/api/sessions/:id/stress-replies` e as rotas de `isomorphic-problem` continuam
temporariamente disponíveis para o frontend legado. Novos consumidores devem
usar Teste de caso-limite e Projeto de prática.

Swagger UI local: `http://localhost:3333/docs`. Documento bruto: `/openapi.json`.
Ambos ficam desativados quando `NODE_ENV=production`.

## Segurança e quota de IA

- `AI_DAILY_REQUEST_LIMIT` define quantas tentativas reais ao Gemini cada usuário pode fazer por dia; o padrão é 100.
- O consumo é reservado atomicamente no PostgreSQL antes da chamada, incluindo fallbacks de modelo.
- Cache hit não consome quota. A interface mostra o saldo interno do MasterMe, que é independente dos limites do projeto no Google AI Studio.
- A API limita rajadas por IP e mutações por usuário. Produção deve manter também rate limiting no Caddy/Cloudflare.
- A chave Gemini permanece somente no backend e deve ser exclusiva, restrita e rotacionada.

## Projeto de prática

O frontend expõe apenas foco automático e seleção manual. Como contrato interno e para compatibilidade, o body de geração aceita `focusMode` igual a `OVERVIEW`, `MANUAL`,
`CONFIDENCE`, `PERFORMANCE` ou `COMBINED`, além de `conceptIds` quando o modo
permitir. Ranking e razões são calculados antes do Gemini. Modos sem dados
retornam `422`, sem fallback oculto. Entradas semanticamente idênticas usam
cache em `practice_projects`.

## Docker

O Compose inicia API e worker; o PostgreSQL é externo no Supabase e o frontend permanece fora do Docker.

```bash
docker compose up --build
```

O PostgreSQL de produção fica no Supabase. Apenas os arquivos enviados ficam no
volume Docker `material_uploads` da VPS; por isso esse volume deve ser incluído
na estratégia de backup enquanto não houver object storage.

## CI/CD e produção

Todo `push` para `main` dispara dois workflows independentes:

1. `CI` instala dependências com lockfile, executa typecheck e testes.
2. `Deploy backend to OCI` repete as validações, cria a imagem Docker para
   `linux/amd64` e `linux/arm64`, publica no GHCR com tags do commit e `latest`,
   conecta à OCI por SSH, executa as migrations, atualiza API e worker e aguarda
   o health check.

O deploy usa o environment `production` do GitHub. Ele requer os secrets
`OCI_HOST`, `OCI_SSH_USER`, `OCI_SSH_KEY` e `OCI_KNOWN_HOSTS`. As variáveis da
aplicação permanecem exclusivamente em `/opt/masterme/.env` na VPS e não são
armazenadas no repositório.

Como CI e CD são disparados em paralelo, o CD possui suas próprias validações e
não depende do resultado do workflow de CI. Um deploy só é considerado concluído
depois de migrations, atualização dos containers e health check bem-sucedidos.

## Limites do MVP

- A quota exibida é a proteção interna do produto; ela não consulta o saldo remoto do Google em tempo real.
- PDFs sem texto selecionável são rejeitados; não há OCR.
- O Projeto de prática não recebe, executa ou avalia uma solução.
- Arquivos brutos ficam em volume local; produção deve usar object storage.

As fontes de verdade de produto são `../scope.md` e `../prd.md`; prioridades ficam em `../backlog.md` e os guardrails de engenharia em `../agents.md`.
