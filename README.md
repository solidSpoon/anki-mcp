# Anki MCP Vocabulary Manager

一个基于 MCP (Model Context Protocol) 的 Anki 词汇管理工具。

## 功能特点

- 自动生成单词、释义和例句的发音（使用 OpenAI TTS）
- 使用美观的卡片模板
- 支持标签系统
- 支持笔记功能
- CSV 格式存储，方便版本控制
- 完全自动化的 Anki 卡片创建
- 支持热更新开发
- 环境变量配置

## 安装要求

1. Node.js (v16 或更高版本)
2. Anki
3. AnkiConnect 插件
4. OpenAI API 密钥

## 安装步骤

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
   # 编辑 .env 文件，填入你的配置
   ```

4. 编译项目：
   ```bash
   npm run build
   ```

5. 在 Anki 中安装 AnkiConnect 插件：
   - 打开 Anki
   - 工具 -> 插件 -> 获取插件
   - 输入代码：2055492159
   - 重启 Anki

6. 在 Claude for Desktop 中配置 MCP：
   编辑 `~/.config/claude-mcp/config.json`：
   ```json
   {
     "servers": {
       "anki-mcp": {
         "command": "node",
         "args": [
           "/path/to/anki-mcp/build/index.js"
         ],
         "env": {
           "PATH": "/usr/local/bin:/usr/bin:/bin"
         }
       }
     }
   }
   ```

## 开发说明

1. 启动开发模式（支持热更新）：
   ```bash
   npm run dev
   ```

2. 清理构建文件：
   ```bash
   npm run clean
   ```

3. 环境变量配置：
   - `OPENAI_API_KEY`: OpenAI API 密钥（必需）
   - `OPENAI_API_BASE`: OpenAI API 基础 URL（可选）
   - `ANKI_DECK_NAME`: Anki 牌组名称（默认：Vocabulary）
   - `ANKI_MODEL_NAME`: Anki 模板名称（默认：Basic）
   - `ANKI_CONNECT_URL`: AnkiConnect URL（默认：http://localhost:8765）

## 使用方法

1. 添加新单词：
   ```
   添加单词 "ephemeral"，定义为 "lasting for a very short time"，例句 "Social media posts are often ephemeral, disappearing after 24 hours."
   ```

2. 查看词汇列表：
   ```
   显示我的单词列表
   ```

3. 搜索单词：
   ```
   搜索包含 "time" 的单词
   ```

## 项目结构

```
.
├── data/
│   ├── audio/          # 音频文件
│   ├── card-style.css  # Anki 卡片样式
│   └── vocabulary.csv  # 词汇数据
├── src/
│   └── index.ts        # 主程序
├── .env.example        # 环境变量模板
├── .gitignore         # Git 忽略文件
├── package.json
└── README.md
```

## 注意事项

1. 确保 Anki 在添加单词时处于运行状态
2. 确保已正确设置 OpenAI API 密钥
3. 音频文件会自动保存在 `data/audio` 目录中
4. 词汇数据保存在 `data/vocabulary.csv` 中，可以提交到 Git 进行版本控制
5. 开发时使用 `npm run dev` 可以支持热更新
6. 环境变量可以在 `.env` 文件中配置

## 许可证

ISC 