# Workflow de engenharia

## Leitura orientada por tarefa

Antes de planejar ou editar, leia `AGENTS.md` e a skill local
`.agents/skills/masterme-documentation-routing/SKILL.md`. A matriz da skill
indica os documentos mínimos para cada tipo de alteração. Leia referências
adicionais somente quando a mudança as atingir; não transforme toda a árvore
de Markdown em pré-requisito de rotina.

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

Quando houver PRD global no workspace da iniciativa, declare se o change set o
altera, quais seções são afetadas e por quê. Ao concluir a iniciativa, atualize
somente essas seções. Não reescreva documentação estável; refatore documentos
ou código apenas quando a própria tarefa busca reduzir o custo de mudança.

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

### Orçamento e visibilidade da revisão

- Solicite a primeira revisão somente depois de o diff estar estável e a
  validação local estar verde. Não use subagente como acompanhamento contínuo da
  implementação.
- Envie apenas o PRD da tarefa, o SHA ou diff final, os arquivos diretamente
  afetados e um resumo dos testes. O revisor usa a skill de roteamento para
  carregar referências adicionais somente quando um risco concreto exigir.
- A resposta do revisor contém somente achados acionáveis, severidade,
  arquivo/linha e `APPROVED` ou `BLOCKED`; não repete o plano nem resume todo o
  código.
- Uma nova passada revisa somente as correções e suas dependências, salvo quando
  a mudança alterar o contrato original.
- Durante a execução, informe ao usuário em atualizações curtas: agente, escopo,
  estado (`aguardando`, `revisando`, `bloqueado`, `aprovado`) e resultado dos
  testes. Não alegue consumo exato por agente quando a plataforma não expuser
  essa telemetria.

## Validação

```bash
bun install --frozen-lockfile
bun run validate
```

Deploy só ocorre por merge de `development` em `main`, após CI verde.
