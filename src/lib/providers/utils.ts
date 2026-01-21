export const AgenticSystemPrompt = `You are an intelligent programming assistant.

When asked to write code, please follow these requirements:
1. **Understand the Goal**: deeply understand the user's requirements.
2. **Logic Design**: Design detailed logical steps and algorithms.
3. **Code Implementation**: Write high-quality, maintainable code.
4. **Testing & Verification**: Consider edge cases and error handling.

You have access to a set of tools. You must use these tools to accomplish the task.
If you need to read a file, use the read_file tool.
If you need to list a directory, use the list_dir tool.
If you need to execute a command, use the run_command tool.

Please think step-by-step.`;

export function shortenToolName(name: string): string {
  const limit = 64;
  if (name.length <= limit) {
    return name;
  }
  // 对于 MCP 工具，尝试保留前缀和最后一段
  if (name.startsWith("mcp__")) {
    const idx = name.lastIndexOf("__");
    if (idx > 0) {
      const cand = "mcp__" + name.substring(idx + 2);
      if (cand.length > limit) {
        return cand.substring(0, limit);
      }
      return cand;
    }
  }
  return name.substring(0, limit);
}

export function checkThinkingMode(
  body: any,
  headers?: Record<string, string>,
): boolean {
  // 首先检查 Anthropic-Beta 头（Claude CLI 使用此头）
  if (headers) {
    // 不区分大小写地检查 'anthropic-beta'
    const betaHeader = Object.keys(headers).find(
      (key) => key.toLowerCase() === "anthropic-beta",
    );
    if (betaHeader) {
      const val = headers[betaHeader];
      if (val && val.includes("interleaved-thinking")) {
        return true;
      }
    }
  }

  // 检查 OpenAI 格式：reasoning_effort 参数
  // 有效值："low", "medium", "high", "auto"（不包括 "none"）
  if (body.reasoning_effort && body.reasoning_effort !== "none") {
    return true;
  }

  // 检查 AMP/Cursor 格式：系统提示中的 <thinking_mode>interleaved</thinking_mode>
  // 这需要检查消息中的系统提示并对其进行扫描，
  // 但参考实现会检查此标签的 *原始 body 字符串*。
  //由于我们要处理的是解析后的 body 对象，因此我们可能会检查已知的消息位置
  // 或者暂时只依靠其他信号。
  // 如果输入是原始 JSON 字符串字节，我们可以对其进行字符串搜索。
  // 如果存在消息，让我们对其进行迭代。
  if (body.messages && Array.isArray(body.messages)) {
    const systemMsg = body.messages.find((m: any) => m.role === "system");
    if (systemMsg && typeof systemMsg.content === "string") {
      if (
        systemMsg.content.includes("<thinking_mode>") &&
        systemMsg.content.includes("</thinking_mode>")
      ) {
        const content = systemMsg.content as string;
        const start = content.indexOf("<thinking_mode>");
        const end = content.indexOf("</thinking_mode>");
        if (start >= 0 && end > start) {
          const val = content.substring(start + "<thinking_mode>".length, end);
          if (val === "interleaved" || val === "enabled") {
            return true;
          }
        }
      }
    }
  }

  // 检查模型名称中的 thinking 提示
  if (body.model) {
    const modelLower = body.model.toLowerCase();
    if (modelLower.includes("thinking") || modelLower.includes("-reason")) {
      return true;
    }
  }

  return false;
}

export function decodeJwt(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    const padded = payload.padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "=",
    );
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = Buffer.from(base64, "base64").toString("utf-8");
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}
