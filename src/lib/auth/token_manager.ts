import { db } from '../../db';
import { credentials } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../../config';

export interface FullCredential {
  accessToken: string;
  refreshToken: string | null;
  email: string | null;
  metadata?: any;
}

export class TokenManager {
  static async getValidToken(
    providerId: string, 
    refreshFn: (refreshToken: string) => Promise<any>
  ): Promise<FullCredential | null> {
    const creds = await db.select().from(credentials).where(eq(credentials.provider, providerId)).limit(1);
    if (creds.length === 0) return null;
    
    const cred = creds[0];
    if (!cred || !cred.accessToken) return null;
    const now = Date.now();
    
    const parseMetadata = (m?: string | null) => {
      try { return m ? JSON.parse(m) : {}; } catch { return {}; }
    };

    // Check if expired (with 5 minute buffer)
    if (cred.expiresAt && cred.expiresAt > (now + 5 * 60 * 1000)) {
      return {
        accessToken: cred.accessToken as string,
        refreshToken: cred.refreshToken,
        email: cred.email,
        metadata: parseMetadata(cred.metadata)
      };
    }
    
    // Refresh
    if (!cred.refreshToken) return null;
    
    try {
      console.log(`[TokenManager] Refreshing token for ${providerId}...`);
      const newData = await refreshFn(cred.refreshToken);
      
      const newMetadata = (newData.id_token || newData.email || (newData as any).account) ? { ...parseMetadata(cred.metadata), ...newData } : cred.metadata;

      await db.update(credentials).set({
        accessToken: newData.access_token,
        refreshToken: newData.refresh_token || cred.refreshToken, // Keep old if not rotated
        expiresAt: now + (newData.expires_in * 1000),
        lastRefresh: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }).where(eq(credentials.id, cred.id));
      
      return {
        accessToken: newData.access_token,
        refreshToken: newData.refresh_token || cred.refreshToken,
        email: cred.email,
        metadata: typeof newMetadata === 'string' ? parseMetadata(newMetadata) : newMetadata
      };
    } catch (e) {
      console.error(`[TokenManager] Failed to refresh token for ${providerId}:`, e);
      return null;
    }
  }
}
