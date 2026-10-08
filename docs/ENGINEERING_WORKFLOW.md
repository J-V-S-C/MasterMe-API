# Workflow de engenharia

## PRD temporário

Antes de alterar código, crie `../.task-prds/YYYY-MM-DD-slug.md` no workspace
compartilhado. O arquivo deve conter:

- problema, objetivo e não objetivos;
- contratos e dados afetados;
- threat model, privacidade e impacto de custo;
- critérios de aceite observáveis;
- plano de testes, migração, rollback e rollout;
- branches e PRs previstos.

Esse PRD é descartável, não substitui o PRD global e não entra no Git. Apague-o
somente quando a tarefa estiver validada, revisada por outro agente e com PRs
abertos.

## Revisão independente

Para todo change set com código, o autor chama um subagente diferente. O revisor
recebe objetivo, PRD temporário, diff e resultados dos testes, mas não implementa
o código que revisa. Ele classifica achados por severidade e verifica:

- autenticação, autorização, ownership e exposição de segredos;
- validação, idempotência, concorrência, migração e rollback;
- logs sem PII, métricas de cardinalidade limitada e custo de nuvem/IA;
- testes de sucesso, erro, abuso e regressão;
- compatibilidade de API, OpenAPI e documentação.

O PR registra quem revisou, os achados e como foram resolvidos. Se houver mudança
material após a revisão, solicite uma segunda passada.

## Validação

```bash
bun install --frozen-lockfile
bun run validate
```

Deploy só ocorre por merge de `development` em `main`, após CI verde.
