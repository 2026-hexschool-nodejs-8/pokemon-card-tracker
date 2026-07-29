import { useEffect } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import CardListPage from './pages/CardListPage.jsx';
import CardDetailPage from './pages/CardDetailPage.jsx';
import LoginPage from './pages/admin/LoginPage.jsx';
import AdminPage from './pages/admin/AdminPage.jsx';
import AdminOverviewPage from './pages/admin/AdminOverviewPage.jsx';
import { isLoggedIn } from './lib/auth.js';
import { setNavigate } from './lib/api.js';

export default function App() {
  // 每次點擊導覽連結（含同路徑）location.key 都會更新，
  // 用它當 key 讓 CardListPage 重新掛載，清空搜尋狀態回到初始畫面
  const location = useLocation();
  // 登入 / 登出都會 navigate → location 變動 → 這裡重算，據此顯示僅管理者可見的導覽鍵
  const loggedIn = isLoggedIn();

  // 把 navigate 交給 lib/api.js，讓它收到 401 時能導向登入頁（見 api.js 的 request()）
  const navigate = useNavigate();
  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <Link to="/" className="font-bold">
            🃏 寶可夢卡牌價格追蹤器
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/" className="hover:underline">
              卡牌列表
            </Link>
            <Link to="/admin" className="hover:underline">
              後台管理
            </Link>
            {loggedIn && (
              <Link to="/admin/overview" className="hover:underline">
                卡片總覽
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="container py-8">
        <Routes>
          <Route path="/" element={<CardListPage key={location.key} />} />
          <Route path="/cards/:id" element={<CardDetailPage />} />
          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/overview" element={<AdminOverviewPage />} />
        </Routes>
      </main>
    </div>
  );
}
