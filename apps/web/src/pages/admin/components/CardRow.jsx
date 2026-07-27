// 卡片摘要列：夾在 AccordionItem 內，左側為可展開的 Trigger（摘要），右側為「追蹤」開關。
// 開關刻意放在 Trigger 之外（避免 button 巢狀且點開關不會展開 Accordion）。
// 對齊策略：操作區固定寬度 + 摘要用固定比例 grid + 每欄 min-w-0/truncate，
// 讓每一列的欄位、箭頭都對齊（trigger 寬度固定 → 各欄寬度一致）。
import { AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';

const fmtPrice = (p, c) => (p == null ? '—' : `${c ?? ''} ${p.toLocaleString()}`);
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW') : '—');

export default function CardRow({ card, onToggleTrack, toggleBusy }) {
  return (
    <div className="flex items-center justify-between">
      <AccordionTrigger className="min-w-0 flex-1 py-3 hover:no-underline justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-x-4 pr-3 text-left">
          {/* 卡名 / 卡號 / 系列 */}
          <div className="w-60">
            <div className="truncate font-medium">{card.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {card.cardNumber}
              {card.setName ? `　${card.setName}` : ''}
            </div>
          </div>
          {/* 語言 / 狀態別 */}
          <div className="w-32 text-sm">
            <div className="text-xs text-muted-foreground">語言 / 狀態別</div>
            <div className="truncate">
              {card.language} / {card.condition}
            </div>
          </div>
          {/* 最新價 */}
          <div className="w-32 text-sm">
            <div className="text-xs text-muted-foreground">最新價</div>
            <div className="truncate font-semibold">{fmtPrice(card.latestPrice, card.latestCurrency)}</div>
          </div>
          {/* 來源數 / 最後更新 */}
          <div className="w-60 text-sm text-muted-foreground">
            <div className="text-xs">來源數 / 最後更新</div>
            <div className="truncate">
              {card._count?.sources ?? 0} 個　{fmtTime(card.lastFetchedAt)}
            </div>
          </div>
        </div>
      </AccordionTrigger>

      {/* 追蹤開關（固定寬度，Trigger 外，點擊不展開） */}
      <div
        className="flex w-44 shrink-0 items-center justify-end gap-2 pl-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={
            'w-14 shrink-0 rounded-full px-2 py-0.5 text-center text-xs ' +
            (card.isActive ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground')
          }
        >
          {card.isActive ? '追蹤中' : '停用'}
        </span>
        <Button
          type="button"
          size="sm"
          variant={card.isActive ? 'outline' : 'default'}
          disabled={toggleBusy}
          onClick={onToggleTrack}
          className="w-24 shrink-0"
        >
          {card.isActive ? '關閉追蹤' : '開啟追蹤'}
        </Button>
      </div>
    </div>
  );
}
