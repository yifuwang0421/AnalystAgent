# Analyst Agent Electron App

这是 Analyst Agent 的主要桌面端，使用 Electron + React + Vite 构建。它继承 Craft Agent 的多会话工作台和工具执行框架，并在当前项目中调整为投研工作台、知识库和研究 agent 角色入口。

## 快速启动

从仓库根目录运行：

```bash
bun install
bun run electron:dev
```

完整构建后运行：

```bash
bun run electron:start
```

Windows 构建脚本：

```powershell
bun run electron:dist:win
```

## 主要能力

- 多会话聊天和会话历史。
- 工作区切换、设置、权限模式和模型选择。
- 中间研究工作区与右侧聊天面板可拖拽调整宽度。
- 投研角色预设与自定义 research agent。
- 研究工作区和知识库文件浏览、搜索、Markdown 编辑。
- 文件附件、文件预览、系统应用打开、本地文件夹定位。
- Sources、Skills、MCP、REST API 和本地文件系统连接。
- 自动化、会话标签/状态、消息通道和 browser tool。

## 目录结构

```text
apps/electron/
  src/
    main/              # Electron main process
    preload/           # context bridge
    renderer/          # React UI
      components/
        app-shell/     # 主工作台、侧栏、聊天、研究文件区
        settings/      # 设置页组件
        preview/       # 文件预览
        automations/   # 自动化 UI
      pages/           # 顶层页面
      lib/             # navigation、storage、agent presets
    shared/            # renderer/main 共享类型和路由
  resources/           # 图标、主题、内置文档和脚本
  dist/                # 构建产物
```

## 与投研功能相关的文件

| 文件 | 说明 |
|---|---|
| `src/renderer/components/app-shell/AppShell.tsx` | 主工作台布局、侧栏、面板组合 |
| `src/renderer/components/app-shell/ResearchFileWorkspace.tsx` | 研究工作区与知识库 UI |
| `src/renderer/components/app-shell/AgentsPresetPanel.tsx` | 投研角色预设面板 |
| `src/renderer/lib/agent-presets.tsx` | 内置和自定义 research agent preset |
| `src/renderer/lib/local-storage.ts` | renderer 本地状态键 |
| `src/shared/routes.ts` | 应用内部路由 |
| `src/shared/route-parser.ts` | deep link 与 route parser |

配套的 server 和共享逻辑在仓库根目录的 `packages/` 下：

| 文件 | 说明 |
|---|---|
| `packages/shared/src/workspaces/finance.ts` | 投研工作区目录、模板和默认技能 |
| `packages/session-tools-core/src/handlers/research-workflow.ts` | 研究流程工具 |
| `packages/session-tools-core/src/handlers/finance-market-data.ts` | 只读市场数据工具 |
| `packages/session-tools-core/src/handlers/knowledge-search.ts` | 工作区知识检索 |
| `packages/server-core/src/handlers/rpc/files.ts` | 文件读取、写入、搜索和工作区 RPC |

## 开发命令

```bash
# Electron 开发
bun run electron:dev

# 构建主进程、preload、renderer、resources
bun run electron:build

# Electron 类型检查
bun run typecheck:electron

# Electron lint
bun run lint:electron
```

## 环境变量

Electron app 会读取仓库根目录 `.env` 中的开发配置。不要提交真实 `.env`。

常见变量：

| 变量 | 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google AI Studio key |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth desktop client id |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth secret |
| `SLACK_OAUTH_CLIENT_ID` | Slack OAuth client id |
| `SLACK_OAUTH_CLIENT_SECRET` | Slack OAuth secret |
| `MICROSOFT_OAUTH_CLIENT_ID` | Microsoft OAuth desktop client id |
| `IFIND_MCP_AUTH_TOKEN` | iFinD MCP bearer token |

真实凭据应存放在本机 secret store、系统环境变量、CI secret 或本地 `.env` 中。

## Deep Links

内部仍支持继承自 Craft Agent 的 `craftagents://` deep link：

```text
craftagents://settings
craftagents://allSessions/session/session123
craftagents://sources/source/github
craftagents://action/new-chat
craftagents://workspace/{id}/allSessions/session/abc123
```

这些 scheme 名称是兼容遗留实现，不代表必须连接 Craft 官方服务。

## 调试

开发模式会输出主进程和 renderer 日志。打包应用可以使用 debug 参数启动：

```powershell
& "$env:LOCALAPPDATA\Programs\@craft-agentelectron\Analyst Agent.exe" -- --debug
```

常见日志位置：

- Windows: `%APPDATA%\@craft-agent\electron\logs\main.log`
- macOS: `~/Library/Logs/@craft-agent/electron/main.log`
- Linux: `~/.config/@craft-agent/electron/logs/main.log`

## 注意事项

- 代码中仍有 `CraftAgent`、`@craft-agent/*`、`CRAFT_*` 等命名，这是继承自 upstream 的兼容层。
- 投研 UI 的中文文案应保持 UTF-8 编码。
- 修改侧边栏、会话历史、设置入口或面板拖拽时，要保留既有功能控制，不要顺手删除无关入口。
- 投研功能不应引入交易执行、仓位建议或自动下单能力。
