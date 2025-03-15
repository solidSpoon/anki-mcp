# Anki MCP 词汇管理器

一个基于 MCP (Model Context Protocol) 的智能 Anki 词汇管理工具，支持自动生成发音、智能搜索和统计分析。

## 功能特点

- 智能词汇管理
  - 批量添加单词和个别添加
  - 自动生成单词、释义和例句的发音（OpenAI TTS）
  - 支持标签系统和笔记功能
  - CSV 格式存储，支持版本控制
  
- 高级搜索和分析
  - 多维度排序：到期时间、最近复习、难度等
  - 智能搜索：支持单词和释义的模糊匹配
  - 详细统计：复习次数、正确率、熟悉度等
  
- 自动化工具
  - 完全自动化的 Anki 卡片创建
  - 智能音频缓存系统
  - 详细的日志记录

## 工具命令

### add-words-batch
添加单词到词汇表并创建 Anki 卡片（支持单个和批量操作）

输入:
- words: 单词数组，每个包含：
  - word: 单词（仅英文）
  - definition: 释义（仅英文）
  - example: 例句（可选，仅英文）
  - notes: 笔记（可选，仅英文）
  - tags: 标签数组（可选，仅支持字母、数字、连字符和下划线）

### list-words
列出 Anki 中的单词，支持多种排序方式：

- due: 按到期时间排序（不熟悉的词优先）
- recent: 按复习频率排序（最近复习优先）
- difficulty: 按正确率排序（最具挑战性优先）
- added: 按创建时间排序（最新添加优先）
- lapses: 按遗忘次数排序（最常遗忘优先）

### search-words
在 Anki 牌组中搜索单词和释义

输入:
- query: 搜索关键词
- limit: 返回结果数量（1-50，默认20）

## 安装要求

1. Node.js (v16+)
2. Anki
3. AnkiConnect 插件
4. OpenAI API 密钥

## 快速开始

1. 克隆仓库：
   ```bash
   git clone <repository-url>
   cd anki-mcp
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 配置环境变量：
   ```bash
   cp .env.example .env
   # 编辑 .env 文件
   ```

4. 构建项目：
   ```bash
   npm run build
   ```

## MCP 配置

在 Claude Desktop 中配置（编辑 `~/.config/claude-mcp/config.json`）：

```json
{
  "servers": {
    "anki-mcp": {
      "command": "node",
      "args": ["./build/index.js"],
      "env": {
        "OPENAI_API_KEY": "你的OpenAI API密钥",
        "OPENAI_API_BASE": "可选的API基础URL",
        "ANKI_DECK_NAME": "你的Anki牌组名称",
        "ANKI_MODEL_NAME": "你的卡片模板名称",
        "ANKI_CONNECT_URL": "http://localhost:8765"
      }
    }
  }
}
```

## 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| OPENAI_API_KEY | OpenAI API 密钥 | 必需 |
| OPENAI_API_BASE | OpenAI API 基础 URL | 可选 |
| ANKI_DECK_NAME | Anki 牌组名称 | "Vocabulary" |
| ANKI_MODEL_NAME | Anki 模板名称 | "Basic" |
| ANKI_CONNECT_URL | AnkiConnect URL | "http://localhost:8765" |

## 项目结构

```
.
├── data/
│   ├── audio/          # 音频文件缓存
│   └── vocabulary.csv  # 词汇数据存储
├── logs/               # 日志文件
├── src/
│   └── index.ts       # 主程序
├── .env.example       # 环境变量模板
└── package.json
```

## 开发指南

1. 启动开发模式：
   ```bash
   npm run dev
   ```

2. 日志查看：
   ```bash
   tail -f logs/anki-mcp-YYYY-MM-DD.log
   ```

## 注意事项

1. 确保 Anki 和 AnkiConnect 插件正在运行
2. 音频文件会自动缓存在 `data/audio` 目录
3. 词汇数据保存在 `data/vocabulary.csv`
4. 详细日志保存在 `logs` 目录

## 许可证

ISC
