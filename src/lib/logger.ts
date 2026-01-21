import { db } from "../db";
import { systemLogs } from "../db/schema";

type LogLevel = "INFO" | "WARN" | "ERROR";

class Logger {
  private async log(
    level: LogLevel,
    message: string,
    source: string = "System",
  ) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [${source}] ${message}`;

    // 控制台输出（带颜色，用于开发环境）
    switch (level) {
      case "INFO":
        console.log(`\x1b[36m${logEntry}\x1b[0m`);
        break;
      case "WARN":
        console.warn(`\x1b[33m${logEntry}\x1b[0m`);
        break;
      case "ERROR":
        console.error(`\x1b[31m${logEntry}\x1b[0m`);
        break;
    }

    // DB 持久化（由于性能原因，采用 Fire & Forget 策略，不阻塞主线程）
    try {
      await db.insert(systemLogs).values({
        level,
        source,
        message,
        timestamp, // Schema 有默认值，但显式指定也没问题
      });
    } catch (e) {
      // 数据库写入失败时的回退
      console.error("Failed to write log to DB", e);
    }
  }

  info(message: string, source?: string) {
    this.log("INFO", message, source);
  }

  warn(message: string, source?: string) {
    this.log("WARN", message, source);
  }

  error(message: string, error?: any, source?: string) {
    const fullMsg = error
      ? `${message} ${error.message || error}`
      : message;
    this.log("ERROR", fullMsg, source);
  }
}

export const logger = new Logger();
export const logSystem = (level: string, source: string, msg: string) => {
  switch (level) {
    case "INFO":
      logger.info(msg, source);
      break;
    case "WARN":
      logger.warn(msg, source);
      break;
    case "ERROR":
      logger.error(msg, source);
      break;
    default:
      logger.info(msg, source);
  }
};
