# Contributing to Analyst Agent

感谢你愿意参与 Analyst Agent。这个项目基于 Craft Agent / Craft Agents OSS 调整而来，当前方向是本地优先、研究优先、证据优先的 AI 投研工作台。

## 开始开发

### 前置条件

- Bun
- Node.js 18+
- Git
- Windows、macOS 或 Linux

### 本地设置

```bash
git clone <repository-url>
cd AnalystAgent
bun install
cp .env.example .env
```

编辑 `.env` 时只放本机开发凭据。不要提交真实 API key、OAuth secret、server token、iFinD token 或个人研究资料。

启动桌面应用：

```bash
bun run electron:dev
```

## 工作流

1. 从 `main` 创建功能分支。
2. 保持改动范围清晰，不混入无关重构。
3. 对 UI 改动提供截图或简短说明。
4. 对工具、server、工作区逻辑改动补充测试。
5. 提交前运行相关检查。

常用检查：

```bash
bun run typecheck:all
bun run validate:dev
bun run typecheck:electron
```

如果只修改文档，可说明未运行代码检查。

## 分支命名

- `feature/add-research-tool`
- `fix/workspace-search-error`
- `docs/update-readme`
- `refactor/session-tool-registry`

## Pull Request 内容

PR 描述建议包含：

```markdown
## Summary
What changed and why.

## Testing
Commands run or manual checks performed.

## Notes
Known limitations, follow-up work, or screenshots for UI changes.
```

## 项目结构

```text
apps/
  electron/              # 桌面应用
  cli/                   # CLI client
  webui/                 # Web UI build target
  viewer/                # Session viewer
packages/
  core/                  # 核心类型
  shared/                # 工作区、配置、agent、模型和权限逻辑
  server-core/           # RPC 和 session server 核心
  server/                # headless server 入口
  session-tools-core/    # session tools 和投研工具
  pi-agent-server/       # Pi backend adapter
  ui/                    # 共享 UI 组件
```

## 投研功能贡献原则

- 优先支持研究流程、证据检索、报告结构和风险复核。
- 新数据源默认只读，并清楚返回 provider、请求参数、数据日期和 warning。
- 结论应可追溯到本地文件、数据 provider、用户文档或显式推断。
- 不要引入交易执行、自动下单、精确仓位、杠杆或买卖指令。
- 缺少关键输入时应追问或返回 clarification，而不是猜测。

## 隐私要求

提交前请检查：

- 没有 `.env`、token、cookie、OAuth secret 或 API key。
- 没有本机绝对路径、用户名、内部服务器地址或私人邮箱。
- 没有上传真实研究材料、会话日志或未脱敏报告。
- 示例中的凭据使用 `<placeholder>` 或 `your-token`。

## License

提交贡献即表示你同意贡献内容按 Apache License 2.0 授权。
