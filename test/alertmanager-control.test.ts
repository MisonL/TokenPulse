import { describe, expect, it } from "bun:test";
import {
  ALERTMANAGER_CONFIG_SETTING_KEY,
  AlertmanagerLockConflictError,
  AlertmanagerSyncError,
  listAlertmanagerControlHistory,
  readAlertmanagerControlConfig,
  syncAlertmanagerControlConfig,
  updateAlertmanagerControlConfig,
  type AlertmanagerControlConfig,
  type AlertmanagerControlStore,
  type AlertmanagerRuntimeAdapter,
  type AlertmanagerRuntimeConfig,
} from "../src/lib/observability/alertmanager-control";

class MemoryAlertmanagerStore implements AlertmanagerControlStore {
  private readonly values = new Map<string, string>();
  writes: Array<{ key: string; value: string }> = [];

  async readSetting(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async writeSetting(input: {
    key: string;
    value: string;
    description: string;
  }): Promise<void> {
    this.values.set(input.key, input.value);
    this.writes.push({ key: input.key, value: input.value });
  }

  async deleteSetting(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class StubAlertmanagerRuntimeAdapter implements AlertmanagerRuntimeAdapter {
  actions: string[] = [];
  writeCalls = 0;
  reloadCalls = 0;
  readyCalls = 0;
  failReloadAtCall = 0;
  failReadyAtCall = 0;

  async writeRuntimeYaml(
    _yaml: string,
    runtime: AlertmanagerRuntimeConfig,
  ): Promise<string> {
    this.writeCalls += 1;
    this.actions.push(`write#${this.writeCalls}`);
    return `${runtime.runtimeDir}/alertmanager.generated.yml`;
  }

  async reload(): Promise<void> {
    this.reloadCalls += 1;
    this.actions.push(`reload#${this.reloadCalls}`);
    if (this.failReloadAtCall > 0 && this.reloadCalls === this.failReloadAtCall) {
      throw new Error("reload failed");
    }
  }

  async ready(): Promise<void> {
    this.readyCalls += 1;
    this.actions.push(`ready#${this.readyCalls}`);
    if (this.failReadyAtCall > 0 && this.readyCalls === this.failReadyAtCall) {
      throw new Error("ready failed");
    }
  }
}

const runtime: AlertmanagerRuntimeConfig = {
  reloadUrl: "http://127.0.0.1:19093/-/reload",
  readyUrl: "http://127.0.0.1:19093/-/ready",
  runtimeDir: "/tmp/tokenpulse-alertmanager-test",
  timeoutMs: 800,
};

const baseConfig: AlertmanagerControlConfig = {
  route: {
    receiver: "primary-receiver",
    group_by: ["alertname", "cluster"],
  },
  receivers: [
    {
      name: "primary-receiver",
      webhook_configs: [
        {
          url: "https://hooks.example.com/services/base/token/value",
          send_resolved: true,
        },
      ],
    },
  ],
};

const nextConfig: AlertmanagerControlConfig = {
  route: {
    receiver: "oncall-receiver",
    group_by: ["alertname", "severity"],
  },
  receivers: [
    {
      name: "oncall-receiver",
      webhook_configs: [
        {
          url: "https://hooks.example.com/services/new/token/value",
          send_resolved: false,
        },
      ],
    },
  ],
};

async function seedConfig(
  store: MemoryAlertmanagerStore,
  config: AlertmanagerControlConfig,
) {
  await store.writeSetting({
    key: ALERTMANAGER_CONFIG_SETTING_KEY,
    value: JSON.stringify({
      version: 1,
      updatedAt: "2026-03-05T00:00:00.000Z",
      updatedBy: "seed",
      config,
    }),
    description: "seed",
  });
}

function getReceiverName(config: AlertmanagerControlConfig | null): string {
  const route = config?.route as Record<string, unknown> | undefined;
  return typeof route?.receiver === "string" ? route.receiver : "";
}

describe("alertmanager-control", () => {
  it("手动更新配置时版本号应递增", async () => {
    const store = new MemoryAlertmanagerStore();

    const first = await updateAlertmanagerControlConfig(baseConfig, {
      actor: "owner",
      comment: "first",
      store,
    });
    const second = await updateAlertmanagerControlConfig(nextConfig, {
      actor: "owner",
      comment: "second",
      store,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
  });

  it("sync 成功路径：应完成写入、reload、ready，并记录脱敏 webhook", async () => {
    const store = new MemoryAlertmanagerStore();
    const runtimeAdapter = new StubAlertmanagerRuntimeAdapter();
    await seedConfig(store, baseConfig);

    const result = await syncAlertmanagerControlConfig(nextConfig, {
      actor: "ops-user",
      reason: "发布新接收器",
      runtime,
      store,
      runtimeAdapter,
    });

    const saved = await readAlertmanagerControlConfig(store);
    const history = await listAlertmanagerControlHistory({ store, limit: 1 });

    expect(getReceiverName(saved?.config || null)).toBe("oncall-receiver");
    expect(result.history.outcome).toBe("success");
    expect(result.history.webhookTargets).toEqual(["https://hooks.example.com/***"]);
    expect(history[0]?.outcome).toBe("success");
    expect(runtimeAdapter.actions).toEqual(["write#1", "reload#1", "ready#1"]);
  });

  it("reload 失败路径：应回滚到旧配置并记录 rolled_back", async () => {
    const store = new MemoryAlertmanagerStore();
    const runtimeAdapter = new StubAlertmanagerRuntimeAdapter();
    runtimeAdapter.failReloadAtCall = 1;
    await seedConfig(store, baseConfig);

    let thrown: unknown;
    try {
      await syncAlertmanagerControlConfig(nextConfig, {
        actor: "ops-user",
        reason: "触发 reload 失败回滚",
        runtime,
        store,
        runtimeAdapter,
      });
    } catch (error) {
      thrown = error;
    }

    const saved = await readAlertmanagerControlConfig(store);
    const history = await listAlertmanagerControlHistory({ store, limit: 1 });
    const configWrites = store.writes.filter(
      (item) => item.key === ALERTMANAGER_CONFIG_SETTING_KEY,
    );

    expect(thrown).toBeInstanceOf(AlertmanagerSyncError);
    expect((thrown as AlertmanagerSyncError).rollbackSucceeded).toBe(true);
    expect(getReceiverName(saved?.config || null)).toBe("primary-receiver");
    expect(history[0]?.outcome).toBe("rolled_back");
    expect(configWrites.length).toBe(3);
    expect(runtimeAdapter.actions).toEqual([
      "write#1",
      "reload#1",
      "write#2",
      "reload#2",
      "ready#1",
    ]);
  });

  it("ready 失败路径：应回滚到旧配置并记录 rolled_back", async () => {
    const store = new MemoryAlertmanagerStore();
    const runtimeAdapter = new StubAlertmanagerRuntimeAdapter();
    runtimeAdapter.failReadyAtCall = 1;
    await seedConfig(store, baseConfig);

    let thrown: unknown;
    try {
      await syncAlertmanagerControlConfig(nextConfig, {
        actor: "ops-user",
        reason: "触发 ready 失败回滚",
        runtime,
        store,
        runtimeAdapter,
      });
    } catch (error) {
      thrown = error;
    }

    const saved = await readAlertmanagerControlConfig(store);
    const history = await listAlertmanagerControlHistory({ store, limit: 1 });
    const configWrites = store.writes.filter(
      (item) => item.key === ALERTMANAGER_CONFIG_SETTING_KEY,
    );

    expect(thrown).toBeInstanceOf(AlertmanagerSyncError);
    expect((thrown as AlertmanagerSyncError).rollbackSucceeded).toBe(true);
    expect(getReceiverName(saved?.config || null)).toBe("primary-receiver");
    expect(history[0]?.outcome).toBe("rolled_back");
    expect(configWrites.length).toBe(3);
    expect(runtimeAdapter.actions).toEqual([
      "write#1",
      "reload#1",
      "ready#1",
      "write#2",
      "reload#2",
      "ready#2",
    ]);
  });

  it("并发 sync 应拒绝第二个请求并返回锁冲突错误", async () => {
    const store = new MemoryAlertmanagerStore();
    await seedConfig(store, baseConfig);

    let releaseReload: () => void = () => {};
    const reloadBarrier = new Promise<void>((resolve) => {
      releaseReload = () => resolve();
    });

    class BlockingRuntimeAdapter extends StubAlertmanagerRuntimeAdapter {
      override async reload(): Promise<void> {
        await super.reload();
        if (this.reloadCalls === 1) {
          await reloadBarrier;
        }
      }
    }

    const runtimeAdapter = new BlockingRuntimeAdapter();

    const first = syncAlertmanagerControlConfig(nextConfig, {
      actor: "ops-user",
      reason: "并发测试-第一个请求",
      runtime,
      store,
      runtimeAdapter,
    });

    await Promise.resolve();

    let secondError: unknown;
    try {
      await syncAlertmanagerControlConfig(nextConfig, {
        actor: "ops-user",
        reason: "并发测试-第二个请求",
        runtime,
        store,
        runtimeAdapter,
      });
    } catch (error) {
      secondError = error;
    }

    expect(secondError).toBeInstanceOf(AlertmanagerLockConflictError);
    releaseReload();

    const firstResult = await first;
    expect(firstResult.history.outcome).toBe("success");
  });
});
