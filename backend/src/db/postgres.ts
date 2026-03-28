import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { env } from "../config/env";

const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.pgPoolMax,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000
});

export const pgQuery = <T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> => {
  return pool.query<T>(text, params);
};

export const withPgTransaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const pingPostgres = async (): Promise<void> => {
  await pgQuery("SELECT 1");
};

export const shutdownPostgres = async (): Promise<void> => {
  await pool.end();
};
