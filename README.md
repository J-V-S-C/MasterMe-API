# MasterMe — Backend

API e worker do MasterMe. O backend transforma materiais técnicos em conceitos
navegáveis, avalia explicações por conceito e gera Projetos de prática com foco
determinístico. Usa o SDK oficial `@google/genai`, structured output validado por
Zod e contexto explícito; não usa RAG, embeddings, LangChain ou LangGraph.

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

| Método | Rota | Finalidade |
| --- | --- | --- |
| POST | `/api/materials` | Cria material textual. |
| POST | `/api/materials/upload` | Envia PDF, Markdown ou TXT. |
| GET | `/api/materials/:id/status` | Consulta processamento assíncrono. |
| GET | `/api/events` | Acompanha eventos via SSE. |
| GET | `/api/materials/:id/knowledge-map` | Retorna mapa, status da explicação e do caso-limite. |
| POST | `/api/concepts/:id/sessions` | Inicia explicação de qualquer conceito. |
| POST | `/api/sessions/:id/answers` | Avalia resposta inicial; `PASSED` conclui a explicação. |
| POST | `/api/sessions/:id/edge-case` | Cria ou recupera caso-limite opt-in. |
| POST | `/api/sessions/:id/edge-case/answers` | Avalia o caso sem rebaixar a explicação. |
| GET | `/api/materials/:id/confidences` | Lista autoconfianças existentes. |
| PUT | `/api/concepts/:id/confidence` | Cria ou atualiza confiança de 1 a 5. |
| DELETE | `/api/concepts/:id/confidence` | Remove confiança. |
| GET | `/api/materials/:id/performance` | Expõe desempenho determinístico por conceito. |
| POST | `/api/materials/:id/practice-projects` | Gera ou recupera do cache um Projeto de prática. |
| GET | `/api/materials/:id/practice-projects` | Lista projetos do material. |
| GET | `/api/practice-projects/:id` | Recupera um projeto. |

`/api/sessions/:id/stress-replies` e as rotas de `isomorphic-problem` continuam
temporariamente disponíveis para o frontend legado. Novos consumidores devem
usar Teste de caso-limite e Projeto de prática.

Swagger UI: `http://localhost:3333/docs`. Documento bruto: `/openapi.json`.

## Projeto de prática

O frontend expõe apenas foco automático e seleção manual. Como contrato interno e para compatibilidade, o body de geração aceita `focusMode` igual a `OVERVIEW`, `MANUAL`,
`CONFIDENCE`, `PERFORMANCE` ou `COMBINED`, além de `conceptIds` quando o modo
permitir. Ranking e razões são calculados antes do Gemini. Modos sem dados
retornam `422`, sem fallback oculto. Entradas semanticamente idênticas usam
cache em `practice_projects`.

## Docker

O Compose inicia PostgreSQL, API e worker; o frontend permanece fora do Docker.

```bash
docker compose up --build
```

Volumes preservam banco e uploads. Ao reutilizar um volume criado antes da
renomeação do projeto, mantenha as credenciais internas desse banco ou migre
explicitamente role/database antes de recriar os containers.

## Limites do MVP

- Sem autenticação: existe uma confiança por conceito.
- PDFs sem texto selecionável são rejeitados; não há OCR.
- O Projeto de prática não recebe, executa ou avalia uma solução.
- Arquivos brutos ficam em volume local; produção deve usar object storage.

As fontes de verdade de produto são `../scope.md` e `../prd.md`; prioridades ficam em `../backlog.md` e os guardrails de engenharia em `../agents.md`.
