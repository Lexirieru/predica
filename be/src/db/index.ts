import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// SSL policy:
//   DATABASE_SSL=false            → no TLS (local dev / unix socket)
//   DATABASE_SSL=true (default)   → TLS enabled
//   DATABASE_SSL_REJECT_UNAUTHORIZED=false (default) → accept self-signed /
//     provider-chain certs (Supabase, Neon, Heroku PG) whose CA isn't in the
//     system bundle. Set to "true" in prod when your provider uses a CA the
//     runtime trusts — this is the hardened setting.
const sslEnabled = process.env.DATABASE_SSL !== "false";
const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || "10"),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: sslEnabled ? { rejectUnauthorized } : false,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err);
});

export const db = drizzle(pool, { schema });

export function getDb() {
  return db;
}
