import { Hono } from "hono";

const logs = new Hono();

import { db } from "../db";
import { systemLogs } from "../db/schema";
import { desc, sql } from "drizzle-orm";

import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

// Get recent logs
logs.get(
  "/", 
  zValidator(
    "query",
    z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(50),
    })
  ),
  async (c) => {
    const { page, pageSize } = c.req.valid("query");
    const offset = (page - 1) * pageSize;

  const [history, total] = await Promise.all([
    db
      .select()
      .from(systemLogs)
      .orderBy(desc(systemLogs.id))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(systemLogs),
  ]);

  return c.json({
    data: history,
    meta: {
      page,
      pageSize,
      total: total[0]?.count || 0,
      totalPages: Math.ceil((total[0]?.count || 0) / pageSize),
    },
  });
});

export default logs;
