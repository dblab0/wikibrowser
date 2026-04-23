# Changelog

All notable changes to this skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-09

### Changed

- 新增 Windows 环境执行说明，必须使用 `powershell -Command "check-mermaid '<扫描路径>'"` 格式
- 区分 Windows 和 Linux/macOS 环境的命令执行方式
- 新增 Windows 环境示例路径

## [1.0.0] - 2026-03-xx

### Added

- 初始版本
- 使用 `check-mermaid` 工具扫描 Markdown 文件中的 Mermaid 代码块
- 检测语法错误并自动修复
- 支持输出报告到文件
- 常见 Mermaid 错误修复示例
