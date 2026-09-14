-- ============================================================
-- AI API Gateway — 初始数据库结构
-- 使用方法：Supabase Dashboard -> SQL Editor -> 粘贴本文件 -> Run
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 表结构
-- ------------------------------------------------------------

-- 用户资料（扩展 auth.users）
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'user'  check (role in ('user', 'admin')),
  balance      numeric(12,4) not null default 0,   -- 余额（元）
  status       text not null default 'active' check (status in ('active', 'banned')),
  created_at   timestamptz not null default now()
);

-- API 令牌（只存哈希，明文仅在创建时展示一次）
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null default '默认令牌',
  key_prefix   text not null,                        -- 展示用前缀，如 sk-Ab3dE
  key_hash     text not null unique,                 -- sha256(完整key)
  allow_models text[] default null,                  -- null = 允许全部模型
  status       text not null default 'active' check (status in ('active', 'disabled')),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expired_at   timestamptz
);

-- 上游渠道（管理员维护）
create table public.channels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null default 'openai' check (type in ('openai', 'anthropic')),
  base_url   text not null,                          -- 如 https://api.openai.com 或 https://api.deepseek.com
  api_key    text not null,
  models     text[] not null default '{}',           -- 该渠道支持的模型列表
  priority   int  not null default 0,                -- 大者优先
  weight     int  not null default 1,                -- 同优先级内按权重随机分流
  status     text not null default 'enabled' check (status in ('enabled', 'disabled')),
  remark     text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 模型定价（元 / 百万 tokens）
create table public.model_pricing (
  model        text primary key,
  input_price  numeric(10,4) not null default 0,
  output_price numeric(10,4) not null default 0,
  description  text default '',
  updated_at   timestamptz not null default now()
);

-- 调用日志
create table public.usage_logs (
  id                bigint generated always as identity primary key,
  user_id           uuid not null,
  key_id            uuid,
  channel_id        uuid,
  model             text not null default '',
  prompt_tokens     int not null default 0,
  completion_tokens int not null default 0,
  cost              numeric(12,6) not null default 0,
  latency_ms        int,
  status            int,
  created_at        timestamptz not null default now()
);

-- 充值订单
create table public.orders (
  id         uuid primary key default gen_random_uuid(),
  order_no   text not null unique,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     numeric(10,2) not null,                 -- 支付金额（元）
  credits    numeric(12,4) not null,                 -- 到账额度（元）
  provider   text not null default 'epay',
  pay_type   text,                                   -- alipay / wxpay
  status     text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired')),
  trade_no   text,
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);

-- 系统设置（KV）
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 索引
-- ------------------------------------------------------------
create index api_keys_user_idx        on public.api_keys(user_id);
create index usage_logs_user_idx      on public.usage_logs(user_id, created_at desc);
create index usage_logs_created_idx   on public.usage_logs(created_at desc);
create index orders_user_idx          on public.orders(user_id, created_at desc);

-- ------------------------------------------------------------
-- 函数
-- ------------------------------------------------------------

-- 管理员判断（供 RLS 策略使用）
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

-- 注册时自动创建 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 计费 + 记账 + 扣余额（仅 service_role 调用，原子操作）
create or replace function public.apply_usage(
  p_user_id uuid, p_key_id uuid, p_channel_id uuid, p_model text,
  p_prompt_tokens int, p_completion_tokens int, p_cost numeric,
  p_latency_ms int, p_status int
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- 仅允许 service_role（无用户上下文）调用
  if auth.uid() is not null then
    raise exception 'permission denied';
  end if;

  insert into public.usage_logs (user_id, key_id, channel_id, model,
    prompt_tokens, completion_tokens, cost, latency_ms, status)
  values (p_user_id, p_key_id, p_channel_id, p_model,
    p_prompt_tokens, p_completion_tokens, p_cost, p_latency_ms, p_status);

  update public.profiles set balance = balance - p_cost where id = p_user_id;
  update public.api_keys  set last_used_at = now()   where id = p_key_id;
end;
$$;

-- 管理员/服务角色调整余额
create or replace function public.admin_adjust_balance(p_user_id uuid, p_delta numeric)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare new_balance numeric;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'permission denied';
  end if;
  update public.profiles set balance = balance + p_delta where id = p_user_id
    returning balance into new_balance;
  return coalesce(new_balance, -1);
end;
$$;

-- 设置用户角色
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'permission denied';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

-- 设置用户状态（封禁/解封）
create or replace function public.admin_set_status(p_user_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'permission denied';
  end if;
  update public.profiles set status = p_status where id = p_user_id;
end;
$$;

-- 标记订单已支付并加余额（仅 service_role，幂等）
create or replace function public.mark_order_paid(p_order_no text, p_trade_no text default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare o record;
begin
  if auth.uid() is not null then
    raise exception 'permission denied';
  end if;

  select * into o from public.orders where order_no = p_order_no for update;
  if not found then return false; end if;
  if o.status = 'paid' then return true; end if;   -- 幂等

  update public.orders
    set status = 'paid', trade_no = coalesce(p_trade_no, trade_no), paid_at = now()
    where id = o.id;
  update public.profiles set balance = balance + o.credits where id = o.user_id;
  return true;
end;
$$;

-- ------------------------------------------------------------
-- RLS 行级安全策略
-- ------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.api_keys      enable row level security;
alter table public.channels      enable row level security;
alter table public.model_pricing enable row level security;
alter table public.usage_logs    enable row level security;
alter table public.orders        enable row level security;
alter table public.settings      enable row level security;

-- profiles：本人可读，管理员可读全部（写入仅走 RPC / service_role）
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- api_keys：本人增删改查
create policy "keys_select" on public.api_keys
  for select using (user_id = auth.uid() or public.is_admin());
create policy "keys_insert" on public.api_keys
  for insert with check (user_id = auth.uid());
create policy "keys_update" on public.api_keys
  for update using (user_id = auth.uid() or public.is_admin());
create policy "keys_delete" on public.api_keys
  for delete using (user_id = auth.uid() or public.is_admin());

-- channels：仅管理员
create policy "channels_all" on public.channels
  for all using (public.is_admin()) with check (public.is_admin());

-- 定价：所有人可读（前端展示），管理员可写
create policy "pricing_select" on public.model_pricing
  for select using (true);
create policy "pricing_write" on public.model_pricing
  for all using (public.is_admin()) with check (public.is_admin());

-- 日志：本人/管理员可读（写入仅 service_role）
create policy "usage_select" on public.usage_logs
  for select using (user_id = auth.uid() or public.is_admin());

-- 订单：本人可读，只能创建 pending 状态（防伪造已支付订单）
create policy "orders_select" on public.orders
  for select using (user_id = auth.uid() or public.is_admin());
create policy "orders_insert" on public.orders
  for insert with check (user_id = auth.uid() and status = 'pending');

-- 设置：登录可读，管理员可写
create policy "settings_select" on public.settings
  for select using (auth.uid() is not null or public.is_admin());
create policy "settings_write" on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 初始数据
-- ------------------------------------------------------------

-- 常见模型参考定价（元 / 百万 tokens，请管理员在后台按实际上游成本调整）
insert into public.model_pricing (model, input_price, output_price, description) values
  ('gpt-4o',              17.5, 70.0, '官方价约 $2.5/$10 每百万'),
  ('gpt-4o-mini',          1.05, 4.2, '官方价约 $0.15/$0.60 每百万'),
  ('claude-sonnet-4-20250514',      21.0, 105.0, '官方价约 $3/$15 每百万'),
  ('claude-3-5-haiku-20241022',      5.8, 28.8, '官方价约 $0.80/$4 每百万'),
  ('deepseek-chat',        2.0,  8.0, '官方价约'),
  ('deepseek-reasoner',    4.0, 16.0, '官方价约'),
  ('qwen-plus',            0.8,  2.0, '官方价约'),
  ('gemini-2.0-flash',     2.8, 11.2, '官方价约')
on conflict (model) do nothing;

-- 系统设置
insert into public.settings (key, value) values
  ('site',
   '{"name": "Team AI Gateway", "site_url": "", "api_base": ""}'),
  ('payment',
   '{"provider": "epay", "epay_url": "", "epay_pid": "", "epay_key": "", "recharge_min": 10, "credits_rate": 1}')
on conflict (key) do nothing;
