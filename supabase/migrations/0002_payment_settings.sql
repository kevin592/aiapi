-- 支付设置升级为多通道结构（支付宝官方 / 微信官方 / 易支付）
-- 将旧的扁平结构 (epay_url/epay_pid/epay_key) 迁移到新的嵌套结构
update public.settings set value = jsonb_build_object(
  'enabled', '[]'::jsonb,
  'recharge_min', coalesce(value->>'recharge_min', '10'),
  'credits_rate', coalesce(value->>'credits_rate', '1'),
  'epay', jsonb_build_object(
    'url',  coalesce(value->>'epay_url', ''),
    'pid',  coalesce(value->>'epay_pid', ''),
    'key',  coalesce(value->>'epay_key', '')
  ),
  'alipay', jsonb_build_object(
    'app_id', '',
    'private_key', '',
    'alipay_public_key', ''
  ),
  'wechat', jsonb_build_object(
    'mchid', '',
    'appid', '',
    'api_v3_key', '',
    'serial_no', '',
    'private_key', ''
  )
)
where key = 'payment';
