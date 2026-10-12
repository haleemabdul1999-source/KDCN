'use client';

import { useState } from 'react';
import { Alert, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface User {
  id: string;
  email: string;
  name: string;
  status: string;
  staffRoles: string[];
  mfaEnabled: boolean;
}
interface Audit {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  actorRoles: string[];
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}
interface Market {
  id: string;
  slug: string;
  name: string;
  kind: string;
  operators: { role: string; user: { id: string; email: string; name: string } }[];
  _count: { affiliations: number; collectionPoints: number };
}
interface Job {
  name: string;
  everyMs: number;
  lastRun: { at: string; result: number | string } | null;
}

const ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT'];

export default function Platform() {
  const [tab, setTab] = useState('audit');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [userQ, setUserQ] = useState('');
  const [auditQ, setAuditQ] = useState('');
  const users = useApi<{ items: User[] }>(tab === 'users' ? `/admin/users?pageSize=50${userQ ? `&q=${encodeURIComponent(userQ)}` : ''}` : null);
  const audit = useApi<{ items: Audit[]; total: number }>(tab === 'audit' ? `/admin/audit?pageSize=50${auditQ ? `&action=${encodeURIComponent(auditQ)}` : ''}` : null);
  const markets = useApi<Market[]>(tab === 'markets' ? '/admin/markets' : null);
  const jobs = useApi<Job[]>(tab === 'jobs' ? '/admin/jobs' : null);
  const [op, setOp] = useState<Record<string, { email: string; role: string }>>({});

  const run = async (fn: () => Promise<unknown>, ok: string, reload: () => Promise<void>) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
    }
  };

  return (
    <div className="stack">
      <div className="chip-row">
        {[
          ['audit', 'Audit log'],
          ['users', 'Users & roles'],
          ['markets', 'Markets & operators'],
          ['jobs', 'Background jobs'],
        ].map(([v, l]) => (
          <button key={v} className="chip" aria-current={tab === v} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {tab === 'audit' && (
        <>
          <input type="search" aria-label="Filter by action prefix" placeholder="Filter by action (e.g. merchant., refund., payment.)" value={auditQ} onChange={(e) => setAuditQ(e.target.value)} style={{ maxWidth: 420 }} />
          {audit.loading && <Loading />}
          {audit.error && <Alert tone="error">{audit.error.message}</Alert>}
          {audit.data && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Actor</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.items.map((a) => (
                    <tr key={a.id}>
                      <td className="small nowrap">{date(a.createdAt, true)}</td>
                      <td className="small">{a.action}</td>
                      <td className="small">
                        {a.entityType} {a.entityId.slice(0, 8)}
                      </td>
                      <td className="small">{a.actorUserId ? `${a.actorUserId.slice(0, 8)} ${a.actorRoles.join(',').toLowerCase()}` : 'system'}</td>
                      <td className="small" style={{ maxWidth: 360, wordBreak: 'break-word' }}>
                        {JSON.stringify(a.metadata).slice(0, 200)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'users' && (
        <>
          <input type="search" aria-label="Search users" placeholder="Search email or name" value={userQ} onChange={(e) => setUserQ(e.target.value)} style={{ maxWidth: 320 }} />
          {users.error && <Alert tone="error">{users.error.message}</Alert>}
          {users.data && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Staff roles</th>
                    <th>MFA</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.items.map((u) => (
                    <tr key={u.id}>
                      <td className="small">
                        {u.name}
                        <div className="meta">{u.email}</div>
                      </td>
                      <td className="small">
                        {ROLES.map((r) => (
                          <label key={r} className="checkbox" style={{ display: 'inline-flex', marginRight: 8 }}>
                            <input
                              type="checkbox"
                              checked={u.staffRoles.includes(r)}
                              onChange={(e) => run(() => api(`/admin/users/${u.id}/roles`, { method: 'PUT', body: { staffRoles: e.target.checked ? [...u.staffRoles, r] : u.staffRoles.filter((x) => x !== r) } }), 'Roles updated — user must sign in again', users.reload)}
                            />
                            {r.toLowerCase().replace('_', ' ')}
                          </label>
                        ))}
                      </td>
                      <td className="small">{u.mfaEnabled ? 'Enrolled' : '—'}</td>
                      <td>
                        <button className="btn btn-sm btn-secondary" onClick={() => run(() => api(`/admin/users/${u.id}/status`, { body: { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', reason: 'Changed by administrator' } }), 'Status updated', users.reload)}>
                          {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'markets' &&
        markets.data?.map((m) => {
          const v = op[m.id] ?? { email: '', role: 'MARKET_ADMIN' };
          return (
            <section key={m.id} className="card stack-sm">
              <h3>
                {m.name} <span className="meta">({m._count.affiliations} affiliations · {m._count.collectionPoints} collection points)</span>
              </h3>
              {m.operators.map((o) => (
                <div key={o.user.id} className="row-between small">
                  <span>
                    {o.user.name} &lt;{o.user.email}&gt; — {o.role.toLowerCase().replace('_', ' ')}
                  </span>
                  <button className="btn btn-link" onClick={() => run(() => api(`/admin/markets/${m.id}/operators/${o.user.id}`, { method: 'DELETE' }), 'Operator removed', markets.reload)}>
                    Remove
                  </button>
                </div>
              ))}
              <form className="row" onSubmit={(e) => (e.preventDefault(), run(() => api(`/admin/markets/${m.id}/operators`, { body: v }), 'Operator added', markets.reload))}>
                <input aria-label="Operator email" type="email" required placeholder="operator@email" value={v.email} onChange={(e) => setOp({ ...op, [m.id]: { ...v, email: e.target.value } })} style={{ maxWidth: 260 }} />
                <select aria-label="Operator role" value={v.role} onChange={(e) => setOp({ ...op, [m.id]: { ...v, role: e.target.value } })} style={{ maxWidth: 200 }}>
                  <option value="MARKET_ADMIN">Market admin</option>
                  <option value="MARKET_EDITOR">Content editor</option>
                </select>
                <button className="btn btn-sm btn-secondary">Add operator</button>
              </form>
            </section>
          );
        })}

      {tab === 'jobs' && jobs.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Interval</th>
                <th>Last run (this instance)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.data.map((j) => (
                <tr key={j.name}>
                  <td className="small">{j.name}</td>
                  <td className="small">{Math.round(j.everyMs / 1000)}s</td>
                  <td className="small">{j.lastRun ? `${date(j.lastRun.at, true)} → ${j.lastRun.result}` : '—'}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={() => run(() => api(`/admin/jobs/${j.name}/run`, { method: 'POST' }), 'Job run', jobs.reload)}>
                      Run now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
