import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "../db";
import { logger } from "./logger";

async function main() {
  try {
    logger.info("正在执行数据库迁移...", "迁移");
    await migrate(db, { migrationsFolder: "./drizzle" });
    logger.info("数据库迁移完成。", "迁移");
    logger.info("数据库迁移已成功应用。", "迁移");
  } catch (e: any) {
    logger.error(`迁移失败: ${e}`, "迁移");
    logger.error(`数据库迁移失败: ${e.message}`, "迁移");
    process.exit(1);
  }
}

main();
