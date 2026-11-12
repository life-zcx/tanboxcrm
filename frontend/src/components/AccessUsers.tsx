import React, { useEffect, useState } from 'react';
import { api, AccessUser } from '../api-client';

const labels: Record<string, string> = { PENDING: 'Ожидает решения', APPROVED: 'Доступ открыт', REJECTED: 'Отклонено', REVOKED: 'Доступ отозван' };

export function AccessUsers() {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string|null>(null);
  const refresh = async () => { const result = await api.getAccessUsers(); setUsers(result.users); };
  useEffect(() => { void refresh().catch(e => setError(e instanceof Error ? e.message : 'Не удалось загрузить пользователей')); }, []);
  const decide = async (user: AccessUser, action: 'APPROVE'|'REJECT'|'REVOKE') => {
    if (action === 'REVOKE' && !window.confirm('Отозвать доступ и завершить все сеансы пользователя?')) return;
    setBusy(user.id); setError('');
    try { await api.decideAccess(user.id, action); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось изменить доступ'); }
    finally { setBusy(null); }
  };
  return <div className="p-4 md:p-6 space-y-4">
    <div><h1 className="text-xl font-bold text-slate-900">Доступ к CRM</h1><p className="text-sm text-slate-500">Сотрудники входят по одноразовому коду Telegram после вашего одобрения.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 p-3 text-sm">{error}</p>}
    <div className="space-y-2">{users.map(user => <div key={user.id} className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div><div className="font-semibold text-slate-900">{user.telegramUsername ? '@'+user.telegramUsername : 'Telegram ID '+user.telegramChatId}</div><div className="text-xs text-slate-500">ID {user.telegramChatId} · {labels[user.accessStatus] || user.accessStatus}</div></div>
      <div className="flex gap-2">{user.accessStatus === 'PENDING' && <><button disabled={busy===user.id} onClick={() => void decide(user,'APPROVE')} className="rounded bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50">Одобрить</button><button disabled={busy===user.id} onClick={() => void decide(user,'REJECT')} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Отклонить</button></>}{user.accessStatus === 'APPROVED' && <button disabled={busy===user.id} onClick={() => void decide(user,'REVOKE')} className="rounded border border-red-200 text-red-700 px-3 py-2 text-sm disabled:opacity-50">Отозвать доступ</button>}</div>
    </div>)}{!users.length && <p className="text-sm text-slate-500">Заявок пока нет.</p>}</div>
  </div>;
}
