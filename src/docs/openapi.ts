export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'MasterMe API', version: '0.1.0' },
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
                  locale: { type: 'string', enum: ['pt-BR', 'en-US'], default: 'pt-BR' },
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
    '/api/processing/overview': { get: { summary: 'Resumo operacional da fila de processamento', responses: { '200': { description: 'Contagens de jobs e processamento mais antigo' } } } },
    '/api/materials/{id}/extract': {
      post: {
        summary: 'Enfileira a extração do material',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '202': { description: 'Extração enfileirada' } },
      },
      delete: {
        summary: 'Cancela uma extração ativa',
        parameters: [
          {
            name: 'id', in: 'path', required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Extração cancelada' }, '409': { description: 'Não há extração ativa' } },
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
    '/api/materials/{id}/localize': {
      post: {
        summary: 'Localiza campos gerados sem alterar evidências, IDs ou histórico',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['locale'], properties: { locale: { type: 'string', enum: ['pt-BR', 'en-US'] } } } } } },
        responses: { '200': { description: 'Conceitos localizados' }, '409': { description: 'Material ainda não extraído ou localização incompatível' } },
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
        summary: 'Inicia sessão de estudo guiado',
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
          '409': { description: 'Transição inválida' },
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
          '200': { description: 'Avaliação; PASSED conclui a explicação sem criar caso-limite' },
        },
      },
    },
    '/api/sessions/{id}/edge-case': { post: { summary: 'Cria ou recupera um Teste de caso-limite opt-in', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Sessão com caso-limite' }, '409': { description: 'Explicação ainda não aprovada' } } } },
    '/api/sessions/{id}/edge-case/answers': { post: { summary: 'Avalia resposta ao caso-limite sem alterar a aprovação da explicação', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string', minLength: 20 } } } } } }, responses: { '200': { description: 'Estado separado do caso-limite' }, '409': { description: 'Transição inválida' } } } },
    '/api/materials/{id}/confidences': { get: { summary: 'Lista autoconfianças existentes do material', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Autoconfianças' } } } },
    '/api/concepts/{id}/confidence': { put: { summary: 'Cria ou atualiza autoconfiança de 1 a 5', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['value'], properties: { value: { type: 'integer', minimum: 1, maximum: 5 } } } } } }, responses: { '200': { description: 'Autoconfiança persistida' }, '400': { description: 'Valor inválido' } } }, delete: { summary: 'Remove a autoconfiança', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '204': { description: 'Removida' } } } },
    '/api/materials/{id}/performance': { get: { summary: 'Desempenho determinístico por conceito usando apenas tentativas iniciais', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Contagens, histórico e necessidade baseada na tentativa inicial mais recente' } } } },
    '/api/materials/{id}/practice-focus': { post: { summary: 'Pré-visualiza até três dificuldades ativas sem consumir IA', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['focusMode'], properties: { focusMode: { type: 'string', enum: ['OVERVIEW','MANUAL','CONFIDENCE','PERFORMANCE','COMBINED'] }, conceptIds: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', format: 'uuid' } } } } } } }, responses: { '200': { description: 'Conceitos priorizados e justificativas' }, '422': { description: 'Sinal indisponível ou nenhuma dificuldade ativa' } } } },
    '/api/materials/{id}/practice-projects': { get: { summary: 'Lista Projetos de prática mais recentes primeiro', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Projetos' } } }, post: { summary: 'Gera ou recupera do cache um Projeto de prática', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['focusMode'], properties: { focusMode: { type: 'string', enum: ['OVERVIEW','MANUAL','CONFIDENCE','PERFORMANCE','COMBINED'] }, conceptIds: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', format: 'uuid' } } } } } } }, responses: { '201': { description: 'Projeto de prática' }, '400': { description: 'Payload inválido' }, '422': { description: 'Sinal escolhido sem dados' } } } },
    '/api/practice-projects/{id}': { get: { summary: 'Recupera um Projeto de prática', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Projeto' }, '404': { description: 'Não encontrado' } } } },
    '/api/sessions/{id}/stress-replies': {
      post: {
        summary: 'Compatibilidade temporária: avalia resposta ao caso-limite',
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
      get: {
        summary: 'Consulta problema isomórfico em cache para o estado atual do material',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Problema salvo ou null' } },
      },
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
        summary: 'Uso de IA do usuário autenticado, quota restante e renovação',
        responses: { '200': { description: 'Contagem por operação/modelo e quota diária interna' } },
      },
    },
  },
} as const;
