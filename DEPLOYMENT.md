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
Defina também `AI_DAILY_REQUEST_LIMIT` com a quantidade de tentativas ao provedor permitida por usuário e por dia. O padrão do Compose é 100.

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
  reverse_proxy 127.0.0.1:3333
}
```

O Caddy mantém streaming por padrão. Em Nginx, desative buffering no endpoint SSE (`proxy_buffering off`). Libere somente `80/tcp` e `443/tcp` publicamente; a porta 3333 fica ligada ao loopback.
Configure também rate limiting no proxy para `/api`, especialmente em uploads e conexões SSE. Os limites em memória da aplicação protegem a instância atual, mas não substituem uma barreira distribuída caso a API seja escalada horizontalmente.

## 5. Primeiro lançamento

1. Execute manualmente o workflow `Deploy backend to OCI`.
2. Confirme `https://api.seudominio.com/health` retornando `{ "status": "ok" }`.
3. Execute `Deploy frontend to Cloudflare`.
4. No Cloudflare, associe o domínio do frontend ao Worker `masterme-frontend`.
5. Faça upload de um PDF pequeno, acompanhe o SSE, cancele uma extração e rode uma extração completa.

Depois do primeiro lançamento, pushes em `main` com mudanças nos respectivos diretórios fazem deploy automático. Pull requests executam somente CI.

## Rollback

Cada backend é publicado com a tag imutável do SHA do commit. Para rollback, execute na VM usando um SHA anterior:

```bash
cd /opt/masterme
MASTERME_IMAGE=ghcr.io/OWNER/masterme-backend:COMMIT_SHA docker compose --env-file .env -f compose.yml up -d
```

Os dados permanecem no Supabase e os uploads no volume Docker. Antes de mudanças de schema destrutivas, faça backup do banco no Supabase e do volume de uploads; as migrações atuais rodam antes da troca dos containers.

## Alternativa se a OCI estiver sem capacidade

Use uma VM que já exista e compartilhe-a com os demais apps por meio do proxy reverso. O Compose limita a API a 384 MiB, o worker a 256 MiB e processa uma extração por vez. Configure 1–2 GB de swap na VM para absorver picos do parser de PDF. Plataformas que suspendem o container não são adequadas para este worker, SSE e uploads locais sem antes migrar uploads para object storage.
