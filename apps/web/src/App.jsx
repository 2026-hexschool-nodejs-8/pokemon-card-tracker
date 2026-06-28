import { Routes, Route, Link } from 'react-router-dom';
import CardListPage from './pages/CardListPage.jsx';
import CardDetailPage from './pages/CardDetailPage.jsx';
import LoginPage from './pages/admin/LoginPage.jsx';
import AdminPage from './pages/admin/AdminPage.jsx';

export default function App() {
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
          </nav>
        </div>
      </header>

      <main className="container py-8">
        <Routes>
          <Route path="/" element={<CardListPage />} />
          <Route path="/cards/:id" element={<CardDetailPage />} />
          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}
