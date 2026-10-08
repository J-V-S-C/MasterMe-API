# Workflow de engenharia

## PRD temporário

Antes de alterar código, crie `.task-prds/YYYY-MM-DD-slug.md` na raiz deste
repositório. O arquivo deve conter:

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
material após a revisão, solicite uma segunda passada. Achados `CRITICAL` e
`HIGH` impedem merge/conclusão até correção e novo veredito explícito. Achados
menores precisam de resolução ou aceite de risco documentado.

O registro no corpo do PR inclui o caminho/ID do PRD, autor, revisor, SHA exato
revisado, achados com severidade, resoluções, veredito e confirmação de nova
passada quando o SHA mudar materialmente. O PRD permanece ignorado e é removido
localmente ao final; o corpo do PR preserva a evidência auditável.

## Validação

```bash
bun install --frozen-lockfile
bun run validate
```

Deploy só ocorre por merge de `development` em `main`, após CI verde.
