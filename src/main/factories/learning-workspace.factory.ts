import type { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import type { GeminiMasterMeGateway } from '../../infra/llm/gemini.gateway';
import { PrismaLearningWorkspaceRepository } from '../../infra/repositories/prisma/prisma-learning-workspace.repository';
import { LearningWorkspaceService } from '../../application/services/learning-workspace.service';
import { LearningWorkspaceController } from '../../infra/controllers/learning-workspace.controller';

export function makeLearningWorkspaceFactory(pool: Pool, gateway: GeminiMasterMeGateway) {
  const repository = new PrismaLearningWorkspaceRepository(new PrismaClient({ adapter: new PrismaPg(pool) }));
  const service = new LearningWorkspaceService(repository, gateway);
  const controller = new LearningWorkspaceController(service);
  return { service, controller };
}
