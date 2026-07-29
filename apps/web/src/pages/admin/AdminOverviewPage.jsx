// 後台卡片與來源管理總覽頁：Accordion + 無限滾動檢視卡片與其來源（延遲載入），
// 同頁切換「卡片追蹤」與「來源使用」兩層開關（樂觀更新 + 失敗還原），
// 關閉最後一個啟用來源走確認 modal 與交易連動，並支援卡片層 / 來源層篩選。
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isLoggedIn, clearToken } from '@/lib/auth';
import {
  adminGetCards,
  adminGetCardSources,
  adminToggleCard,
  adminToggleSource,
  adminDeactivateLastSource,
} from '@/lib/api';
import { Accordion, AccordionItem, AccordionContent } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import CardRow from './components/CardRow.jsx';
import SourceList from './components/SourceList.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';

const emptyFilters = { keyword: '', language: '', grade: '', isActive: '' };

// 共用的 busy Set 切換（卡片層與來源層各持有一份 state）
function markBusy(setBusy, id, busy) {
  setBusy((prev) => {
    const next = new Set(prev);
    if (busy) next.add(id);
    else next.delete(id);
    return next;
  });
}

export default function AdminOverviewPage() {
  const navigate = useNavigate();

  // 篩選：keyword / grade 為文字（debounce），language / isActive 為 select（即時）
  const [filters, setFilters] = useState(emptyFilters);
  const [textDraft, setTextDraft] = useState({ keyword: '', grade: '' });

  const [cards, setCards] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true); // 第一批
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  // 來源延遲載入快取：{ [cardId]: { loading, error, data } }
  const [sourcesByCard, setSourcesByCard] = useState({});
  const [openItems, setOpenItems] = useState([]);

  // 確認 modal（關閉最後一個啟用來源）
  const [confirm, setConfirm] = useState(null); // { card, source } | null
  const [confirmBusy, setConfirmBusy] = useState(false);

  // 進行中的切換（請求飛行期間鎖住按鈕，避免重複點擊）
  const [busyCards, setBusyCards] = useState(() => new Set());
  const [busySources, setBusySources] = useState(() => new Set());

  const reqSeq = useRef(0); // 卡片清單載入序號（stale-response guard）
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef(null);
  const loadMoreRef = useRef(() => {});

  // 未登入 / token 過期導向登入頁（FR-001）
  useEffect(() => {
    if (!isLoggedIn()) navigate('/admin/login');
  }, [navigate]);

  function logout() {
    clearToken();
    navigate('/admin/login');
  }

  // 文字篩選 debounce 300ms 後套用（避免每個按鍵都打 API）
  // 值沒變就回傳同一個物件讓 React bail out，否則新物件會讓 [filters] 誤判為改變而重打 API
  //（掛載時、以及打完字又刪回原值時都會遇到）
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) =>
        f.keyword === textDraft.keyword && f.grade === textDraft.grade
          ? f
          : { ...f, keyword: textDraft.keyword, grade: textDraft.grade },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [textDraft]);

  // 載入第一批（filters 變更即自第一批重載，FR-011）
  useEffect(() => {
    const myId = ++reqSeq.current;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const { data, nextCursor: nc } = await adminGetCards({
          keyword: filters.keyword || undefined,
          language: filters.language || undefined,
          grade: filters.grade || undefined,
          isActive: filters.isActive || undefined,
        });
        if (myId !== reqSeq.current) return; // 過期批次丟棄
        setCards(data);
        setNextCursor(nc);
        setOpenItems([]);
        setSourcesByCard({});
      } catch (e) {
        if (myId !== reqSeq.current) return;
        setError(e.message);
        setCards([]);
        setNextCursor(null);
      } finally {
        if (myId === reqSeq.current) setLoading(false);
      }
    })();
  }, [filters]);

  // 載入下一批（無限滾動）：把最新的 loader 存進 loadMoreRef 供 observer 呼叫。
  // 定義並隨 filters / nextCursor 更新即可。
  useEffect(() => {
    loadMoreRef.current = async () => {
      if (loadingMoreRef.current) return; // 同步防重入鎖：state 更新非同步，擋不住同一 tick 的重複觸發
      if (!nextCursor) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      const myId = reqSeq.current; // 條件未變才接續
      try {
        const { data, nextCursor: nc } = await adminGetCards({
          cursor: nextCursor,
          keyword: filters.keyword || undefined,
          language: filters.language || undefined,
          grade: filters.grade || undefined,
          isActive: filters.isActive || undefined,
        });
        if (myId !== reqSeq.current) return; // 條件已變，丟棄
        // 以 id 去重：排序鍵 updatedAt 會被本頁的開關操作改寫（Prisma @updatedAt），
        // 被改的卡會跳到排序最前，後續批次因而可能重送已載入的卡片。
        // 重複的 id 會讓 AccordionItem value 撞號（展開一列連動另一列、來源快取對不上）
        setCards((prev) => {
          const seen = new Set(prev.map((c) => c.id));
          return [...prev, ...data.filter((c) => !seen.has(c.id))];
        });
        setNextCursor(nc);
      } catch (e) {
        if (myId === reqSeq.current) setError(e.message);
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    };
  }, [filters, nextCursor]);

  // IntersectionObserver 監看底部 sentinel；清單變動時重觀察以接續填滿短內容
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { rootMargin: '200px' },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [cards.length, nextCursor]);

  // 延遲載入某卡來源（首次展開才抓；已載入不重抓，FR-004）
  async function fetchSources(cardId) {
    setSourcesByCard((prev) => ({ ...prev, [cardId]: { loading: true, error: '', data: null } }));
    try {
      const { data } = await adminGetCardSources(cardId);
      setSourcesByCard((prev) => ({ ...prev, [cardId]: { loading: false, error: '', data } }));
    } catch (e) {
      setSourcesByCard((prev) => ({
        ...prev,
        [cardId]: { loading: false, error: e.message, data: null },
      }));
    }
  }

  function handleOpenChange(values) {
    setOpenItems(values);
    values.forEach((cardId) => {
      if (!sourcesByCard[cardId]) fetchSources(cardId);
    });
  }

  // ── 卡片「追蹤」開關：樂觀更新 + 失敗還原（FR-006/FR-012）──
  async function handleToggleCard(card) {
    const target = !card.isActive;
    markBusy(setBusyCards, card.id, true);
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, isActive: target } : c)));
    try {
      await adminToggleCard(card.id, target);
    } catch (e) {
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, isActive: card.isActive } : c)), // 還原
      );
      setError(`更新追蹤狀態失敗：${e.message}`);
    } finally {
      markBusy(setBusyCards, card.id, false);
    }
  }

  // 樂觀更新某卡某來源的 isActive
  function setSourceActive(cardId, sourceId, isActive) {
    setSourcesByCard((prev) => {
      const entry = prev[cardId];
      if (!entry?.data) return prev;
      return {
        ...prev,
        [cardId]: {
          ...entry,
          data: entry.data.map((s) => (s.id === sourceId ? { ...s, isActive } : s)),
        },
      };
    });
  }

  // ── 來源「使用」開關（FR-007/FR-008/FR-015/FR-016/FR-017）──
  async function handleToggleSource(card, source) {
    const entry = sourcesByCard[card.id];
    const list = entry?.data || [];
    const activeCount = list.filter((s) => s.isActive).length;

    // 關閉「最後一個啟用來源」→ 先確認 modal，走交易連動端點
    if (source.isActive && activeCount === 1) {
      setConfirm({ card, source });
      return;
    }

    // 一般切換（含來源重新啟用）：不動卡片
    const target = !source.isActive;
    markBusy(setBusySources, source.id, true);
    setSourceActive(card.id, source.id, target);
    try {
      await adminToggleSource(source.id, target);
    } catch (e) {
      setSourceActive(card.id, source.id, source.isActive); // 還原
      setError(`更新來源狀態失敗：${e.message}`);
    } finally {
      markBusy(setBusySources, source.id, false);
    }
  }

  // 確認關閉最後啟用來源：交易連動同時停用來源與卡片（FR-016）
  async function handleConfirmDeactivate() {
    if (!confirm) return;
    const { card, source } = confirm;
    setConfirmBusy(true);
    // 樂觀：來源與卡片一起停用
    setSourceActive(card.id, source.id, false);
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, isActive: false } : c)));
    try {
      await adminDeactivateLastSource(source.id);
      setConfirm(null);
    } catch (e) {
      // 還原來源與卡片；併發（409）時重抓來源清單反映真實狀態（FR-012）
      setSourceActive(card.id, source.id, true);
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, isActive: card.isActive } : c)),
      );
      setError(`關閉最後來源失敗：${e.message}`);
      fetchSources(card.id);
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">卡片總覽</h1>
        <Button variant="outline" size="sm" onClick={logout}>
          登出
        </Button>
      </div>

      {/* 篩選列（卡片層） */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="搜尋卡名或卡號…"
          value={textDraft.keyword}
          onChange={(e) => setTextDraft((d) => ({ ...d, keyword: e.target.value }))}
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={filters.language}
          onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value }))}
        >
          <option value="">語言：全部</option>
          <option value="ja">ja</option>
          <option value="en">en</option>
          <option value="zh">zh</option>
        </select>
        {/* 狀態別 grade 對應 DB condition 欄位（I1） */}
        <Input
          placeholder="狀態別（如 raw / PSA10）"
          value={textDraft.grade}
          onChange={(e) => setTextDraft((d) => ({ ...d, grade: e.target.value }))}
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={filters.isActive}
          onChange={(e) => setFilters((f) => ({ ...f, isActive: e.target.value }))}
        >
          <option value="">追蹤狀態：全部</option>
          <option value="true">僅追蹤中</option>
          <option value="false">僅停用</option>
        </select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground">載入中…</p>
      ) : cards.length === 0 ? (
        <p className="text-muted-foreground">查無符合條件的卡片</p>
      ) : (
        <Accordion type="multiple" value={openItems} onValueChange={handleOpenChange}>
          {cards.map((card) => (
            <AccordionItem key={card.id} value={card.id}>
              <CardRow
                card={card}
                onToggleTrack={() => handleToggleCard(card)}
                toggleBusy={busyCards.has(card.id)}
              />
              <AccordionContent>
                <SourceList
                  entry={sourcesByCard[card.id]}
                  cardActive={card.isActive}
                  busySources={busySources}
                  onRetry={() => fetchSources(card.id)}
                  onToggleSource={(source) => handleToggleSource(card, source)}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {/* 無限滾動 sentinel + 狀態提示 */}
      <div ref={sentinelRef} />
      {!loading && cards.length > 0 && (
        <p className="py-2 text-center text-xs text-muted-foreground">
          {loadingMore ? '載入更多中…' : nextCursor === null ? '已到底' : ''}
        </p>
      )}

      <ConfirmModal
        open={!!confirm}
        title="關閉最後一個啟用來源"
        message="關閉後這張卡片將沒有任何啟用中來源、價格不再更新。確定要關閉嗎？"
        confirmText="確認關閉"
        busy={confirmBusy}
        onConfirm={handleConfirmDeactivate}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
