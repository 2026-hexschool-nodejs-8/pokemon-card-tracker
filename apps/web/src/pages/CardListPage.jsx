import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCards } from "@/lib/api";

const fmtPrice = (p, c) =>
  p == null ? "尚未更新" : `${c ?? ""} ${p.toLocaleString()}`;
const fmtTime = (t) => (t ? new Date(t).toLocaleString("zh-TW") : "—");

function getBadge(c) {
  if (c.latestPrice != null && c.latestPrice >= 5000) return "💰 高價";
  if (c.setName?.toLowerCase().includes("sv")) return "⭐ 稀有";
  return null;
}

function SkeletonCard() {
  return (
    <div
      className="break-inside-avoid mb-6 rounded-2xl overflow-hidden bg-white"
      style={{ boxShadow: "0 4px 12px rgba(59,76,202,0.08)" }}
    >
      <div className="h-44 bg-[#EEF1FF] animate-pulse" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
        <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2" />
        <div className="h-5 bg-blue-100 rounded animate-pulse w-1/3 mt-3" />
      </div>
    </div>
  );
}

export default function CardListPage() {
  const [keyword, setKeyword] = useState("");
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(kw = "") {
    setLoading(true);
    setError("");
    try {
      const { data } = await getCards({ keyword: kw });
      setCards(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      {/* 搜尋框 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(keyword);
        }}
        className="flex gap-3 mb-8 bg-white rounded-2xl p-4"
        style={{ boxShadow: "0 4px 20px rgba(59,76,202,0.12)" }}
      >
        <input
          type="text"
          placeholder="搜尋卡名或卡號…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:border-[#3B4CCA] focus:ring-2 focus:ring-[#3B4CCA]/20 transition-all"
          style={{ fontFamily: 'Noto Sans TC, sans-serif' }}
        />
        <button
          type="submit"
          className="px-6 py-2 rounded-xl text-sm font-bold text-white transition-colors"
          style={{
            background: '#3B4CCA',
            fontFamily: 'Nunito, sans-serif',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#2a38b0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#3B4CCA')}
        >
          搜尋
        </button>
      </form>

      {/* 錯誤訊息 */}
      {error && (
        <p className="text-red-600 text-sm mb-4 px-1">{error}</p>
      )}

      {/* 載入骨架 */}
      {loading && (
        <div className="card-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* 空態 */}
      {!loading && !error && cards.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-gray-400">
          <span className="text-6xl">⚡</span>
          <p className="text-base" style={{ fontFamily: 'Nunito, sans-serif' }}>
            找不到符合的卡牌
          </p>
        </div>
      )}

      {/* Masonry 卡牌格線 */}
      {!loading && cards.length > 0 && (
        <div className="card-grid">
          {cards.map((c, index) => {
            const badge = getBadge(c);
            const tcgplayerId = /^\d+$/.test(c.cardNumber) ? c.cardNumber : null;
            return (
              <Link
                key={c.id}
                to={`/cards/${c.id}`}
                className="break-inside-avoid mb-6 block group"
              >
                <div
                  className="bg-white rounded-2xl overflow-hidden relative transition-all duration-300
                    group-hover:-translate-y-1.5"
                  style={{
                    boxShadow: "0 4px 12px rgba(59,76,202,0.1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = "0 12px 28px rgba(59,76,202,0.22)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(59,76,202,0.1)";
                  }}
                >
                  {/* 標籤 */}
                  {badge && (
                    <span
                      className="absolute top-2 left-2 z-10 text-xs font-extrabold px-2 py-0.5 rounded-full"
                      style={{
                        background: '#FFCB05',
                        color: '#1A1A2E',
                        fontFamily: 'Nunito, sans-serif',
                        boxShadow: "0 2px 6px rgba(255,203,5,0.4)",
                      }}
                    >
                      {badge}
                    </span>
                  )}

                  {/* 卡牌圖片 */}
                  {c.imageUrl ? (
                    <img
                      src={c.imageUrl}
                      alt={c.name}
                      loading="lazy"
                      className="w-full object-contain bg-[#EEF1FF]"
                    />
                  ) : (
                    <div className="h-44 w-full bg-[#EEF1FF] flex items-center justify-center">
                      <span className="text-3xl opacity-30">🃏</span>
                    </div>
                  )}

                  {/* 卡片資訊 */}
                  <div className="p-4">
                    <h3
                      className="font-bold text-[#1A1A2E] text-base leading-tight"
                      style={{ fontFamily: 'Nunito, sans-serif' }}
                    >
                      {c.name}
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {c.cardNumber}　{c.setName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {c.language} / {c.condition}
                    </p>
                    <p
                      className="text-lg font-extrabold mt-2"
                      style={{ color: '#3B4CCA', fontFamily: 'Nunito, sans-serif' }}
                    >
                      {fmtPrice(c.latestPrice, c.latestCurrency)}
                    </p>
                    <p className="text-[10px] text-gray-300 mt-1">
                      更新：{fmtTime(c.lastFetchedAt)}
                    </p>
                    {tcgplayerId && (
                      <a
                        href={`https://www.tcgplayer.com/product/${tcgplayerId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-block mt-2 text-[11px] font-semibold hover:underline"
                        style={{ color: '#CC0000' }}
                      >
                        TCGPlayer 查看 ↗
                      </a>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
