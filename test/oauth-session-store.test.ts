import { describe, expect, it } from "bun:test";
import {
  OAuthSessionStore,
  type OAuthSessionEventQuery,
  type OAuthSessionEventQueryResult,
  type OAuthSessionEventRecord,
  type OAuthSessionPersistence,
  type OAuthSessionRecord,
} from "../src/lib/auth/oauth-session-store";

class MemoryOAuthSessionPersistence implements OAuthSessionPersistence {
  records = new Map<string, OAuthSessionRecord>();
  events: OAuthSessionEventRecord[] = [];
  findCalls = 0;
  eventListCalls = 0;
  throwOnFind = false;
  throwOnAppendEvent = false;
  throwOnListEvents = false;

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

  async appendEvent(event: OAuthSessionEventRecord): Promise<void> {
    if (this.throwOnAppendEvent) {
      throw new Error("append event failed");
    }
    this.events.unshift({ ...event });
  }

  async listEvents(query: OAuthSessionEventQuery): Promise<OAuthSessionEventQueryResult> {
    this.eventListCalls += 1;
    if (this.throwOnListEvents) {
      throw new Error("list events failed");
    }

    const page = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page!)) : 1;
    const pageSize = Number.isFinite(query.pageSize)
      ? Math.min(100, Math.max(1, Math.floor(query.pageSize!)))
      : 20;
    const offset = (page - 1) * pageSize;
    const fromMs = query.from ? Date.parse(query.from) : NaN;
    const toMs = query.to ? Date.parse(query.to) : NaN;

    let list = [...this.events];
    if (query.state) list = list.filter((item) => item.state === query.state);
    if (query.provider) list = list.filter((item) => item.provider === query.provider);
    if (query.flowType) list = list.filter((item) => item.flowType === query.flowType);
    if (query.phase) list = list.filter((item) => item.phase === query.phase);
    if (query.status) list = list.filter((item) => item.status === query.status);
    if (query.eventType) list = list.filter((item) => item.eventType === query.eventType);
    if (Number.isFinite(fromMs)) list = list.filter((item) => item.createdAt >= fromMs);
    if (Number.isFinite(toMs)) list = list.filter((item) => item.createdAt <= toMs);

    const total = list.length;
    return {
      data: list.slice(offset, offset + pageSize).map((item) => ({ ...item })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
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

  it("应记录 register/setPhase/complete 事件", async () => {
    const persistence = new MemoryOAuthSessionPersistence();
    const store = new OAuthSessionStore(60_000, { persistence });
    await store.register("state-g", "claude");
    await store.setPhase("state-g", "exchanging");
    await store.complete("state-g");

    const result = await store.listEvents({
      state: "state-g",
      page: 1,
      pageSize: 10,
    });
    expect(result.total).toBe(3);
    expect(result.data[0]?.eventType).toBe("complete");
    expect(result.data[1]?.eventType).toBe("set_phase");
    expect(result.data[2]?.eventType).toBe("register");
  });

  it("应支持按基础条件过滤事件", async () => {
    const persistence = new MemoryOAuthSessionPersistence();
    const store = new OAuthSessionStore(60_000, { persistence });

    await store.register("state-h1", "claude");
    await store.markError("state-h1", "exchange failed");
    await store.register("state-h2", "gemini");

    const filtered = await store.listEvents({
      provider: "claude",
      status: "error",
      eventType: "mark_error",
      page: 1,
      pageSize: 10,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.data[0]?.state).toBe("state-h1");
    expect(filtered.data[0]?.provider).toBe("claude");
  });

  it("事件查询持久层失败时应回退内存数据", async () => {
    const persistence = new MemoryOAuthSessionPersistence();
    persistence.throwOnAppendEvent = true;
    persistence.throwOnListEvents = true;

    const store = new OAuthSessionStore(60_000, {
      persistence,
      eventMemoryLimit: 20,
    });
    await store.register("state-i", "claude");
    await store.markError("state-i", "fallback expected");

    const result = await store.listEvents({
      state: "state-i",
      page: 1,
      pageSize: 10,
    });

    expect(persistence.eventListCalls).toBeGreaterThan(0);
    expect(result.total).toBe(2);
    expect(result.data[0]?.eventType).toBe("mark_error");
    expect(result.data[1]?.eventType).toBe("register");
  });
});
