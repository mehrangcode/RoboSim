import { loadEnv } from '../config/env.js';
import { openDatabase } from './open.js';

const env = loadEnv();
const database = await openDatabase(env);
try {
  await database.migrate();
  console.warn(`Migrations applied (${database.driver}).`);
} finally {
  await database.close();
}
