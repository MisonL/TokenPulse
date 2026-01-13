import { db } from '../../db';
import { credentials } from '../../db/schema';
import crypto from 'crypto';
import { logger } from '../logger';
const GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GEMINI_CLIENT_SECRET = "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";
const AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REDIRECT_URI = "http://localhost:8085/oauth2callback";
const SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
].join(' ');
// In-memory store
const pendingStates = new Set<string>();
export function generateGeminiAuthUrl() {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.add(state);
    const params = new URLSearchParams({
        client_id: GEMINI_CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state: state,
        access_type: 'offline', // Important for refresh token
        prompt: 'consent'      // Force consent to get refresh token
    });
    return `${AUTH_URL}?${params.toString()}`;
}
// Dedicated Callback Server for Gemini (Port 8085)
export function startGeminiCallbackServer() {
    Bun.serve({
        port: 8085,
        async fetch(req) {
            const url = new URL(req.url);
            
            // Only handle /oauth2callback
            if (url.pathname !== '/oauth2callback') {
                return new Response("Not Found", { status: 404 });
            }
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');
            if (error) {
                 return new Response(`<h1>Auth Failed</h1><p>${error}</p>`, { headers: { 'Content-Type': 'text/html' } });
            }
            if (!code) {
                return new Response("<h1>Missing Code</h1>", { headers: { 'Content-Type': 'text/html' } });
            }
            if (state && !pendingStates.has(state)) {
                 // proceed with caution
            }
            if (state) pendingStates.delete(state);
            // Exchange Code
            try {
                const params = new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: GEMINI_CLIENT_ID,
                    client_secret: GEMINI_CLIENT_SECRET,
                    code: code,
                    redirect_uri: REDIRECT_URI
                });
                const res = await fetch(TOKEN_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params
                });
                if (!res.ok) {
                    const text = await res.text();
                    logger.error(`Gemini token exchange failed: ${text}`, "GeminiAuth");
                    return new Response(`<h1>Exchange Failed</h1><p>${text}</p>`, { headers: { 'Content-Type': 'text/html' } });
                }
                interface GeminiTokenResponse {
                    access_token: string;
                    refresh_token: string;
                    expires_in: number;
                    id_token: string;
                    scope: string;
                }
                const data = await res.json() as GeminiTokenResponse;
                
                // Fetch User Info to get email
                let email = 'gemini-user@google';
                if (data.access_token) {
                    try {
                        const userRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
                            headers: { Authorization: `Bearer ${data.access_token}` }
                        });
                        interface GoogleUserInfo {
                            email: string;
                        }
                        const userData = await userRes.json() as GoogleUserInfo;
                        if (userData.email) email = userData.email;
                    } catch(e) {}
                }
                
                await db.insert(credentials).values({
                    id: 'gemini',
                    provider: 'gemini',
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token,
                    expiresAt: Date.now() + (data.expires_in * 1000),
                    email: email,
                    metadata: JSON.stringify({
                         scope: data.scope,
                         idToken: data.id_token
                    })
                }).onConflictDoUpdate({
                    target: credentials.provider,
                    set: {
                        accessToken: data.access_token,
                        refreshToken: data.refresh_token,
                        expiresAt: Date.now() + (data.expires_in * 1000),
                        metadata: JSON.stringify({
                             scope: data.scope,
                             idToken: data.id_token
                        }),
                        email: email
                    }
                });
                return new Response(`
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: green;">Gemini Connected!</h1>
                        <p>You can close this window now.</p>
                        <script>setTimeout(() => window.close(), 1000);</script>
                    </body>
                    </html>
                `, { headers: { 'Content-Type': 'text/html' } });
            } catch (e: any) {
                return new Response(`<h1>Internal Error</h1><p>${e.message}</p>`, { headers: { 'Content-Type': 'text/html' } });
            }
        }
    });
    logger.info("Gemini Callback Server started on port 8085", "GeminiAuth");
}
