import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isLoggedIn, clearToken } from '@/lib/auth';
import { adminCreateCard, adminAddSource, adminSyncAll, adminGetJobs, adminImportTcgplayer, adminSearchImportTcgplayer, adminClearStuckJobs } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const emptyForm = {
  name: '',
  cardNumber: '',
  setName: '',
  language: 'ja',
  condition: 'raw',
  sourceType: 'api',
  provider: 'mockApi',
  url: '',
  externalId: '',
  currency: 'JPY',
};

const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW') : '—');

export default function AdminPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [jobs, setJobs] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importPage, setImportPage] = useState(1);
  const [importLimit, setImportLimit] = useState(10);
  const [importResult, setImportResult] = useState(null);
  const [searchName, setSearchName] = useState('');
  const [searchLimit, setSearchLimit] = useState(5);
  const [searchResult, setSearchResult] = useState(null);

  useEffect(() => {
    if (!isLoggedIn()) navigate('/admin/login');
    else loadJobs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadJobs() {
    try {
      const { data } = await adminGetJobs();
      setJobs(data);
    } catch (e) {
      setError(e.message);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const { data: card } = await adminCreateCard({
        name: form.name,
        cardNumber: form.cardNumber,
        setName: form.setName || undefined,
        language: form.language,
        condition: form.condition,
      });
      await adminAddSource(card.id, {
        type: form.sourceType,
        provider: form.provider,
        url: form.url || undefined,
        externalId: form.externalId || undefined,
        currency: form.currency,
      });
      setMsg(`已新增卡牌「${card.name}」與來源`);
      setForm(emptyForm);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncAll() {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const { data: job } = await adminSyncAll();
      setMsg(`抓價完成：${job.status}（成功 ${job.successCount} / 失敗 ${job.failedCount}）`);
      loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClearStuck() {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const { data } = await adminClearStuckJobs();
      setMsg(`已清除 ${data.clearedCount} 個卡住的任務`);
      loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchName.trim()) return;
    setBusy(true);
    setError('');
    setMsg('');
    setSearchResult(null);
    try {
      const data = await adminSearchImportTcgplayer(searchName.trim(), searchLimit);
      setSearchResult(data);
      setMsg(data.message ?? `「${data.searchName}」搜尋完成：成功 ${data.imported}、略過 ${data.skipped}、失敗 ${data.failed}`);
      loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    setError('');
    setMsg('');
    setImportResult(null);
    try {
      const data = await adminImportTcgplayer(importPage, importLimit);
      setImportResult(data);
      setMsg(`匯入完成：成功 ${data.imported}、略過 ${data.skipped}、失敗 ${data.failed}`);
      loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearToken();
    navigate('/admin/login');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">後台管理</h1>
        <Button variant="outline" size="sm" onClick={logout}>
          登出
        </Button>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>新增追蹤卡牌（含一個來源）</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleCreate}>
            <Input placeholder="卡名" value={form.name} onChange={set('name')} required />
            <Input placeholder="卡號（如 208/XY-P）" value={form.cardNumber} onChange={set('cardNumber')} required />
            <Input placeholder="系列 setName" value={form.setName} onChange={set('setName')} />
            <Input placeholder="語言（ja/en/zh）" value={form.language} onChange={set('language')} />
            <Input placeholder="品相（raw/PSA10…）" value={form.condition} onChange={set('condition')} />
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={form.sourceType}
              onChange={set('sourceType')}
            >
              <option value="api">來源類型：api</option>
              <option value="crawler">來源類型：crawler</option>
            </select>
            <Input placeholder="provider（mockApi / mockCrawler）" value={form.provider} onChange={set('provider')} />
            <Input placeholder="currency（JPY/USD/TWD）" value={form.currency} onChange={set('currency')} />
            <Input placeholder="url（crawler 必填）" value={form.url} onChange={set('url')} />
            <Input placeholder="externalId（api 用）" value={form.externalId} onChange={set('externalId')} />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                新增卡牌
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>依卡名搜尋並匯入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            輸入卡牌名稱，從 TCGPlayer 搜尋並匯入最相關的卡牌。
          </p>
          <form className="flex flex-wrap gap-3 items-end" onSubmit={handleSearch}>
            <div className="space-y-1 flex-1 min-w-48">
              <label className="text-xs text-muted-foreground">卡牌名稱</label>
              <Input
                placeholder="例：Pikachu ex、Charizard"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">匯入張數上限（max 20）</label>
              <Input
                type="number"
                min={1}
                max={20}
                className="w-24"
                value={searchLimit}
                onChange={(e) => setSearchLimit(Number(e.target.value))}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? '搜尋中…' : '搜尋並匯入'}
            </Button>
          </form>
          {searchResult && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <div className="flex gap-4 font-medium">
                <span className="text-green-600">成功 {searchResult.imported}</span>
                <span className="text-muted-foreground">略過 {searchResult.skipped}</span>
                <span className="text-destructive">失敗 {searchResult.failed}</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-1">productId</th>
                    <th>卡名</th>
                    <th>歷史價格筆數</th>
                    <th>狀態</th>
                    <th>錯誤</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResult.results.map((r) => (
                    <tr key={r.productId} className="border-b">
                      <td className="py-1">{r.productId}</td>
                      <td>{r.name || '—'}</td>
                      <td>{r.salesCount != null ? `${r.salesCount} 筆` : '—'}</td>
                      <td className={
                        r.status === 'imported' ? 'text-green-600' :
                        r.status === 'skipped' ? 'text-muted-foreground' : 'text-destructive'
                      }>{r.status}</td>
                      <td className="text-destructive">{r.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>TCGPlayer 爬蟲批次匯入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            從 TCGPlayer 搜尋頁自動抓取寶可夢卡牌，建立卡牌記錄並立即同步價格與圖片。
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">搜尋頁碼</label>
              <Input
                type="number"
                min={1}
                className="w-24"
                value={importPage}
                onChange={(e) => setImportPage(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">匯入張數上限（max 50）</label>
              <Input
                type="number"
                min={1}
                max={50}
                className="w-24"
                value={importLimit}
                onChange={(e) => setImportLimit(Number(e.target.value))}
              />
            </div>
            <Button onClick={handleImport} disabled={busy}>
              {busy ? '匯入中（Playwright 啟動需數秒）…' : '開始匯入'}
            </Button>
          </div>
          {importResult && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <div className="flex gap-4 font-medium">
                <span className="text-green-600">成功 {importResult.imported}</span>
                <span className="text-muted-foreground">略過 {importResult.skipped}</span>
                <span className="text-destructive">失敗 {importResult.failed}</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-1">productId</th>
                    <th>卡名</th>
                    <th>歷史價格筆數</th>
                    <th>狀態</th>
                    <th>錯誤</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.results.map((r) => (
                    <tr key={r.productId} className="border-b">
                      <td className="py-1">{r.productId}</td>
                      <td>{r.name || '—'}</td>
                      <td>{r.salesCount != null ? `${r.salesCount} 筆` : '—'}</td>
                      <td className={
                        r.status === 'imported' ? 'text-green-600' :
                        r.status === 'skipped' ? 'text-muted-foreground' : 'text-destructive'
                      }>{r.status}</td>
                      <td className="text-destructive">{r.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>手動更新</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={handleSyncAll} disabled={busy}>
            {busy ? '更新中…' : '立即抓取全部卡牌價格'}
          </Button>
          <Button variant="outline" onClick={handleClearStuck} disabled={busy}>
            清除卡住的任務
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近任務狀態</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">開始時間</th>
                <th>觸發</th>
                <th>狀態</th>
                <th>成功/失敗</th>
                <th>錯誤</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b">
                  <td className="py-2">{fmtTime(j.startedAt)}</td>
                  <td>{j.triggerType}</td>
                  <td>{j.status}</td>
                  <td>
                    {j.successCount}/{j.failedCount}
                  </td>
                  <td className="text-destructive">{j.errorMessage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
