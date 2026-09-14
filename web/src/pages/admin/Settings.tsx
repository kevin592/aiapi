import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Card, ErrorText, Field, Input } from '../../components/ui'

interface SiteConfig {
  name: string
  site_url: string
  api_base: string
}

interface PaymentConfig {
  epay_url: string
  epay_pid: string
  epay_key: string
  recharge_min: number
  credits_rate: number
}

const defaultSite: SiteConfig = { name: 'Team AI Gateway', site_url: '', api_base: '' }
const defaultPayment: PaymentConfig = { epay_url: '', epay_pid: '', epay_key: '', recharge_min: 10, credits_rate: 1 }

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
        if (row.key === 'payment') setPayment({ ...defaultPayment, ...(row.value as unknown as PaymentConfig) })
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
            hint="https://<项目ref>.supabase.co/functions/v1/api/v1 — 部署 Edge Functions 后填入，会展示在用户「概览」页"
          >
            <Input placeholder="https://xxxx.supabase.co/functions/v1/api/v1" value={site.api_base} onChange={(e) => setSite({ ...site, api_base: e.target.value })} />
          </Field>
          <div className="flex items-center gap-3">
            <Button onClick={() => void save('site')} disabled={savingSite}>{savingSite ? '保存中…' : '保存'}</Button>
            {siteMsg && <span className={`text-xs ${siteMsg.includes('失败') ? 'text-red-500' : 'text-emerald-600'}`}>{siteMsg}</span>}
          </div>
        </div>
      </Card>

      <Card title="支付设置（易支付，支持微信 / 支付宝）">
        <div className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500">
            采用易支付（Epay）协议，兼容彩虹易支付等主流聚合支付平台，个人即可申请，可同时开通微信、支付宝通道。
            不配置支付也不影响使用——管理员可在「用户管理」中手动调整余额。
            如需官方直连微信支付 / 支付宝（需营业执照），可在 supabase/functions 下扩展新函数。
          </p>
          <Field label="易支付网关地址" hint="如 https://pay.example.com（提交地址 submit.php 所在域名）">
            <Input placeholder="https://pay.example.com" value={payment.epay_url} onChange={(e) => setPayment({ ...payment, epay_url: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="商户 ID（pid）">
              <Input value={payment.epay_pid} onChange={(e) => setPayment({ ...payment, epay_pid: e.target.value })} />
            </Field>
            <Field label="商户密钥（key）">
              <Input type="password" value={payment.epay_key} onChange={(e) => setPayment({ ...payment, epay_key: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="最低充值金额（元）">
              <Input type="number" min={1} value={payment.recharge_min} onChange={(e) => setPayment({ ...payment, recharge_min: Number(e.target.value) })} />
            </Field>
            <Field label="额度兑换比例" hint="1 元 = 多少额度，通常为 1">
              <Input type="number" step="0.01" value={payment.credits_rate} onChange={(e) => setPayment({ ...payment, credits_rate: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => void save('payment')} disabled={savingPay}>{savingPay ? '保存中…' : '保存'}</Button>
            {payMsg && <span className={`text-xs ${payMsg.includes('失败') ? 'text-red-500' : 'text-emerald-600'}`}>{payMsg}</span>}
          </div>
        </div>
      </Card>
    </div>
  )
}
