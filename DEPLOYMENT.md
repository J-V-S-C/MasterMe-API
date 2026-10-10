# Deploy e CI/CD do MasterMe

## Arquitetura recomendada

- Frontend Next.js 16 no Cloudflare Workers, via vinext.
- Backend, worker e uploads em uma VM OCI existente de 1 GB.
- Imagem única do backend publicada no GitHub Container Registry (GHCR).
- GitHub Actions executa typecheck, testes e builds antes dos deploys.

Essa divisão mantém API, worker e uploads no host persistente, enquanto o PostgreSQL roda no Supabase. O frontend não é um site estático: ele usa SSR, rewrites e um route handler para o stream SSE.

## 1. Publicar o repositório

Backend e frontend são repositórios independentes e já possuem os remotes `MasterMe-API` e `MasterMe-Front`. Faça commit e push das alterações em cada um separadamente. O arquivo `.env` do backend é ignorado pelo Git e pelo contexto Docker; nunca use `git add -f` nele.

## 2. Configurar a OCI

Antes da VM, crie um projeto gratuito no Supabase e abra **Connect**. Copie a URL de **Session pooler**, porta 5432, porque ela funciona em redes IPv4 e preserva sessões usadas pelo backend persistente. Inclua `sslmode=require` e, se a senha possuir caracteres reservados, use a versão codificada para URL.

Execute as migrações uma vez a partir do backend local:

```bash
DATABASE_URL='URL_DO_SESSION_POOLER' bun run migrate
```

O plano gratuito possui limite de 500 MB de banco e pode pausar projetos com baixa atividade. API e worker usam pools separados de até três conexões cada (`DATABASE_POOL_MAX=3`).

A VM precisa ter Docker Engine, o plugin Docker Compose e um proxy reverso HTTPS já instalado (Caddy, Nginx ou Traefik). O proxy deve encaminhar o domínio da API para `127.0.0.1:3333` e preservar conexões longas para `/api/events`.

Na VM:

```bash
sudo install -d -m 750 -o "$USER" /opt/masterme
cp deploy/.env.example /opt/masterme/.env
chmod 600 /opt/masterme/.env
```

Edite `/opt/masterme/.env` e preencha a URL do Session pooler do Supabase e a chave Gemini. Não copie a chave para o GitHub nem para o frontend.
Configure `PUBLIC_APP_URL` com a origem HTTPS canônica do frontend, sem path,
query ou fragmento. Defina `AI_GLOBAL_DAILY_CREDIT_LIMIT` conforme o orçamento
diário e mantenha `AI_CREDITS_ENABLED=true`; alterar para `false` é o kill
switch imediato de novas tentativas no provedor.
Configure também `METRICS_BEARER_TOKEN` com um valor aleatório de no mínimo 32
caracteres e mantenha `/metrics` acessível somente por loopback ou rede privada.
`OBSERVABILITY_DB_TIMEOUT_MS=1000` limita as sondagens de readiness/coleta.

Para habilitar cobrança, ative o Checkout Integrado no painel InfinitePay e
configure `INFINITEPAY_HANDLE` com a InfiniteTag sem `$`. Sem essa variável,
catálogo, plano gratuito e estudo dentro dos créditos existentes continuam
disponíveis, mas criação e reconciliação de checkout retornam `503`. O backend
usa apenas os endpoints fixos `api.checkout.infinitepay.io`, com timeout e
resposta limitada. O contrato deve ser conferido na
[documentação oficial do Checkout Integrado](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay)
antes de alterações no payload ou nos endpoints.

Crie uma chave SSH exclusiva para o deploy. Cadastre a chave pública em `~/.ssh/authorized_keys` do usuário de deploy e dê a esse usuário acesso ao Docker. Obtenha a linha segura para `known_hosts` diretamente do console/host administrado; não aceite uma chave desconhecida automaticamente durante o workflow.

## 3. Secrets e variável do GitHub

Crie o Environment `production` nos dois repositórios. No `MasterMe-API`, adicione os secrets da OCI e do GHCR. No `MasterMe-Front`, adicione os secrets Cloudflare e a variável `BACKEND_URL`.

| Nome | Tipo | Conteúdo |
|---|---|---|
| `BACKEND_URL` (`MasterMe-Front`) | Variable | URL HTTPS pública da API, sem barra final |
| `CLOUDFLARE_ACCOUNT_ID` (`MasterMe-Front`) | Secret | ID da conta Cloudflare |
| `CLOUDFLARE_API_TOKEN` (`MasterMe-Front`) | Secret | Token limitado a editar Workers |
| `OCI_HOST` | Secret | IP ou hostname da VM |
| `OCI_SSH_USER` | Secret | Usuário SSH de deploy |
| `OCI_SSH_KEY` | Secret | Chave privada SSH exclusiva do deploy |
| `OCI_KNOWN_HOSTS` | Secret | Linha conhecida da host key SSH |

O token Cloudflare não deve ter permissões globais. Restrinja-o à conta e ao Worker usados pelo projeto.

## 4. DNS e proxy reverso

Crie, por exemplo, `api.seudominio.com` apontando para a VM. Exemplo Caddy:

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

O Caddy mantém streaming por padrão. Em Nginx, desative buffering no endpoint SSE (`proxy_buffering off`). Libere somente `80/tcp` e `443/tcp` publicamente; a porta 3333 fica ligada ao loopback.
Configure também rate limiting no proxy para `/api`, especialmente em uploads e conexões SSE. Os limites em memória da aplicação protegem a instância atual, mas não substituem uma barreira distribuída caso a API seja escalada horizontalmente.
O teto de corpo no proxy é obrigatório: ele interrompe multipart abusivo antes
de o payload alcançar o processo Bun. Mantenha-o pouco acima dos 8 MiB aceitos
pela API apenas para comportar os headers e campos do formulário. Configure
também timeout de leitura no proxy para impedir uploads lentos indefinidos.
O webhook `/api/billing/webhooks/infinitepay` aceita no máximo 16 KiB dentro da
API. Se o proxy permitir regras por rota, aplique o mesmo teto e rate limit
próprio. Não exija autenticação do usuário nesse endpoint: o payload público
não concede acesso; ele apenas agenda a confirmação ativa via `payment_check`.
Uma rajada de webhooks é coalescida pelo processo. Leases no PostgreSQL
limitam o conjunto das réplicas a cinco reconciliações ativas, com no máximo
uma por pedido, e expiram em cinco minutos para recuperação após crash. A
admissão máxima de cinco pendências por pedido também é serializada no banco.
Uma resposta `paid=false` fica terminal; replay idêntico não reabre o evento,
e somente um webhook com sinal novo cria outra tentativa.

## 5. Primeiro lançamento

1. Na branch `main`, execute manualmente o workflow `Deploy backend to OCI`.
2. Confirme `/health` pelo domínio público e `/ready` via loopback na VM. O
   deploy usa readiness como gate; o healthcheck Docker permanece em liveness.
3. Execute `Deploy frontend to Cloudflare`.
4. No Cloudflare, associe o domínio do frontend ao Worker `masterme-frontend`.
5. Faça upload de um PDF pequeno, acompanhe o SSE, cancele uma extração e rode uma extração completa.
6. Com `INFINITEPAY_HANDLE` configurado, crie um pedido controlado, conclua o
   pagamento, chame a reconciliação autenticada e confirme que uma repetição
   não amplia a vigência nem os créditos.

Depois do primeiro lançamento, pushes em `main` fazem deploy automático. A
execução manual também é recusada fora de `main`; pull requests executam somente
CI.

O comando `bun run migrate` serializa execuções com advisory lock e registra
nome/checksum em `schema_migrations`. Instalações anteriores completas recebem
um baseline seguro até `012`; schema parcial ou migração já aplicada que mudou
é bloqueado para impedir reaplicação destrutiva.
O workflow de CI sobe PostgreSQL descartável e define
`MIGRATION_TEST_REQUIRED=true`; remover a URL de teste faz a suíte falhar em vez
de ignorar os invariantes de tiers, repetição, concorrência e webhook.
Além disso, o CI audita apenas as dependências de produção, constrói a imagem
Linux/amd64 somente com essas dependências e sobe o artefato com filesystem
somente leitura, capabilities
removidas e PostgreSQL descartável. As migrações já validadas pela integração
PostgreSQL são reutilizadas pelo smoke, que inicia o mesmo artefato com o comando
da API (sem tentar apontar o runner de produção para o banco local), exige
`/health` e `/ready` verdes, confirma `401` sem bearer e valida a exposição
Prometheus somente com o token de teste. O deploy repete a suíte com
outro PostgreSQL descartável, a auditoria, o Compose e o mesmo smoke em uma
imagem amd64 antes de autenticar no registry ou publicar. Assim um push em
`main` não depende da ordem entre workflows paralelos: o próprio CD possui o
gate completo. Builds multi-arquitetura permanecem exclusivos da
promoção para não duplicar custo em cada pull request.

## Rollback

Cada backend é publicado com a tag imutável do SHA do commit. Para rollback, execute na VM usando um SHA anterior:

```bash
cd /opt/masterme
MASTERME_IMAGE=ghcr.io/OWNER/masterme-backend:COMMIT_SHA docker compose --env-file .env -f compose.yml up -d
```

Os dados permanecem no Supabase e os uploads no volume Docker. Antes de mudanças de schema destrutivas, faça backup do banco no Supabase e do volume de uploads; as migrações atuais rodam antes da troca dos containers.

O rollback da aplicação preserva pedidos, eventos, concessões e entitlements
da migração `014`; não remova essas tabelas. Em incidente de custo, use primeiro
`AI_CREDITS_ENABLED=false`. Em incidente isolado no checkout, remova
`INFINITEPAY_HANDLE`; isso não revoga entitlements já confirmados.

O workflow captura a imagem atualmente executada antes da troca em
`/opt/masterme/.previous-image`. Se a nova API não passar em `/ready`,
`deploy/deploy-and-verify.sh` restaura automaticamente essa imagem na API e no
worker. O workflow continua falhando com o código original da readiness mesmo
se o rollback também falhar, para não mascarar o incidente. Falhas anteriores
ao gate (pull, migração ou `compose up`) interrompem o script sem declarar um
rollback bem-sucedido; use o procedimento manual acima após diagnosticar o
estado, lembrando que migrações são aditivas e não são revertidas pelo script.

## Alternativa se a OCI estiver sem capacidade

Use uma VM que já exista e compartilhe-a com os demais apps por meio do proxy reverso. O Compose limita a API a 384 MiB, o worker a 256 MiB e processa uma extração por vez. Configure 1–2 GB de swap na VM para absorver picos do parser de PDF. Plataformas que suspendem o container não são adequadas para este worker, SSE e uploads locais sem antes migrar uploads para object storage.
