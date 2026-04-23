# 输出格式规范

## 目录结构

```
{project-root}/.zread/wiki/
├── current                      # 纯文本文件，指向最新版本（内容：{YYYY-MM-DD-HHmmss} 或 versions/{YYYY-MM-DD-HHmmss}）
└── versions/
    └── {YYYY-MM-DD-HHmmss}/
        ├── wiki.json            # 目录索引 + 元数据
        ├── 01-{slug}.md         # 各主题文档
        ├── 02-{slug}.md
        └── ...
```

## current 文件格式

`current` 是一个无扩展名的纯文本文件，位于 `.zread/wiki/` 根目录下，内容为指向最新版本目录的相对路径：

```
versions/2026-04-09-143022
```

每次生成新版本时更新此文件，覆盖为最新的版本目录路径。外部工具可通过读取此文件快速定位当前 wiki 版本。

## wiki.json 格式

```json
{
  "id": "2026-04-09-143022",
  "generated_at": "2026-04-09T14:30:22Z",
  "language": "zh",
  "pages": [
    {
      "slug": "xiang-mu-gai-shu",
      "title": "项目概述：XXX 的定位与核心价值",
      "file": "01-xiang-mu-gai-shu.md",
      "section": "快速入门",
      "level": "Beginner",
      "sources": ["README.md", "package.json", "src/index.ts"]
    },
    {
      "slug": "he-xin-jia-gou",
      "title": "核心架构：模块划分与数据流",
      "file": "04-he-xin-jia-gou.md",
      "section": "深入理解",
      "level": "Intermediate",
      "group": "架构设计",
      "sources": ["src/core/engine.ts", "src/core/router.ts", "src/types/index.ts"]
    }
  ]
}
```

## 字段说明

### 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✓ | 版本标识，使用时间戳格式 `YYYY-MM-DD-HHmmss` |
| `generated_at` | string | ✓ | 生成时间，ISO 8601 格式，以 `Z` 结尾表示 UTC |
| `language` | string | ✓ | 文档语言，如 `zh`、`en` |
| `pages` | array | ✓ | 页面列表，扁平数组结构 |

### Page 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slug` | string | ✓ | 页面 URL 标识，拼音或英文，用 `-` 连接 |
| `title` | string | ✓ | 页面标题，完整的中文名称 |
| `file` | string | ✓ | 对应的 Markdown 文件名 |
| `section` | string | ✓ | 所属章节名称，用于文档分组 |
| `level` | string | ✓ | 难度级别：`Beginner`、`Intermediate`、`Advanced` |
| `group` | string | | 可选，章节内的子分组名称 |
| `sources` | string[] | ✓ | 该页面引用的源文件路径列表，用于增量更新时判定页面是否需要重新生成 |

## 页面文件格式

每个 `.md` 文件的内容结构：

```markdown
# {标题}

简要介绍（1-2 段）
Sources: [file1](path#L1-L20)

## 子标题 1

详细内容（段落式，每段末尾附 Sources）
Sources: [file2](path#L100-L156)

## 子标题 2

内容...
Sources: [file3](path#L200-L280)

### 更细的子标题（可选）

内容...

## 延伸阅读

- [相关主题 A](a-slug)
- [相关主题 B](b-slug)
```

## Slug 生成规则

- 将中文标题转换为拼音（去掉声调）
- 用连字符连接
- 保留英文和数字
- 全部小写
- 示例：`项目概述：Kimi Code CLI 的定位与核心价值` → `xiang-mu-gai-shu-kimi-code-cli-de-ding-wei-yu-he-xin-jie-zhi`

## 文件命名规则

- 格式：`{序号}-{slug}.md`
- 序号从 01 开始，按目录顺序递增，使用两位数格式
- 示例：`01-xiang-mu-gai-shu-kimi-code-cli-de-ding-wei-yu-he-xin-jie-zhi.md`

## 版本目录命名规则

- 格式：`YYYY-MM-DD-HHmmss`
- 使用本地时间
- 示例：`2026-04-09-143022`
