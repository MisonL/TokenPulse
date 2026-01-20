import crypto from "crypto";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";

export interface DeviceProfile {
  machineId: string;
  macMachineId?: string;
  devDeviceId: string;
  sqmId: string;
  userAgent: string;
}

export class DeviceManager {
  private static DEFAULT_UA = "antigravity/1.104.0 darwin/arm64";

  /**
   * Get or generate a persistent device profile for a credential.
   */
  static async getProfile(cred: { id: string; email?: string | null }): Promise<DeviceProfile> {
    const id = cred.id;
    const email = cred.email || "unknown";

    // 1. Try to find in DB
    const creds = await db
      .select({ deviceProfile: credentials.deviceProfile })
      .from(credentials)
      .where(eq(credentials.id, id))
      .limit(1);

    if (creds.length > 0 && creds[0] && creds[0].deviceProfile) {
      try {
        return JSON.parse(creds[0].deviceProfile);
      } catch (e) {
        // corrupted JSON, generate new
      }
    }

    // 2. Generate New Profile
    const profile = this.generateProfile(email);

    // 3. Save to DB (async/background)
    this.saveProfile(id, profile).catch(console.error);

    return profile;
  }

  private static generateProfile(seed: string): DeviceProfile {
    const hash = (s: string) =>
      crypto.createHash("sha256").update(s).digest("hex");
    const uuid = () => crypto.randomUUID();

    return {
      machineId: hash(seed + "_machine").substring(0, 64),
      macMachineId: hash(seed + "_mac").substring(0, 64),
      devDeviceId: uuid(),
      sqmId: `{${uuid().toUpperCase()}}`,
      userAgent: this.DEFAULT_UA,
    };
  }

  private static async saveProfile(id: string, profile: DeviceProfile) {
    await db
      .update(credentials)
      .set({ deviceProfile: JSON.stringify(profile) })
      .where(eq(credentials.id, id));
  }

  /**
   * Injects device headers into a request context.
   */
  static injectHeaders(
    headers: Record<string, string>,
    profile: DeviceProfile,
  ): Record<string, string> {
    return {
      ...headers,
      "X-Antigravity-Machine-Id": profile.machineId,
      "X-Antigravity-Dev-Device-Id": profile.devDeviceId,
      "X-Antigravity-Sqm-Id": profile.sqmId,
      "User-Agent": profile.userAgent,
    };
  }
}
