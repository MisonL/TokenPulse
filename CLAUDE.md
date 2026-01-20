---
description: 使用 Bun 代替 Node.js、npm、pnpm 或 vite。
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

默认使用 Bun 而不是 Node.js。

- 使用 `bun <file>` 代替 `node <file>` 或 `ts-node <file>`
- 使用 `bun test` 代替 `jest` 或 `vitest`
- 使用 `bun build <file.html|file.ts|file.css>` 代替 `webpack` 或 `esbuild`
- 使用 `bun install` 代替 `npm install` 或 `yarn install` 或 `pnpm install`
- 使用 `bun run <script>` 代替 `npm run <script>` 或 `yarn run <script>` 或 `pnpm run <script>`
- Bun 自动加载 .env，所以不需要使用 dotenv。

## API

- `Bun.serve()` 支持 WebSockets、HTTPS 和路由。不要使用 `express`。
- `bun:sqlite` 用于 SQLite。不要使用 `better-sqlite3`。
- `Bun.redis` 用于 Redis。不要使用 `ioredis`。
- `Bun.sql` 用于 Postgres。不要使用 `pg` 或 `postgres.js`。
- `WebSocket` 是内置的。不要使用 `ws`。
- 优先使用 `Bun.file` 而不是 `node:fs` 的 readFile/writeFile
- 使用 `Bun.$`ls` 代替 execa。

## 测试

使用 `bun test` 运行测试。

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## 前端

使用 `Bun.serve()` 进行 HTML 导入。不要使用 `vite`。HTML 导入完全支持 React、CSS、Tailwind。

服务端：

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // 可选的 WebSocket 支持
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // 处理关闭
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML 文件可以直接导入 .tsx、.jsx 或 .js 文件，Bun 的打包器会自动转译和打包。`<link>` 标签可以指向样式表，Bun 的 CSS 打包器会自动打包。

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

使用以下 `frontend.tsx`：

```tsx#frontend.tsx
import React from "react";

// 直接导入 .css 文件即可正常工作
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

然后，运行 index.ts

```sh
bun --hot ./index.ts
```

更多信息，请阅读 `node_modules/bun-types/docs/**.md` 中的 Bun API 文档。