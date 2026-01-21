import { describe, it, expect, mock, spyOn } from "bun:test";
import { generateClaudeAuthUrl } from "../src/lib/auth/claude";

describe("Claude OAuth Logic", () => {
  it("should generate a valid Auth URL with PKCE", () => {
    const urlString = generateClaudeAuthUrl();
    const url = new URL(urlString);
    
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("claude.ai");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBeDefined();
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBeDefined();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeDefined();
  });

  // Note: Testing startClaudeCallbackServer is complex as it starts a real Bun server.
  // We can at least test the URL generation and internal utility logic if it were exported.
  // To reach higher coverage, we'd need to mock Bun.serve or use a test client to hit the server.
});
