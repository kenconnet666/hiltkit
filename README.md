# hiltkit

细粒度响应的 Web 框架、组件库和文档站。标准 TS JSX，不需要编译插件，组件库发布后使用方不用重新编译。

## 目录

| 路径            | 包              | 说明                                   |
| --------------- | --------------- | -------------------------------------- |
| `packages/core` | `hiltkit`       | 框架                                   |
| `packages/ui`   | `@hiltkit/ui`   | 组件库                                 |
| `apps/docs`     | `@hiltkit/docs` | 文档站，不发布，用框架和组件库自己搭建 |
| `experiments`   | 不是工作区成员  | 选型实验和实测数据                     |

框架的 API 见 [docs/api.md](docs/api.md)。组件库已有 `Provider`（语言、时区、文案、主题）和亮色、暗色、深蓝三套主题，`Button` 是第一版。

## 常用命令

需要 Node 24。pnpm 版本写在 `package.json` 里，会自动切换。

```bash
pnpm install
```

```bash
pnpm dev
```

```bash
pnpm check
```

```bash
pnpm test
```

```bash
pnpm test:integration
```

```bash
pnpm build
```

```bash
pnpm check:packages
```

第一次跑测试前要装一次浏览器：

```bash
pnpm exec playwright install chromium firefox webkit
```

## AI 工具的语言服务

语言服务器都是仓库 `node_modules` 里的 TypeScript 7（`tsc --lsp`），结果和 `pnpm typecheck` 一致。

- **Claude Code：** `.claude/settings.json` 启用了仓库内的 `hiltkit-lsp` 插件和 `.mcp.json` 里的服务。信任这个目录、重启会话后就能用。
- **其他 AI 工具：** 读 `.mcp.json`，或者手动配置 `node scripts/lsp/server.mjs .`。工具有 `diagnostics`、`hover`、`definitions`、`references`、`completions`，位置都从 1 开始。

改过配置或升级 TypeScript 后验证一遍：

```bash
pnpm lsp:verify
```

## 约定

- **包之间解析到源码：** `exports` 里的 `@hiltkit/source` 条件指向 `src`，开发和测试不用先构建。发布后的使用方没有这个条件，走 `dist`。
- **依赖版本：** 只写在 `pnpm-workspace.yaml` 的 `catalog` 里，各包用 `catalog:` 引用。
- **DOM 行为在真浏览器里测：** Vitest 浏览器模式配 Playwright。
- **发布：** 用 Changesets，`pnpm changeset` 记录变更。
