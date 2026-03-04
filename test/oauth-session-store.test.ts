import { describe, expect, it } from "bun:test";
import {
  OAuthSessionStore,
  type OAuthSessionPersistence,
  type OAuthSessionRecord,
} from "../src/lib/auth/oauth-session-store";

class MemoryOAuthSessionPersistence implements OAuthSessionPersistence {
  records = new Map<string, OAuthSessionRecord>();
  findCalls = 0;
  throwOnFind = false;

  async upsert(state: string, record: OAuthSessionRecord): Promise<void> {
    this.records.set(state, { ...record });
  }

  async findByState(state: string): Promise<OAuthSessionRecord | null> {
    this.findCalls += 1;
    if (this.throwOnFind) {
      throw new Error("persistence unavailable");
    }
    const record = this.records.get(state);
    return record ? { ...record } : null;
  }

  async deleteByState(state: string): Promise<void> {
    this.records.delete(state);
  }

  async deleteExpired(now: number): Promise<void> {
    for (const [state, record] of this.records.entries()) {
      if (record.expiresAt <= now) {
        this.records.delete(state);
      }
    }
  }
}

describe("OAuth 会话仓库", () => {
  it("应注册并校验 pending 会话", async () => {
    const store = new OAuthSessionStore(60_000);
    await store.register("state-a", "claude", "verifier-a");

    expect(await store.isPending("state-a", "claude")).toBe(true);
    expect(await store.isPending("state-a", "gemini")).toBe(false);

    const record = await store.get("state-a");
    expect(record?.verifier).toBe("verifier-a");
  });

  it("完成会话后应不可再用", async () => {
    const store = new OAuthSessionStore(60_000);
    await store.register("state-b", "codex");
    await store.complete("state-b");
    expect(await store.isPending("state-b", "codex")).toBe(false);
  });

  it("标记错误后应变为非 pending", async () => {
    const store = new OAuthSessionStore(60_000);
    await store.register("state-c", "claude");
    await store.markError("state-c", "token exchange failed");
    expect(await store.isPending("state-c", "claude")).toBe(false);
    expect((await store.get("state-c"))?.status).toBe("error");
  });

  it("缓存新鲜期内应优先命中内存，避免重复查询持久层", async () => {
    const persistence = new MemoryOAuthSessionPersistence();
    const store = new OAuthSessionStore(60_000, {
      cacheTtlMs: 5_000,
      persistence,
    });
    await store.register("state-d", "claude");
    persistence.findCalls = 0;

    await store.get("state-d");
    await store.get("state-d");

    expect(persistence.findCalls).toBe(0);
  });

  it("缓存过期后应以持久层记录为准", async () => {
    const persistence = new MemoryOAuthSessionPersistence();
    const store = new OAuthSessionStore(60_000, {
      cacheTtlMs: 1,
      persistence,
    });
    await store.register("state-e", "claude");

    const persisted = persistence.records.get("state-e");
    expect(persisted).toBeTruthy();
    persistence.records.set("state-e", {
      ...persisted!,
      status: "completed",
      phase: "completed",
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });

    await Bun.sleep(5);
    const record = await store.get("state-e");
    expect(record?.status).toBe("completed");
    expect(record?.phase).toBe("completed");
    expect(persistence.findCalls).toBeGreaterThan(0);
  });

  it("持久层查询异常时应回退内存缓存，保障会话可读", async () => {
    const persistence = new MemoryOAuthSessionPersistence();
    const store = new OAuthSessionStore(60_000, {
      cacheTtlMs: 1,
      persistence,
    });
    await store.register("state-f", "claude");
    persistence.throwOnFind = true;

    await Bun.sleep(5);
    const record = await store.get("state-f");
    expect(record?.status).toBe("pending");
    expect(persistence.findCalls).toBeGreaterThan(0);
  });
});
