import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { decryptCredential, encryptCredential } from "../auth/crypto_helpers";

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
    for (const rawCred of allCreds) {
      // 1. Decrypt before usage
      const cred = decryptCredential(rawCred);
      const handler = RefreshHandlers[cred.provider];
      
      if (handler) {
        try {
          logger.info(
            `[Scheduler] Checking ${cred.provider} (${cred.email})...`,
            "Scheduler",
          );
          logger.info(
            `[Scheduler] Found session for ${cred.provider} - refreshing if needed`,
            "Scheduler",
          );

          const newData = await handler(cred);
          if (newData) {
            const now = Date.now();
            
            // 2. Encrypt before update
            const toSave: any = {
                // Construct a partial object compliant with NewCredential for encryption helper
                // id/provider/status are not needed for encryptCredential helper if we only care about fields
                // But encryptCredential expects NewCredential.
                // We'll construct a mock object or just manually call encrypt() on fields?
                // Using encryptCredential is safer to keep logic unified.
                accessToken: newData.access_token,
                refreshToken: newData.refresh_token || cred.refreshToken,
                metadata: newData.metadata
                  ? typeof newData.metadata === "string"
                    ? newData.metadata
                    : JSON.stringify(newData.metadata)
                  : cred.metadata,
                // Pass through other fields just to satisfy type if needed, but we only use encrypted ones below
            };
            
            const encrypted = encryptCredential(toSave);

            await db
              .update(credentials)
              .set({
                accessToken: encrypted.accessToken,
                refreshToken: encrypted.refreshToken,
                expiresAt: now + newData.expires_in * 1000,
                lastRefresh: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                metadata: encrypted.metadata,
              })
              .where(eq(credentials.id, cred.id));

            logger.info(`[Scheduler] Refreshed token for ${cred.provider}`, "Scheduler");
          }
        } catch (errInner) {
// ...
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
