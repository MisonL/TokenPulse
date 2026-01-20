import crypto from "crypto";

/**
 * 加密配置
 */
const ENCRYPTION_CONFIG = {
  algorithm: "aes-256-gcm",
  keyLength: 32, // 256 bits
  ivLength: 16, // 128 bits
  saltLength: 64,
  tagLength: 16,
  iterations: 100000,
};

/**
 * 从环境变量获取加密密钥
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;

  if (!secret) {
    throw new Error(
      "ENCRYPTION_SECRET environment variable is required for encryption",
    );
  }

  // 使用 PBKDF2 从环境变量派生密钥
  const salt = crypto.createHash("sha256").update("tokenpulse-salt").digest();
  return crypto.pbkdf2Sync(
    secret,
    salt,
    ENCRYPTION_CONFIG.iterations,
    ENCRYPTION_CONFIG.keyLength,
    "sha256",
  );
}

/**
 * 加密数据
 */
export function encrypt(data: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);

    const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.algorithm, key, iv);

    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = (cipher as crypto.CipherGCM).getAuthTag();

    // 组合: iv + authTag + encrypted
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, "hex"),
    ]);

    return combined.toString("base64");
  } catch (error) {
    throw new Error(
      `Encryption failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 解密数据
 */
export function decrypt(encryptedData: string): string {
  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedData, "base64");

    // 提取 iv, authTag 和加密数据
    const iv = combined.subarray(0, ENCRYPTION_CONFIG.ivLength);
    const authTag = combined.subarray(
      ENCRYPTION_CONFIG.ivLength,
      ENCRYPTION_CONFIG.ivLength + ENCRYPTION_CONFIG.tagLength,
    );
    const encrypted = combined.subarray(
      ENCRYPTION_CONFIG.ivLength + ENCRYPTION_CONFIG.tagLength,
    );

    const decipher = crypto.createDecipheriv(
      ENCRYPTION_CONFIG.algorithm,
      key,
      iv,
    );
    (decipher as crypto.DecipherGCM).setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf8");
  } catch (error) {
    throw new Error(
      `Decryption failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 加密 JSON 对象
 */
export function encryptObject<T extends Record<string, unknown>>(
  obj: T,
): string {
  try {
    const jsonString = JSON.stringify(obj);
    return encrypt(jsonString);
  } catch (error) {
    throw new Error(
      `Object encryption failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 解密 JSON 对象
 */
export function decryptObject<T extends Record<string, unknown>>(
  encryptedData: string,
): T {
  try {
    const jsonString = decrypt(encryptedData);
    return JSON.parse(jsonString) as T;
  } catch (error) {
    throw new Error(
      `Object decryption failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 哈希数据（用于密码等）
 */
export function hashData(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * 生成随机字符串
 */
export function generateRandomString(length: number = 32): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

/**
 * 生成安全的 API 密钥
 */
export function generateApiKey(): string {
  const timestamp = Date.now().toString(36);
  const random = generateRandomString(24);
  return `tp_${timestamp}_${random}`;
}

/**
 * 验证数据完整性（使用 HMAC）
 */
export function signData(data: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(data);
  return hmac.digest("hex");
}

/**
 * 验证数据签名
 */
export function verifySignature(
  data: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = signData(data, secret);
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, "hex"),
    Buffer.from(signature, "hex"),
  );
}

/**
 * 屏蔽敏感信息
 */
export function maskSensitiveData(
  data: string,
  visibleChars: number = 4,
): string {
  if (data.length <= visibleChars * 2) {
    return "*".repeat(data.length);
  }

  const start = data.substring(0, visibleChars);
  const end = data.substring(data.length - visibleChars);
  const masked = "*".repeat(data.length - visibleChars * 2);

  return `${start}${masked}${end}`;
}

/**
 * 检查加密是否可用
 */
export function isEncryptionAvailable(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
