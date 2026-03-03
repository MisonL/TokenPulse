import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { advancedOnly } from "../middleware/advanced";
import { getEditionFeatures } from "../lib/edition";
import { queryAuditEvents, writeAuditEvent } from "../lib/admin/audit";

const enterprise = new Hono();

enterprise.use("*", advancedOnly);

enterprise.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "tokenpulse-enterprise",
    edition: "advanced",
  });
});

enterprise.get("/features", (c) => {
  return c.json(getEditionFeatures());
});

enterprise.get("/rbac/permissions", (c) => {
  return c.json({
    data: [
      { key: "admin.dashboard.read", name: "查看企业仪表盘" },
      { key: "admin.users.manage", name: "管理企业用户" },
      { key: "admin.billing.manage", name: "管理计费与配额" },
      { key: "admin.audit.read", name: "查看审计日志" },
      { key: "admin.audit.write", name: "写入审计事件" },
    ],
  });
});

enterprise.get("/rbac/roles", (c) => {
  return c.json({
    data: [
      {
        key: "owner",
        name: "所有者",
        permissions: [
          "admin.dashboard.read",
          "admin.users.manage",
          "admin.billing.manage",
          "admin.audit.read",
          "admin.audit.write",
        ],
      },
      {
        key: "auditor",
        name: "审计员",
        permissions: ["admin.dashboard.read", "admin.audit.read"],
      },
      {
        key: "operator",
        name: "运维员",
        permissions: ["admin.dashboard.read", "admin.users.manage"],
      },
    ],
  });
});

const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  action: z.string().trim().min(1).optional(),
  resource: z.string().trim().min(1).optional(),
  result: z.enum(["success", "failure"]).optional(),
  keyword: z.string().trim().min(1).optional(),
});

enterprise.get(
  "/audit/events",
  zValidator("query", auditQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const result = await queryAuditEvents(query);
      return c.json(result);
    } catch (error: any) {
      return c.json(
        { error: "审计事件查询失败，请先执行数据库迁移。", details: error?.message },
        500,
      );
    }
  },
);

const auditCreateSchema = z.object({
  action: z.string().trim().min(1),
  resource: z.string().trim().min(1),
  resourceId: z.string().trim().min(1).optional(),
  result: z.enum(["success", "failure"]).optional(),
  details: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

enterprise.post(
  "/audit/events",
  zValidator("json", auditCreateSchema),
  async (c) => {
    try {
      const payload = c.req.valid("json");
      const ip = resolveClientIp(
        c.req.header("x-forwarded-for"),
        c.req.header("cf-connecting-ip"),
      );
      const userAgent = c.req.header("user-agent") || undefined;
      const actor = c.req.header("x-admin-user") || "api-secret";

      await writeAuditEvent({
        actor,
        action: payload.action,
        resource: payload.resource,
        resourceId: payload.resourceId,
        result: payload.result,
        details: payload.details,
        ip,
        userAgent,
      });

      return c.json({ success: true });
    } catch (error: any) {
      return c.json(
        { error: "写入审计事件失败。", details: error?.message },
        500,
      );
    }
  },
);

enterprise.get("/billing/quotas", (c) => {
  return c.json({
    data: {
      mode: "advanced",
      message: "计费与配额能力已进入可扩展接口阶段。",
      limits: {
        requestsPerMinute: 0,
        tokensPerDay: 0,
      },
    },
  });
});

function resolveClientIp(
  forwardedFor?: string,
  cfConnectingIp?: string,
): string | undefined {
  if (cfConnectingIp) return cfConnectingIp;
  if (!forwardedFor) return undefined;
  return forwardedFor.split(",")[0]?.trim();
}

export default enterprise;
