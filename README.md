# Socratic Game — Backend

Backend do MVP para estudar documentação e conceitos de engenharia de software
por inquirição socrática. O modelo recebe apenas os fragmentos JSON e trechos
do material fornecido; não há RAG, embeddings ou LangGraph.

## Executar

```bash
bun install
cp .env.example .env
# preencha GEMINI_API_KEY
bun run dev
```

```bash
bun run typecheck
bun test
bun run migrate
```

## Rotas

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/health` | Health check. |
| POST | `/api/materials` | Cria material a partir de `title` e `content`. |
| POST | `/api/materials/upload` | Envia PDF, Markdown ou TXT e retorna o material enfileirado. |
| GET | `/api/materials/:id/status` | Consulta processamento assíncrono. |
| GET | `/api/events` | Eventos SSE de jobs e operações. |
| GET | `/api/materials` | Lista todos os materiais em `{ data: [...] }`; retorna lista vazia quando não há materiais. |
| GET | `/api/materials/:id` | Recupera material. |
| POST | `/api/materials/:id/extract` | Extrai axiomas, nós e pontas em JSON. |
| GET | `/api/materials/:id/concepts` | Lista fragmentos e dependências. |
| POST | `/api/concepts/:id/sessions` | Inicia pergunta para conceito desbloqueado. |
| GET | `/api/sessions/:id` | Consulta sessão e tentativas. |
| POST | `/api/sessions/:id/answers` | Avalia resposta inicial. |
| POST | `/api/sessions/:id/stress-replies` | Avalia a réplica ao contra-exemplo. |
| POST | `/api/materials/:id/isomorphic-problem` | Gera problema arquitetural isomórfico. |

Abra [Swagger UI](http://localhost:3333/docs) após iniciar a API. A especificação
bruta está em `/openapi.json`.

## Docker

No diretório raiz, configure `GEMINI_API_KEY` no ambiente e execute:

```bash
docker compose up --build
```

O Compose inicia PostgreSQL, a API e o worker de processamento, executando a
migração antes de subir o servidor. A API fica disponível em
`http://localhost:3333`. O volume `postgres_data` preserva os dados entre
reinicializações.

O frontend é executado localmente, fora do Docker:

```bash
cd ../frontend
bun run dev
```

Ele estará disponível em `http://localhost:3000` e usa a API local em
`http://localhost:3333` por padrão.

Exemplo de criação de material:

```json
{
  "title": "Injeção de dependência",
  "content": "Módulos de alto nível devem depender de abstrações..."
}
```

## Limites atuais

- Os arquivos brutos ficam em volume Docker local, encapsulado pelo adapter
  `LocalMaterialStorage`. Isso é temporário e **não é adequado para produção**
  ou múltiplas instâncias; substituir por object storage antes do deploy.
- PDFs sem camada de texto são rejeitados. OCR, embeddings, RAG e LaTeX não
  fazem parte deste MVP.
- Não existe autenticação nem suporte a múltiplos usuários no MVP.
