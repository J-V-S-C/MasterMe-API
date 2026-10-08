# Instruções para agentes — MasterMe API

Antes de planejar ou editar, leia `../scope.md`, `../prd.md`, `../backlog.md` e
`../agents.md`, nessa ordem. O código deve manter TypeScript estrito, validação
Zod nas bordas, ownership na API, migrações compatíveis e nenhum segredo em Git.

## Fluxo obrigatório para qualquer código

1. Crie antes da primeira edição um PRD local em
   `../.task-prds/<data>-<slug>.md`, seguindo
   `docs/ENGINEERING_WORKFLOW.md`. Ele é específico da execução e não altera o
   PRD global por si só.
2. Implemente em branch tipada criada de `development`, com testes primeiro para
   regras de domínio e regressões.
3. Rode `bun run validate` e os checks específicos da mudança.
4. Chame automaticamente um subagente diferente do autor para revisar o diff.
   O revisor deve ser somente leitor na primeira passada e verificar contratos,
   autenticação, ownership, idempotência, concorrência, custos, logs, migrações e
   testes. Autorrevisão não conta.
5. Corrija ou justifique cada achado e registre a evidência no PR.
6. Apague o PRD temporário apenas depois da validação, revisão e criação dos PRs.

Nunca commite `.task-prds/`, `.env`, tokens, payloads pessoais ou respostas de
estudo. Webhooks públicos só podem causar efeitos depois de verificação com o
provedor e reconciliação idempotente.
