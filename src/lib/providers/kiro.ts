import { BaseProvider } from "./base";
import type { ChatRequest } from "./base";
import type { AuthConfig, TokenResponse } from "../auth/oauth-client";
import {
  AgenticSystemPrompt,
  checkThinkingMode,
  shortenToolName,
} from "./utils";
import { logger } from "../logger";
import { InfrastructureRegistry } from "../auth/infrastructure-registry";
import crypto from "crypto";
import { config } from "../../config";
import type { Context } from "hono";
import https from "https";

const START_URL = "https://view.awsapps.com/start";
const REGION = "us-east-1";
const OIDC_REGISTER_URL = `https://oidc.${REGION}.amazonaws.com/client/register`;
const OIDC_AUTH_URL = `https://oidc.${REGION}.amazonaws.com/device_authorization`;
const OIDC_TOKEN_URL = `https://oidc.${REGION}.amazonaws.com/token`;

export class KiroProvider extends BaseProvider {
  protected providerId = "kiro";
  protected endpoint = "https://q.us-east-1.amazonaws.com/";

  protected authConfig: AuthConfig = {
    providerId: "kiro",
    clientId: "", // Will be filled dynamically
    authUrl: OIDC_AUTH_URL,
    tokenUrl: OIDC_TOKEN_URL,
    redirectUri: "",
    scopes: [
      "codewhisperer:completions",
      "codewhisperer:analysis",
      "codewhisperer:conversations",
      "codewhisperer:transformations",
      "codewhisperer:taskassist",
    ],
  };

  constructor() {
    super();
    this.init();
  }

  /**
   * 最优实现：动态注册与缓存
   */
  private async ensureClientRegistered(): Promise<void> {
    // 1. 尝试从注册中心读取缓存
    const cached = await InfrastructureRegistry.get<{
      clientId: string;
      clientSecret: string;
    }>("kiro_client_creds");
    if (cached) {
      this.authConfig.clientId = cached.clientId;
      this.authConfig.clientSecret = cached.clientSecret;
      return;
    }

    try {
      logger.info("Kiro: Registering new AWS OIDC client...");
      const regResp = await fetch(OIDC_REGISTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "KiroIDE",
        },
        body: JSON.stringify({
          clientName: "Kiro IDE",
          clientType: "public",
          scopes: this.authConfig.scopes,
          grantTypes: [
            "urn:ietf:params:oauth:grant-type:device_code",
            "refresh_token",
          ],
        }),
      });

      if (!regResp.ok)
        throw new Error("AWS OIDC Register Failed: " + (await regResp.text()));

      const data = (await regResp.json()) as any;
      this.authConfig.clientId = data.clientId;
      this.authConfig.clientSecret = data.clientSecret;

      await InfrastructureRegistry.set(
        "kiro_client_creds",
        {
          clientId: data.clientId,
          clientSecret: data.clientSecret,
        },
        "Dynamic credentials for AWS Kiro",
      );
    } catch (e: any) {
      logger.error("Kiro: Failed to register OIDC client", e);
      throw e;
    }
  }

  /**
   * 身份解析钩子：AWS Kiro 专有
   */
  protected override async fetchUserInfo(token: string): Promise<any> {
    let identity: any = { id: "aws-kiro-user" };

    // 1. 尝试获取 Profile Info (Kiro 专有，用于获取 Profile ARN)
    try {
      const resp = await fetch(
        "https://codewhisperer.us-east-1.amazonaws.com",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "AmazonCodeWhispererService.ListProfiles",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ origin: "AI_EDITOR" }),
        },
      );

      if (resp.ok) {
        const data = (await resp.json()) as any;
        const profile = data.profiles?.[0];
        if (profile) {
          identity.profileArn = profile.arn;
          identity.name = profile.name;
          identity.id = profile.arn;
        }
      }
    } catch (e) {
      logger.warn(
        `Kiro: Failed to fetch ProfileInfo: ${e instanceof Error ? e.message : e}`,
      );
    }

    // 2. 备用尝试: ListAllowedCustomizations (部分账户 Profile 可能为空但有 Customization 权限)
    if (!identity.profileArn) {
      try {
        const resp = await fetch(
          "https://codewhisperer.us-east-1.amazonaws.com",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-amz-json-1.1",
              "X-Amz-Target":
                "AmazonCodeWhispererService.ListAvailableCustomizations",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({}),
          },
        );
        if (resp.ok) {
          // 即使没有 customization，以此验证 token 有效性，甚至从 header 中获取一些 info
          // 但通常我们需要 Profile ARN. 如果这里成功了但没 ARN，我们或许可以伪造一个默认的 ARN?
          // 不，AWS API 强依赖 ARN。
          // 最后的 fallback: 尝试构造一个推测的 ARN (如果 pattern 可知) 或者仅返回 ID。
        }
      } catch (e) {
        // ignore
      }
    }

    // 3. 尝试获取通用用户信息
    try {
      const resp = await fetch(
        "https://profile.aws.amazon.com/v1/user/details",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (resp.ok) {
        const data = (await resp.json()) as any;
        identity.email = data.email || data.identity?.email;
        identity.id = identity.id || data.identity?.arn || data.userId;
      }
    } catch (e) {
      logger.warn(
        `Kiro: Failed to fetch generic user details: ${e instanceof Error ? e.message : e}`,
      );
    }

    return {
      ...identity,
      attributes: {
        profile_arn: identity.profileArn,
        ...identity,
      },
    };
  }

  // Social Login Configuration
  private static readonly SOCIAL_AUTH_ENDPOINT =
    "https://prod.us-east-1.auth.desktop.kiro.dev";

  // Override handleAuthUrl to support switching between Device Flow (AWS) and Social Flow
  protected override async handleAuthUrl(c: Context) {
    const method = c.req.query("method"); // 'google' | 'github' | undefined (default aws)

    if (method === "google" || method === "github") {
      return this.handleSocialAuthUrl(
        c,
        method === "google" ? "Google" : "Github",
      );
    }

    try {
      await this.ensureClientRegistered();
      const deviceResp = await this.oauthService.initiateDeviceFlow(
        OIDC_AUTH_URL,
        {
          clientSecret: this.authConfig.clientSecret,
          startUrl: START_URL,
        },
      );

      return c.json({
        url:
          deviceResp.verification_uri_complete || deviceResp.verification_uri,
        code: deviceResp.user_code,
        device_code: deviceResp.device_code,
      });
    } catch (e: any) {
      logger.error("Kiro Auth Start Failed:", e);
      return c.json({ error: e.message }, 500);
    }
  }

  private async handleSocialAuthUrl(c: Context, idp: string) {
    // Construct Social Login URL
    // Format: /login?idp=Google&redirect_uri=...&code_challenge=...&state=...
    const state = crypto.randomUUID();
    const { verifier, challenge } = await this.oauthService.generatePkcePair();

    // Store verifier in cookie or state for callback (simplified here using state param hack or requiring client to store)
    // Since BaseProvider relies on client echoing state/verifier usually, we need to match that.
    // But for Social Auth, we redirect user directly.
    // We will return the URL to frontend, frontend redirects.

    const redirectUri = `${config.baseUrl}/api/kiro/callback`;
    const url = `${KiroProvider.SOCIAL_AUTH_ENDPOINT}/login?idp=${idp}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&prompt=select_account`;

    // We need to pass the verifier back to the client so it can be sent on callback exchange,
    // OR store it server side. BaseProvider (oauth-client) aims to be stateless-ish or client-driven state.
    // Let's return the URL and the verifier to the client.
    return c.json({
      url: url,
      state: state,
      code_verifier: verifier,
      auth_mode: "social", // Signal to frontend to store this verifier
    });
  }

  // Override handleCallback to intercept Social Login code exchange
  protected override setupAdditionalRoutes(router: any) {
    router.post("/auth/import", (c: Context) => this.handleImportToken(c));
  }
  protected override async handleCallback(c: any) {
    const code = c.req.query("code");
    const state = c.req.query("state");
    // If we detect this is a social login callback (maybe by state or failure of standard flow?), we switch.
    // Actually, Kiro Social uses a different Token URL.
    // We need a way to distinguish.
    // Simple way: Try Standard Device Flow (which this callback usually isn't for, Device flow polls).
    // Wait, BaseProvider handleCallback is for Authorization Code flow.
    // Kiro default is Device Flow (which doesn't use handleCallback usually, it uses poll).
    // So if handleCallback is hit for Kiro, it MUST be Social Login (or unexpected).

    if (code) {
      const verifier = c.req.query("code_verifier") || c.req.query("verifier"); // Expect frontend to pass it back

      // Exchange Code for Token at Social Endpoint
      try {
        const tokenResp = await fetch(
          `${KiroProvider.SOCIAL_AUTH_ENDPOINT}/oauth/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: code,
              code_verifier: verifier,
              redirect_uri: `${config.baseUrl}/api/kiro/callback`,
            }),
          },
        );

        if (!tokenResp.ok) throw new Error("Social Token Exchange Failed");
        const tokens = (await tokenResp.json()) as any;

        // Map to TokenData
        const tokenData = {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_in: tokens.expiresIn,
          metadata: {
            profile_arn: tokens.profileArn,
            auth_method: "social",
          },
        };

        return await this.finalizeAuth(c, tokenData);
      } catch (e: any) {
        return c.json({ error: e.message }, 500);
      }
    }

    return super.handleCallback(c);
  }

  // Stub removed, replaced by logic above
  // public async loginWithSocial... removed via overwrite

  protected override async getCustomHeaders(
    token: string,
    body: any,
    context?: any,
  ): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-amz-json-1.0",
      "X-Amz-Target":
        body.target || "AmazonQDeveloperStreamingService.SendMessage",
      "User-Agent": "aws-sdk-rust/1.3.9 os/macos lang/rust/1.87.0",
      Origin: "CLI",
    };
  }

  protected override async transformRequest(
    body: ChatRequest,
    headers?: any,
    context?: any,
  ): Promise<any> {
    // [保持原有的 transformRequest 逻辑，但可以使用 pipeline 重构部分逻辑]
    // 由于 transformRequest 逻辑非常复杂且高度耦合 Kiro 的协议，暂时保持现状，
    // 仅确保其能正确运行在新的 BaseProvider 循环中。

    const conversationId = crypto.randomUUID();
    let systemPrompt = "";
    const messages = body.messages || [];

    for (const msg of messages) {
      if (msg.role === "system") {
        if (systemPrompt) systemPrompt += "\n\n";
        systemPrompt += msg.content;
      }
    }

    if (body.model?.toLowerCase().includes("agentic")) {
      if (systemPrompt) systemPrompt += "\n";
      systemPrompt += AgenticSystemPrompt;
    }

    const thinkingEnabled = checkThinkingMode(body, headers);
    if (thinkingEnabled) {
      const thinkingHint = `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>200000</max_thinking_length>`;
      systemPrompt = systemPrompt
        ? thinkingHint + "\n\n" + systemPrompt
        : thinkingHint;
    }

    const timestamp =
      new Date().toLocaleString("en-US", { timeZone: "UTC", hour12: false }) +
      " UTC";
    const timestampContext = `[Context: Current time is ${timestamp}]`;
    systemPrompt = systemPrompt
      ? timestampContext + "\n\n" + systemPrompt
      : timestampContext;

    if (body.response_format) {
      let responseFormatHint = "";
      if (body.response_format.type === "json_object") {
        responseFormatHint =
          "[INSTRUCTION: Respond ONLY with a valid JSON object. Do not include any explanations or text outside the JSON.]";
      } else if (body.response_format.type === "json_schema") {
        responseFormatHint = `[INSTRUCTION: Respond ONLY with a JSON object that strictly follows this schema: ${JSON.stringify(body.response_format.json_schema?.schema || {})}]`;
      }
      if (responseFormatHint) {
        systemPrompt += `\n\n${responseFormatHint}`;
      }
    }

    if (body.tool_choice) {
      let toolChoiceHint = "";
      if (body.tool_choice === "none") {
        toolChoiceHint =
          "[INSTRUCTION: Do NOT use any tools. Respond with text only.]";
      } else if (body.tool_choice === "required") {
        toolChoiceHint =
          "[INSTRUCTION: You MUST use at least one of the available tools.]";
      } else if (
        typeof body.tool_choice === "object" &&
        body.tool_choice.type === "function"
      ) {
        toolChoiceHint = `[INSTRUCTION: You MUST use the tool "${shortenToolName(body.tool_choice.function?.name)}" to respond.]`;
      }

      if (toolChoiceHint) {
        systemPrompt = systemPrompt
          ? systemPrompt + "\n" + toolChoiceHint
          : toolChoiceHint;
      }
    }

    const kiroTools: any[] = [];
    if (body.tools && Array.isArray(body.tools)) {
      for (const tool of body.tools) {
        if (tool.type === "function") {
          kiroTools.push({
            toolSpecification: {
              name: shortenToolName(tool.function.name),
              description:
                tool.function.description || `Tool: ${tool.function.name}`,
              inputSchema: { json: tool.function.parameters },
            },
          });
        }
      }
    }

    const history: any[] = [];
    let currentMessage: any = null;
    let pendingToolResults: any[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isLast = i === messages.length - 1;
      if (msg.role === "system") continue;

      if (msg.role === "tool") {
        pendingToolResults.push({
          toolUseId: msg.tool_call_id,
          content: [{ text: msg.content as string }],
          status: "success",
        });
        continue;
      }

      if (msg.role === "user") {
        const userMsg = {
          userInputMessage: {
            content: (msg.content as string) || "Continue",
            modelId: body.model || "amazon-q",
            origin: "CLI",
            userInputMessageContext:
              pendingToolResults.length > 0
                ? { toolResults: [...pendingToolResults] }
                : undefined,
          },
        };
        pendingToolResults = [];
        if (isLast) currentMessage = userMsg;
        else history.push(userMsg);
      }

      if (msg.role === "assistant") {
        if (pendingToolResults.length > 0) {
          history.push({
            userInputMessage: {
              content: "Tool results provided.",
              modelId: body.model || "amazon-q",
              origin: "CLI",
              userInputMessageContext: { toolResults: [...pendingToolResults] },
            },
          });
          pendingToolResults = [];
        }

        history.push({
          assistantResponseMessage: {
            content: (msg.content as string) || "",
            toolUses: msg.tool_calls?.map((tc: any) => ({
              toolUseId: tc.id,
              name: shortenToolName(tc.function.name),
              input: JSON.parse(tc.function.arguments),
            })),
          },
        });

        if (isLast) {
          currentMessage = {
            userInputMessage: {
              content: "Continue",
              modelId: body.model || "amazon-q",
              origin: "CLI",
            },
          };
        }
      }
    }

    if (pendingToolResults.length > 0 && currentMessage) {
      if (!currentMessage.userInputMessage.userInputMessageContext)
        currentMessage.userInputMessage.userInputMessageContext = {};
      currentMessage.userInputMessage.userInputMessageContext.toolResults =
        pendingToolResults;
    }

    if (currentMessage) {
      currentMessage.userInputMessage.content = `--- SYSTEM PROMPT ---\n${systemPrompt}\n--- END SYSTEM PROMPT ---\n\n${currentMessage.userInputMessage.content}`;
      if (kiroTools.length > 0) {
        if (!currentMessage.userInputMessage.userInputMessageContext)
          currentMessage.userInputMessage.userInputMessageContext = {};
        currentMessage.userInputMessage.userInputMessageContext.tools =
          kiroTools;
      }
    }

    const origin = this.normalizeOrigin(context?.origin || "CLI");

    return {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: conversationId,
        currentMessage: currentMessage,
        history: history,
      },
      profileArn: context?.profileArn || "",
      inferenceConfig: {
        maxTokens: body.max_tokens === -1 ? 32000 : body.max_tokens || 4096,
        temperature: body.temperature || 0.0,
        topP: body.top_p || 1.0,
      },
    };
  }

  private normalizeOrigin(origin: string): string {
    switch (origin) {
      case "KIRO_CLI":
      case "AMAZON_Q":
        return "CLI";
      case "KIRO_AI_EDITOR":
      case "KIRO_IDE":
        return "AI_EDITOR";
      default:
        return origin;
    }
  }

  protected override async transformResponse(
    response: Response,
  ): Promise<Response> {
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  public override async getModels(token: string): Promise<{ id: string; name: string; provider: string }[]> {
    const endpoint = "https://codewhisperer.us-east-1.amazonaws.com";
    const target = "AmazonCodeWhispererService.ListAvailableCustomizations";
    
    // Optimized: Use native fetch with https.Agent to ignore TLS errors (for internal/proxy scenarios)
    // replacing the manual curl -k spawn.
    const agent = new https.Agent({ rejectUnauthorized: false });

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/x-amz-json-1.1",
          "x-amz-target": target,
        },
        body: JSON.stringify({}),
        // @ts-ignore - Bun/Node fetch supports agent
        agent: agent 
      });

      if (resp.ok) {
        const data = await resp.json() as any;
        // If we have customizations, we could map them here. 
        // For now, we still return the foundation models which are always available.
      }
    } catch (e: any) {
      logger.warn(`[Kiro] API model list check failed (expected for some identities):`, e.message);
    }

    // Always include latest foundation models for Kiro
    return [
      { id: "anthropic.claude-3-7-sonnet-20250219-v1:0", name: "Claude 3.7 Sonnet (Latest)", provider: "kiro" },
      { id: "anthropic.claude-3-5-sonnet-20241022-v2:0", name: "Claude 3.5 Sonnet v2", provider: "kiro" },
      { id: "anthropic.claude-3-5-sonnet-20240620-v1:0", name: "Claude 3.5 Sonnet", provider: "kiro" },
      { id: "anthropic.claude-3-opus-20240229-v1:0", name: "Claude 3 Opus", provider: "kiro" },
      { id: "anthropic.claude-3-haiku-20240307-v1:0", name: "Claude 3 Haiku", provider: "kiro" },
    ];
  }
  protected async handleImportToken(c: Context) {
    try {
      const body = await c.req.json();
      const { accessToken, refreshToken, profileArn, email } = body;

      if (!accessToken) throw new Error("AccessToken is required for import");

      const tokenData: any = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600, // Dummy
        profile_arn: profileArn,
        email: email,
      };

      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      return c.json({ error: "Import failed", details: e.message }, 400);
    }
  }
}

const kiroProvider = new KiroProvider();
export { kiroProvider };
export default kiroProvider.router;
