import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUPPORTED_CURRENCIES } from '@pct/shared/constants';
import { isLoggedIn, clearToken } from '@/lib/auth';
import { adminCreateCard, adminAddSource, adminSyncAll, adminGetJobs } from '@/lib/api';
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
            <Input
              placeholder={`currency（${SUPPORTED_CURRENCIES.join('/')}）`}
              value={form.currency}
              onChange={set('currency')}
            />
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
          <CardTitle>手動更新</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={handleSyncAll} disabled={busy}>
            {busy ? '更新中…' : '立即抓取全部卡牌價格'}
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
