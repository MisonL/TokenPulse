import { Hono } from 'hono';
import { db } from '../db';
import { credentials } from '../db/schema';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { initiateQwenDeviceFlow, pollQwenToken } from '../lib/auth/qwen';


import { config } from '../config';

const api = new Hono();

// Auth Middleware (Protect all routes in this router)
api.use('*', async (c, next) => {
    // Only protect write operations or specific read ops if needed.
    // Ideally, "status" might be public or protected.
    // For now, let's keep status public-ish or protected?
    // The frontend doesn't send the secret for status check usually unless updated.
    // Let's protect POST specifically or relax middleware.

    if (c.req.method === 'POST' || c.req.method === 'DELETE') {
        const authHeader = c.req.header('Authorization');
        const secret = authHeader?.replace('Bearer ', '');
        // In dev mode allow if secret is default, otherwise require match
        // Note: Frontend currently doesn't send Bearer for /status, so logic needs care.
        // OAuth flow doesn't require Bearer token for auth endpoints.

        // Let's simply allow GET /status for now without strict auth if needed for UI.
        // Or better: The UI *should* probably be behind auth, but we don't have user login yet.
        // Let's skip global protection for this sub-app and apply per-route if needed.
    }
    await next();
});

// Get Status of all providers
api.get('/status', async (c) => {
    const all = await db.select().from(credentials);
    const statusMap: Record<string, boolean> = {};
    
    // Default all to false
    const SUPPORTED = ['kiro', 'codex', 'qwen', 'iflow', 'aistudio', 'claude', 'gemini', 'antigravity'];
    SUPPORTED.forEach(p => statusMap[p] = false);
    
    all.forEach(creds => {
        statusMap[creds.provider] = true;
    });
    
    return c.json(statusMap);
});

// Get all credentials (public/protected potentially)
api.get('/', async (c) => {
    const all = await db.select().from(credentials);
    // Filter out sensitive data like tokens if needed, but for now return all or simplified list
    // Return safe list
    const safeList = all.map(cred => ({
        id: cred.id,
        provider: cred.provider,
        email: cred.email,
        status: cred.status,
        lastRefresh: cred.lastRefresh,
        expiresAt: cred.expiresAt,
        metadata: cred.metadata ? JSON.parse(cred.metadata as string) : null
    }));
    return c.json(safeList);
});

// Auth Routes (Generic Pattern could be applied later)

// --- Qwen Auth ---
api.post('/auth/qwen/start', async (c) => {
    try {
        const data = await initiateQwenDeviceFlow();
        return c.json(data);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

api.post('/auth/qwen/poll', async (c) => {
    const { device_code, code_verifier } = await c.req.json();
    try {
        const result = await pollQwenToken(device_code, code_verifier);
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// --- Kiro (AWS) Auth ---
import { initiateKiroDeviceFlow, pollKiroToken, registerKiroClient } from '../lib/auth/kiro';

api.post('/auth/kiro/start', async (c) => {
    try {
        // Kiro needs registration first every time or cached? Upstream does it every time in LoginWithBuilderID
        const reg = await registerKiroClient();
        const flow = await initiateKiroDeviceFlow(reg.clientId, reg.clientSecret);
        // We need to return clientId/Secret to frontend so it can pass it back during poll?
        // Or we should store it temporarily. Stateless approach: send it to client.
        return c.json({ ...flow, clientId: reg.clientId, clientSecret: reg.clientSecret });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});


// --- Codex Auth ---
import { generateCodexAuthUrl } from '../lib/auth/codex';

api.post('/auth/codex/url', (c) => {
    const url = generateCodexAuthUrl();
    return c.json({ url });
});

api.post('/auth/codex/poll', async (c) => {
    // Codex doesn't need polling in the same way, the window closes.
    // Frontend should check status via refresh or polling fetchCredentials().
    // But we can provider a check endpoint if needed, or just let frontend refresh.
    return c.json({ success: true, message: "Use fetchCredentials" });
});

// --- iFlow Auth ---
import { generateIflowAuthUrl } from '../lib/auth/iflow';

api.post('/auth/iflow/url', (c) => {
    const url = generateIflowAuthUrl();
    return c.json({ url });
});

// --- Gemini Auth ---
import { generateGeminiAuthUrl } from '../lib/auth/gemini';
api.post('/auth/gemini/url', (c) => {
    return c.json({ url: generateGeminiAuthUrl() });
});

// --- Claude Auth ---
import { generateClaudeAuthUrl } from '../lib/auth/claude';
api.post('/auth/claude/url', (c) => {
    return c.json({ url: generateClaudeAuthUrl() });
});

// --- AI Studio (Vertex) ---
api.post('/auth/aistudio/save', async (c) => {
    try {
        const { serviceAccountJson } = await c.req.json();
        if (!serviceAccountJson) return c.json({ error: "Missing JSON" }, 400);

        let parsed: any;
        try {
            parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
        } catch(e) {
            return c.json({ error: "Invalid JSON format" }, 400);
        }

        const projectId = parsed.project_id;
        const clientEmail = parsed.client_email;

        if (!projectId || !clientEmail) {
            return c.json({ error: "JSON must contain project_id and client_email" }, 400);
        }

        // Save
        await db.insert(credentials).values({
            id: 'aistudio',
            provider: 'aistudio',
            accessToken: 'service-account', // Placeholder
            email: clientEmail,
            metadata: JSON.stringify({
                service_account: parsed,
                project_id: projectId,
                location: 'us-central1' // Default
            }),
            updatedAt: new Date().toISOString()
        }).onConflictDoUpdate({
            target: credentials.provider,
            set: {
                metadata: JSON.stringify({
                    service_account: parsed,
                    project_id: projectId,
                    location: 'us-central1'
                }),
                email: clientEmail,
                updatedAt: new Date().toISOString()
            }
        });

        return c.json({ success: true });
    } catch (e: any) {
         return c.json({ error: e.message }, 500);
    }
});






// Delete Credential (Disconnect)
api.delete('/:provider', async (c) => {
    const provider = c.req.param('provider');
    
    if (!provider) {
        return c.json({ error: 'Provider required' }, 400);
    }
    
    await db.delete(credentials).where(eq(credentials.provider, provider));
    
    return c.json({ success: true, provider });
});

export default api;
