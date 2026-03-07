import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { config } from "../../config";
import { logger } from "../logger";
import { decryptCredential, encryptCredential } from "../auth/crypto_helpers";
import { evaluateOAuthSessionAlerts } from "../observability/oauth-session-alerts";
import {
  getAgentLedgerOutboxHealth,
  runAgentLedgerOutboxDeliveryCycle,
} from "../agentledger/runtime-events";


const CHECK_INTERVAL = 5 * 60 * 1000; // 5 Minutes
const OAUTH_ALERT_INITIAL_DELAY_MS = 8 * 1000;

import { RefreshHandlers } from "../auth/refreshers";
import { TokenManager } from "../auth/token_manager";

let oauthAlertInterval: ReturnType<typeof setInterval> | null = null;
let oauthAlertRunning = false;
let agentLedgerWorkerInterval: ReturnType<typeof setInterval> | null = null;
let agentLedgerWorkerRunning = false;

export function startScheduler() {
  logger.info("[调度器] 启动保活调度任务...", "调度器");

  const scheduleNext = () => {
    setTimeout(async () => {
      await runChecks();
      scheduleNext();
    }, CHECK_INTERVAL);
  };

  setTimeout(scheduleNext, 5000);
  startOAuthAlertScheduler();
  startAgentLedgerWorkerScheduler();
}

function startOAuthAlertScheduler() {
  if (oauthAlertInterval) return;

  const intervalSec = Math.max(5, config.oauthAlerts.evalIntervalSec);
  const intervalMs = intervalSec * 1000;
  logger.info(
    `[调度器] OAuth 告警评估任务已启动，间隔 ${intervalSec} 秒`,
    "调度器",
  );

  setTimeout(() => {
    void runOAuthAlertEvaluation();
  }, OAUTH_ALERT_INITIAL_DELAY_MS);

  oauthAlertInterval = setInterval(() => {
    void runOAuthAlertEvaluation();
  }, intervalMs);
}

function startAgentLedgerWorkerScheduler() {
  if (agentLedgerWorkerInterval) return;
  if (!config.agentLedger.enabled) return;

  void getAgentLedgerOutboxHealth().catch((error) => {
    logger.warn("[调度器] AgentLedger 健康快照初始化失败", "调度器");
    logger.error("[调度器] AgentLedger 健康快照初始化失败:", error, "调度器");
  });

  const intervalMs = Math.max(1000, config.agentLedger.workerPollIntervalMs);
  logger.info(
    `[调度器] AgentLedger outbox 投递任务已启动，间隔 ${intervalMs}ms`,
    "调度器",
  );

  setTimeout(() => {
    void runAgentLedgerOutboxWorker();
  }, 5000);

  agentLedgerWorkerInterval = setInterval(() => {
    void runAgentLedgerOutboxWorker();
  }, intervalMs);
}

async function runOAuthAlertEvaluation() {
  if (oauthAlertRunning) return;
  oauthAlertRunning = true;
  try {
    const result = await evaluateOAuthSessionAlerts();
    if (result.createdEvents > 0) {
      logger.warn(
        `[调度器] OAuth 告警已触发 ${result.createdEvents} 条，投递尝试 ${result.deliveryAttempts} 次`,
        "调度器",
      );
    }
  } catch (error) {
    logger.error("[调度器] OAuth 告警评估失败:", error, "调度器");
  } finally {
    oauthAlertRunning = false;
  }
}

async function runAgentLedgerOutboxWorker() {
  if (agentLedgerWorkerRunning) return;
  agentLedgerWorkerRunning = true;
  try {
    await runAgentLedgerOutboxDeliveryCycle();
  } catch (error) {
    logger.error("[调度器] AgentLedger outbox 投递失败:", error, "调度器");
  } finally {
    agentLedgerWorkerRunning = false;
  }
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
