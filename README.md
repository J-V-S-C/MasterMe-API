# MasterMe — Backend

**The service that turns study material and student answers into a trustworthy learning record.**

MasterMe helps people studying programming and other technical subjects on their own. Reading a book or article can feel like understanding, even when its ideas are hard to explain later. It is also difficult to decide what to study next when material, tasks, and weak spots are scattered. MasterMe keeps the original source beside concept-specific questions, records what the learner actually answered, and suggests a small next action with a reason. A passed answer is evidence for that attempt, not a claim that the person has mastered the subject.

This repository contains the **backend**: the API used by the web app, a background worker for long-running material processing, the database schema, AI integration, and the rules for study evidence, planning, access, and credits. The [web interface is a separate repository](https://github.com/J-V-S-C/MasterMe-Front). This README covers the product flow, its implementation, and local setup.

- **Running API:** <https://masterme-api.duckdns.org>
- **Health endpoint:** <https://masterme-api.duckdns.org/health>
- **Web app:** <https://masterme-frontend.joaovictorcortabitart.workers.dev>
- **Local API documentation:** <http://localhost:3333/docs> when running in development; disabled in production.

## The problem

A highlight or a finished chapter says what someone read; it does not show what they can explain, apply, or recall. Most study tools leave the reader to connect their material, practice attempts, and schedule by hand. If an AI assistant simply supplies an answer, the learner can also miss the chance to retrieve and reason through the idea themselves.

MasterMe addresses these problems by connecting **the source**, **a question about that source**, **the learner's own answer**, and **a possible next action**. It preserves different kinds of evidence separately. Confidence is a self-report; task completion says work was done; an approved explanation says one answer met its criteria; a later recall attempt says something about retention. None becomes a global mastery score.

## The solution

Imagine uploading a chapter about a design pattern. The backend stores the chapter and starts processing it. It finds concepts and passages in the chapter, then the learner chooses one and receives a custom question. When they answer, MasterMe returns a short diagnosis: what was correct, what is missing or inconsistent, and what to try next. The answer, question version, cited passage, and any help used stay in the learner's history. A later review or practice task can point back to that evidence.

The backend has five jobs:

| Job                                      | Why it matters to the learner                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the material and its location       | The learner can check a question or diagnosis against the original passage and, for a book, its chapter order.                         |
| Process large material in the background | Uploading does not hold the browser open while a book is parsed and concepts are extracted. Progress and retries are visible.          |
| Generate and evaluate study work         | AI writes concept-specific questions and diagnoses answers using the saved source and criteria. The learner writes the answer.         |
| Keep an honest learning history          | Earlier answers, assistance, challenges, and review attempts remain distinct; reprocessing material does not silently erase them.      |
| Protect accounts and provider cost       | The server checks ownership, reserves AI credits, and controls billing. A browser response cannot grant access or mark itself correct. |

## What a student can do

1. **Import material:** paste text or upload a PDF, Markdown, or TXT file. An extraction job reports its stages and can be cancelled. PDFs need selectable text; OCR is not included.
2. **Study a concept:** read its original passage, answer an explanation question, and optionally try reasoning, application, recall, or an edge case. Questions are generated for the particular concept, not filled into a generic template.
3. **Review feedback:** see `PASSED`, `INCOMPLETE`, or `LOGICAL_BREAK` with a diagnosis. These labels judge the submitted answer, not the whole subject. An AI diagnosis can be contested.
4. **Plan work:** save tasks, goals, availability, and review dates. Today suggestions have reasons and require the learner to decide whether to act on them.
5. **Practice:** preview a gap, try a focused drill, or request a Practice Project brief. MasterMe does not run or grade a submitted project solution.

These actions are optional paths. A student can request a Practice Project after extraction without passing an explanation first. The browser screens for these actions are in the frontend repository; the full API contract is in `src/docs/openapi.ts`.

## Why processing has its own worker

A web request should answer promptly. Extracting a long PDF may take much longer, and the person may close the tab, lose the connection, or cancel. The API therefore records a **job** in PostgreSQL and responds while a separate **worker** performs the parsing and AI calls. A **queue** is the list of jobs waiting for that worker. It is a database table here, so the project does not need another queue server.

The worker claims available jobs with database locks, renews each claim during long calls, and saves progress. If the process stops, another claim can resume the work; chapter checkpoints prevent already completed chapters from being repeated. Progress is also saved as **events**. The API streams those events to the browser through server-sent events (SSE), and the browser can reconnect or poll if the stream drops. Events are for progress and recovery; they are not a separate store for PDF content. Source files and study records remain in their own storage and database tables.

## Technology and structure

| Area                 | Implementation                                                               |
| -------------------- | ---------------------------------------------------------------------------- |
| API                  | Bun, TypeScript, Express 5, Zod, OpenAPI                                     |
| Data                 | PostgreSQL 17; Prisma for newer adapters and SQL for specialized operations  |
| Background work      | PostgreSQL jobs, a separate worker, and server-sent events (SSE)             |
| AI                   | Gemini through `@google/genai`; structured output checked with Zod           |
| Identity and billing | Supabase Auth; server-side credit accounting; optional InfinitePay checkout  |
| Files and deployment | Original files in a local volume; Poppler for PDFs; Docker Compose and Caddy |

The API validates HTTP input and coordinates use cases; infrastructure modules implement database, Gemini, file, queue, event, and payment access. Domain rules such as study evidence and practice focus live outside the HTTP handlers. The move toward this separation is ongoing: some older flows still contain persistence logic in services.

```text
src/application/   use cases, contracts, domain rules, prompts
src/infra/         HTTP, ingestion, parsers, Gemini, storage, payments, events
src/main/          API and worker composition
src/middleware/    authentication, validation, limits, errors
src/docs/          OpenAPI contract
prisma/migrations/ database changes
```

## From upload to concepts

1. `POST /api/materials/upload` checks the file and ownership. PDF, Markdown, and TXT are accepted up to 20 MiB; PDFs can have up to 800 pages and need selectable text. Pasted text uses `POST /api/materials`.
2. The API extracts readable text, stores it in `study_materials`, saves the original upload in file storage, and records any source headings as `material_units`. It creates a `processing_jobs` row and returns `202` with the pending material; concept extraction continues in the worker.
3. The worker claims the job from PostgreSQL. For books, it uses usable chapter headings when available; otherwise it processes bounded parts of the text. It divides selected text into passages with source positions, sends batches to Gemini, and checks the structured response against the source. The model proposes concepts; the backend validates and selects them.
4. The worker saves concepts and their source positions. Long books can retain completed chapter checkpoints, so a retry can skip finished chapters. A successful re-extraction activates a new version while earlier study sessions remain linked to their original concepts.
5. The browser receives progress through `/api/events` (SSE), with saved events for reconnection and status polling as a fallback. The source passage can then be shown beside a concept or question.

A source heading guides where to process text; it is not itself a concept or proof of one. Passage boundaries limit how much text a model call receives. The original text remains available for reading and source checks. The API documentation at `/docs` in development and `src/docs/openapi.ts` provide route details.

## Study, planning, and credits

A concept's first question set can be generated together and reused for later activities. Answers receive `PASSED`, `INCOMPLETE`, or `LOGICAL_BREAK` feedback for that attempt. Confidence, task completion, explanations, application, and recall are stored as different evidence. A learner may contest a diagnosis; the original evaluation stays in history. Reviews and Today suggestions use backend rules and do not silently create tasks.

Gemini output is treated as untrusted data: responses must match the expected schema, refer to existing source passages, and use valid concept references. These checks catch structural problems, but a generated question or diagnosis can still be wrong. Identical cached generations can be reused without another provider call.

The backend reserves credits atomically before an AI attempt. A real generation attempt costs one credit; a cache hit costs none. Extraction can make several calls as it processes different parts of a book, so its total cost depends on the work performed. `GET /api/billing/me` is the source for balance and estimates. Payments are disabled in the free release unless the backend and frontend are configured for checkout; when enabled, entitlement follows server-side payment confirmation.

Supabase JWTs identify the user, and the API checks `owner_id` for saved resources. The frontend never decides ownership, balance, or payment state. Upload and AI routes have rate and concurrency limits.

## Run locally

Create a private `.env` with the values described in `.env.example`, including `SUPABASE_URL` and `GEMINI_API_KEY`, then run from this repository:

```bash
docker compose --env-file .env --env-file .env.development up --build
```

Compose starts the API, worker, and local PostgreSQL. The API is at `http://localhost:3333`; `GET /health` checks liveness and `GET /ready` checks database readiness. Source changes restart the watched process. Restart the API after adding a migration; rebuild after dependency, Prisma schema, or Dockerfile changes.

For local validation, start the test database, install dependencies, and run the project gate:

```bash
docker compose --env-file .env --env-file .env.development up -d test-db
bun install
bun run validate
```

Integration tests use the disposable test database on port 5433. Migration files live in `prisma/migrations/`; the API applies them at startup. Production deployment configuration is in `deploy/`, and CI workflows are in `.github/workflows/`.

In production, Caddy must block public access to metrics before proxying API requests:

```caddyfile
api.example.com {
  @operational path /metrics /metrics/*
  respond @operational 404
  reverse_proxy 127.0.0.1:3333
}
```

See `src/docs/openapi.ts` or the local `/docs` page for the full HTTP contract. The [frontend repository](https://github.com/J-V-S-C/MasterMe-Front) documents the browser experience.
