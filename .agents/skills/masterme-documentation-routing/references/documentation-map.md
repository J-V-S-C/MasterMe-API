# Document map — backend

Always read `AGENTS.md` and this map. Select documents as follows.

| Task scope | Read before acting |
| --- | --- |
| Any code change | `docs/ENGINEERING_WORKFLOW.md`, the task's local `.task-prds/*.md` |
| Public API, controller, schema, response or error | `README.md`, `src/docs/openapi.ts`, relevant route/service tests |
| Database migration, repository, concurrency or worker | `README.md`, `DEPLOYMENT.md`, `src/database/migrations/`, relevant integration tests |
| Auth, ownership, rate limit, upload, webhook, secrets or privacy | `SECURITY.md` when present, `.env.example`, relevant middleware/routes/tests |
| AI usage, quota, Gemini or cost | `README.md`, `.env.example`, AI usage service/gateway/tests |
| Payment or entitlement | payment task PRD, `.env.example`, relevant migration, routes and OpenAPI; use provider primary documentation |
| Deployment, OCI, Docker, CI/CD or rollback | `DEPLOYMENT.md`, `docker-compose.yml`, `.github/workflows/` |
| Observability, health, metrics or alert | `DEPLOYMENT.md`, relevant runtime configuration and operational docs |
| Documentation-only change | only the document being changed plus documents it directly links or contradicts |

Read a global workspace PRD only when the change alters a permanent product,
architecture, operational or commercial contract. Update only the affected
sections at initiative close.
