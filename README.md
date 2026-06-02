# TaskMaster AI

TaskMaster 是一个面向个人与小团队的任务管理应用，支持任务维护、模板复用、历史追踪与日报输出，并提供访客模式便于快速体验。

## 主要功能

- 邮箱注册/登录（邮箱验证码）与访客模式（支持本地试用）
- 案件/父任务与子任务管理
- 任务模板与模板子任务管理
- 历史记录查看与任务回溯
- Excel 导入与周报导出（`.xlsx`）
- 基于 Gemini 的 AI 内容处理（需配置密钥）

## 技术栈

- React 19 + TypeScript + Vite 6
- 腾讯云开发 CloudBase（身份认证、云数据库）
- Express 开发服务器
- [exceljs](https://www.npmjs.com/package/exceljs) 处理 Excel 读写

## 本地运行

**前置条件：** Node.js 18+

1. 安装依赖：

   ```bash
   npm install
   ```

2. 配置环境变量（复制 `.env.example` 为 `.env.local` 并填写）：

   | 变量 | 说明 |
   | --- | --- |
   | `GEMINI_API_KEY` | Gemini API 密钥，用于 AI 功能 |
   | `APP_URL` | 应用访问地址（自引用链接等） |
   | `TCB_ENV_ID` | 腾讯云开发 CloudBase 环境 ID（认证与数据库必需） |

3. 配置 CloudBase：在云开发控制台开通环境，开启「邮箱登录」与「匿名登录」，创建集合并配置安全规则（详见 `cloudbase/README.md`），将环境 ID 填入 `.env.local` 的 `TCB_ENV_ID`。

4. 启动开发环境：

   ```bash
   npm run dev
   ```

   默认访问：<http://localhost:3000>

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产包至 `dist/` |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | TypeScript 类型检查 |
| `npm audit` | 检查依赖安全漏洞 |

## Excel 导入说明

- 仅支持 **`.xlsx`** 格式
- **第 1 行** 为表头，**第 2 行起** 为数据；不足 2 行提示「没有需要导入的数据」
- 列名定义见 `src/importColumns.ts`（如 `案件`、`タスク`、`予定工数(H)`、`実績工数(H)` 等）
- 合并列：`システム`(A–B)、`月次`(C–D)、`タスク`(K–P)；空单元格会向下填充
- 按 `案件` 分组创建父任务；组内每行一条子任务
- 若存在名为 `import` 的工作表，优先使用该表
- 导入页可下载模板：`public/task-import-template.xlsx`（保存为 `taskimportfile.xlsx`）

## 备注

- 访客模式下，数据保存在浏览器本地存储。
- 依赖安全：项目使用 `npm audit` 维护；Excel 相关功能使用 `exceljs`，不再使用存在已知漏洞且无官方补丁的 `xlsx` 包。
