import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const targetDirectories = ["frontend/src", "scripts"];
const legacyPathPatterns = [
  "/api/admin/oauth/alerts",
  "/api/admin/oauth/alertmanager",
];

async function walkDirectory(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return walkDirectory(absolutePath);
      }
      return [absolutePath];
    }),
  );
  return files.flat();
}

describe("OAuth 告警兼容路径退场护栏", () => {
  it("前端与发布脚本不应再引用旧的兼容路径", async () => {
    const files = (
      await Promise.all(
        targetDirectories.map((directory) =>
          walkDirectory(path.join(repoRoot, directory)),
        ),
      )
    ).flat();

    const violations: string[] = [];

    for (const filePath of files) {
      const content = await readFile(filePath, "utf8");
      for (const legacyPath of legacyPathPatterns) {
        if (content.includes(legacyPath)) {
          violations.push(`${path.relative(repoRoot, filePath)} -> ${legacyPath}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
