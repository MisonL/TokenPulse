import { Hono } from "hono";
import { strictAuthMiddleware } from "../middleware/auth";

export const VERIFY_SECRET_PATH = "/api/auth/verify-secret";

const auth = new Hono();

auth.get("/verify-secret", strictAuthMiddleware, async (c) => {
  return c.json({ success: true });
});

export default auth;
