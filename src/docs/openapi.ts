export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'MasterMe API', version: '0.1.0' },
  externalDocs: { description: 'Contrato oficial do Checkout Integrado InfinitePay', url: 'https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay' },
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
        summary: 'Lista metadados dos Materiais sem o conteúdo integral',
        responses: { '200': { description: 'Resumos privados e revalidáveis por ETag' } },
      },
    },
    '/api/materials/upload': {
      post: { summary: 'Envia PDF, Markdown ou TXT para processamento assíncrono', description: 'Aceita um arquivo de até 8 MiB. O texto extraído é limitado a 100.000 caracteres e PDFs a 120 páginas. Cada conta pode iniciar até 8 uploads por 15 minutos e 24 por janela de 24 horas.', requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], additionalProperties: false, properties: { file: { type: 'string', format: 'binary' }, title: { type: 'string', maxLength: 160 }, locale: { type: 'string', enum: ['pt-BR', 'en-US'], default: 'pt-BR' } } } } } }, responses: { '202': { description: 'Material enfileirado' }, '400': { description: 'Arquivo inválido, ausente ou sem texto legível' }, '408': { description: 'PDF excedeu o tempo seguro de parsing' }, '413': { description: 'Arquivo acima de 8 MiB, texto acima de 100.000 caracteres ou PDF acima de 120 páginas' }, '429': { description: 'Limite de frequência, concorrência ou volume diário de upload' }, '503': { description: 'Resultado do commit não pôde ser confirmado; consulte os materiais antes de reenviar' } } },
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
          '409': { description: 'SESSION_CONFLICT: outra solicitação alterou ou está alterando a sessão; recarregue antes de tentar novamente' },
        },
      },
    },
    '/api/sessions/{id}/edge-case': { post: { summary: 'Cria ou recupera um Teste de caso-limite opt-in', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Sessão com caso-limite' }, '409': { description: 'Transição inválida ou SESSION_CONFLICT; recarregue a sessão antes de repetir' } } } },
    '/api/sessions/{id}/edge-case/answers': { post: { summary: 'Avalia resposta ao caso-limite sem alterar a aprovação da explicação', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string', minLength: 20 } } } } } }, responses: { '200': { description: 'Estado separado do caso-limite' }, '409': { description: 'Transição inválida ou SESSION_CONFLICT; recarregue a sessão antes de repetir' } } } },
    '/api/materials/{id}/confidences': { get: { summary: 'Lista autoconfianças existentes do material', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Autoconfianças' } } } },
    '/api/concepts/{id}/confidence': { put: { summary: 'Cria ou atualiza autoconfiança de 1 a 5', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['value'], properties: { value: { type: 'integer', minimum: 1, maximum: 5 } } } } } }, responses: { '200': { description: 'Autoconfiança persistida' }, '400': { description: 'Valor inválido' } } }, delete: { summary: 'Remove a autoconfiança', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '204': { description: 'Removida' } } } },
    '/api/materials/{id}/performance': { get: { summary: 'Desempenho determinístico por conceito usando apenas tentativas iniciais', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Contagens, histórico e necessidade baseada na tentativa inicial mais recente' } } } },
    '/api/materials/{id}/practice-context': { get: { summary: 'Agrega mapa, confiança, desempenho e histórico de projetos em uma leitura', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Contexto completo da tela de prática' } } } },
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
        responses: { '200': { description: 'Sessão atualizada' }, '409': { description: 'Transição inválida ou SESSION_CONFLICT; recarregue a sessão' } },
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
        summary: 'Telemetria legada de uso de IA do usuário autenticado',
        description: 'Compatibilidade temporária para contagem de chamadas e tokens. Use /api/billing/me como fonte autoritativa de saldo e renovação.',
        responses: { '200': { description: 'Contagem por operação/modelo e campos legados de quota' } },
      },
    },
    '/api/billing/catalog': {
      get: {
        summary: 'Catálogo público de planos e pesos de créditos',
        description: 'Expõe preços definidos pelo servidor. Essencial e Pro são pagamentos únicos, sem renovação automática.',
        responses: { '200': { description: 'Catálogo público cacheável' } },
      },
    },
    '/api/billing/checkouts': {
      post: {
        summary: 'Cria ou recupera checkout InfinitePay idempotente',
        description: 'O servidor determina preço, descrição, redirect e webhook. O cliente envia somente um planId conhecido.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['planId'], properties: { planId: { type: 'string', enum: ['ESSENTIAL', 'PRO'] } } } } } },
        responses: {
          '200': { description: 'Checkout idempotente já existente' },
          '201': { description: 'Pedido criado' },
          '400': { description: 'Plano ou chave de idempotência inválidos' },
          '409': { description: 'Chave reutilizada para outro plano ou checkout ainda em criação' },
          '429': { description: 'Limite de criação/reconciliação de checkout' },
          '503': { description: 'InfinitePay não configurada ou estado do pedido indisponível' },
        },
      },
    },
    '/api/billing/webhooks/infinitepay': {
      post: {
        summary: 'Recebe sinal público de pagamento da InfinitePay',
        description: 'Payload limitado a 16 KiB. Nunca concede entitlement diretamente; agenda payment_check server-to-server. Replay idêntico é idempotente e não reabre evento terminal.',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['invoice_slug', 'amount', 'transaction_nsu', 'order_nsu'],
          properties: {
            invoice_slug: { type: 'string', maxLength: 160 },
            amount: { type: 'integer', minimum: 0 },
            paid_amount: { type: 'integer', minimum: 0 },
            transaction_nsu: { type: 'string', maxLength: 160 },
            order_nsu: { type: 'string', format: 'uuid' },
          },
        } } } },
        responses: { '200': { description: 'Evento novo persistido ou replay idempotente aceito; reconciliação sinalizada' }, '400': { description: 'Payload inválido ou pedido inexistente' }, '413': { description: 'Payload acima de 16 KiB' }, '429': { description: 'Limite por IP ou cinco eventos pendentes para o pedido' } },
      },
    },
    '/api/billing/orders/{id}/reconcile': {
      post: {
        summary: 'Reconcilia pagamento de pedido do usuário',
        description: 'Confirma status e valor com payment_check antes de conceder entitlement. Repetições não duplicam vigência ou créditos.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { transactionNsu: { type: 'string', maxLength: 160 }, slug: { type: 'string', maxLength: 160 } } } } } },
        responses: { '200': { description: 'Estado autoritativo do pedido' }, '400': { description: 'Referência ausente ou inválida' }, '404': { description: 'Pedido não encontrado para este usuário' }, '409': { description: 'Pagamento pendente, valor divergente ou transação já usada' }, '429': { description: 'Limite de reconciliações' }, '503': { description: 'InfinitePay não configurada' } },
      },
    },
    '/api/billing/me': {
      get: {
        summary: 'Entitlement, saldo e estimativas conservadoras do usuário',
        description: 'Expõe limites diário e do período do tier efetivo. Pro tem prioridade quando os dois tiers estão ativos, sem incorporar saldo ou vigência Essencial. Estimativas consideram o número máximo configurado de tentativas/fallbacks.',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Plano efetivo, vigência, créditos usados/restantes, pesos e estimativas por operação' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
} as const;
