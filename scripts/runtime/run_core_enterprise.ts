const watch = process.argv.includes("--watch");

const commands = [
  {
    name: "core",
    cmd: watch ? ["bun", "--watch", "apps/core/src/index.ts"] : ["bun", "run", "apps/core/src/index.ts"],
    env: process.env,
  },
  {
    name: "enterprise",
    cmd: watch
      ? ["bun", "--watch", "apps/enterprise/src/index.ts"]
      : ["bun", "run", "apps/enterprise/src/index.ts"],
    env: {
      ...process.env,
      PORT: process.env.PORT_ENTERPRISE || "9010",
    },
  },
];

const children = commands.map((entry) =>
  Bun.spawn({
    cmd: entry.cmd,
    env: entry.env,
    stdout: "inherit",
    stderr: "inherit",
  }),
);

let shuttingDown = false;

function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const exitStatuses = children.map((child, index) =>
  child.exited.then((code) => ({
    code,
    index,
  })),
);

const result = await Promise.race(exitStatuses);
const failed = commands[result.index];

if (!shuttingDown) {
  console.error(`[dual-service] ${failed?.name || "unknown"} 退出，code=${result.code}`);
  shutdown(typeof result.code === "number" ? result.code : 1);
}
