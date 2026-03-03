import { config } from "../config";
import * as schema from "./schema";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";

type DrizzleDb = ReturnType<typeof drizzlePostgres<typeof schema>>;

let dbInstance: DrizzleDb;
let postgresClient: postgres.Sql | null = null;
let pgliteClient: PGlite | null = null;

if (config.isTest && !config.databaseUrl) {
  // 测试环境默认使用内存 pglite，避免依赖外部 PostgreSQL 实例。
  pgliteClient = new PGlite();
  dbInstance = drizzlePglite(pgliteClient, { schema }) as unknown as DrizzleDb;
} else {
  const connectionString = config.databaseUrl;
  if (!connectionString) {
    throw new Error("DATABASE_URL 未配置");
  }
  postgresClient = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  dbInstance = drizzlePostgres(postgresClient, { schema });
}

export const db = dbInstance;
export const dbClients = {
  postgres: postgresClient,
  pglite: pgliteClient,
};

