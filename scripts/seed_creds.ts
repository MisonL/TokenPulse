import { db } from "../src/db";
import { credentials } from "../src/db/schema";
import { randomUUID } from "node:crypto";

async function seed() {
  console.log("Seeding dummy antigravity credential...");
  try {
    const expiresAt = Math.floor(Date.now() / 1000) + 1000000;
    await db.insert(credentials).values({
      id: randomUUID(),
      provider: "antigravity",
      email: "test@example.com",
      accessToken: "dummy_access_token",
      refreshToken: "dummy_refresh_token",
      expiresAt: expiresAt,
      status: "connected",
      lastRefresh: new Date().toISOString(),
      metadata: JSON.stringify({ scope: "test", idToken: "test" }),
    }).onConflictDoNothing();
    console.log("Done.");
  } catch (e) {
    console.error("Error seeding:", e);
  }
}

seed();
