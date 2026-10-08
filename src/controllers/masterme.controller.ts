import type { RequestHandler } from 'express';
import { type MasterMeService } from '../services/masterme.service';
import {
  AnswerBodySchema,
  ConfidenceBodySchema,
  CreatePracticeProjectBodySchema,
  CreateMaterialBodySchema,
  IdParamsSchema,
  LocaleBodySchema,
  UploadMaterialBodySchema,
} from '../schemas/http.schema';
import { getValidated } from '../middleware/validate-request';
import type { IngestionService } from '../services/ingestion.service';

export class MasterMeController {
  public constructor(private readonly service: MasterMeService, private readonly aiDailyLimit: number) {}

  public readonly createMaterial: RequestHandler = async (_req, res) => {
    const body = getValidated(res, 'body', CreateMaterialBodySchema);
    const material = await this.service.createMaterial(body, res.locals.userId!);
    res.status(201).json({ data: material });
  };

  public readonly getAllMaterials: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.getAllMaterials(res.locals.userId!) });
  };

  public readonly getMaterial: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.json({ data: await this.service.getMaterial(id) });
  };

  public readonly extractConcepts: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    const concepts = await this.service.extractConcepts(id);
    res.status(201).json({ data: concepts });
  };

  public readonly getConcepts: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.json({ data: await this.service.getConcepts(id) });
  };

  public readonly localizeMaterial: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema)
    const { locale } = getValidated(res, 'body', LocaleBodySchema)
    res.json({ data: await this.service.localizeMaterial(id, locale) })
  };

  public readonly getKnowledgeMap: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.json({ data: await this.service.getKnowledgeMap(id) });
  };

  public readonly startSession: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    const session = await this.service.startSession(id);
    res.status(201).json({ data: session });
  };

  public readonly getSession: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.json({ data: await this.service.getSession(id) });
  };

  public readonly evaluateInitialAnswer: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    const { answer } = getValidated(res, 'body', AnswerBodySchema);
    res.json({ data: await this.service.evaluateInitialAnswer(id, answer) });
  };

  public readonly evaluateStressReply: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    const { answer } = getValidated(res, 'body', AnswerBodySchema);
    res.json({ data: await this.service.evaluateStressReply(id, answer) });
  };

  public readonly generateIsomorphicProblem: RequestHandler = async (
    _req,
    res,
  ) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res
      .status(201)
      .json({ data: await this.service.generateIsomorphicProblem(id) });
  };

  public readonly getIsomorphicProblem: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.json({ data: await this.service.getIsomorphicProblem(id) });
  };

  public readonly requestEdgeCase: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); res.json({ data: await this.service.requestEdgeCase(id) }); };

  public readonly evaluateEdgeCaseAnswer: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); const { answer } = getValidated(res, 'body', AnswerBodySchema); res.json({ data: await this.service.evaluateEdgeCaseAnswer(id, answer) }); };

  public readonly getConfidences: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); res.json({ data: await this.service.getConfidences(id) }); };

  public readonly saveConfidence: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); const { value } = getValidated(res, 'body', ConfidenceBodySchema); res.json({ data: await this.service.saveConfidence(id, value) }); };

  public readonly deleteConfidence: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); await this.service.deleteConfidence(id); res.status(204).end(); };

  public readonly getPerformance: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); res.json({ data: await this.service.getPerformance(id) }); };

  public readonly getPracticeFocus: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); const body = getValidated(res, 'body', CreatePracticeProjectBodySchema); const focus = await this.service.getPracticeFocus(id, body); res.json({ data: { focusMode: body.focusMode, priorities: focus.priorities } }); };

  public readonly generatePracticeProject: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); const body = getValidated(res, 'body', CreatePracticeProjectBodySchema); res.status(201).json({ data: await this.service.generatePracticeProject(id, body) }); };

  public readonly getPracticeProjects: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); res.json({ data: await this.service.getPracticeProjects(id) }); };

  public readonly getPracticeProject: RequestHandler = async (_req, res) => { const { id } = getValidated(res, 'params', IdParamsSchema); res.json({ data: await this.service.getPracticeProject(id) }); };

  public readonly getAiUsageToday: RequestHandler = async (_req, res) => {
    res.set('cache-control', 'no-store');
    res.json({ data: await this.service.getAiUsageToday(res.locals.userId!, this.aiDailyLimit) });
  };
}

export class IngestionController {
  public constructor(private readonly ingestion: IngestionService) {}
  public readonly upload: RequestHandler = async (req, res) => {
    if (!req.file) throw new Error('Arquivo ausente.');
    const body = getValidated(res, 'body', UploadMaterialBodySchema)
    res.status(202).json({
      data: await this.ingestion.upload(
        req.file,
        body.title,
        body.locale,
        res.locals.userId!,
      ),
    });
  };
  public readonly status: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.set('cache-control', 'no-store');
    res.json({ data: await this.ingestion.status(id) });
  };
  public readonly events: RequestHandler = async (req, res) => {
    const cursor = req.header('last-event-id') ?? req.query.after;
    let after =
      cursor === undefined
        ? await this.ingestion.latestEventId(res.locals.userId!)
        : Number(cursor);
    res
      .status(200)
      .set({
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      .flushHeaders();
    res.write('retry: 2000\n: connected\n\n');
    const send = async () => {
      for (const event of await this.ingestion.events(
        Number.isSafeInteger(after) ? after : 0,
        res.locals.userId!,
      )) {
        after = Number(event.id);
        res.write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
        );
      }
    };
    await send();
    const poll = setInterval(() => {
      void send();
    }, 1_000);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  };
  public readonly extract: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.status(202).json({ data: await this.ingestion.enqueue(id, res.locals.userId!) });
  };
  public readonly cancelExtraction: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.json({ data: await this.ingestion.cancel(id, res.locals.userId!) });
  };
  public readonly overview: RequestHandler = async (_req, res) => {
    res.json({ data: await this.ingestion.overview(res.locals.userId!) });
  };
}
