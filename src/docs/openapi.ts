import { MAX_QUESTION_VARIANT } from '../application/study-limits';

export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'MasterMe API', version: '0.1.0' },
  externalDocs: { description: 'Contrato oficial do Checkout Integrado InfinitePay', url: 'https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay' },
  paths: {
    '/api/materials/{id}/sessions': { get: { summary: 'Lista tentativas atuais e históricas de um material próprio para análise', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Conceitos históricos, IDs ativos e sessões existentes; nenhuma nova avaliação é criada' }, '404': { description: 'Material não pertence ao usuário' } } } },
    '/api/learning/concepts/{conceptId}/activity-prompts': { post: { summary: 'Gera ou reutiliza um conjunto de perguntas específicas para o conceito; a primeira geração consome uma chamada de IA', security: [{ bearerAuth: [] }], parameters: [{ name: 'conceptId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'variant', in: 'query', schema: { type: 'integer', minimum: 0, maximum: MAX_QUESTION_VARIANT, default: 0 } }], responses: { '200': { description: 'Perguntas versionadas para o conceito próprio' }, '400': { description: 'Variante inválida' }, '404': { description: 'Conceito não pertence ao usuário' }, '429': { description: 'Limite de IA excedido' } } } },
    '/api/learning/materials/{materialId}/questions': { get: { summary: 'Lista objetivos ativos e versões imutáveis das perguntas respondidas, com fonte e versão da extração', security: [{ bearerAuth: [] }], parameters: [{ name: 'materialId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Objetivos e perguntas do material próprio; conceitos legados usam leitura de compatibilidade' }, '404': { description: 'Material não pertence ao usuário' } } } },
    '/api/learning/materials/{materialId}/drill': { post: { summary: 'Escolhe uma prática focada e gera ou reutiliza sua pergunta específica', security: [{ bearerAuth: [] }], parameters: [{ name: 'materialId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'conceptId', in: 'query', schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Conceito, objetivo, lacuna, critério, pergunta, variante e tentativa anterior quando aplicável' }, '400': { description: 'ID de conceito inválido' }, '404': { description: 'Material ou conceito não pertence ao usuário' }, '409': { description: 'Material sem conceitos extraídos' }, '429': { description: 'Limite de IA excedido' } } } },
    '/api/learning/goals/{id}': { patch: { summary: 'Edita um objetivo próprio, inclusive seu prazo opcional', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Objetivo atualizado' }, '404': { description: 'Objetivo de outra conta ou inexistente' } } } },
    '/api/learning/materials/{materialId}/outline': { get: { summary: 'Índice editorial ordenado, com proveniência e página quando disponíveis', security: [{ bearerAuth: [] }], parameters: [{ name: 'materialId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Unidades editoriais do material; uma unidade integral se a estrutura não for confiável' }, '404': { description: 'Material não pertence ao usuário' } } }, patch: { summary: 'Corrige o índice: preserva âncoras existentes e permite adicionar/remover seções sem progresso', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedRevision', 'units'], properties: { expectedRevision: { type: 'integer', minimum: 0 }, units: { type: 'array', items: { oneOf: [{ type: 'object', required: ['id', 'title'], properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string', nullable: true, maxLength: 160 } } }, { type: 'object', required: ['title', 'startOffset', 'endOffset'], properties: { title: { type: 'string', maxLength: 160 }, startOffset: { type: 'integer', minimum: 0 }, endOffset: { type: 'integer', minimum: 1 } } }] } } } } } } }, responses: { '200': { description: 'Índice corrigido e nova revisão' }, '400': { description: 'Correção inválida' }, '404': { description: 'Material não pertence ao usuário' }, '409': { description: 'Revisão antiga, unidade indisponível ou seção com progresso' } } } },
    '/api/learning/materials/{materialId}/outline-state': { get: { summary: 'Índice editorial e revisão atual para correção segura', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Revisão e unidades com títulos originais e corrigidos' }, '404': { description: 'Material não pertence ao usuário' } } } },
    '/api/learning/today': { get: { summary: 'Sugere até três próximas atividades com motivo e duração, sem criar tarefas', security: [{ bearerAuth: [] }], parameters: [{ name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }, { name: 'timezone', in: 'query', required: true, schema: { type: 'string' } }, { name: 'availableMinutes', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 480 } }], responses: { '200': { description: 'Tarefas agendadas, revisões, lacunas e próxima leitura dentro do tempo disponível' }, '400': { description: 'Data, fuso ou tempo inválido' } } } },
    '/api/learning/materials/{materialId}/reading-position': {
      get: { summary: 'Obtém a posição de leitura do material próprio', security: [{ bearerAuth: [] }], parameters: [{ name: 'materialId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Offset UTF-16 salvo' }, '404': { description: 'Material não pertence ao usuário' } } },
      put: { summary: 'Salva a posição de leitura sem alterar evidências de aprendizagem', security: [{ bearerAuth: [] }], parameters: [{ name: 'materialId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['offset'], properties: { offset: { type: 'integer', minimum: 0 } } } } } }, responses: { '200': { description: 'Posição salva' }, '409': { description: 'Offset além do conteúdo' } } },
    },
    '/api/learning/materials/{materialId}/relations': { get: { summary: 'Relações tipadas e ancoradas de um material', security: [{ bearerAuth: [] }], parameters: [{ name: 'materialId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Relações do material' }, '404': { description: 'Material não pertence ao usuário' } } } },
    '/api/learning/relations': { post: { summary: 'Cria relação justificada pelo estudante entre dois conceitos do mesmo material', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['materialId','fromConceptId','toConceptId','relationType','statement','justification','sourceExcerpt'], properties: { materialId: { type: 'string', format: 'uuid' }, fromConceptId: { type: 'string', format: 'uuid' }, toConceptId: { type: 'string', format: 'uuid' }, relationType: { type: 'string', enum: ['REQUIRES','ENABLES','CONTRASTS','APPLIES_TO','PART_OF'] }, statement: { type: 'string' }, justification: { type: 'string' }, sourceExcerpt: { type: 'string' }, sourceOffset: { type: 'integer', minimum: 0, description: 'Offset UTF-16 do trecho no conteúdo do material quando há repetição' } } } } } }, responses: { '201': { description: 'Relação criada' }, '400': { description: 'Payload inválido' }, '404': { description: 'Recurso de outro usuário' }, '409': { description: 'Trecho sem fonte ou conceitos inválidos' } } } },
    '/api/learning/shelves': { get: { summary: 'Lista prateleiras e materiais associados', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Prateleiras privadas' } } }, post: { summary: 'Cria ou recupera prateleira pelo nome', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 80 } } } } } }, responses: { '201': { description: 'Prateleira persistida' } } } },
    '/api/learning/shelves/{id}': { delete: { summary: 'Remove prateleira sem apagar materiais', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '204': { description: 'Prateleira removida' }, '404': { description: 'Prateleira não encontrada' } } } },
    '/api/learning/shelves/{id}/materials/{materialId}': { put: { summary: 'Coloca material próprio na prateleira de forma idempotente', security: [{ bearerAuth: [] }], responses: { '204': { description: 'Associação salva' }, '404': { description: 'Prateleira ou material não encontrado' } } }, delete: { summary: 'Retira material da prateleira sem apagar o material', security: [{ bearerAuth: [] }], responses: { '204': { description: 'Associação removida' } } } },
    '/api/learning/cards': { get: { summary: 'Lista fichas privadas que referenciam conceitos', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Fichas e fontes' } } } },
    '/api/learning/cards/{conceptId}': { put: { summary: 'Guarda ou atualiza uma ficha sem duplicar o conceito', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Ficha salva' }, '404': { description: 'Conceito não pertence ao usuário' } } }, delete: { summary: 'Remove ficha sem apagar o conceito', security: [{ bearerAuth: [] }], responses: { '204': { description: 'Ficha removida' } } } },
    '/api/learning/goals': { get: { summary: 'Lista objetivos pessoais', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Objetivos' } } }, post: { summary: 'Cria objetivo pessoal com prazo opcional', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Objetivo criado' } } } },
    '/api/learning/plans': { get: { summary: 'Lista roteiros com materiais ordenados', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Roteiros privados' } } }, post: { summary: 'Cria roteiro a partir de objetivo e coleção ordenada de materiais próprios', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Roteiro criado' }, '404': { description: 'Objetivo ou material não pertence ao usuário' } } } },
    '/api/learning/plans/{id}': { patch: { summary: 'Edita título, objetivo ou ordem dos materiais de um roteiro próprio', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Roteiro atualizado' }, '404': { description: 'Roteiro ou referência não pertence ao usuário' } } } },
    '/api/learning/plans/{id}/tasks/order': { put: { summary: 'Reordena atomicamente todas as tarefas ativas do roteiro próprio, sem alterar a sequência editorial', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['taskIds'], properties: { taskIds: { type: 'array', uniqueItems: true, items: { type: 'string', format: 'uuid' } } } } } } }, responses: { '200': { description: 'Tarefas na nova ordem' }, '404': { description: 'Roteiro não pertence ao usuário' }, '409': { description: 'A lista mudou ou não contém todas as tarefas ativas' } } } },
    '/api/learning/tasks': { get: { summary: 'Lista tarefas e estados sem inferir aprendizagem de conclusão', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tarefas privadas, incluindo descrição opcional e vínculos' } } }, post: { summary: 'Cria tarefa com descrição opcional, vinculável a roteiro, material, unidade, conceito, revisão ou projeto próprio', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'activityType'], properties: { title: { type: 'string', maxLength: 160 }, description: { type: 'string', maxLength: 500 }, activityType: { type: 'string', enum: ['READ', 'EXPLAIN', 'RELATE', 'APPLY', 'REVISIT', 'PRACTICE'] }, planId: { type: 'string', format: 'uuid' }, materialId: { type: 'string', format: 'uuid' }, conceptId: { type: 'string', format: 'uuid' }, unitId: { type: 'string', format: 'uuid' }, reviewId: { type: 'string', format: 'uuid' }, projectId: { type: 'string', format: 'uuid', description: 'Exige activityType PRACTICE e não aceita reviewId' }, durationMinutes: { type: 'integer', minimum: 1, maximum: 480 }, scheduledAt: { type: 'string', format: 'date-time' }, reason: { type: 'string', maxLength: 500 } } } } } }, responses: { '201': { description: 'Tarefa criada' }, '400': { description: 'Tipo ou combinação de vínculos inválidos' }, '404': { description: 'Referência não pertence ao usuário' } } } },
    '/api/learning/tasks/order': { put: { summary: 'Reordena todas as tarefas ativas e altera etapas do quadro atomicamente', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['taskIds'], properties: { taskIds: { type: 'array', uniqueItems: true, items: { type: 'string', format: 'uuid' } }, statuses: { type: 'object', additionalProperties: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'DONE'] } } } } } } }, responses: { '200': { description: 'Tarefas e etapas na nova ordem' }, '409': { description: 'A lista mudou ou não contém todas as tarefas ativas' } } } },
    '/api/learning/tasks/{id}': { patch: { summary: 'Edita título, descrição, material, conceito, projeto, duração, agenda ou estado da tarefa', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', minProperties: 1, properties: { title: { type: 'string', maxLength: 160 }, description: { type: 'string', maxLength: 500 }, materialId: { type: 'string', format: 'uuid', nullable: true }, conceptId: { type: 'string', format: 'uuid', nullable: true }, projectId: { type: 'string', format: 'uuid', nullable: true }, durationMinutes: { type: 'integer', minimum: 1, maximum: 480, nullable: true }, scheduledAt: { type: 'string', format: 'date-time', nullable: true }, status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'DONE', 'REMOVED'] } } } } } }, responses: { '200': { description: 'Tarefa atualizada' }, '404': { description: 'Tarefa ou referência não encontrada' }, '409': { description: 'Projeto exige tarefa de prática sem revisão' } } } },
    '/api/learning/availability': { get: { summary: 'Lista disponibilidade semanal do estudante', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Minutos por dia da semana e timezone' } } }, put: { summary: 'Salva disponibilidade de um dia da semana', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Disponibilidade salva' } } } },
    '/api/learning/desk': { get: { summary: 'Mesa do Dia com tarefas e carga em timezone explícito', security: [{ bearerAuth: [] }], parameters: [{ name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }, { name: 'timezone', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Tarefas, minutos disponíveis e excesso sem reagendamento automático' } } } },
    '/api/learning/reviews/due': { get: { summary: 'Lista revisões vencidas como sugestões, sem alterar a agenda', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Revisões com conceito, material, último diagnóstico e intervalo atual' } } } },
    '/api/learning/reviews/{id}/reminder': { post: { summary: 'Adia ou dispensa uma revisão própria sem concluir aprendizagem', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [{ type: 'object', required: ['action', 'days'], properties: { action: { type: 'string', enum: ['POSTPONE'] }, days: { type: 'integer', minimum: 1, maximum: 30 } }, additionalProperties: false }, { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['SKIP'] } }, additionalProperties: false }] } } } }, responses: { '200': { description: 'Estado e vencimento atualizados; repetir a decisão não cria outra revisão' }, '404': { description: 'Revisão não pertence ao usuário' }, '409': { description: 'A revisão mudou durante a decisão' } } } },
    '/api/learning/materials/{materialId}/evidence': { get: { summary: 'Histórico de evidências distintas por atividade', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tentativas com pergunta, versão, critérios, pistas, ajuda, solução revelada, feedback estruturado, revisão e fonte' } } } },
    '/api/learning/evidence': { post: { summary: 'Registra apenas evidência declarada ou contestação; cliente não aprova avaliação', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Evidência registrada' }, '400': { description: 'Status de avaliação reservado ao servidor' } } } },
    '/api/learning/evidence/{id}/contestations': { post: { summary: 'Contesta diagnóstico sem sobrescrever a avaliação original', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Contestação registrada' }, '404': { description: 'Evidência de outra conta ou inexistente' } } } },
    '/api/learning/activities/answers': { post: { summary: 'Avalia explicação, raciocínio, aplicação ou retomada com perguntas geradas por IA; aceita ajuda, revelação, revisão, questionVariant e attemptContext STUDY ou DRILL', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Evidência com feedback, versão da pergunta, contexto de tentativa e, quando aplicável, agenda de revisão atualizada' }, '400': { description: 'Resposta, variante, ajuda, revisão ou atividade de relação inválidas' }, '404': { description: 'Tentativa anterior ou revisão não pertence ao mesmo material' }, '429': { description: 'Limite de IA excedido' }, '503': { description: 'Verificação de sessão indisponível' } } } },
    '/api/learning/suggestions': { get: { summary: 'Lista recomendações com motivo, pergunta, diagnóstico, fonte e tentativa anterior', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Sugestões privadas' } } } },
    '/api/learning/evidence/{id}/revisit': { post: { summary: 'Solicita retomada de uma tentativa própria sem criar tarefa antes do aceite', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Sugestão existente ou criada de forma idempotente' }, '404': { description: 'Tentativa não pertence ao usuário' } } } },
    '/api/learning/suggestions/{id}/decision': { post: { summary: 'Aceita ou ignora sugestão; aceite cria tarefa uma única vez e pode ajustar título, duração, data e roteiro', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Decisão persistida idempotentemente' }, '404': { description: 'Sugestão ou roteiro não pertence ao usuário' } } } },
    '/health': {
      get: {
        summary: 'Health check',
        responses: { '200': { description: 'API ativa' } },
      },
    },
    '/ready': {
      get: {
        summary: 'Readiness do banco com timeout curto',
        responses: { '200': { description: 'API pronta' }, '503': { description: 'Dependência indisponível' } },
      },
    },
    '/metrics': {
      get: {
        summary: 'Métricas Prometheus operacionais',
        description: 'Somente rede privada/loopback. Responde 404 quando o token operacional não está configurado.',
        security: [{ metricsBearer: [] }],
        responses: { '200': { description: 'Prometheus text format' }, '401': { description: 'Bearer operacional inválido' }, '404': { description: 'Coleta desabilitada' } },
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
                  materialKind: { type: 'string', enum: ['BOOK', 'ARTICLE', 'TEXT'], default: 'TEXT' },
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
      post: { summary: 'Envia PDF, Markdown ou TXT para processamento assíncrono', description: 'Aceita um arquivo de até 20 MiB. PDFs são limitados a 800 páginas. Livros longos são extraídos em partes; cada chamada ao Gemini consome um crédito. Texto colado tem limite separado de 500.000 caracteres. Cada conta pode iniciar até 8 uploads por 15 minutos e 24 por janela de 24 horas. O tipo do material pode ser informado ou inferido a partir da estrutura.', requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], additionalProperties: false, properties: { file: { type: 'string', format: 'binary' }, title: { type: 'string', maxLength: 160 }, locale: { type: 'string', enum: ['pt-BR', 'en-US'], default: 'pt-BR' }, materialKind: { type: 'string', enum: ['BOOK', 'ARTICLE', 'TEXT'] } } } } } }, responses: { '202': { description: 'Material enfileirado' }, '400': { description: 'Arquivo inválido, ausente ou sem texto legível' }, '408': { description: 'PDF excedeu o tempo seguro de parsing' }, '413': { description: 'Arquivo acima de 20 MiB ou PDF acima de 800 páginas' }, '429': { description: 'Limite de frequência, concorrência ou volume diário de upload' }, '503': { description: 'Resultado do commit não pôde ser confirmado; consulte os materiais antes de reenviar' } } },
    },
    '/api/materials/{id}/file': { get: { summary: 'Entrega o PDF original do material ao proprietário', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Bytes do PDF original', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, '404': { description: 'Material não encontrado, não pertence ao usuário ou não tem PDF' } } } },
    '/api/materials/{id}/kind': { patch: { summary: 'Corrige a classificação de um material próprio sem alterar conteúdo ou histórico', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['materialKind'], additionalProperties: false, properties: { materialKind: { type: 'string', enum: ['BOOK', 'ARTICLE', 'TEXT'] } } } } } }, responses: { '200': { description: 'Material atualizado' }, '400': { description: 'Tipo inválido' }, '404': { description: 'Material não encontrado ou pertence a outra conta' }, '409': { description: 'Extração em andamento; cancele antes de alterar o tipo' } } } },
    '/api/materials/{id}': { delete: { summary: 'Remove o material próprio e seu histórico; a limpeza do arquivo original é durável e assíncrona', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '204': { description: 'Material e histórico removidos' }, '404': { description: 'Material não pertence ao usuário' }, '409': { description: 'Extração ainda ativa' } } } },
    '/api/materials/{id}/status': { get: { summary: 'Consulta o status de processamento do material próprio', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Status e progresso da extração; a lista anterior continua ativa até a nova extração terminar' }, '404': { description: 'Material não pertence ao usuário' } } } },
    '/api/events': { get: { summary: 'Eventos SSE de processamento e operações de IA', responses: { '200': { description: 'text/event-stream' } } } },
    '/api/processing/overview': { get: { summary: 'Resumo operacional da fila de processamento', responses: { '200': { description: 'Contagens de jobs e processamento mais antigo' } } } },
    '/api/materials/{id}/extract/preview': { get: { summary: 'Estima tópicos e créditos de uma nova extração sem consumir IA nem alterar o material', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Tópicos planejados, créditos base estimados e indicação de reparo do índice de texto' }, '404': { description: 'Material não pertence ao usuário' } } } },
    '/api/materials/{id}/extract': {
      post: {
        summary: 'Enfileira a extração do material próprio; o PDF original e as respostas salvas permanecem intactos',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '202': { description: 'Extração enfileirada ou retomada' }, '404': { description: 'Material não pertence ao usuário' } },
      },
      delete: {
        summary: 'Cancela uma extração ativa',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id', in: 'path', required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Extração cancelada; o conjunto anterior continua disponível' }, '404': { description: 'Material não pertence ao usuário' }, '409': { description: 'Não há extração ativa' } },
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
      get: {
        summary: 'Lista tentativas salvas de um conceito, da mais recente para a mais antiga',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Sessões e respostas anteriores preservadas' }, '404': { description: 'Conceito não encontrado ou não pertence ao usuário' } },
      },
      post: {
        summary: 'Inicia sessão e gera ou reutiliza um conjunto de perguntas específicas para o conceito (até uma chamada de IA)',
        description: 'A pergunta é gerada para o conceito e seu trecho de origem, podendo parafrasear o material sem entregar a resposta. O servidor preserva a pergunta gerada e as tentativas anteriores; não substitui a pergunta por um modelo genérico.',
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
          '404': { description: 'Conceito não pertence ao usuário' },
          '409': { description: 'Transição inválida' },
          '429': { description: 'Limite de IA excedido' },
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
                properties: {
                  answer: { type: 'string' },
                  assisted: { type: 'boolean', default: false },
                  assistanceLevel: { type: 'integer', minimum: 0, maximum: 4, default: 0 },
                  hintsUsed: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 200 } },
                  solutionRevealed: { type: 'boolean', default: false },
                },
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
        summary: 'Catálogo público de planos e custo por tentativa de IA',
        description: 'Sem INFINITEPAY_HANDLE, retorna somente FREE. Com pagamentos ativos, expõe preços definidos pelo servidor; Essencial e Pro são pagamentos únicos.',
        responses: { '200': { description: 'Catálogo público cacheável' } },
      },
    },
    '/api/billing/checkouts': {
      post: {
        summary: 'Cria ou recupera checkout InfinitePay idempotente',
        description: 'Disponível somente com INFINITEPAY_HANDLE. O servidor determina preço, descrição, redirect e webhook. O cliente envia somente um planId conhecido.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['planId'], properties: { planId: { type: 'string', enum: ['ESSENTIAL', 'PRO'] } } } } } },
        responses: {
          '200': { description: 'Checkout idempotente já existente' },
          '201': { description: 'Pedido criado' },
          '400': { description: 'Plano ou chave de idempotência inválidos' },
          '409': { description: 'Chave reutilizada para outro plano ou checkout ainda em criação' },
          '429': { description: 'Limite de criação/reconciliação de checkout' },
          '404': { description: 'Pagamentos desativados' },
          '503': { description: 'InfinitePay não configurada ou estado do pedido indisponível' },
        },
      },
    },
    '/api/billing/webhooks/infinitepay': {
      post: {
        summary: 'Recebe sinal público de pagamento da InfinitePay',
        description: 'Disponível somente com INFINITEPAY_HANDLE. Payload limitado a 16 KiB. Nunca concede entitlement diretamente; agenda payment_check server-to-server. Replay idêntico é idempotente e não reabre evento terminal.',
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
        responses: { '200': { description: 'Evento novo persistido ou replay idempotente aceito; reconciliação sinalizada' }, '400': { description: 'Payload inválido ou pedido inexistente' }, '404': { description: 'Pagamentos desativados' }, '413': { description: 'Payload acima de 16 KiB' }, '429': { description: 'Limite por IP ou cinco eventos pendentes para o pedido' } },
      },
    },
    '/api/billing/orders/{id}/reconcile': {
      post: {
        summary: 'Reconcilia pagamento de pedido do usuário',
        description: 'Disponível somente com INFINITEPAY_HANDLE. Confirma status e valor com payment_check antes de conceder entitlement. Repetições não duplicam vigência ou créditos.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { transactionNsu: { type: 'string', maxLength: 160 }, slug: { type: 'string', maxLength: 160 } } } } } },
        responses: { '200': { description: 'Estado autoritativo do pedido' }, '400': { description: 'Referência ausente ou inválida' }, '404': { description: 'Pedido não encontrado, ou pagamentos desativados' }, '409': { description: 'Pagamento pendente, valor divergente ou transação já usada' }, '429': { description: 'Limite de reconciliações' }, '503': { description: 'InfinitePay não configurada' } },
      },
    },
    '/api/billing/me': {
      get: {
        summary: 'Entitlement, saldo e estimativas conservadoras do usuário',
        description: 'No plano gratuito, somente o limite diário se aplica e os campos de período repetem o dia por compatibilidade. Planos pagos mantêm o limite da vigência. Pro tem prioridade quando os dois tiers estão ativos, sem incorporar saldo ou vigência Essencial. Estimativas consideram o número máximo configurado de tentativas/fallbacks.',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Plano efetivo, vigência, créditos usados/restantes, pesos e estimativas por operação' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      metricsBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque operational token' },
    },
  },
} as const;
