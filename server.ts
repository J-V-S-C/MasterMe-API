import dotenv from 'dotenv';
import { getEnvironment } from './src/config/environment';
import { startApi } from './src/main/api';
import { startWorker } from './src/main/worker';

// Compatibility export for existing component tests; new code imports infra/http/app directly.
export { createApp } from './src/infra/http/app';

if (import.meta.main || process.argv[1]?.endsWith('server.ts') === true) {
  dotenv.config();
  const environment = getEnvironment();
  if (process.argv.includes('--worker')) startWorker(environment);
  else startApi(environment);
}
