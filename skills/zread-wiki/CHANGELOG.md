# Changelog

All notable changes to this skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-04-14

### Added

- 新增增量更新模式：检测已有 wiki 版本，结合 git diff 只更新受影响的页面
- 新增阶段 0.5（增量检测）：读取 current 指针，获取 git diff，三分类变更文件
- 新增阶段 1.5（目录调整）：基于旧版目录调整，处理未覆盖文件和删除文件
- 新增阶段 2.5（增量页面生成）：复制旧版目录，只重新生成变更页面
- 新增 `agents/catalog-adjuster.md`：增量模式目录调整 subagent
- wiki.json 的 page 对象新增 `sources` 字段，记录页面引用的源文件路径
- page-writer subagent 新增 SOURCES_RESULT 返回机制，主 agent 据此更新 wiki.json

### Changed

- 阶段 2 全量模式增加 sources 收集流程：先生成初始 wiki.json（sources 为空），每批 subagent 返回后统一更新
- page-writer subagent 支持增量模式：可选接收 old_content 和 git_diff，基于旧版文档做针对性更新
- description 更新：增加"更新 wiki"触发词，说明支持增量更新
- 版本号升至 0.3.0

## [0.2.3] - 2026-04-10

### Changed

- 移除 wiki 页面输出格式中的 `<blog>` 标签包裹要求
- 更新 `output-schema.md` 和 `page-writer.md`，输出标准 Markdown 格式

## [0.2.2] - 2026-04-09

### Added

- 新增 Mermaid 语法检查与修复步骤
- wiki 页面生成完成后自动启动 subagent 调用 mermaid-checker skill
- 检查 `.zread` 目录下生成的 wiki 文件中的 Mermaid 图表语法
- 自动修复发现的语法错误并在摘要中报告

## [0.2.1] - 2026-04-09

### Changed

- 明确批次控制的具体实现方式，解决 subagent 并发控制不明确的问题
- 新增"核心原则：批次内并行调用，批次间串行执行"说明
- 新增工具调用方式的详细指导：同一 response 中并行调用多个 Agent，不设 `run_in_background`
- 新增错误示例，避免使用 `run_in_background: true` 导致不等完成就开下一波

## [0.2.0] - 2026-04-09

### Fixed

- 修复 wiki.json 输出格式
- 顶层字段调整：`version` → `id`，新增 `language` 字段，移除 `project_path` 和 `total_pages`
- 结构扁平化：嵌套的 `catalog.sections[].groups[].topics[]` 改为扁平的 `pages[]` 数组
- 时间格式：`generated_at` 添加 `Z` 后缀表示 UTC 时间
- 文件命名：序号使用两位数格式（01、02...）

## [0.1.0] - 2026-04-09

### Added

- 初始版本发布
- 两阶段工作流：目录生成 + 并行页面生成
- Catalog Generator subagent：深度分析项目并生成结构化文档目录
- Page Writer subagent：为每个 topic 生成完整的 wiki 页面
- 支持项目规模检测，自动调整主题数量
- 输出包含架构解析、模块详解、Mermaid 图表、源码引用
- 版本管理：输出到 `.zread/wiki/versions/` 目录
- current 指针文件，方便外部工具定位最新版本
