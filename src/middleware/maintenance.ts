import type { Context, Next } from 'hono';
import { db } from '../db';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';

// Cache maintenance mode state to avoid hitting DB on every request
let isMaintenance = false;
let lastCheck = 0;
const CACHE_TTL = 10000; // 10 seconds

export const maintenanceMiddleware = async (c: Context, next: Next) => {
    // Skip for Admin API and Internal Assets
    if (c.req.path.startsWith('/api/settings') || 
        c.req.path.startsWith('/api/credentials') ||
        c.req.path.startsWith('/assets') ||
        c.req.path === '/icon.png') {
        await next();
        return;
    }

    const now = Date.now();
    if (now - lastCheck > CACHE_TTL) {
        try {
            const res = await db.select().from(settings).where(eq(settings.key, 'maintenance_mode')).limit(1);
            if (res.length > 0 && res[0]) {
                isMaintenance = res[0].value === 'true';
            }
            lastCheck = now;
        } catch (e) {
            console.error("Failed to check maintenance mode", e);
        }
    }

    if (isMaintenance) {
        return c.json({ 
            error: 'Service Unavailable', 
            message: 'System is currently in maintenance mode.' 
        }, 503);
    }

    await next();
};
