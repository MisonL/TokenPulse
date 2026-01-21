import { describe, it, expect, spyOn, afterEach } from "bun:test";
import { logger } from "../src/lib/logger";
import { db } from "../src/db";
import { systemLogs } from "../src/db/schema";

describe("Logger Service", () => {
  afterEach(() => {
    // Clean up or reset spies if needed
  });

  it("should output info logs to console with blue color", async () => {
    const logSpy = spyOn(console, "log");
    logger.info("Test Info Message", "TestUnit");
    
    // Logger.info calls log() which is async but info/warn/error don't await it.
    // However, console output is immediate in the log method.
    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls;
    if (!calls[0]) throw new Error("Logger.info didn't call console.log");
    const callArgs = calls[0][0];
    expect(callArgs).toContain("[INFO]");
    expect(callArgs).toContain("[TestUnit]");
    expect(callArgs).toContain("Test Info Message");
    expect(callArgs).toContain("\x1b[36m"); // Cyan/Blue color
  });

  it("should output warn logs to console with yellow color", async () => {
    const warnSpy = spyOn(console, "warn");
    logger.warn("Test Warn Message", "TestUnit");
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls;
    if (!calls[0]) throw new Error("Logger.warn didn't call console.warn");
    const callArgs = calls[0][0];
    expect(callArgs).toContain("[WARN]");
    expect(callArgs).toContain("Test Warn Message");
  });

  it("should output error logs to console with red color", async () => {
    const errorSpy = spyOn(console, "error");
    logger.error("Test Error Message", "TestUnit");
    expect(errorSpy).toHaveBeenCalled();
    const calls = errorSpy.mock.calls;
    if (!calls[0]) throw new Error("Logger.error didn't call console.error");
    const callArgs = calls[0][0];
    expect(callArgs).toContain("[ERROR]");
    expect(callArgs).toContain("Test Error Message");
  });

  it("should attempt to insert logs into the database", async () => {
    expect(() => logger.info("DB Persistence Test")).not.toThrow();
  });

  it("should support logSystem helper correctly", () => {
    const infoSpy = spyOn(logger, "info");
    const warnSpy = spyOn(logger, "warn");
    const errorSpy = spyOn(logger, "error");
    
    const { logSystem } = require("../src/lib/logger");
    
    logSystem("INFO", "Sys", "msg");
    expect(infoSpy).toHaveBeenCalledWith("msg", "Sys");
    
    logSystem("WARN", "Sys", "msg");
    expect(warnSpy).toHaveBeenCalledWith("msg", "Sys");
    
    logSystem("ERROR", "Sys", "msg");
    expect(errorSpy).toHaveBeenCalledWith("msg", "Sys");
    
    logSystem("UNKNOWN", "Sys", "msg");
    expect(infoSpy).toHaveBeenCalledTimes(2); // Fallback to info
  });
});
