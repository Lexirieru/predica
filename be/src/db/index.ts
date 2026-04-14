import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// SSL is required by Supabase/Neon/managed Postgres providers.
// Disable only for local dev by setting DATABASE_SSL=false.
const sslEnabled = process.env.DATABASE_SSL !== "false";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || "10"),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err);
});

export const db = drizzle(pool, { schema });

export function getDb() {
  return db;
}
