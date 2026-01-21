import { db } from "../db";
import { systemLogs, requestLogs } from "../db/schema";
import { logger } from "./logger";

export default async function seed() {
  // 根据用户要求移除了模拟数据。
  // 我们只保留 schema 和必要的结构。
  logger.info("Seeding disabled (Mock data removed).", "Seed");
}
