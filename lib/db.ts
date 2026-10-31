import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

type Database = ReturnType<typeof drizzle<typeof schema>>;
type PgPool = pg.Pool;

let cachedDb: Database | null = null;
let cachedPool: PgPool | null = null;

function databaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required before using the database');
  }
  return databaseUrl;
}

export function getRawSql() {
  if (cachedPool) return cachedPool;
  cachedPool = new pg.Pool({ connectionString: databaseUrl() });
  return cachedPool;
}

function getDb() {
  if (cachedDb) {
    return cachedDb;
  }

  const sql = getRawSql();
  cachedDb = drizzle(sql, { schema });
  return cachedDb;
}

export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
