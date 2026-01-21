import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { config } from "../config";

const sqlite = new Database(config.dbFileName);

// Optimization for concurrency
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA synchronous = NORMAL;");
sqlite.exec("PRAGMA busy_timeout = 5000;"); // 5s timeout for busy locks

export const db = drizzle(sqlite);
