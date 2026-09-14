import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fmtMoney } from '../lib/format'
import { Badge } from './ui'

const navItems = [
  { to: '/', label: '概览', icon: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10' },
  { to: '/keys', label: 'API 令牌', icon: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L19 3m-8.6 8.6L19 3' },
  { to: '/usage', label: '用量明细', icon: 'M3 3v18h18M7 14l4-4 3 3 5-6' },
  { to: '/recharge', label: '充值', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
]

const adminItems = [
  { to: '/admin/channels', label: '渠道管理', icon: 'M5 12H3l2-7h14l2 7h-2M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M5 12h14' },
  { to: '/admin/users', label: '用户管理', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { to: '/admin/pricing', label: '模型定价', icon: 'M7 7h.01M7 3h5a1.99 1.99 0 0 1 1.414.586l7 7a2 2 0 0 1 0 2.828l-7 7a2 2 0 0 1-2.828 0l-7-7A1.99 1.99 0 0 1 3 12V7a4 4 0 0 1 4-4z' },
  { to: '/admin/orders', label: '订单管理', icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2' },
  { to: '/admin/settings', label: '系统设置', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
]

function NavIcon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()

  return (
    <div className="flex h-full">
      {/* 桌面侧边栏 */}
      <aside className="hidden w-56 shrink-0 flex-col bg-slate-900 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#818cf8" d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" /></svg>
          <div>
            <div className="text-sm font-bold text-white">AI API 网关</div>
            <div className="text-[10px] text-slate-500">Team Gateway</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-indigo-600 font-medium text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              <NavIcon path={item.icon} />
              {item.label}
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <div className="px-3 pb-1 pt-5 text-[10px] font-semibold tracking-wider text-slate-600">管理后台</div>
              {adminItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive ? 'bg-indigo-600 font-medium text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`
                  }
                >
                  <NavIcon path={item.icon} />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="border-t border-slate-800 px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-slate-300">{profile?.display_name || profile?.email}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                余额 <span className="font-semibold text-emerald-400">{fmtMoney(profile?.balance ?? 0)}</span>
              </div>
            </div>
            {isAdmin && <Badge tone="indigo">管理员</Badge>}
          </div>
          <button
            onClick={() => void signOut()}
            className="mt-3 w-full rounded-lg border border-slate-700 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 移动端顶部导航 */}
        <header className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-900 px-3 py-2 md:hidden">
          {[...navItems, ...(isAdmin ? adminItems : [])].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${
                  isActive ? 'bg-indigo-600 font-medium text-white' : 'text-slate-400'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <button onClick={() => void signOut()} className="ml-auto whitespace-nowrap px-2 text-xs text-slate-400">
            退出
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
