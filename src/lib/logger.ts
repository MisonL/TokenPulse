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

    // Console output (with colors for dev)
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

    // DB Persistence (Fire & Forget to not block main thread too much)
    try {
      await db.insert(systemLogs).values({
        level,
        source,
        message,
        timestamp, // Schema has default, but explicit is fine
      });
    } catch (e) {
      // Fallback if DB fails
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
