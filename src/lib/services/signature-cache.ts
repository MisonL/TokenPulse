import crypto from "crypto";

// Types
export interface SignatureEntry {
  signature: string;
  timestamp: number;
}

interface SessionCache {
  entries: Map<string, SignatureEntry>; // key: textHash
  lastAccess: number;
}

// Configuration
const SIGNATURE_CACHE_TTL = 3 * 60 * 60 * 1000; // 3 Hours
const SESSION_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 Minutes
const MIN_VALID_SIGNATURE_LEN = 50;

// Storage
const signatureCache = new Map<string, SessionCache>();
let cleanupInterval: Timer | null = null;

// Helper: Hash text content for stable keys (first 16 chars of sha256 hex)
function hashText(text: string): string {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex")
    .substring(0, 16);
}

// Helper: Get or create session cache
function getOrCreateSession(sessionId: string): SessionCache {
  startCleanupTask();

  let session = signatureCache.get(sessionId);
  if (!session) {
    session = {
      entries: new Map(),
      lastAccess: Date.now(),
    };
    signatureCache.set(sessionId, session);
  } else {
    session.lastAccess = Date.now();
  }
  return session;
}

// Helper: Start background cleanup task (idempotent)
function startCleanupTask() {
  if (cleanupInterval) return;

  // Use unref() if available (Node.js) so it doesn't block process exit
  // In universal context, standard interval.
  cleanupInterval = setInterval(purgeExpiredSessions, SESSION_CLEANUP_INTERVAL);
  if (typeof (cleanupInterval as any).unref === "function") {
    (cleanupInterval as any).unref();
  }
}

// Helper: Purge expired sessions
function purgeExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of signatureCache.entries()) {
    // Clean entries within session
    for (const [textHash, entry] of session.entries.entries()) {
      if (now - entry.timestamp > SIGNATURE_CACHE_TTL) {
        session.entries.delete(textHash);
      }
    }

    // Remove empty sessions
    if (session.entries.size === 0) {
      signatureCache.delete(sessionId);
    }
  }
}

/**
 * Cache a thinking signature for a given session and text content.
 */
export function cacheSignature(
  sessionId: string,
  text: string,
  signature: string,
): void {
  if (!sessionId || !text || !signature) return;
  if (signature.length < MIN_VALID_SIGNATURE_LEN) return;

  const session = getOrCreateSession(sessionId);
  const textHash = hashText(text);

  session.entries.set(textHash, {
    signature,
    timestamp: Date.now(),
  });
}

/**
 * Retrieve a cached signature for a given session and text content.
 * Returns null if not found or expired.
 */
export function getCachedSignature(
  sessionId: string,
  text: string,
): string | null {
  if (!sessionId || !text) return null;

  const session = signatureCache.get(sessionId);
  if (!session) return null;

  session.lastAccess = Date.now(); // Refresh session access

  const textHash = hashText(text);
  const entry = session.entries.get(textHash);

  if (!entry) return null;

  // Check TTL (sliding expiration for individual entry is optional, here we check absolute age)
  if (Date.now() - entry.timestamp > SIGNATURE_CACHE_TTL) {
    session.entries.delete(textHash);
    return null;
  }

  // Update timestamp on access (sliding expiration)
  entry.timestamp = Date.now();
  return entry.signature;
}

/**
 * Clear signature cache for a specific session or all sessions.
 */
export function clearSignatureCache(sessionId?: string): void {
  if (sessionId) {
    signatureCache.delete(sessionId);
  } else {
    signatureCache.clear();
  }
}

/**
 * Validates if the given signature string looks valid.
 */
export function isValidSignature(signature: string): boolean {
  return !!signature && signature.length >= MIN_VALID_SIGNATURE_LEN;
}
