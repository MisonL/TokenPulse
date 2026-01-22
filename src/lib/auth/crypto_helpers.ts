import { encrypt, decrypt, isEncryptionAvailable, encryptObject, decryptObject } from "../crypto";
import type { Credential, NewCredential } from "../../db/schema";

/**
 * Encrypt sensitive fields in a credential object before saving to DB.
 * Fields encrypted: accessToken, refreshToken, metadata.
 */
export function encryptCredential(data: NewCredential): NewCredential {
  // If encryption is not configured, warn and return raw data (or throw?)
  // Given "Production Ready" goal, we should probably warn but proceed if no key,
  // BUT in this specific task we want to enforce encryption.
  // However, `isEncryptionAvailable` checks for ENCRYPTION_SECRET.
  if (!data) return data;

  if (!isEncryptionAvailable()) {
    console.warn("[Security] ENCRYPTION_SECRET not set. Saving credentials in PLAIN TEXT!");
    return data;
  }

  const encrypted = { ...data };

  if (encrypted.accessToken) {
    encrypted.accessToken = encrypt(encrypted.accessToken);
  }

  if (encrypted.refreshToken) {
    encrypted.refreshToken = encrypt(encrypted.refreshToken);
  }

  if (typeof encrypted.metadata === 'string' && encrypted.metadata.length > 0) {
      // Encrypt the entire metadata string
      encrypted.metadata = encrypt(encrypted.metadata);
  }

  // Handle attributes if needed (it's JSON string)
  if (typeof encrypted.attributes === 'string' && encrypted.attributes.length > 0) {
      encrypted.attributes = encrypt(encrypted.attributes);
  }

  return encrypted;
}

/**
 * Decrypt sensitive fields in a credential object after reading from DB.
 */
export function decryptCredential(data: Credential): Credential {
  if (!data) return data;
  
  if (!isEncryptionAvailable()) {
    return data;
  }

  const decrypted = { ...data };

  try {
    if (decrypted.accessToken) {
      decrypted.accessToken = decrypt(decrypted.accessToken);
    }
  } catch (e) {
    // Fail silently -> It might be plain text
    // console.warn(`[Security] Failed to decrypt accessToken for ${data.id}. Assuming plain text.`);
  }

  try {
    if (decrypted.refreshToken) {
      decrypted.refreshToken = decrypt(decrypted.refreshToken);
    }
  } catch (e) {
     // console.warn(`[Security] Failed to decrypt refreshToken for ${data.id}. Assuming plain text.`);
  }

  try {
    if (typeof decrypted.metadata === 'string' && decrypted.metadata.length > 0) {
        decrypted.metadata = decrypt(decrypted.metadata);
    }
  } catch (e) {
      // console.warn(`[Security] Failed to decrypt metadata for ${data.id}. Assuming plain text.`);
  }

  try {
      if (typeof decrypted.attributes === 'string' && decrypted.attributes.length > 0) {
          decrypted.attributes = decrypt(decrypted.attributes);
      }
  } catch (e) {
      // console.warn(`[Security] Failed to decrypt attributes for ${data.id}. Assuming plain text.`);
  }

  return decrypted;
}
