import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { decryptCredential, encryptCredential } from "../auth/crypto_helpers";


const CHECK_INTERVAL = 5 * 60 * 1000; // 5 Minutes

import { RefreshHandlers } from "../auth/refreshers";
import { TokenManager } from "../auth/token_manager";

export function startScheduler() {
  logger.info("[调度器] 启动保活调度任务...", "调度器");

  const scheduleNext = () => {
    setTimeout(async () => {
      await runChecks();
      scheduleNext();
    }, CHECK_INTERVAL);
  };

  setTimeout(scheduleNext, 5000);
}

async function runChecks() {
  logger.info("[调度器] 执行保活检查...", "调度器");
  try {
    const allCreds = await db.select().from(credentials);
    for (const rawCred of allCreds) {
      const cred = decryptCredential(rawCred);
      const handler = RefreshHandlers[cred.provider];
      
      if (handler) {
        try {
          logger.info(
            `[调度器] 检查 ${cred.provider} (${cred.email})...`,
            "调度器",
          );
          logger.info(
            `[调度器] 已找到 ${cred.provider} 会话，按需刷新`,
            "调度器",
          );

          const newData = await handler(cred);
          if (newData) {
            const now = Date.now();
            
            const toSave: any = {
                accessToken: newData.access_token,
                refreshToken: newData.refresh_token || cred.refreshToken,
                metadata: newData.metadata
                  ? typeof newData.metadata === "string"
                    ? newData.metadata
                    : JSON.stringify(newData.metadata)
                  : cred.metadata,
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

            logger.info(`[调度器] 已刷新 ${cred.provider} 的令牌`, "调度器");
          }
        } catch (errInner) {
// ...
          logger.error( // 由 console.error 改为统一日志入口
            `[调度器] 刷新 ${cred.provider} 失败:`,
            errInner,
            "调度器",
          );
        }
      }
    }
  } catch (e) {
    logger.error("[调度器] 执行异常:", e, "调度器");
  }
}
