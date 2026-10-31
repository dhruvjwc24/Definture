import { useMemo, useState } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, Drawer, ErrorBox, Field, Loading, PageHead, useLoad, useToast } from '../ui.jsx';

// ───────────── Users & record-level scope ─────────────
const SCOPE_TYPES = [['org', 'Organization'], ['site', 'Site'], ['line', 'Line'], ['machine', 'Machine'], ['part', 'Part']];

function UserForm({ user, roles, orgs, opts, onClose, onSaved }) {
  const [v, setV] = useState(user ? { ...user, password: '' } : { full_name: '', email: '', title: '', org_id: orgs[0]?.id || '', role_id: '', active: true, password: '', scopes: [] });
  const [add, setAdd] = useState({ type: 'site', id: '' });
  const [err, setErr] = useState('');
  const tenantWide = v.scopes.some((s) => s.type === 'tenant');
  const nameOf = (s) => opts[s.type]?.find((o) => o.id === s.id)?.name || s.id;
  const save = async () => {
    try {
      const body = { ...v, password: v.password || undefined };
      await api(user ? `/admin/users/${user.id}` : '/admin/users', { method: user ? 'PUT' : 'POST', body });
      onSaved(user ? 'User saved' : 'User created');
    } catch (e) { setErr(e.message); }
  };
  return (
    <Drawer title={user ? 'Edit user' : 'New user'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Full name" required><input type="text" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
        <Field label="Email" required><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Title"><input type="text" value={v.title || ''} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label={user ? 'Reset password (optional)' : 'Password'} required={!user}><input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Organization" required><select value={v.org_id} onChange={(e) => setV({ ...v, org_id: e.target.value })}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}</select></Field>
        <Field label="Role (feature & CRED access)" required><select value={v.role_id} onChange={(e) => setV({ ...v, role_id: e.target.value })}><option value="">Select…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        {user && <label className="check full"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Active</label>}
      </div>
      <h3 style={{ margin: '18px 0 6px' }}>Record visibility</h3>
      <div className="muted" style={{ marginBottom: 8 }}>Limits which plants, lines, machines or parts this person can see and act on.</div>
      <label className="check"><input type="checkbox" checked={tenantWide} onChange={(e) => setV({ ...v, scopes: e.target.checked ? [{ type: 'tenant' }] : [] })} /> Everything in the company (tenant-wide)</label>
      {!tenantWide && (
        <>
          <div className="chips" style={{ margin: '10px 0' }}>
            {v.scopes.map((s, i) => <span className="chip" key={i}>{s.type}: {nameOf(s)}<button onClick={() => setV({ ...v, scopes: v.scopes.filter((_, j) => j !== i) })} aria-label="Remove"><X size={12} /></button></span>)}
            {!v.scopes.length && <span className="muted">No access to records until a scope is added.</span>}
          </div>
          <div className="row">
            <select value={add.type} onChange={(e) => setAdd({ type: e.target.value, id: '' })}>{SCOPE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value })} style={{ minWidth: 220 }}>
              <option value="">Select…</option>{(opts[add.type] || []).map((o) => <option key={o.id} value={o.id}>{o.parent ? `${o.parent} · ` : ''}{o.name}</option>)}
            </select>
            <button className="btn" disabled={!add.id || v.scopes.some((s) => s.type === add.type && s.id === add.id)} onClick={() => { setV({ ...v, scopes: [...v.scopes, add] }); setAdd({ ...add, id: '' }); }}>Add</button>
          </div>
        </>
      )}
    </Drawer>
  );
}

export function Users() {
  const { can } = useAuth();
  const [edit, setEdit] = useState(null);
  const [toast, toastNode] = useToast();
  const d = useLoad(() => Promise.all([api('/admin/users'), api('/admin/roles'), api('/admin/scope-options')]).then(([users, roles, opts]) => ({ users, roles, opts })), []);
  const describe = (u) => (u.scopes.some((s) => s.type === 'tenant') ? 'Everything' : u.scopes.length ? u.scopes.map((s) => d.data.opts[s.type]?.find((o) => o.id === s.id)?.name || s.type).join(', ') : 'None');
  return (
    <>
      <PageHead title="Users & Access" sub="Who can sign in, what they can do, and which records they can see">
        {can('users', 'c') && <button className="btn primary" disabled={!d.data} onClick={() => setEdit('new')}><Plus size={14} /> New user</button>}
      </PageHead>
      <ErrorBox error={d.error} />
      <Card flush>
        {!d.data ? <Loading /> : (
          <DataTable rows={d.data.users} onRowClick={can('users', 'e') ? setEdit : undefined} columns={[
            { header: 'Name', render: (u) => <><b>{u.full_name}</b><div className="muted">{u.email}</div></> }, { header: 'Organization', key: 'org_name' },
            { header: 'Role', render: (u) => <Badge tone="blue">{u.role_name}</Badge> }, { header: 'Record visibility', render: describe },
            { header: 'Last login', render: (u) => (u.last_login ? String(u.last_login).slice(0, 16).replace('T', ' ') : 'Never') },
            { header: 'Active', render: (u) => (u.active ? 'Yes' : <Badge tone="bad">No</Badge>) },
          ]} />
        )}
      </Card>
      {edit && d.data && <UserForm user={edit === 'new' ? null : edit} roles={d.data.roles} orgs={d.data.opts.org} opts={d.data.opts} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); d.reload(); }} />}
      {toastNode}
    </>
  );
}

// ───────────── Roles: CRED matrix + field security ─────────────
const ACTIONS = [['c', 'Create'], ['r', 'Read'], ['e', 'Edit'], ['d', 'Delete'], ['a', 'Approve']];

function RoleEditor({ role, catalog, onSaved, onCancel, isNew }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description || '');
  const [perms, setPerms] = useState(() => Object.fromEntries(role.permissions.map((p) => [p.resource, p])));
  const [fields, setFields] = useState(() => Object.fromEntries(role.field_security.map((f) => [`${f.resource}.${f.field}`, f.access])));
  const [err, setErr] = useState('');
  const groups = useMemo(() => { const g = {}; for (const r of catalog.resources) (g[r.group] ||= []).push(r); return g; }, [catalog]);

  const toggle = (res, act) => setPerms((p) => {
    const cur = { resource: res, c: false, r: false, e: false, d: false, a: false, ...p[res] };
    cur[act] = !cur[act];
    if (act !== 'r' && cur[act]) cur.r = true;            // anything implies Read
    if (act === 'r' && !cur.r) { cur.c = cur.e = cur.d = cur.a = false; }
    return { ...p, [res]: cur };
  });
  const save = async () => {
    try {
      const body = {
        name, description, persona: role.persona,
        permissions: Object.values(perms),
        field_security: Object.entries(fields).filter(([, a]) => a).map(([k, access]) => { const [resource, field] = k.split('.'); return { resource, field, access }; }),
      };
      await api(isNew ? '/admin/roles' : `/admin/roles/${role.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved(isNew ? 'Role created' : 'Role saved');
    } catch (e) { setErr(e.message); }
  };
  return (
    <Card title={isNew ? 'New role' : `Role: ${role.name}`} actions={<><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Role name" required><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="tbl-wrap" style={{ marginTop: 14 }}>
        <table className="tbl cred">
          <thead><tr><th>Feature / object</th>{ACTIONS.map(([k, l]) => <th key={k} className="r" style={{ textAlign: 'center' }}>{l}</th>)}</tr></thead>
          <tbody>
            {Object.entries(groups).map(([g, items]) => [
              <tr key={g} className="grp"><td colSpan={6}>{g}</td></tr>,
              ...items.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}{r.kind === 'feature' && <span className="muted"> (access)</span>}</td>
                  {ACTIONS.map(([k, l]) => {
                    const applies = r.kind === 'object' ? k !== 'a' || r.approve : k === 'r';
                    return <td key={k} style={{ textAlign: 'center' }}>{applies ? <input type="checkbox" aria-label={`${l} ${r.label}`} checked={!!perms[r.key]?.[k]} onChange={() => toggle(r.key, k)} /> : ''}</td>;
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <h3 style={{ margin: '18px 0 6px' }}>Field-level security</h3>
      <div className="muted" style={{ marginBottom: 8 }}>Hide sensitive fields entirely, or show them read-only.</div>
      <table className="tbl"><tbody>
        {Object.entries(catalog.securableFields).flatMap(([res, fs]) => fs.map((f) => (
          <tr key={`${res}.${f}`}>
            <td>{res}.<b>{f}</b></td>
            <td><select value={fields[`${res}.${f}`] || ''} onChange={(e) => setFields({ ...fields, [`${res}.${f}`]: e.target.value })}><option value="">Visible & editable (per CRED)</option><option value="read">Read-only</option><option value="hidden">Hidden</option></select></td>
          </tr>
        )))}
      </tbody></table>
    </Card>
  );
}

export function Roles() {
  const { can, refresh } = useAuth();
  const [sel, setSel] = useState(null);
  const [mode, setMode] = useState('edit'); // edit | new
  const [toast, toastNode] = useToast();
  const d = useLoad(() => Promise.all([api('/admin/roles'), api('/admin/permission-catalog')]).then(([roles, catalog]) => ({ roles, catalog })), []);
  const role = d.data?.roles.find((r) => r.id === sel);
  const blank = { name: '', description: '', permissions: [], field_security: [] };
  const clone = (r) => { setMode('new'); setSel('clone:' + r.id); };
  const editing = mode === 'new' ? (sel?.startsWith('clone:') ? { ...d.data.roles.find((r) => r.id === sel.slice(6)), name: '', description: '' } : blank) : role;
  const del = async (r) => {
    if (!window.confirm(`Delete role "${r.name}"?`)) return;
    try { await api(`/admin/roles/${r.id}`, { method: 'DELETE' }); toast('Role deleted'); setSel(null); d.reload(); } catch (e) { toast(e.message, true); }
  };
  return (
    <>
      <PageHead title="Roles & Security" sub="Feature access and Create / Read / Edit / Delete / Approve by persona">
        {can('roles', 'c') && <button className="btn primary" onClick={() => { setMode('new'); setSel('new'); }}><Plus size={14} /> New role</button>}
      </PageHead>
      <ErrorBox error={d.error} />
      {!d.data ? <Loading /> : (
        <div className="grid" style={{ gridTemplateColumns: '300px 1fr', alignItems: 'start' }}>
          <Card title="Roles" flush>
            <DataTable rows={d.data.roles} onRowClick={(r) => { setMode('edit'); setSel(r.id); }} columns={[
              { header: 'Role', render: (r) => <><b>{r.name}</b>{r.is_system && <> <Badge>preset</Badge></>}<div className="muted">{r.user_count} user(s)</div></> },
              { header: '', width: 56, render: (r) => <span className="row">{can('roles', 'c') && <button className="btn link" title="Clone" onClick={(e) => { e.stopPropagation(); clone(r); }}><Copy size={14} /></button>}</span> },
            ]} />
          </Card>
          {editing ? (
            <div>
              <RoleEditor key={sel + mode} role={editing} isNew={mode === 'new'} catalog={d.data.catalog} onCancel={() => setSel(null)}
                onSaved={(m) => { toast(m); setSel(null); d.reload(); refresh(); }} />
              {mode === 'edit' && role && !role.is_system && can('roles', 'd') && <button className="btn danger" onClick={() => del(role)}>Delete role</button>}
            </div>
          ) : <Card><div className="empty">Select a role to review or change its access, or create a new one.</div></Card>}
        </div>
      )}
      {toastNode}
    </>
  );
}

// ───────────── Configuration: terminology, KPI targets ─────────────
const METRICS = { oee: 'OEE', availability: 'Availability', performance: 'Performance', quality: 'Quality', scrap_rate: 'Scrap rate', otd: 'On-time delivery' };

export function Config() {
  const { can, refresh, session } = useAuth();
  const [toast, toastNode] = useToast();
  const [v, setV] = useState(null);
  const s = useLoad(() => api('/admin/settings').then((x) => { setV({ name: x.name, labels: { ...session.tenant.labels, ...(x.settings.labels || {}) }, targets: x.targets }); return x; }), []);
  const canEdit = can('settings', 'e');
  const save = async () => {
    try { await api('/admin/settings', { method: 'PUT', body: { name: v.name, settings: { labels: v.labels }, targets: v.targets } }); await refresh(); toast('Configuration saved'); }
    catch (e) { toast(e.message, true); }
  };
  if (!v) return s.error ? <ErrorBox error={s.error} /> : <Loading />;
  const setT = (m, p) => setV({ ...v, targets: v.targets.map((t) => (t.metric === m ? { ...t, ...p } : t)) });
  return (
    <>
      <PageHead title="Configuration" sub={`Company code: ${s.data.slug} · Plan: ${s.data.plan}`}>{canEdit && <button className="btn primary" onClick={save}>Save changes</button>}</PageHead>
      <div className="grid g2">
        <Card title="Terminology">
          <div className="muted" style={{ marginBottom: 10 }}>Rename concepts to match your shop-floor language. Applies across menus, forms and reports.</div>
          <Field label="Company name"><input type="text" value={v.name} disabled={!canEdit} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <div className="form-grid" style={{ marginTop: 10 }}>
            {Object.keys(v.labels).map((k) => <Field key={k} label={k}><input type="text" value={v.labels[k]} disabled={!canEdit} onChange={(e) => setV({ ...v, labels: { ...v.labels, [k]: e.target.value } })} /></Field>)}
          </div>
        </Card>
        <Card title="KPI targets">
          <div className="muted" style={{ marginBottom: 10 }}>Green at or beyond the target, amber between target and warning, red otherwise.</div>
          <table className="tbl"><thead><tr><th>Metric</th><th>Target %</th><th>Warning %</th><th>Better when</th></tr></thead><tbody>
            {v.targets.map((t) => (
              <tr key={t.metric}>
                <td>{METRICS[t.metric] || t.metric}</td>
                <td><input type="number" style={{ width: 80 }} value={t.target} disabled={!canEdit} onChange={(e) => setT(t.metric, { target: e.target.value })} /></td>
                <td><input type="number" style={{ width: 80 }} value={t.warn} disabled={!canEdit} onChange={(e) => setT(t.metric, { warn: e.target.value })} /></td>
                <td><select value={t.direction} disabled={!canEdit} onChange={(e) => setT(t.metric, { direction: e.target.value })}><option value="higher">Higher</option><option value="lower">Lower</option></select></td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      </div>
      {toastNode}
    </>
  );
}

export function AuditLog() {
  const [resource, setResource] = useState('');
  const a = useLoad(() => api('/admin/audit', { query: { resource } }), [resource]);
  return (
    <>
      <PageHead title="Audit Log" sub="The last 300 security-relevant actions">
        <select value={resource} onChange={(e) => setResource(e.target.value)}><option value="">All resources</option>{['production_logs', 'users', 'roles', 'settings', 'purchase_orders', 'shipments'].map((r) => <option key={r}>{r}</option>)}</select>
      </PageHead>
      <ErrorBox error={a.error} />
      <Card flush>
        {a.loading && !a.data ? <Loading /> : (
          <DataTable rows={a.data} columns={[
            { header: 'When', render: (r) => String(r.created_at).slice(0, 19).replace('T', ' ') }, { header: 'User', render: (r) => r.user_name || '—' },
            { header: 'Action', render: (r) => <Badge tone="blue">{r.action}</Badge> }, { header: 'Resource', key: 'resource' }, { header: 'Record', render: (r) => r.record_id || '—' },
            { header: 'Detail', render: (r) => (r.detail ? JSON.stringify(r.detail) : '—') },
          ]} />
        )}
      </Card>
    </>
  );
}
