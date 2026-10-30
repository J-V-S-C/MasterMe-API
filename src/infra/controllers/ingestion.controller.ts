import type { RequestHandler } from 'express';
import { getValidated } from '../../middleware/validate-request';
import {
  IdParamsSchema,
  UploadMaterialBodySchema,
} from '../../schemas/http.schema';
import type { IngestionService } from '../ingestion/ingestion.service';
import { AppError } from '../../application/errors';

export class IngestionController {
  public constructor(private readonly ingestion: IngestionService) {}
  public readonly originalPdf: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    const pdf = await this.ingestion.originalPdf(id, res.locals.userId!);
    res.set({
      'content-type': 'application/pdf',
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    res.send(pdf);
  };
  public readonly upload: RequestHandler = async (req, res) => {
    if (!req.file)
      throw new AppError(
        'INVALID_UPLOAD',
        'Envie um arquivo PDF, Markdown ou TXT.',
      );
    const body = getValidated(res, 'body', UploadMaterialBodySchema);
    res.status(202).json({
      data: await this.ingestion.upload(
        req.file,
        body.title,
        body.locale,
        res.locals.userId!,
        body.materialKind,
      ),
    });
  };
  public readonly deleteMaterial: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    await this.ingestion.deleteMaterial(id, res.locals.userId!);
    res.status(204).end();
  };
  public readonly status: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.set('cache-control', 'no-store');
    res.json({ data: await this.ingestion.status(id, res.locals.userId!) });
  };
  public readonly events: RequestHandler = async (req, res) => {
    const cursor = req.header('last-event-id') ?? req.query.after;
    let after =
      cursor === undefined
        ? await this.ingestion.latestEventId(res.locals.userId!)
        : Number(cursor);
    let closed = false;
    let unsubscribe = () => {};
    let flush = Promise.resolve();
    const send = () => {
      flush = flush
        .then(async () => {
          if (closed) return;
          for (const event of await this.ingestion.events(
            Number.isSafeInteger(after) ? after : 0,
            res.locals.userId!,
          )) {
            after = Number(event.id);
            res.write(
              `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
            );
          }
        })
        .catch(() => {
          console.error(
            JSON.stringify({
              level: 'error',
              operation: 'sse-flush',
              code: 'SSE_FLUSH_FAILED',
            }),
          );
        });
    };
    unsubscribe = await this.ingestion.subscribe(res.locals.userId!, send);
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
    send();
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    req.on('close', () => {
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
    });
  };
  public readonly extract: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res
      .status(202)
      .json({ data: await this.ingestion.enqueue(id, res.locals.userId!) });
  };
  public readonly extractionPreview: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.set('cache-control', 'no-store');
    res.json({
      data: await this.ingestion.extractionPreview(id, res.locals.userId!),
    });
  };
  public readonly cancelExtraction: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', IdParamsSchema);
    res.json({ data: await this.ingestion.cancel(id, res.locals.userId!) });
  };
  public readonly overview: RequestHandler = async (_req, res) => {
    res.json({ data: await this.ingestion.overview(res.locals.userId!) });
  };
}
