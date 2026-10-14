import { createApp } from './bootstrap.js';
import { loadEnv } from './config/env.js';
import { openDatabase } from './db/open.js';

const env = loadEnv();
const database = await openDatabase(env);
if (database.driver === 'pglite') {
  // Local no-Docker mode: keep the embedded database migrated automatically.
  await database.migrate();
}
const app = await createApp(env, database);
app
  .getHttpAdapter()
  .getInstance()
  .addHook('onClose', async () => database.close());
await app.listen({ port: env.API_PORT, host: env.API_HOST });
