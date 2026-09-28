# Contribuição e fluxo de branches

O MasterMe usa duas branches permanentes:

- `development`: integração e validação das próximas mudanças.
- `main`: versão estável que dispara o deploy de produção.

## Nome das branches

Crie toda mudança a partir de `development`:

| Tipo | Padrão | Exemplo |
| --- | --- | --- |
| Funcionalidade | `feat/<feature>` | `feat/importar-markdown` |
| Correção | `fix/<fix>` | `fix/gemini-rate-limit` |
| Documentação | `docs/<assunto>` | `docs/deploy-oci` |
| Manutenção | `chore/<assunto>` | `chore/branching-workflow` |
| Refatoração | `refactor/<assunto>` | `refactor/material-repository` |
| Testes | `test/<assunto>` | `test/extraction-worker` |
| CI/CD | `ci/<assunto>` | `ci/cache-docker` |
| Performance | `perf/<assunto>` | `perf/material-query` |
| Correção urgente | `hotfix/<assunto>` | `hotfix/auth-validation` |

Use nomes em minúsculas, separados por hífen e sem espaços.

## Fluxo obrigatório

1. Atualize `development` e crie a branch tipada.
2. Faça commits pequenos e execute os testes localmente.
3. Envie a branch e abra PR para `development`.
4. Aguarde o CI e faça o merge somente com os checks verdes.
5. Quando a versão estiver pronta, abra PR de `development` para `main`.
6. O merge em `main` executa novamente o CI e dispara o deploy de produção.

```bash
git switch development
git pull --ff-only origin development
git switch -c feat/minha-feature
# desenvolver, testar e commitar
git push -u origin feat/minha-feature
```

Não faça push direto em `development` ou `main`. O PR para `main` deve ter `development` como origem.

## GitHub Actions

- PRs para `development` e `main` executam typecheck, testes e validações de build.
- Push após merge em `development` executa CI, mas não publica produção.
- Push após merge em `main` executa CI e o workflow de produção.
- O workflow de deploy recusa execução fora de `main`, inclusive quando iniciado manualmente.

Configure regras de proteção no GitHub para exigir PR, checks verdes e bloquear push direto nas duas branches.
