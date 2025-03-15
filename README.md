# Anki MCP 词汇管理器

一个基于 MCP (Model Context Protocol) 的智能 Anki 词汇管理工具，支持自动生成发音、智能搜索和统计分析。

## 功能特点

- 智能词汇管理
  - 批量添加单词和个别添加
  - 自动生成单词、释义和例句的发音（OpenAI TTS）
  - 支持标签系统和笔记功能
  - CSV 格式存储，支持版本控制，防止单词丢失
  
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
3. AnkiConnect 插件（插件代码：2055492159）
4. OpenAI API 密钥

### AnkiConnect 插件安装

1. 打开 Anki
2. 点击顶部菜单 Tools（工具） -> Add-ons（插件）
3. 点击 "Get Add-ons..."（获取插件...）按钮
4. 输入插件代码：`2055492159`
5. 点击 OK 安装
6. 重启 Anki 使插件生效
7. 验证安装：
   - 确保 Anki 正在运行
   - 在浏览器中访问 `http://localhost:8765`
   - 如果看到空白页面或 JSON 响应，说明插件安装成功

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

3. 构建项目：
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
      "args": ["/path-of-project/build/index.js"],
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

## Anki 模板配置

在使用本工具之前，需要在 Anki 中创建正确的卡片模板。请按照以下步骤配置：

1. 在 Anki 中创建一个新的笔记类型（Tools -> Manage Note Types -> Add）
2. 添加以下字段：
   - Word（单词）
   - WordAudio（单词发音）
   - Definition（释义）
   - DefinitionAudio（释义发音）
   - Example（例句）
   - ExampleAudio（例句发音）

3. 配置卡片模板：

### 正面模板
```html
<div class="container">
    <div class="word">{{Word}}</div>
    <div class="audio-wrapper">{{WordAudio}}</div>
</div>
```

### 背面模板
```html
<div class="container">
    <!-- 单词部分 -->
    <div class="header">
        <div class="word">{{Word}}</div>
        <div class="audio-wrapper">{{WordAudio}}</div>
    </div>

    <!-- 释义部分 -->
    <div class="section">
        <div class="label">Definition</div>
        <div class="content">{{Definition}}</div>
        <div class="audio-wrapper">{{DefinitionAudio}}</div>
    </div>

    <!-- 例句部分 -->
    <div class="section">
        <div class="label">Example</div>
        <div class="content">{{Example}}</div>
        <div class="audio-wrapper">{{ExampleAudio}}</div>
    </div>
</div>
```

### 样式表
```css
.card {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background-color: #ffffff;
    color: #2c3e50;
    line-height: 1.6;
}

.container {
    padding: 30px;
    max-width: 800px;
    margin: 0 auto;
}

.header {
    text-align: center;
    margin-bottom: 40px;
    padding-bottom: 30px;
    border-bottom: 1px solid #eee;
}

.word {
    font-size: 36px;
    font-weight: 700;
    color: #1a1a1a;
    margin-bottom: 10px;
    letter-spacing: 0.5px;
}

.section {
    margin-bottom: 35px;
    padding: 20px;
    background-color: #f8f9fa;
    border-radius: 12px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    position: relative;
}

.label {
    font-size: 20px;
    font-weight: 600;
    color: #666;
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.content {
    font-size: 22px;
    color: #2c3e50;
    line-height: 1.7;
    padding: 0 10px;
}

/* 隐藏音频控件 */
.audio-wrapper {
    height: 0;
    width: 0;
    opacity: 0;
    overflow: hidden;
    position: absolute;
}

/* 响应式设计 */
@media (max-width: 480px) {
    .container {
        padding: 20px;
    }
  
    .word {
        font-size: 32px;
    }
  
    .content {
        font-size: 20px;
    }
}

/* 过渡效果 */
.section {
    transition: transform 0.2s ease;
}

.section:hover {
    transform: translateY(-2px);
}

/* 间距和对比度 */
.section + .section {
    margin-top: 25px;
}

/* 夜间模式支持 */
.nightMode .card {
    background-color: #1a1a1a;
    color: #ffffff;
}

.nightMode .section {
    background-color: #2d2d2d;
}

.nightMode .word {
    color: #ffffff;
}

.nightMode .label {
    color: #aaaaaa;
}

.nightMode .content {
    color: #dddddd;
}
```

4. 在环境变量中设置 `ANKI_MODEL_NAME` 为你创建的模板名称

## 注意事项

1. 确保 Anki 和 AnkiConnect 插件正在运行
2. 音频文件会自动缓存在 `data/audio` 目录
3. 词汇数据保存在 `data/vocabulary.csv`
4. 详细日志保存在 `logs` 目录

## 许可证

ISC
