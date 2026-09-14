import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

function SetupNotice() {
  return (
    <div style={{ maxWidth: 640, margin: '80px auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#334155' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>还没配置 Supabase 环境变量</h1>
      <ol style={{ lineHeight: 2, fontSize: 14, paddingLeft: 20 }}>
        <li>创建 Supabase 项目（supabase.com，免费版即可）</li>
        <li>在 Settings → API 中复制 Project URL 和 anon key</li>
        <li>
          本地开发：复制 <code>web/.env.example</code> 为 <code>web/.env.local</code> 并填写
        </li>
        <li>
          GitHub 部署：在仓库 Settings → Secrets and variables → Actions → Variables 添加
          <code> VITE_SUPABASE_URL</code> 和 <code>VITE_SUPABASE_ANON_KEY</code>
        </li>
        <li>数据库初始化和 Edge Functions 部署见项目根目录 README.md</li>
      </ol>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {!url || !key ? <SetupNotice /> : <App />}
  </React.StrictMode>,
)
