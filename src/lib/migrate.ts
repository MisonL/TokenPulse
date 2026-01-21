import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "../db";
import { logger } from "./logger";

async function main() {
  try {
    logger.info("正在执行数据库迁移...", "Migration");
    await migrate(db, { migrationsFolder: "./drizzle" });
    logger.info("数据库迁移完成。", "Migration");
    logger.info("数据库迁移已成功应用。", "Migration");
  } catch (e: any) {
    logger.error(`迁移失败: ${e}`, "Migration");
    logger.error(`数据库迁移失败: ${e.message}`, "Migration");
    process.exit(1);
  }
}

main();
