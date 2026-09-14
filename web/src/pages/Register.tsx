import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, ErrorText, Field, Input } from '../components/ui'

export default function Register() {
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [needConfirm, setNeedConfirm] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || undefined } },
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    if (data.session) {
      navigate('/', { replace: true })
    } else {
      setNeedConfirm(true)
    }
  }

  if (needConfirm) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mb-2 text-3xl">📧</div>
          <h2 className="text-sm font-semibold text-slate-700">确认邮件已发送</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            请前往 <span className="font-medium text-slate-600">{email}</span> 查收确认邮件，点击链接后即可登录。
            <br />
            （团队内部使用可在 Supabase 后台 Authentication → Providers 关闭邮箱确认）
          </p>
          <Link to="/login" className="mt-4 inline-block text-xs text-indigo-600 hover:underline">
            返回登录
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <svg width="40" height="40" viewBox="0 0 24 24"><path fill="#6366f1" d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" /></svg>
          <h1 className="mt-2 text-xl font-bold text-slate-800">注册账号</h1>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Field label="昵称（可选）">
            <Input placeholder="你的名字" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="邮箱">
            <Input
              type="email"
              required
              autoComplete="email"
              placeholder="you@team.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="密码" hint="至少 6 位">
            <Input
              type="password"
              required
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? '注册中…' : '注 册'}
          </Button>
          <p className="text-center text-xs text-slate-400">
            已有账号？
            <Link to="/login" className="ml-1 text-indigo-600 hover:underline">
              登录
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
