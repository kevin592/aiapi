// ============================================================
// AI API Gateway — OpenAI / Anthropic 兼容网关
// 部署：supabase functions deploy api --no-verify-jwt
//
// 接入地址（OpenAI 兼容客户端）：
//   https://<project-ref>.supabase.co/functions/v1/api/v1
//   客户端会自动拼接 /chat/completions、/models、/embeddings
// Anthropic 客户端（如 Claude Code）：
//   https://<project-ref>.supabase.co/functions/v1/api
//   客户端会自动拼接 /v1/messages
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-api-key, content-type, anthropic-version, anthropic-beta, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

// 上游单次请求超时（Edge Function 平台硬上限约 400s，留余量）
const UPSTREAM_TIMEOUT_MS = 280_000

interface KeyRow {
  id: string
  user_id: string
  status: string
  expired_at: string | null
  allow_models: string[] | null
}

interface ProfileRow {
  id: string
  role: string
  status: string
  balance: string | number
}

interface ChannelRow {
  id: string
  name: string
  type: string
  base_url: string
  api_key: string
  models: string[]
  priority: number
  weight: number
  status: string
}

interface Usage {
  prompt_tokens: number
  completion_tokens: number
}

// ---------- 工具函数 ----------

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

function apiError(status: number, message: string, type = 'invalid_request_error'): Response {
  return json(status, { error: { message, type, code: status } })
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 粗略估算 token 数（仅在上游未返回 usage 时兜底） */
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 3)
}

/** 拼接上游 URL，自动处理末尾斜杠与重复的 /v1 */
function joinUrl(base: string, path: string): string {
  const b = base.trim().replace(/\/+$/, '')
  let p = path.startsWith('/') ? path : `/${path}`
  if (b.endsWith('/v1') && p.startsWith('/v1/')) p = p.slice(3)
  return b + p
}

// ---------- 渠道选择：优先级分组 + 权重随机 ----------

async function pickChannels(model: string, type?: string): Promise<ChannelRow[]> {
  let q = db.from('channels').select('*').eq('status', 'enabled')
    .contains('models', [model]).order('priority', { ascending: false })
  if (type) q = q.eq('type', type)
  const { data, error } = await q
  if (error || !data || data.length === 0) return []

  const all = data as ChannelRow[]
  const top = all[0].priority
  const group = all.filter((c) => c.priority === top)
  const fallback = all.filter((c) => c.priority !== top)

  // 同优先级内按权重加权随机排序
  const pool = [...group]
  const ordered: ChannelRow[] = []
  while (pool.length > 0) {
    const total = pool.reduce((s, c) => s + Math.max(1, c.weight), 0)
    let r = Math.random() * total
    let idx = 0
    for (; idx < pool.length; idx++) {
      r -= Math.max(1, pool[idx].weight)
      if (r <= 0) break
    }
    idx = Math.min(idx, pool.length - 1)
    ordered.push(pool.splice(idx, 1)[0])
  }
  return [...ordered, ...fallback]
}

// ---------- 计费 ----------

async function recordUsage(params: {
  userId: string
  keyId: string
  channelId: string
  model: string
  usage: Usage | null
  outChars: number
  promptEstimate: number
  status: number
  latencyMs: number
}): Promise<void> {
  const ok = params.status >= 200 && params.status < 300
  const promptTokens = params.usage?.prompt_tokens ?? (ok ? params.promptEstimate : 0)
  const completionTokens = params.usage?.completion_tokens ??
    (ok ? Math.ceil(params.outChars / 3) : 0)

  // 定价实时查一次，保证与管理员后台修改一致
  const { data: pricing } = await db.from('model_pricing')
    .select('input_price, output_price').eq('model', params.model).maybeSingle()
  const inPrice = Number(pricing?.input_price ?? 0)
  const outPrice = Number(pricing?.output_price ?? 0)
  const cost = (promptTokens / 1e6) * inPrice + (completionTokens / 1e6) * outPrice

  const { error } = await db.rpc('apply_usage', {
    p_user_id: params.userId,
    p_key_id: params.keyId,
    p_channel_id: params.channelId,
    p_model: params.model,
    p_prompt_tokens: promptTokens,
    p_completion_tokens: completionTokens,
    p_cost: cost,
    p_latency_ms: params.latencyMs,
    p_status: params.status,
  })
  if (error) console.error('apply_usage failed:', error.message)
}

// ---------- 流式 usage 捕获（透传的同时解析 SSE） ----------

function makeUsageInterceptor(
  onFinish: (usage: Usage | null, outChars: number) => Promise<void>,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  let rest = ''
  let outChars = 0
  let usage: Usage | null = null            // OpenAI 格式: usage.prompt_tokens/completion_tokens
  let anthropicIn = 0                        // Anthropic 格式: usage.input_tokens/output_tokens
  let anthropicOut = 0

  return new TransformStream({
    transform(chunk, controller) {
      // 立即透传，不增加延迟
      controller.enqueue(chunk)
      outChars += chunk.byteLength
      rest += decoder.decode(chunk, { stream: true })

      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const obj = JSON.parse(payload)
          const u = obj.usage
          if (u && typeof u === 'object') {
            if (u.prompt_tokens != null || u.completion_tokens != null) {
              usage = {
                prompt_tokens: u.prompt_tokens ?? usage?.prompt_tokens ?? 0,
                completion_tokens: u.completion_tokens ?? usage?.completion_tokens ?? 0,
              }
            }
            if (u.input_tokens != null) anthropicIn = u.input_tokens
            if (u.output_tokens != null) anthropicOut = u.output_tokens
          }
        } catch {
          // 非 JSON 行，忽略
        }
      }
    },
    async flush() {
      const final = usage ??
        (anthropicIn > 0 || anthropicOut > 0
          ? { prompt_tokens: anthropicIn, completion_tokens: anthropicOut }
          : null)
      try {
        await onFinish(final, outChars)
      } catch (e) {
        console.error('bill stream failed:', e)
      }
    },
  })
}

// ---------- 鉴权 ----------

async function authenticate(req: Request): Promise<{ keyRow: KeyRow; profile: ProfileRow } | Response> {
  const authHeader = req.headers.get('authorization') ?? ''
  const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim() || req.headers.get('x-api-key') || ''
  if (!rawKey.startsWith('sk-')) {
    return apiError(401, '缺少 API Key。请在控制台「API 令牌」页创建，并通过 Authorization: Bearer sk-xxx 或 x-api-key 传入。', 'authentication_error')
  }

  const hash = await sha256Hex(rawKey)
  const { data: keyRow } = await db.from('api_keys')
    .select('id, user_id, status, expired_at, allow_models')
    .eq('key_hash', hash).maybeSingle()

  if (!keyRow || keyRow.status !== 'active') {
    return apiError(401, 'API Key 无效或已禁用。', 'authentication_error')
  }
  if (keyRow.expired_at && new Date(keyRow.expired_at) < new Date()) {
    return apiError(401, 'API Key 已过期。', 'authentication_error')
  }

  const { data: profile } = await db.from('profiles')
    .select('id, role, status, balance').eq('id', keyRow.user_id).maybeSingle()
  if (!profile || profile.status !== 'active') {
    return apiError(403, '账号已被禁用，请联系管理员。', 'permission_error')
  }
  if (profile.role !== 'admin' && Number(profile.balance) <= 0) {
    return apiError(402, '余额不足，请先充值或联系管理员。', 'insufficient_quota')
  }
  return { keyRow: keyRow as KeyRow, profile: profile as ProfileRow }
}

function checkModelPermission(keyRow: KeyRow, model: string): Response | null {
  if (keyRow.allow_models && keyRow.allow_models.length > 0 && !keyRow.allow_models.includes(model)) {
    return apiError(403, `该令牌不允许使用模型 ${model}。`, 'permission_error')
  }
  return null
}

// ---------- 路由处理器 ----------

async function handleModels(): Promise<Response> {
  const { data, error } = await db.from('channels').select('models').eq('status', 'enabled')
  if (error) return apiError(500, error.message, 'api_error')
  const set = new Set<string>()
  for (const row of data ?? []) for (const m of row.models ?? []) set.add(m)
  return json(200, {
    object: 'list',
    data: Array.from(set).sort().map((m) => ({ id: m, object: 'model', owned_by: 'aiapi' })),
  })
}

async function handleChatCompletion(
  req: Request,
  keyRow: KeyRow,
  profile: ProfileRow,
): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError(400, '请求体不是合法 JSON。')
  }
  const model = typeof body.model === 'string' ? body.model : ''
  if (!model) return apiError(400, '缺少 model 参数。')

  const denied = checkModelPermission(keyRow, model)
  if (denied) return denied

  const channels = await pickChannels(model)
  if (channels.length === 0) {
    return apiError(503, `没有可用渠道支持模型 ${model}，请联系管理员在后台添加渠道。`, 'service_unavailable')
  }

  const isStream = body.stream === true
  if (isStream) {
    // 注入 include_usage 以便流式结束时拿到 token 用量
    body.stream_options = { ...(body.stream_options as object ?? {}), include_usage: true }
  }
  const payload = JSON.stringify(body)
  const promptEstimate = estimateTokens(JSON.stringify(body.messages ?? body.input ?? ''))

  let lastError = 'unknown'
  for (const ch of channels) {
    const started = Date.now()
    try {
      const res = await fetch(joinUrl(ch.base_url, '/v1/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ch.api_key}` },
        body: payload,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })

      // 渠道级错误：换下一个渠道重试
      if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403) {
        lastError = `渠道「${ch.name}」HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        console.warn(lastError)
        continue
      }

      // 客户端请求本身的错误（参数问题等）：原样返回，不重试
      if (!res.ok) {
        const text = await res.text()
        await recordUsage({
          userId: profile.id, keyId: keyRow.id, channelId: ch.id, model,
          usage: { prompt_tokens: 0, completion_tokens: 0 }, outChars: 0,
          promptEstimate: 0, status: res.status, latencyMs: Date.now() - started,
        })
        return new Response(text, {
          status: res.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
        })
      }

      // 非流式：读完整响应，解析 usage 计费后返回
      if (!isStream) {
        const text = await res.text()
        let usage: Usage | null = null
        try {
          const obj = JSON.parse(text)
          if (obj.usage) {
            usage = { prompt_tokens: obj.usage.prompt_tokens ?? 0, completion_tokens: obj.usage.completion_tokens ?? 0 }
          }
        } catch { /* 保留 null，走估算 */ }
        await recordUsage({
          userId: profile.id, keyId: keyRow.id, channelId: ch.id, model,
          usage, outChars: text.length, promptEstimate,
          status: 200, latencyMs: Date.now() - started,
        })
        return new Response(text, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
        })
      }

      // 流式：边透传边捕获 usage，流结束后计费
      if (!res.body) {
        lastError = `渠道「${ch.name}」返回空 body`
        continue
      }
      const stream = res.body.pipeThrough(
        makeUsageInterceptor(async (usage, outChars) => {
          await recordUsage({
            userId: profile.id, keyId: keyRow.id, channelId: ch.id, model,
            usage, outChars, promptEstimate, status: 200, latencyMs: Date.now() - started,
          })
        }),
      )
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...CORS_HEADERS,
        },
      })
    } catch (e) {
      lastError = `渠道「${ch.name}」${e instanceof Error ? e.message : String(e)}`
      console.warn(lastError)
    }
  }
  return apiError(502, `所有渠道均调用失败，最后错误：${lastError}`, 'upstream_error')
}

async function handleEmbeddings(
  req: Request,
  keyRow: KeyRow,
  profile: ProfileRow,
): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError(400, '请求体不是合法 JSON。')
  }
  const model = typeof body.model === 'string' ? body.model : ''
  if (!model) return apiError(400, '缺少 model 参数。')

  const denied = checkModelPermission(keyRow, model)
  if (denied) return denied

  const channels = await pickChannels(model)
  if (channels.length === 0) return apiError(503, `没有可用渠道支持模型 ${model}。`, 'service_unavailable')

  const promptEstimate = estimateTokens(JSON.stringify(body.input ?? ''))
  const payload = JSON.stringify(body)

  let lastError = 'unknown'
  for (const ch of channels) {
    const started = Date.now()
    try {
      const res = await fetch(joinUrl(ch.base_url, '/v1/embeddings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ch.api_key}` },
        body: payload,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      if (!res.ok) {
        lastError = `渠道「${ch.name}」HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        if (res.status >= 500 || res.status === 429) continue
        return new Response(lastError, { status: res.status, headers: CORS_HEADERS })
      }
      const text = await res.text()
      let usage: Usage | null = null
      try {
        const obj = JSON.parse(text)
        if (obj.usage) usage = { prompt_tokens: obj.usage.prompt_tokens ?? 0, completion_tokens: 0 }
      } catch { /* ignore */ }
      await recordUsage({
        userId: profile.id, keyId: keyRow.id, channelId: ch.id, model,
        usage, outChars: 0, promptEstimate, status: 200, latencyMs: Date.now() - started,
      })
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
      })
    } catch (e) {
      lastError = `渠道「${ch.name}」${e instanceof Error ? e.message : String(e)}`
    }
  }
  return apiError(502, `所有渠道均调用失败，最后错误：${lastError}`, 'upstream_error')
}

async function handleAnthropicMessages(
  req: Request,
  keyRow: KeyRow,
  profile: ProfileRow,
): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError(400, '请求体不是合法 JSON。')
  }
  const model = typeof body.model === 'string' ? body.model : ''
  if (!model) return apiError(400, '缺少 model 参数。')

  const denied = checkModelPermission(keyRow, model)
  if (denied) return denied

  const channels = await pickChannels(model, 'anthropic')
  if (channels.length === 0) {
    return apiError(503, `没有 anthropic 类型渠道支持模型 ${model}，请联系管理员添加（渠道类型选 anthropic）。`, 'service_unavailable')
  }

  const isStream = body.stream === true
  const payload = JSON.stringify(body)
  const promptEstimate = estimateTokens(JSON.stringify(body.messages ?? ''))
  const anthropicVersion = req.headers.get('anthropic-version') ?? '2023-06-01'

  let lastError = 'unknown'
  for (const ch of channels) {
    const started = Date.now()
    try {
      const res = await fetch(joinUrl(ch.base_url, '/v1/messages'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ch.api_key,
          'anthropic-version': anthropicVersion,
        },
        body: payload,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      if (!res.ok) {
        lastError = `渠道「${ch.name}」HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        if (res.status >= 500 || res.status === 429) continue
        await recordUsage({
          userId: profile.id, keyId: keyRow.id, channelId: ch.id, model,
          usage: { prompt_tokens: 0, completion_tokens: 0 }, outChars: 0,
          promptEstimate: 0, status: res.status, latencyMs: Date.now() - started,
        })
        return new Response(lastError, { status: res.status, headers: CORS_HEADERS })
      }

      if (!isStream) {
        const text = await res.text()
        let usage: Usage | null = null
        try {
          const obj = JSON.parse(text)
          if (obj.usage) {
            usage = { prompt_tokens: obj.usage.input_tokens ?? 0, completion_tokens: obj.usage.output_tokens ?? 0 }
          }
        } catch { /* ignore */ }
        await recordUsage({
          userId: profile.id, keyId: keyRow.id, channelId: ch.id, model,
          usage, outChars: text.length, promptEstimate,
          status: 200, latencyMs: Date.now() - started,
        })
        return new Response(text, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
        })
      }

      if (!res.body) {
        lastError = `渠道「${ch.name}」返回空 body`
        continue
      }
      const stream = res.body.pipeThrough(
        makeUsageInterceptor(async (usage, outChars) => {
          await recordUsage({
            userId: profile.id, keyId: keyRow.id, channelId: ch.id, model,
            usage, outChars, promptEstimate, status: 200, latencyMs: Date.now() - started,
          })
        }),
      )
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...CORS_HEADERS,
        },
      })
    } catch (e) {
      lastError = `渠道「${ch.name}」${e instanceof Error ? e.message : String(e)}`
    }
  }
  return apiError(502, `所有渠道均调用失败，最后错误：${lastError}`, 'upstream_error')
}

// ---------- 入口 ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  // 兼容两种形式：平台可能传入完整 /functions/v1/api/v1/chat/completions，
  // 也可能剥掉 /functions/v1 前缀后传入 /api/v1/chat/completions
  const url = new URL(req.url)
  let path = url.pathname.replace(/^\/functions\/v1\/?/, '')
  path = path.replace(/^\/+api(?:\/|$)/, '')
  const route = path.replace(/^\/?v1(?:\/|$)/, '').replace(/^\/+|\/+$/g, '')

  if (route === '' || route === 'health') {
    return json(200, { ok: true, service: 'aiapi-gateway' })
  }

  const auth = await authenticate(req)
  if (auth instanceof Response) return auth
  const { keyRow, profile } = auth

  if (route === 'models' && req.method === 'GET') return handleModels()
  if (route === 'chat/completions' && req.method === 'POST') return handleChatCompletion(req, keyRow, profile)
  if (route === 'embeddings' && req.method === 'POST') return handleEmbeddings(req, keyRow, profile)
  if (route === 'messages' && req.method === 'POST') return handleAnthropicMessages(req, keyRow, profile)

  return apiError(404, `未知接口：${route}。支持 /v1/chat/completions、/v1/models、/v1/embeddings、/v1/messages`)
})
