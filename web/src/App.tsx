import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Spinner } from './components/ui'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Overview from './pages/Overview'
import Keys from './pages/Keys'
import Usage from './pages/Usage'
import Recharge from './pages/Recharge'
import Channels from './pages/admin/Channels'
import Users from './pages/admin/Users'
import Pricing from './pages/admin/Pricing'
import Orders from './pages/admin/Orders'
import Settings from './pages/admin/Settings'

function RequireAuth() {
  const { session, booting } = useAuth()
  if (booting) return <Spinner text="正在进入控制台…" />
  if (!session) return <Navigate to="/login" replace />
  return <Outlet />
}

function RequireAdmin() {
  const { profile, booting } = useAuth()
  if (booting) return <Spinner text="加载中…" />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Overview />} />
              <Route path="/keys" element={<Keys />} />
              <Route path="/usage" element={<Usage />} />
              <Route path="/recharge" element={<Recharge />} />
              <Route element={<RequireAdmin />}>
                <Route path="/admin/channels" element={<Channels />} />
                <Route path="/admin/users" element={<Users />} />
                <Route path="/admin/pricing" element={<Pricing />} />
                <Route path="/admin/orders" element={<Orders />} />
                <Route path="/admin/settings" element={<Settings />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
