import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "../db";
import { logger } from "./logger";

async function main() {
  try {
    logger.info("Running migrations...", "Migration");
    await migrate(db, { migrationsFolder: "./drizzle" });
    logger.info("Migrations complete.", "Migration");
    logger.info("Database migrations applied successfully.", "Migration");
  } catch (e: any) {
    logger.error(`Migration failed: ${e}`, "Migration");
    logger.error(`Database migration failed: ${e.message}`, "Migration");
    process.exit(1);
  }
}

main();
