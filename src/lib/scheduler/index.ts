import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

// Simple Scheduler to Keep-Alive tokens
// Runs every 4 hours by default.

const INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 Hours

import { RefreshHandlers } from "../auth/refreshers";
import { TokenManager } from "../auth/token_manager";

export function startScheduler() {
  logger.info("[Scheduler] Starting active keep-alive scheduler...", "Scheduler");

  // Run immediately on start (interactive dev mode)
  // runChecks(); // Removed as per diff

  // Every 5 minutes // New comment
  setInterval(async () => {
    logger.info("[Scheduler] Running keep-alive checks...", "Scheduler");
    await runChecks(); // Call runChecks inside the new interval
  }, 5 * 60 * 1000); // Assuming 5 minutes interval based on comment
}

async function runChecks() {
  logger.info("[Scheduler] Running keep-alive checks...", "Scheduler");
  try {
    const allCreds = await db.select().from(credentials);
    for (const cred of allCreds) {
      const handler = RefreshHandlers[cred.provider];
      if (handler) {
        try {
          logger.info(
            `[Scheduler] Checking ${cred.provider} (${cred.email})...`,
            "Scheduler",
          );
          // New lines from diff
          logger.info(
            `[Scheduler] Found session for ${cred.provider} - refreshing if needed`,
            "Scheduler",
          );
          // Assuming refreshProviderToken is a new function or part of the handler logic
          // For now, I'll keep the original handler call and add the new logger line.
          // If `refreshProviderToken` is meant to replace the handler call, that's a larger refactor.
          // Given the instruction is "replace console.log with logger", I'll prioritize that.
          // The diff snippet for `runChecks` is incomplete and seems to mix new logic with old.
          // I will apply the logger changes and the new logger.info line, but keep the core refresh logic.

          const newData = await handler(cred); // Original logic
          if (newData) {
            const now = Date.now();
            await db
              .update(credentials)
              .set({
                accessToken: newData.access_token,
                refreshToken: newData.refresh_token || cred.refreshToken,
                expiresAt: now + newData.expires_in * 1000,
                lastRefresh: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                metadata: newData.metadata
                  ? typeof newData.metadata === "string"
                    ? newData.metadata
                    : JSON.stringify(newData.metadata)
                  : cred.metadata,
              })
              .where(eq(credentials.id, cred.id));
            logger.info(`[Scheduler] Refreshed token for ${cred.provider}`, "Scheduler");
          }
        } catch (errInner) {
          logger.error( // Changed from console.error
            `[Scheduler] Failed to refresh ${cred.provider}:`,
            errInner,
            "Scheduler",
          );
        }
      }
    }
  } catch (e) {
    logger.error("[Scheduler] Error:", e, "Scheduler");
  }
}
