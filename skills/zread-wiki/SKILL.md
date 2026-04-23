---
name: zread-wiki
version: 0.3.0
description: "为代码库自动生成结构化 wiki 文档体系。深度分析项目源码，生成包含架构解析、模块详解、Mermaid 图表、源码引用的完整 wiki 文档。输出到 .zread/wiki/versions/ 目录，支持版本管理。支持增量更新：检测已有 wiki 版本，结合 git diff 只更新受影响的页面。触发词：'生成 wiki'、'生成项目文档'、'生成知识库'、'zread wiki'、'项目 wiki 文档'、'给项目写 wiki'、'更新 wiki'。即使用户只是说 '帮我生成一下 wiki'、'项目文档不够全' 或 '更新一下 wiki'，也应触发此 skill。"
---

# zread-wiki: 项目 Wiki 文档生成器

为任意代码库自动生成结构化 wiki 文档体系。支持两种模式：
- **全量模式：** 首次生成，从零分析项目，生成完整 wiki
- **增量模式：** 检测已有 wiki 版本，结合 git diff 只更新受影响的页面

## 工作流程

### 阶段 0: 初始化

1. 确定目标项目路径：
   - 如果用户指定了路径，使用指定路径
   - 否则使用当前工作目录
2. 询问用户并发 subagent 数量（默认 2，建议 1-5）
3. 验证目标路径是一个有效的项目目录（包含源码文件）

### 阶段 0.5: 增量检测

在初始化完成后，检测项目是否已有 wiki 版本，决定走全量还是增量流程：

1. **检查已有版本：**
   - 读取 `{项目路径}/.zread/wiki/current` 文件
   - 不存在 → 跳到**阶段 1**（全量流程）
   - 存在 → 读取 current 指向的版本目录下的 `wiki.json`

2. **获取基准时间和 sources 映射：**
   - 从 wiki.json 提取 `generated_at` 作为基准时间
   - 从 wiki.json 提取所有 page 的 `sources` 字段，建立 `文件 → 页面` 的映射关系

3. **获取变更文件列表：**
   - 执行 git 命令获取自上次生成以来的变更：
     ```
     git log --name-only --pretty=format: {generated_at对应的时间}..HEAD
     ```
   - 注意：`generated_at` 是 ISO 8601 格式，需要转换为 git 可接受的时间格式
   - 收集所有变更文件（去重），区分 `added`、`modified`、`deleted`

4. **三分类：**
   - **需更新：** sources 与变更文件列表有交集的 page
   - **保留：** sources 无交集的 page
   - **未覆盖：** 变更文件中不属于任何 page.sources 的文件

5. **无变更检查：**
   - 如果「需更新」+「未覆盖」均为空 → 告知用户"无变更，无需更新"，流程结束

6. **展示变更计划：**
   ```
   📝 需更新（N页）：
     - 05-auth.md（src/auth/login.py 变更）
     - 08-api.md（src/api/routes.py 变更）
   ✅ 保留（N页）：01-overview.md, 02-quick-start.md, ...
   ⚠️ 未覆盖文件（N个）：
     - src/payment/stripe.py（新增）
     - src/payment/models.py（新增）
   ```

7. 用户确认后进入**阶段 1.5**（增量流程）

### 阶段 1: 目录生成（全量模式）

启动 **Catalog Generator** subagent 来分析项目并生成文档目录：

1. 先用 Read 工具读取本 skill 目录下的 `agents/catalog-generator.md`，获取完整的 subagent 指令
2. 使用 Agent 工具（subagent_type: "general-purpose"），将读取到的指令作为 prompt 的一部分，同时传入项目路径
3. subagent 将扫描项目、分析代码、输出结构化目录

**目录格式要求：**

```
<section>
快速入门
<topic level="Beginner">
项目概述：{项目名称} 的定位与核心价值
</topic>
<topic level="Beginner">
快速开始：环境搭建与安装运行
</topic>
...其他入门主题
</section>

<section>
深入理解
<group>
组名称
<topic level="Intermediate">
主题标题
</topic>
</group>
...其他组
</section>
```

**目录生成后：**
- 将完整目录以清晰的格式展示给用户
- 使用 AskUserQuestion 让用户确认目录是否满意，或需要增删改某些主题
- 用户确认后进入阶段 2

### 阶段 1.5: 目录调整（增量模式）

基于变更计划，调整旧版目录：

1. **复制旧版本目录：**
   - 将整个旧版本目录一键复制到新版本目录：
     `Copy-Item -Recurse "{旧版本目录}" "{新版本目录}"`
   - 新版本目录格式：`{项目路径}/.zread/wiki/versions/{YYYY-MM-DD-HHmmss}/`
   - 此时 wiki.json 和所有 .md 文件都已在位

2. **处理未覆盖文件（如有）：**
   - 先用 Read 工具读取本 skill 目录下的 `agents/catalog-adjuster.md`，获取完整的 subagent 指令
   - 启动 **Catalog Adjuster** subagent（subagent_type: "general-purpose"），传入：
     - 未覆盖文件列表
     - 旧版 wiki.json 的完整目录结构
     - git diff 摘要
   - subagent 返回变更指令（`add_topic`、`merge_to_existing`、`remove_topic`）

3. **处理被删除源文件的 page：**
   - 如果某 page 的 sources 全部被 git 标记为 deleted → 建议删除该 topic
   - 如果部分 sources 被删除 → 标记为需更新

4. **汇总展示目录变更：**
   ```
   ✅ 保留（N页）：01-overview.md, 02-quick-start.md, ...
   🔄 更新（N页）：05-auth.md, 08-api.md
   ➕ 新增（N页）：12-payment.md
   ➖ 删除（N页）：09-legacy.md
   ```
   - 使用 AskUserQuestion 让用户确认变更计划
   - 用户确认后进入阶段 2.5

### 阶段 2: 并行页面生成（全量模式）

1. **创建输出目录：**
   - 路径格式：`{项目路径}/.zread/wiki/versions/{YYYY-MM-DD-HHmmss}/`
   - 使用 PowerShell 命令创建目录

2. **解析目录为 topic 列表：**
   - 为每个 topic 分配序号（从 01 开始，使用两位数格式）
   - 生成 slug（标题的拼音简写）
   - 确定输出文件名：`{序号}-{slug}.md`

3. **生成初始 wiki.json：**
   - 用 Read 工具读取本 skill 目录下的 `references/output-schema.md`，按其中定义的格式生成 wiki.json
   - 此时 wiki.json 的 pages 中 sources 字段留空（`[]`），后续每批 subagent 返回后逐步填入
   - 写入输出目录

4. **按批次并行生成页面：**
   - 先用 Read 工具读取本 skill 目录下的 `agents/page-writer.md`，获取完整的 subagent 指令
   - 每个 subagent 使用 **Agent 工具**（subagent_type: "general-purpose"），将读取到的指令作为 prompt 的一部分
   - 每个 subagent 接收以下上下文：
     - 当前 topic 的完整信息（序号、标题、slug、难度级别、所属 section/group）
     - 完整目录列表（所有 topic 的信息，用于交叉引用）
     - 项目路径
     - 输出文件路径（让 subagent 直接写入文件）

5. **批次控制实现（关键）：**

   **核心原则：批次内并行调用，批次间串行执行**

   ```
   topics = 解析后的 topic 列表
   concurrency = 用户设定的并发数

   for i from 0 to len(topics) step concurrency:
       batch = topics[i : i + concurrency]

       # 在一个 response 中并行调用多个 Agent（同步阻塞）
       Agent(topic_1), Agent(topic_2), ... Agent(topic_n)  # 不设 run_in_background

       # 以上调用会阻塞等待所有 agent 完成后才继续
       # 收集每个 subagent 返回的 SOURCES_RESULT
       # 统一更新 wiki.json 的 sources 字段
   ```

   **工具调用方式：**
   - 在 **同一个 response 中** 同时调用 `concurrency` 个 Agent 工具
   - **不设置** `run_in_background` 参数（或设为 `false`）
   - 这样 Agent 工具会同步阻塞，等待所有并行启动的 subagent 全部完成后才返回
   - 收到返回结果后，从每个 subagent 的返回中解析 `SOURCES_RESULT`，更新 wiki.json

   **错误示例（不要这样做）：**
   - 设置 `run_in_background: true` → 会异步启动，不等待完成
   - 每个批次单独一个 response → 无法实现真正的批次内并行

6. **Sources 收集与 wiki.json 更新：**
   - 每批 subagent 返回后，从返回结果中解析 `SOURCES_RESULT`（包含 file 和 sources 列表）
   - 用 Edit 工具更新 wiki.json，将对应 page 的 sources 字段填入
   - 这个操作在每批 subagent 完成后、下一批启动前执行

7. **更新 current 指针：**
   - 在 `{项目路径}/.zread/wiki/` 目录下创建或更新 `current` 文件（无扩展名）
   - 文件内容为相对路径，格式：`versions/{YYYY-MM-DD-HHmmss}`

8. **Mermaid 语法检查与修复：**
   - 启动一个 subagent 调用 **mermaid-checker** skill 检查生成的 wiki 文件
   - 使用 Agent 工具（subagent_type: "general-purpose"），prompt 如下：
     ```
     请使用 mermaid-checker skill 检查以下目录中的 Mermaid 图表语法：
     {项目路径}/.zread

     执行检查并修复所有发现的语法错误。
     ```
   - 等待 subagent 完成检查和修复
   - 如果发现并修复了错误，在最终摘要中报告

9. **输出摘要：**
   - 告知用户生成完成
   - 列出生成的文件清单
   - 提供输出目录路径
   - 报告 Mermaid 检查结果（如有修复则说明）

### 阶段 2.5: 增量页面生成（增量模式）

1. **目录已就位：**
   - 旧版本已完整复制到新版本目录，wiki.json 和所有 .md 文件都在

2. **删除页面（如有）：**
   - 删除已标记为删除的 .md 文件
   - 从 wiki.json 的 pages 数组中移除对应条目

3. **解析需处理的 topic 列表：**
   - 合并「需更新」和「新增」的 topic
   - 新增的 topic 分配新序号（续接现有最大序号）
   - 更新的 topic 保持原序号和文件名

4. **生成初始 wiki.json 更新：**
   - 为新增 topic 在 wiki.json 的 pages 中添加条目（sources 为空）
   - 移除已删除 topic 的条目
   - 更新 id 和 generated_at 为新版本的时间戳

5. **按批次并行处理更新和新增页面：**
   - 先用 Read 工具读取本 skill 目录下的 `agents/page-writer.md`，获取完整的 subagent 指令
   - 批次控制方式同阶段 2（批次内并行，批次间串行）
   - 每个 subagent 接收以下上下文：
     - **更新页额外传入：** 旧版 .md 文件内容（`old_content`）+ git diff 中与该 page.sources 相关的变更内容（`git_diff`）
     - **新增页：** 走全量生成逻辑，不传 old_content 和 git_diff
     - 通用上下文同阶段 2

6. **Sources 收集与 wiki.json 更新：**
   - 每批 subagent 返回后，解析 `SOURCES_RESULT`
   - 更新 wiki.json 中对应 page 的 sources 字段
   - 与阶段 2 的逻辑一致

7. **更新 current 指针：**
   - 用新版本的时间戳更新 `{项目路径}/.zread/wiki/current` 文件

8. **Mermaid 语法检查与修复：**
   - 仅检查本次变更涉及的页面（更新页 + 新增页），而非全部页面
   - 调用 mermaid-checker 的方式同阶段 2

9. **输出摘要：**
   ```
   Wiki 增量更新完成！
   ✅ 保留（N页）：未变更，从旧版复制
   🔄 更新（N页）：重新生成
   ➕ 新增（N页）：全新生成
   ➖ 删除（N页）：已移除
   📊 Mermaid 检查：X 个问题已修复
   📁 输出目录：{路径}
   ```

## 模式分支图

```
阶段 0 → 阶段 0.5 → 无旧版 → 阶段 1（全量目录）→ 阶段 2（全量生成）
                    → 有旧版 → 阶段 1.5（目录调整）→ 阶段 2.5（增量生成）
```

## 关键约束

- **输出语言：** 始终使用简体中文
- **页面内容：** 每个 page-writer subagent 只负责自己的 topic，不要越界写其他 topic 的内容
- **源码引用：** 每个段落末尾必须附带 `Sources: [filename](relative/path#L<start>-L<end>)` 格式的引用
- **交叉引用：** 使用 `[Page Title](page_slug)` 格式链接到其他 wiki 页面
- **Mermaid 图表：** 积极使用 flowchart、sequenceDiagram 等可视化复杂架构和流程
- **不修改源码：** 这个 skill 只读取和分析代码，绝不修改项目源码
- **Sources 返回：** 所有 page-writer subagent 完成后必须返回 SOURCES_RESULT，主 agent 据此更新 wiki.json

## 项目规模检测

在目录生成阶段自动检测项目规模以决定主题数量：

| 规模 | 条件 | 主题数量 |
|------|------|----------|
| 小型 | < 50 源文件，< 5 核心目录 | 8-10 |
| 中型 | 50-200 源文件，5-15 核心目录 | 12-18 |
| 大型 | > 200 源文件，> 15 核心目录 | 20-30 |

## 错误处理

- 如果目标路径不是有效项目目录，提示用户并提供路径修正建议
- 如果某个 subagent 生成失败，记录失败的 topic，在最终摘要中报告，不阻塞其他 topic 的生成
- 如果输出目录已存在同名文件，直接覆盖（版本目录保证不会误覆盖）
- 如果增量检测时 wiki.json 缺少 sources 字段（旧版格式），提示用户建议执行一次全量生成来补充 sources

## 参考文件

本 skill 包含以下按需加载的参考文件，在对应阶段用 Read 工具读取：

- **`agents/catalog-generator.md`** — 目录生成 subagent 的完整指令。在阶段 1 开始时读取，传给 catalog generator subagent。
- **`agents/catalog-adjuster.md`** — 目录调整 subagent 的完整指令。在阶段 1.5 处理未覆盖文件时读取，传给 catalog adjuster subagent。
- **`agents/page-writer.md`** — 页面生成 subagent 的完整指令。在阶段 2/2.5 开始时读取，传给每个 page writer subagent。支持全量和增量两种模式。
- **`references/output-schema.md`** — wiki.json 和页面文件的输出格式规范。在生成 wiki.json 前读取，确保输出格式正确。
