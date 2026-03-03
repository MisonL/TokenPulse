import { encrypt, decrypt, isEncryptionAvailable, encryptObject, decryptObject } from "../crypto";
import type { Credential, NewCredential } from "../../db/schema";

/**
 * Encrypt sensitive fields in a credential object before saving to DB.
 * Fields encrypted: accessToken, refreshToken, metadata.
 */
export function encryptCredential(data: NewCredential): NewCredential {
  if (!data) return data;

  if (!isEncryptionAvailable()) {
    console.warn("[安全] 未设置 ENCRYPTION_SECRET，凭据将以明文保存！");
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
      encrypted.metadata = encrypt(encrypted.metadata);
  }

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
  }

  try {
    if (decrypted.refreshToken) {
      decrypted.refreshToken = decrypt(decrypted.refreshToken);
    }
  } catch (e) {
  }

  try {
    if (typeof decrypted.metadata === 'string' && decrypted.metadata.length > 0) {
        decrypted.metadata = decrypt(decrypted.metadata);
    }
  } catch (e) {
  }

  try {
      if (typeof decrypted.attributes === 'string' && decrypted.attributes.length > 0) {
          decrypted.attributes = decrypt(decrypted.attributes);
      }
  } catch (e) {
  }

  return decrypted;
}
