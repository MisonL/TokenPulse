import { Hono } from "hono";
import { advancedOnly } from "../middleware/advanced";
import { getEditionFeatures } from "../lib/edition";

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
    ],
  });
});

enterprise.get("/audit/events", (c) => {
  return c.json({
    data: [],
    message: "审计事件能力已启用（当前为重构骨架阶段）",
  });
});

export default enterprise;
