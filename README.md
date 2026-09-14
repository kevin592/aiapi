# AI API 网关（aiapi）

给团队用的大模型 API 中转体系：**一个 sk- 令牌访问所有模型**，带用户管理、额度计费、用量统计和微信/支付宝充值。

## 架构

```
┌──────────────────┐     ┌─────────────────────────────┐     ┌──────────────────┐
│  团队成员/客户端   │────▶│  Supabase Edge Functions     │────▶│  上游大模型 API   │
│  (curl/SDK/Claude │     │  ┌───────────────────────┐  │     │  OpenAI/DeepSeek │
│   Code/Cursor…)   │     │  │ api（API网关）         │  │     │  Anthropic/硅基… │
└──────────────────┘     │  │ - sk-令牌鉴权          │  │     └──────────────────┘
                         │  │ - 渠道选择/故障切换     │  │
┌──────────────────┐     │  │ - 流式透传 + 计费       │  │     ┌──────────────────┐
│  Web 控制台       │────▶│  │ - 用量日志             │  │────▶│  Supabase        │
│  (GitHub Pages)   │     │  ├───────────────────────┤  │     │  Postgres + Auth │
│  登录/令牌/充值/   │     │  │ pay-create / pay-notify│  │     │  (RLS 行级安全)  │
│  管理后台          │     │  └───────────────────────┘  │     └──────────────────┘
└──────────────────┘     └─────────────────────────────┘
                                   ▲
                         ┌─────────┴─────────┐
                         │  微信/支付宝(易支付) │
                         └───────────────────┘
```

- **前端控制台**：React + Vite + Tailwind，静态构建部署到 **GitHub Pages**（以后可直接换自定义域名）
- **API 网关**：Supabase Edge Functions（全球边缘节点、免服务器、免费额度足够团队使用，**直连海外上游无网络障碍**）
- **认证与数据**：Supabase Auth（邮箱注册登录）+ Postgres（RLS 行级安全）
- **计费**：按 token 用量实时扣费（元 / 百万 tokens，管理员可定价），支持渠道优先级 + 权重分流 + 故障自动切换
- **支付**：易支付协议（微信 / 支付宝聚合，个人可申请）；也支持管理员手动调整余额

## 功能清单

**用户端**：注册登录、余额与用量概览（14 天图表）、API 令牌管理（只存哈希）、用量明细查询、微信/支付宝扫码充值

**管理端**：上游渠道管理（OpenAI 兼容 / Anthropic 原生，优先级 + 权重）、用户管理（余额调整/管理员/封禁）、模型定价、订单管理、系统设置

---

## 部署指南（约 15 分钟）

### 第 1 步：创建 Supabase 项目

1. 打开 [supabase.com](https://supabase.com) → New project（免费版即可）
2. 记下 **Project URL** 和 **anon key**（Settings → API）
3. （建议）团队内部使用：Authentication → Providers → Email → 关闭 "Confirm email"，注册后无需邮箱验证

### 第 2 步：初始化数据库

Dashboard → **SQL Editor** → 粘贴 `supabase/migrations/0001_init.sql` 全部内容 → Run。

### 第 3 步：部署 Edge Functions

**方式 A（推荐）：用 CLI**

```bash
npm install -g supabase
supabase login                       # 浏览器里登录
supabase link --project-ref <你的项目ref>
supabase functions deploy api --no-verify-jwt          # API 网关（必须关闭 JWT 校验）
supabase functions deploy pay-create                    # 创建支付订单
supabase functions deploy pay-notify --no-verify-jwt    # 支付回调
```

**方式 B：Dashboard 手动创建**

Edge Functions → New function → 分别创建 `api`、`pay-create`、`pay-notify` 三个函数，粘贴对应 `supabase/functions/<名称>/index.ts` 内容。
⚠️ `api` 和 `pay-notify` 必须在函数详情里**关闭 "Verify JWT"**（它们用自定义 sk- 令牌 / MD5 签名鉴权）。

### 第 4 步：配置 GitHub Pages

1. 本仓库已推送（私有仓库）。在仓库 **Settings → Secrets and variables → Actions → Variables** 添加：
   - `VITE_SUPABASE_URL` = `https://<项目ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = anon key
2. **Settings → Pages → Source** 选择 **GitHub Actions**
3. 推送到 main 分支即自动构建部署，地址为 `https://<用户名>.github.io/aiapi/`
4. （以后）自定义域名：Settings → Pages → Custom domain 填入你的域名即可，无需改代码

### 第 5 步：初始化管理员

1. 打开部署好的控制台，注册第一个账号
2. Supabase → SQL Editor 执行：

```sql
update profiles set role = 'admin' where email = '你的邮箱';
```

3. 重新登录，左侧出现「管理后台」

### 第 6 步：配置渠道和定价

1. 管理后台 → **渠道管理** → 添加上游。常用上游：

   | 上游 | 类型 | Base URL |
   |------|------|----------|
   | DeepSeek 官方 | openai | `https://api.deepseek.com` |
   | OpenAI 官方 | openai | `https://api.openai.com` |
   | Anthropic（Claude 原生） | anthropic | `https://api.anthropic.com` |
   | Anthropic（OpenAI 兼容层） | openai | `https://api.anthropic.com/openai` |
   | 硅基流动 / Moonshot / OpenRouter 等 | openai | 见对应官网 |

2. **模型定价**：按渠道支持的模型配置单价（元 / 百万 tokens）
3. **系统设置**：填入 `api_base`（`https://<项目ref>.supabase.co/functions/v1/api/v1`）和 `site_url`（前端地址），用户概览页会展示接入信息

### 第 7 步（可选）：配置微信/支付宝支付

1. 申请一个易支付兼容的聚合支付商户（支持微信 + 支付宝，个人可申请；如已有个体户/企业资质也可接官方微信支付/支付宝，需要自行扩展 `pay-create`/`pay-notify`）
2. 管理后台 → **系统设置** → 填入易支付网关地址、商户 pid、密钥
3. 测试：充值页发起 10 元充值 → 扫码支付 → 余额自动到账

不配置支付也完全可用：管理员在「用户管理」中手动「调余额」即可给团队成员充值。

---

## 客户端接入示例

API 地址（Base URL）：`https://<项目ref>.supabase.co/functions/v1/api/v1`

**curl**

```bash
curl https://<项目ref>.supabase.co/functions/v1/api/v1/chat/completions \
  -H "Authorization: Bearer sk-你的令牌" \
  -H "Content-Type: application/json" \
  -d '{"model": "deepseek-chat", "messages": [{"role": "user", "content": "你好"}], "stream": true}'
```

**Python（OpenAI SDK）**

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-你的令牌",
    base_url="https://<项目ref>.supabase.co/functions/v1/api/v1",
)

resp = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)
```

**Claude Code（Anthropic 协议透传）**

需要管理端添加一个 `anthropic` 类型渠道，然后：

```bash
export ANTHROPIC_BASE_URL=https://<项目ref>.supabase.co/functions/v1/api
export ANTHROPIC_AUTH_TOKEN=sk-你的令牌
claude
```

**Cursor / 其他工具**：任何支持自定义 OpenAI Base URL 的工具都可直接使用。

## 安全设计

- 用户 API 令牌只保存 **SHA-256 哈希**，明文仅创建时展示一次
- 上游渠道密钥仅存于数据库、仅在 Edge Functions（service role）中使用，不会进入前端代码
- Postgres 全表启用 **RLS**，用户只能读写自己的数据；余额/角色变更只能通过管理员 RPC
- 充值订单只能以 `pending` 状态创建，入账仅在服务端验签（MD5 商户签名）后执行，幂等防重复入账

## 已知限制

- Edge Functions 单次请求最长约 400 秒（超长生成会被截断；常规对话不受影响）
- 流式响应被客户端主动中断时，该次请求可能按上游已返回的 usage 计费或漏记（极端情况）
- 未配置定价的模型按 0 元计费（只记账不扣费）
- Supabase 免费版：Edge Functions 每月 50 万次调用、数据库 500MB，团队规模足够；超出可升级 Pro（$25/月）

## 本地开发

```bash
cd web
cp .env.example .env.local   # 填入 Supabase 地址和 anon key
npm install
npm run dev
```

数据库与 Edge Functions 变更直接在 Supabase Dashboard 操作，或用 `supabase` CLI。
