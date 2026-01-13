import { db } from '../../db';
import { credentials } from '../../db/schema';
import { eq } from 'drizzle-orm';

// Simple Scheduler to Keep-Alive tokens
// Runs every 4 hours by default.

const INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 Hours

import { RefreshHandlers } from '../auth/refreshers';
import { TokenManager } from '../auth/token_manager';

export function startScheduler() {
    console.log('[Scheduler] Starting active keep-alive scheduler...');
    
    // Run immediately on start (interactive dev mode)
    runChecks();
    
    setInterval(runChecks, INTERVAL_MS);
}

async function runChecks() {
    console.log('[Scheduler] Running keep-alive checks...');
    try {
        const allCreds = await db.select().from(credentials);
        for (const cred of allCreds) {
            const handler = RefreshHandlers[cred.provider];
            if (handler) {
                try {
                    console.log(`[Scheduler] Checking ${cred.provider} (${cred.email})...`);
                    const newData = await handler(cred);
                    if (newData) {
                         const now = Date.now();
                         await db.update(credentials).set({
                            accessToken: newData.access_token,
                            refreshToken: newData.refresh_token || cred.refreshToken,
                            expiresAt: now + (newData.expires_in * 1000),
                            lastRefresh: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            metadata: newData.metadata ? (typeof newData.metadata === 'string' ? newData.metadata : JSON.stringify(newData.metadata)) : cred.metadata
                         }).where(eq(credentials.id, cred.id));
                         console.log(`[Scheduler] Refreshed token for ${cred.provider}`);
                    }
                } catch (errInner) {
                    console.error(`[Scheduler] Failed to refresh ${cred.provider}:`, errInner);
                }
            }
        }
    } catch (e) {
        console.error('[Scheduler] Error:', e);
    }
}
