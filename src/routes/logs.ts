import { Hono } from 'hono';

const logs = new Hono();

import { db } from '../db';
import { systemLogs } from '../db/schema';
import { desc, sql } from 'drizzle-orm';

// Get recent logs
logs.get('/', async (c) => {
    const page = Number(c.req.query('page')) || 1;
    const pageSize = Number(c.req.query('pageSize')) || 50;
    const offset = (page - 1) * pageSize;

    const [history, total] = await Promise.all([
        db.select().from(systemLogs)
            .orderBy(desc(systemLogs.id))
            .limit(pageSize)
            .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(systemLogs)
    ]);
        
    return c.json({
        data: history,
        meta: {
            page,
            pageSize,
            total: total[0]?.count || 0,
            totalPages: Math.ceil((total[0]?.count || 0) / pageSize)
        }
    });
});

export default logs;
