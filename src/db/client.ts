import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Client PostgreSQL condiviso.
 * In dev il modulo può essere ricaricato: teniamo la connessione su globalThis
 * per non esaurire il pool.
 */
const connectionString =
  process.env.DATABASE_URL ??
  "postgres://dropalert@127.0.0.1:5433/dropalert";

const globalForDb = globalThis as unknown as {
  __dropalertSql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.__dropalertSql ??
  postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    /* Nessuna attesa infinita: una query che resta appesa oltre due minuti
       deve fallire e farsi dichiarare, non impiccare il giro di raccolta
       (il job ha un killer a 10 minuti). Connessione: 30 s al massimo. */
    connect_timeout: 30,
    timeout: 120,
    // i numeric arrivano come stringa: li convertiamo esplicitamente dove serve
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__dropalertSql = sql;
}

export const db = drizzle(sql, { schema });

export type Db = typeof db;
export { schema };
