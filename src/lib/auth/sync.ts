import { db } from "../../db";
import { credentials } from "../../db/schema";
import { logger } from "../logger";
import { eq } from "drizzle-orm";

/**
 * This function is kept for compatibility but does nothing.
 * In the reference project, providers are not auto-registered from config.
 * Users must manually add credentials via the UI or API.
 */
export async function syncConfigToDb() {
  logger.info(
    "[AuthSync] Auto-sync disabled (credentials must be added manually via UI or API).",
  );
}
