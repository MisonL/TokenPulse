import { db } from "../db";
import { systemLogs, requestLogs } from "../db/schema";
import { logger } from "./logger";

export default async function seed() {
  // We removed mock data as requested by user.
  // We only keep the schema and essential structures.
  logger.info("Seeding disabled (Mock data removed).", "Seed");
}
