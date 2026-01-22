
import { db } from "../src/db";
import { credentials } from "../src/db/schema";
import { encrypt, decrypt } from "../src/lib/crypto";
import { eq } from "drizzle-orm";

/**
 * Migration script to encrypt all existing plain text credentials.
 * Usage: bun run scripts/encrypt_legacy_credentials.ts
 */

async function isEncrypted(data: string | null): Promise<boolean> {
  if (!data) return true; // Null is considered "safe" / no action needed
  try {
    // Try to decrypt. If it succeeds, it's already encrypted.
    decrypt(data);
    return true;
  } catch (e) {
    return false;
  }
}

async function migrate() {
  console.log("🔒 Starting credential encryption migration...");

  const allCreds = await db.select().from(credentials);
  console.log(`📊 Found ${allCreds.length} credentials to check.`);

  let encryptedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const cred of allCreds) {
    let needsUpdate = false;
    const updates: any = {};

    // 1. Check Access Token
    if (cred.accessToken && !(await isEncrypted(cred.accessToken))) {
      updates.accessToken = encrypt(cred.accessToken);
      needsUpdate = true;
      console.log(`  > Encrypting accessToken for ${cred.provider} (${cred.id})`);
    }

    // 2. Check Refresh Token
    if (cred.refreshToken && !(await isEncrypted(cred.refreshToken))) {
      updates.refreshToken = encrypt(cred.refreshToken);
      needsUpdate = true;
      console.log(`  > Encrypting refreshToken for ${cred.provider} (${cred.id})`);
    }

    // 3. Check Metadata
    if (cred.metadata && typeof cred.metadata === 'string' && cred.metadata.length > 0) {
        if (!(await isEncrypted(cred.metadata))) {
            try {
                JSON.parse(cred.metadata);
                updates.metadata = encrypt(cred.metadata);
                needsUpdate = true;
                console.log(`  > Encrypting metadata for ${cred.provider} (${cred.id})`);
            } catch (e) {
                if (!(await isEncrypted(cred.metadata))) {
                    updates.metadata = encrypt(cred.metadata);
                    needsUpdate = true;
                    console.log(`  > Encrypting metadata (raw string) for ${cred.provider} (${cred.id})`);
                }
            }
        }
    }

    // 4. Check Attributes
    if (cred.attributes && typeof cred.attributes === 'string' && cred.attributes.length > 0) {
         if (!(await isEncrypted(cred.attributes))) {
             try {
                 JSON.parse(cred.attributes);
                 updates.attributes = encrypt(cred.attributes);
                 needsUpdate = true;
                 console.log(`  > Encrypting attributes for ${cred.provider} (${cred.id})`);
             } catch (e) {
                 if (!(await isEncrypted(cred.attributes))) {
                     updates.attributes = encrypt(cred.attributes);
                     needsUpdate = true;
                     console.log(`  > Encrypting attributes (raw string) for ${cred.provider} (${cred.id})`);
                 }
             }
         }
    }

    if (needsUpdate) {
      try {
        await db.update(credentials).set(updates).where(eq(credentials.id, cred.id));
        encryptedCount++;
      } catch (e) {
        console.error(`❌ Failed to update credential ${cred.id}:`, e);
        errorCount++;
      }
    } else {
      skippedCount++;
    }
  }

  console.log("✅ Migration complete!");
  console.log(`   - Encrypted: ${encryptedCount}`);
  console.log(`   - Skipped (Already Encrypted/Empty): ${skippedCount}`);
  console.log(`   - Errors: ${errorCount}`);
  
  process.exit(0);
}

migrate().catch((e) => {
  console.error("❌ Fatal error during migration:", e);
  process.exit(1);
});
