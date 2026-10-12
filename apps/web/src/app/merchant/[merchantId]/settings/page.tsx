'use client';

import { useState } from 'react';
import { useMerchant } from '@/components/MerchantContext';
import { Alert } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Members {
  members: { id: string; role: string; user: { name: string; email: string } }[];
  invitations: { id: string; email: string; role: string; expiresAt: string }[];
}

export default function SettingsPage() {
  const { m, setM } = useMerchant();
  const base = `/merchant/${m.id}`;
  const [f, setF] = useState({
    displayName: m.displayName,
    description: m.description,
    contactEmail: m.contactEmail,
    contactPhone: m.contactPhone,
    whatsappNumber: m.whatsappNumber ?? '',
    instagramHandle: m.instagramHandle ?? '',
    publicAreaLabel: m.publicAreaLabel ?? '',
    returnPolicy: m.returnPolicy,
    cancellationPolicy: m.cancellationPolicy,
    defaultLeadTimeDays: String(m.defaultLeadTimeDays),
  });
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const members = useApi<Members>(m.myRole === 'STAFF' ? null : `${base}/members`);
  const [invite, setInvite] = useState({ email: '', role: 'STAFF' });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const canEdit = m.myRole !== 'STAFF';

  const upload = async (kind: 'logo' | 'cover', file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    try {
      await api(`${base}/images/${kind}`, { method: 'POST', form: fd });
      setM({ ...(await api(`${base}`)), myRole: m.myRole } as typeof m);
      setMsg({ tone: 'success', text: `${kind === 'logo' ? 'Logo' : 'Cover image'} updated` });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Upload failed' });
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<typeof m>(base, {
              method: 'PATCH',
              body: {
                ...f,
                whatsappNumber: f.whatsappNumber || null,
                instagramHandle: f.instagramHandle || null,
                publicAreaLabel: f.publicAreaLabel || null,
                defaultLeadTimeDays: Number(f.defaultLeadTimeDays),
              },
            });
            setM({ ...r, myRole: m.myRole });
            setMsg({ tone: 'success', text: 'Store profile saved' });
          } catch (err) {
            setMsg({ tone: 'error', text: err instanceof ApiError ? err.message : 'Failed' });
          }
        }}
      >
        <h2>Store profile</h2>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="field">
            <label htmlFor="n">Store name</label>
            <input
              id="n"
              type="text"
              value={f.displayName}
              onChange={(e) => setF({ ...f, displayName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="d">About your store</label>
            <textarea
              id="d"
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="ce">Contact email (private)</label>
              <input
                id="ce"
                type="email"
                value={f.contactEmail}
                onChange={(e) => setF({ ...f, contactEmail: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="cp">Contact phone (private)</label>
              <input
                id="cp"
                type="tel"
                value={f.contactPhone}
                onChange={(e) => setF({ ...f, contactPhone: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="wa">WhatsApp (public, optional)</label>
              <input
                id="wa"
                type="tel"
                value={f.whatsappNumber}
                onChange={(e) => setF({ ...f, whatsappNumber: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="ig">Instagram (public, optional)</label>
              <input
                id="ig"
                type="text"
                placeholder="@yourstore"
                value={f.instagramHandle}
                onChange={(e) => setF({ ...f, instagramHandle: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="al">Public area label</label>
            <input
              id="al"
              type="text"
              value={f.publicAreaLabel}
              onChange={(e) => setF({ ...f, publicAreaLabel: e.target.value })}
            />
            <div className="hint">
              General area shown to customers, e.g. “Barnawa, Kaduna”. Don&apos;t include a street
              address if you sell from home.
            </div>
          </div>
          <div className="field">
            <label htmlFor="rp">Return policy</label>
            <textarea
              id="rp"
              value={f.returnPolicy}
              onChange={(e) => setF({ ...f, returnPolicy: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="cpol">Cancellation policy</label>
            <textarea
              id="cpol"
              value={f.cancellationPolicy}
              onChange={(e) => setF({ ...f, cancellationPolicy: e.target.value })}
            />
          </div>
          <button className="btn">Save profile</button>
        </fieldset>
      </form>
      {canEdit && (
        <section className="card stack-sm">
          <h2>Logo &amp; cover</h2>
          <div className="row">
            {(['logo', 'cover'] as const).map((k) => (
              <label key={k} className="btn btn-secondary btn-sm">
                Upload {k}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => e.target.files?.[0] && upload(k, e.target.files[0])}
                />
              </label>
            ))}
          </div>
        </section>
      )}
      {members.data && (
        <section className="card stack-sm">
          <h2>Team</h2>
          {members.data.members.map((mm) => (
            <div key={mm.id} className="row-between small card-flat">
              <span>
                {mm.user.name} <span className="meta">{mm.user.email}</span>
              </span>
              <span className="row">
                <span className="badge">{mm.role.toLowerCase()}</span>
                {m.myRole === 'OWNER' && mm.role !== 'OWNER' && (
                  <button
                    className="btn btn-link"
                    onClick={async () => (
                      await api(`${base}/members/${mm.id}`, { method: 'DELETE' }), members.reload()
                    )}
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>
          ))}
          {members.data.invitations.map((i) => (
            <div key={i.id} className="small meta">
              Invited: {i.email} ({i.role.toLowerCase()})
            </div>
          ))}
          {m.myRole === 'OWNER' && (
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const r = await api<{ inviteUrl: string }>(`${base}/invitations`, {
                    body: invite,
                  });
                  setInviteUrl(r.inviteUrl);
                  setInvite({ email: '', role: 'STAFF' });
                  await members.reload();
                } catch (err) {
                  setMsg({ tone: 'error', text: err instanceof ApiError ? err.message : 'Failed' });
                }
              }}
            >
              <input
                aria-label="Email"
                type="email"
                required
                placeholder="staff@email.com"
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                style={{ flex: 1 }}
              />
              <select
                aria-label="Role"
                value={invite.role}
                onChange={(e) => setInvite({ ...invite, role: e.target.value })}
                style={{ maxWidth: 150 }}
              >
                <option value="STAFF">Staff (orders &amp; products)</option>
                <option value="MANAGER">Manager</option>
              </select>
              <button className="btn btn-sm btn-secondary">Invite</button>
            </form>
          )}
          {inviteUrl && (
            <Alert tone="success">
              Invitation sent. You can also share this link:{' '}
              <code style={{ wordBreak: 'break-all' }}>{inviteUrl}</code>
            </Alert>
          )}
        </section>
      )}
    </div>
  );
}
