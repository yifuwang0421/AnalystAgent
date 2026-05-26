# 隐私与数据说明

Analyst Agent 面向本地研究工作流。它可能处理模型凭据、Source 凭据、市场数据 token、本地文件、研究资料、报告草稿和聊天记录。上传 GitHub 或分享报告前，请先做脱敏检查。

## 不应提交到仓库的内容

- `.env` 和任何真实配置副本
- API key、OAuth secret、bearer token、server token
- iFinD token 或其他数据 provider token
- cookie、session、浏览器 profile
- 工作区里的真实 `knowledge/`、`reports/`、`companies/`、`industries/` 内容
- 真实聊天记录、日志、截图、调试 dump
- 包含个人姓名、邮箱、账号、本机路径、内部域名或私有 IP 的材料

## 可以提交的内容

- 使用占位符的 `.env.example`
- 不含真实主体和敏感数据的示例模板
- 通用说明文档
- 脱敏后的测试 fixtures
- 不含隐私信息的截图

## 推荐占位符

```bash
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
CRAFT_SERVER_TOKEN=<generated-token>
IFIND_MCP_AUTH_TOKEN=your-ifind-token
LLM_API_KEY=your-provider-key
```

## 研究资料处理建议

- 把真实资料放在本地工作区，不要放进应用源码仓库。
- 分享报告前检查 evidence ledger 的 `Source` 字段，避免暴露本机路径或内部文档名。
- 如果报告来自用户文件，确认引用片段是否可以公开。
- 对外发布时，删除未脱敏的原始数据、截图和临时导出文件。

## 运行时数据位置

默认配置目录继承自 Craft Agent 架构，通常位于用户主目录下的 `.craft-agent/`。可以用 `CRAFT_CONFIG_DIR` 改到其他位置。

目录中可能包含：

- 应用配置
- 加密凭据文件
- 工作区配置
- 会话数据
- Sources
- Skills
- 自动化配置

这些运行时数据不应直接上传到公开仓库。
