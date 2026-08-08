// 展開後的來源明細：延遲載入狀態 + 來源層前端篩選（類型 / 使用狀態）+ 使用開關。
// 卡片追蹤關閉時，明確標示「來源不會被抓取」（FR-008）。
import { useState } from 'react';
import { SOURCE_TYPE } from '@pct/shared';
import { Button } from '@/components/ui/button';

const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW') : '—');

export default function SourceList({ entry, cardActive, onRetry, onToggleSource, busySources }) {
  // 來源層篩選（僅作用於已載入清單，不重新抓取，FR-010）
  const [typeFilter, setTypeFilter] = useState('all'); // all | api | crawler
  const [usageFilter, setUsageFilter] = useState('all'); // all | active | inactive

  // 尚未載入或載入中
  if (!entry || entry.loading) {
    return <p className="py-2 text-sm text-muted-foreground">載入來源中…</p>;
  }

  // 載入失敗，可重試（FR-013）
  if (entry.error) {
    return (
      <div className="flex items-center gap-3 py-2 text-sm">
        <span className="text-destructive">來源載入失敗：{entry.error}</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          重試
        </Button>
      </div>
    );
  }

  const sources = entry.data || [];

  // 空來源空狀態（Acceptance US1-5）
  if (sources.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">尚無來源</p>;
  }

  const filtered = sources.filter((s) => {
    if (typeFilter !== 'all' && s.type !== typeFilter) return false;
    if (usageFilter === 'active' && !s.isActive) return false;
    if (usageFilter === 'inactive' && s.isActive) return false;
    return true;
  });

  return (
    <div className="space-y-3 rounded-md bg-muted/30 p-3">
      {/* 卡片追蹤已關閉的提醒（兩層語意，FR-008） */}
      {!cardActive && (
        <p className="rounded bg-amber-100 px-3 py-2 text-xs text-amber-800">
          此卡片追蹤已關閉，來源不會被抓取
        </p>
      )}

      {/* 來源層篩選 */}
      <div className="flex flex-wrap gap-2 text-sm">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">類型：全部</option>
          <option value={SOURCE_TYPE.API}>api</option>
          <option value={SOURCE_TYPE.CRAWLER}>crawler</option>
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={usageFilter}
          onChange={(e) => setUsageFilter(e.target.value)}
        >
          <option value="all">使用狀態：全部</option>
          <option value="active">僅使用中</option>
          <option value="inactive">僅停用</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">沒有符合條件的來源</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <div className="space-y-0.5">
                <div className="font-medium">
                  <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs">{s.type}</span>
                  {s.provider}
                  <span className="ml-2 text-xs text-muted-foreground">{s.currency}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  最後成功：{fmtTime(s.lastSuccessAt)}
                  {s.lastError ? `　最後錯誤：${s.lastError}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={
                    s.isActive
                      ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700'
                      : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700'
                  }
                >
                  {s.isActive ? '使用中' : '停用'}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={s.isActive ? 'outline' : 'default'}
                  disabled={busySources?.has(s.id)}
                  onClick={() => onToggleSource(s)}
                >
                  {s.isActive ? '停用' : '啟用'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
