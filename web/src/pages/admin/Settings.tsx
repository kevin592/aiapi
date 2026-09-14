import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Card, ErrorText, Field, Input } from '../../components/ui'

interface SiteConfig {
  name: string
  site_url: string
  api_base: string
}

interface EpayCfg { url: string; pid: string; key: string }
interface AlipayCfg { app_id: string; private_key: string; alipay_public_key: string }
interface WechatCfg { mchid: string; appid: string; api_v3_key: string; serial_no: string; private_key: string }

interface PaymentConfig {
  enabled: string[]
  recharge_min: number
  credits_rate: number
  epay: EpayCfg
  alipay: AlipayCfg
  wechat: WechatCfg
}

const defaultSite: SiteConfig = { name: 'Team AI Gateway', site_url: '', api_base: '' }
const defaultPayment: PaymentConfig = {
  enabled: [],
  recharge_min: 10,
  credits_rate: 1,
  epay: { url: '', pid: '', key: '' },
  alipay: { app_id: '', private_key: '', alipay_public_key: '' },
  wechat: { mchid: '', appid: '', api_v3_key: '', serial_no: '', private_key: '' },
}

const textareaCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100'

export default function Settings() {
  const [site, setSite] = useState<SiteConfig>(defaultSite)
  const [payment, setPayment] = useState<PaymentConfig>(defaultPayment)
  const [siteMsg, setSiteMsg] = useState('')
  const [payMsg, setPayMsg] = useState('')
  const [savingSite, setSavingSite] = useState(false)
  const [savingPay, setSavingPay] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('key, value').in('key', ['site', 'payment']).then(({ data }) => {
      for (const row of (data ?? []) as { key: string; value: Record<string, unknown> }[]) {
        if (row.key === 'site') setSite({ ...defaultSite, ...(row.value as unknown as SiteConfig) })
        if (row.key === 'payment') {
          const v = row.value as Partial<PaymentConfig> & Record<string, unknown>
          setPayment({
            enabled: Array.isArray(v.enabled) ? v.enabled : [],
            recharge_min: Number(v.recharge_min ?? 10),
            credits_rate: Number(v.credits_rate ?? 1),
            epay: { ...defaultPayment.epay, ...(v.epay ?? {}) },
            alipay: { ...defaultPayment.alipay, ...(v.alipay ?? {}) },
            wechat: { ...defaultPayment.wechat, ...(v.wechat ?? {}) },
          })
        }
      }
    })
  }, [])

  async function save(key: 'site' | 'payment') {
    const value = key === 'site' ? site : payment
    if (key === 'site') setSavingSite(true)
    else setSavingPay(true)
    const { error } = await supabase.from('settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    })
    if (key === 'site') {
      setSavingSite(false)
      setSiteMsg(error ? `保存失败：${error.message}` : '已保存 ✓')
    } else {
      setSavingPay(false)
      setPayMsg(error ? `保存失败：${error.message}` : '已保存 ✓')
    }
    setTimeout(() => {
      setSiteMsg('')
      setPayMsg('')
    }, 2500)
  }

  function toggleEnabled(name: string, checked: boolean) {
    setPayment((p) => ({
      ...p,
      enabled: checked ? [...new Set([...p.enabled, name])] : p.enabled.filter((x) => x !== name),
    }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-800">系统设置</h1>
        <p className="mt-0.5 text-xs text-slate-400">站点信息与支付配置</p>
      </div>

      <Card title="站点设置">
        <div className="space-y-4">
          <Field label="站点名称">
            <Input value={site.name} onChange={(e) => setSite({ ...site, name: e.target.value })} />
          </Field>
          <Field
            label="前端站点地址（site_url）"
            hint="部署后的完整地址，如 https://yourname.github.io/aiapi 或你的自定义域名（不带末尾斜杠）。用于支付完成后的跳转"
          >
            <Input placeholder="https://yourname.github.io/aiapi" value={site.site_url} onChange={(e) => setSite({ ...site, site_url: e.target.value })} />
          </Field>
          <Field
            label="API 接入地址（api_base）"
            hint="https://<项目ref>.supabase.co/functions/v1/api/v1 — 已配置，展示在用户「概览」页"
          >
            <Input placeholder="https://xxxx.supabase.co/functions/v1/api/v1" value={site.api_base} onChange={(e) => setSite({ ...site, api_base: e.target.value })} />
          </Field>
          <div className="flex items-center gap-3">
            <Button onClick={() => void save('site')} disabled={savingSite}>{savingSite ? '保存中…' : '保存'}</Button>
            {siteMsg && <span className={`text-xs ${siteMsg.includes('失败') ? 'text-red-500' : 'text-emerald-600'}`}>{siteMsg}</span>}
          </div>
        </div>
      </Card>

      <Card title="支付设置">
        <div className="space-y-6">
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500">
            支持三种通道，可同时启用。用户选支付宝时优先走「支付宝官方」，选微信时优先走「微信官方」；官方通道未配置密钥时自动回退易支付。
            <strong>资金安全排序：官方直连（资金直达你的账户）＞易支付聚合（资金经平台）</strong>，大流量务必用官方通道。
          </p>

          {/* 通用 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="最低充值金额（元）">
              <Input type="number" min={1} value={payment.recharge_min} onChange={(e) => setPayment({ ...payment, recharge_min: Number(e.target.value) })} />
            </Field>
            <Field label="额度兑换比例" hint="1 元 = 多少额度，通常为 1">
              <Input type="number" step="0.01" value={payment.credits_rate} onChange={(e) => setPayment({ ...payment, credits_rate: Number(e.target.value) })} />
            </Field>
          </div>

          {/* 支付宝官方 */}
          <div className="rounded-xl border border-slate-200 p-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-600"
                checked={payment.enabled.includes('alipay')}
                onChange={(e) => toggleEnabled('alipay', e.target.checked)}
              />
              <span className="text-sm font-semibold text-slate-700">支付宝官方「当面付」扫码</span>
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 ring-1 ring-blue-200">推荐 · 资金直达</span>
            </label>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="应用 AppID">
                  <Input placeholder="open.alipay.com 创建应用获得" value={payment.alipay.app_id} onChange={(e) => setPayment({ ...payment, alipay: { ...payment.alipay, app_id: e.target.value } })} />
                </Field>
                <Field label="签约产品" hint="需在支付宝开放平台签约「当面付」（需营业执照）">
                  <Input value="当面付 alipay.trade.precreate" disabled />
                </Field>
              </div>
              <Field label="应用私钥（PKCS8）" hint="开放平台密钥工具生成，-----BEGIN PRIVATE KEY----- 格式或裸 base64 均可">
                <textarea rows={3} className={textareaCls} value={payment.alipay.private_key} onChange={(e) => setPayment({ ...payment, alipay: { ...payment.alipay, private_key: e.target.value } })} />
              </Field>
              <Field label="支付宝公钥" hint="注意是「支付宝公钥」不是应用公钥，在开放平台密钥配置页查看">
                <textarea rows={3} className={textareaCls} value={payment.alipay.alipay_public_key} onChange={(e) => setPayment({ ...payment, alipay: { ...payment.alipay, alipay_public_key: e.target.value } })} />
              </Field>
            </div>
          </div>

          {/* 微信官方 */}
          <div className="rounded-xl border border-slate-200 p-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-600"
                checked={payment.enabled.includes('wechat')}
                onChange={(e) => toggleEnabled('wechat', e.target.checked)}
              />
              <span className="text-sm font-semibold text-slate-700">微信支付官方「Native 扫码」</span>
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 ring-1 ring-emerald-200">推荐 · 资金直达</span>
            </label>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="商户号 mchid">
                  <Input placeholder="pay.weixin.qq.com 获得" value={payment.wechat.mchid} onChange={(e) => setPayment({ ...payment, wechat: { ...payment.wechat, mchid: e.target.value } })} />
                </Field>
                <Field label="AppID（公众号/小程序/应用）">
                  <Input placeholder="wx开头的appid" value={payment.wechat.appid} onChange={(e) => setPayment({ ...payment, wechat: { ...payment.wechat, appid: e.target.value } })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="APIv3 密钥（32位）">
                  <Input type="password" placeholder="商户平台设置 APIv3 密钥" value={payment.wechat.api_v3_key} onChange={(e) => setPayment({ ...payment, wechat: { ...payment.wechat, api_v3_key: e.target.value } })} />
                </Field>
                <Field label="商户证书序列号">
                  <Input placeholder="上传商户证书后获得" value={payment.wechat.serial_no} onChange={(e) => setPayment({ ...payment, wechat: { ...payment.wechat, serial_no: e.target.value } })} />
                </Field>
              </div>
              <Field label="商户私钥（apiclient_key.pem 内容）" hint="-----BEGIN PRIVATE KEY----- 格式或裸 base64 均可">
                <textarea rows={3} className={textareaCls} value={payment.wechat.private_key} onChange={(e) => setPayment({ ...payment, wechat: { ...payment.wechat, private_key: e.target.value } })} />
              </Field>
            </div>
          </div>

          {/* 易支付 */}
          <div className="rounded-xl border border-slate-200 p-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-600"
                checked={payment.enabled.includes('epay')}
                onChange={(e) => toggleEnabled('epay', e.target.checked)}
              />
              <span className="text-sm font-semibold text-slate-700">易支付（聚合，备用）</span>
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-amber-200">资金经平台 · 小额备用</span>
            </label>
            <div className="mt-3 space-y-3">
              <Field label="易支付网关地址" hint="如 https://pay.example.com（submit.php 所在域名）">
                <Input placeholder="https://pay.example.com" value={payment.epay.url} onChange={(e) => setPayment({ ...payment, epay: { ...payment.epay, url: e.target.value } })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="商户 ID（pid）">
                  <Input value={payment.epay.pid} onChange={(e) => setPayment({ ...payment, epay: { ...payment.epay, pid: e.target.value } })} />
                </Field>
                <Field label="商户密钥（key）">
                  <Input type="password" value={payment.epay.key} onChange={(e) => setPayment({ ...payment, epay: { ...payment.epay, key: e.target.value } })} />
                </Field>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => void save('payment')} disabled={savingPay}>{savingPay ? '保存中…' : '保存支付配置'}</Button>
            {payMsg && <span className={`text-xs ${payMsg.includes('失败') ? 'text-red-500' : 'text-emerald-600'}`}>{payMsg}</span>}
          </div>
        </div>
      </Card>
    </div>
  )
}
