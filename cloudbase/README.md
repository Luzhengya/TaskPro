# CloudBase（腾讯云开发）配置说明

本项目已从 Firebase 迁移到腾讯云开发 CloudBase（身份认证 + 云数据库）。
以下为控制台一次性配置步骤。

## 1. 创建环境

1. 登录 [腾讯云开发控制台](https://console.cloud.tencent.com/tcb)，创建一个环境（按量计费或包年包月均可）。
2. 记下 **环境 ID（envId）**，填入项目根目录 `.env.local` 的 `TCB_ENV_ID`。

## 2. 开启登录方式

控制台「身份认证 > 登录方式」中开启：

- **邮箱登录**（用于邮箱 + 验证码 注册 / 登录 / 找回密码）
- **匿名登录**（用于「游客模式」；若不开启，应用会自动回退到浏览器本地存储的游客模式）

> 邮箱验证码依赖 CloudBase 的邮件发送能力，请确认环境已开通邮件服务。

## 3. 创建集合

在「数据库」中创建以下 6 个集合（空集合即可）：

- `parent_tasks`
- `sub_tasks`
- `task_templates`
- `template_items`
- `settings`
- `daily_reports`

## 4. 配置安全规则（所有者隔离）

对**每个**集合，在「权限设置 > 自定义安全规则」中粘贴 [`database-rules.json`](./database-rules.json) 的内容：

```json
{
  "read": "auth.uid == doc.owner_id",
  "write": "auth.uid == doc.owner_id"
}
```

这样每个用户只能读写自己 `owner_id` 的文档。

> 说明：原 Firestore 规则中的「字段类型 / 白名单」强校验未在此复刻（CloudBase 安全规则表达能力有限）。如需强校验，可后续用云函数实现。管理员后门（基于固定邮箱）已移除。

## 5. 建立索引（实时监听 watch 与查询所需）

为高频查询字段建立索引：

| 集合 | 建议索引字段 |
| --- | --- |
| `parent_tasks` | `owner_id`、`is_hidden` |
| `sub_tasks` | `owner_id`、`parent_task_id` |
| `task_templates` | `owner_id` |
| `template_items` | `owner_id`、`template_id` |
| `settings` | `owner_id` |
| `daily_reports` | `owner_id`、`date` |

## 6. 安全来源 / 域名白名单

在「环境 > 安全配置」中，将本地开发地址（如 `http://localhost:3000`）与正式部署域名加入 WEB 安全域名白名单。

## 7. 部署（静态网站托管，可选）

使用 [CloudBase CLI](https://docs.cloudbase.net/cli-v1/intro)：

```bash
npm i -g @cloudbase/cli
tcb login
# 方式一：使用本目录的 cloudbaserc.json（CloudBase Framework）
tcb framework deploy
# 方式二：直接部署已构建的 dist 到静态托管
npm run build && tcb hosting deploy dist -e <你的环境ID>
```
