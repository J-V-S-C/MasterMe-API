export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'Socratic Game API', version: '0.1.0' },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: { '200': { description: 'API ativa' } },
      },
    },
    '/api/materials': {
      post: {
        summary: 'Cria material',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'content'],
                properties: {
                  title: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Material criado' },
          '400': { description: 'Payload inválido' },
        },
      },
      get: {
        summary: 'Lista de Materiais',
        responses: { '200': { description: 'Materiais' } },
      },
    },
    '/api/materials/upload': {
      post: { summary: 'Envia PDF, Markdown ou TXT para processamento assíncrono', requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, title: { type: 'string' } } } } } }, responses: { '202': { description: 'Material enfileirado' }, '400': { description: 'Arquivo inválido ou sem texto legível' } } },
    },
    '/api/materials/{id}/status': { get: { summary: 'Consulta o status de processamento do material', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Status do material' } } } },
    '/api/events': { get: { summary: 'Eventos SSE de processamento e operações de IA', responses: { '200': { description: 'text/event-stream' } } } },
    '/api/materials/{id}/extract': {
      post: {
        summary: 'Extrai fragmentos do material',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '201': { description: 'Fragmentos extraídos' } },
      },
    },
    '/api/materials/{id}/concepts': {
      get: {
        summary: 'Lista conceitos',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Conceitos' } },
      },
    },
    '/api/materials/{id}/knowledge-map': {
      get: {
        summary: 'Mapa de conhecimento e estado de domínio do material',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Conceitos, dependências e última avaliação' } },
      },
    },
    '/api/concepts/{id}/sessions': {
      post: {
        summary: 'Inicia sessão socrática',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '201': { description: 'Sessão criada' },
          '409': { description: 'Pré-requisito bloqueado' },
        },
      },
    },
    '/api/sessions/{id}/answers': {
      post: {
        summary: 'Avalia resposta inicial',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['answer'],
                properties: { answer: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Avaliação e possível stress test' },
        },
      },
    },
    '/api/sessions/{id}/stress-replies': {
      post: {
        summary: 'Avalia réplica ao stress test',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['answer'],
                properties: { answer: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Sessão atualizada' } },
      },
    },
    '/api/materials/{id}/isomorphic-problem': {
      post: {
        summary: 'Gera problema isomórfico',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '201': { description: 'Problema gerado' } },
      },
    },
    '/api/ai-usage/today': {
      get: {
        summary: 'Uso local de IA registrado hoje, agrupado por modelo e operação',
        responses: { '200': { description: 'Contagem local de chamadas à IA' } },
      },
    },
  },
} as const;
