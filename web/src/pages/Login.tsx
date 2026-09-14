import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, ErrorText, Field, Input } from '../components/ui'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message === 'Invalid login credentials' ? '邮箱或密码错误' : error.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex h-full items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <svg width="40" height="40" viewBox="0 0 24 24"><path fill="#6366f1" d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" /></svg>
          <h1 className="mt-2 text-xl font-bold text-slate-800">AI API 网关</h1>
          <p className="mt-1 text-xs text-slate-400">团队专用 · 稳定可靠的大模型接入平台</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
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
          <Field label="密码">
            <Input
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? '登录中…' : '登 录'}
          </Button>
          <p className="text-center text-xs text-slate-400">
            还没有账号？
            <Link to="/register" className="ml-1 text-indigo-600 hover:underline">
              注册
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
