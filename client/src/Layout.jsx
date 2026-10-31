import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Search, KeyRound } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { api } from './api.js';
import { Drawer, Field, useToast } from './ui.jsx';

// Navigation model: each item is shown only if the user can read its `perm` (any of, when an array)
export const NAV = [
  { title: 'Dashboards', items: [
    { to: '/dashboard/executive', text: 'Executive', perm: 'dashboard.executive' },
    { to: '/dashboard/plant', text: 'Plant & Line', perm: 'dashboard.plant' },
    { to: '/dashboard/supply', text: 'Supply Chain', perm: 'supply.dashboard' },
  ] },
  { title: 'Shop Floor', items: [
    { to: '/shopfloor/new', text: 'Enter Production Log', perm: 'production_logs', action: 'c' },
    { to: '/shopfloor/logs', text: 'Production Logs', perm: 'production_logs' },
    { to: '/data/jobs', text: 'Jobs', perm: 'jobs' },
  ] },
  { title: 'Reports', items: [
    { to: '/reports/quality', text: 'Quality (Pareto & Rejects)', perm: 'report.quality' },
    { to: '/reports/oee', text: 'OEE', perm: 'report.oee' },
    { to: '/reports/downtime', text: 'Downtime', perm: 'report.downtime' },
    { to: '/reports/balance', text: 'Line Balance (Yamazumi)', perm: 'report.balance' },
    { to: '/lifecycle', text: 'Part Lifecycle', perm: 'parts' },
  ] },
  { title: 'Supply Chain', items: [
    { to: '/supply/inventory', text: 'Inventory', perm: 'inventory_levels' },
    { to: '/supply/purchase-orders', text: 'Purchase Orders', perm: 'purchase_orders' },
    { to: '/supply/shipments', text: 'Shipments', perm: 'shipments' },
  ] },
  { title: 'Setup', items: [
    { to: '/data/organizations', text: 'Organizations & Suppliers', perm: 'organizations' },
    { to: '/data/sites', text: 'Sites', perm: 'sites' },
    { to: '/data/lines', text: 'Lines', perm: 'lines' },
    { to: '/data/machines', text: 'Machines', perm: 'machines' },
    { to: '/data/parts', text: 'Parts', perm: 'parts' },
    { to: '/data/operations', text: 'Operations (Routing)', perm: 'operations' },
    { to: '/data/reason_codes', text: 'Reason Codes', perm: 'reason_codes' },
    { to: '/data/shifts', text: 'Shifts', perm: 'shifts' },
    { to: '/data/custom_fields', text: 'Custom Fields', perm: 'custom_fields' },
  ] },
  { title: 'Admin', items: [
    { to: '/admin/users', text: 'Users & Access', perm: 'users' },
    { to: '/admin/roles', text: 'Roles & Security', perm: 'roles' },
    { to: '/admin/config', text: 'Configuration', perm: 'settings' },
    { to: '/admin/audit', text: 'Audit Log', perm: 'audit' },
  ] },
];

export function useNav() {
  const { can } = useAuth();
  return useMemo(() => NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.perm, i.action || 'r')) })).filter((g) => g.items.length), [can]);
}

function ChangePassword({ onClose }) {
  const [f, setF] = useState({ current: '', next: '' });
  const [show, node] = useToast();
  const [err, setErr] = useState('');
  const save = async () => {
    try { await api('/auth/change-password', { method: 'POST', body: { current: f.current, next: f.next } }); show('Password updated'); setTimeout(onClose, 800); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Drawer title="Change password" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Update</button></>}>
      {err && <div className="alert">{err}</div>}
      <Field label="Current password"><input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="New password (min 8 characters)"><input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      {node}
    </Drawer>
  );
}

export default function Layout() {
  const { session, logout } = useAuth();
  const nav = useNav();
  const loc = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const [userMenu, setUserMenu] = useState(false);
  const [q, setQ] = useState('');
  const [pw, setPw] = useState(false);
  const ref = useRef();
  const navRef = useRef();

  useEffect(() => { setOpen(null); setUserMenu(false); }, [loc.pathname]);
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target) && !navRef.current?.contains(e.target)) { setOpen(null); setUserMenu(false); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const flat = nav.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
  const hits = q.trim() ? flat.filter((i) => (i.text + ' ' + i.group).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const initials = session.user.name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      <header className="gh no-print" ref={ref}>
        <Link to="/" className="brand"><span className="brand-mark">T</span>Smart TAKT Board</Link>
        <span className="tenant-chip">{session.tenant.name}</span>
        <div className="spacer" />
        <div className="quickfind">
          <Search size={14} />
          <input placeholder="Quick find…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { navigate(hits[0].to); setQ(''); } if (e.key === 'Escape') setQ(''); }} />
          {hits.length > 0 && <div className="qf-results">{hits.map((h) => <Link key={h.to} to={h.to} onClick={() => setQ('')}>{h.text} <span className="muted">· {h.group}</span></Link>)}</div>}
        </div>
        <div style={{ position: 'relative' }}>
          <button className="avatar" onClick={() => setUserMenu((v) => !v)} aria-label="User menu">{initials}</button>
          {userMenu && (
            <div className="menu user-menu" style={{ right: 0, left: 'auto' }}>
              <div className="hdr"><b>{session.user.name}</b><br />{session.user.role} · {session.user.org}</div>
              <a href="#pw" onClick={(e) => { e.preventDefault(); setPw(true); setUserMenu(false); }}><KeyRound size={13} /> Change password</a>
              <a href="#out" onClick={(e) => { e.preventDefault(); logout(); }}><LogOut size={13} /> Sign out</a>
            </div>
          )}
        </div>
      </header>
      <nav className="nav no-print" ref={navRef}>
        {nav.map((g) => {
          const active = g.items.some((i) => loc.pathname.startsWith(i.to));
          return (
            <div key={g.title} className={`nav-item ${open === g.title ? 'open' : ''}`} onMouseEnter={() => open && setOpen(g.title)}>
              <button className={`nav-btn ${active ? 'active' : ''}`} onClick={() => setOpen(open === g.title ? null : g.title)} aria-haspopup="true" aria-expanded={open === g.title}>{g.title} <ChevronDown size={12} /></button>
              {open === g.title && <div className="menu">{g.items.map((i) => <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'active' : '')}>{i.text}</NavLink>)}</div>}
            </div>
          );
        })}
      </nav>
      <main className="page"><Outlet /></main>
      {pw && <ChangePassword onClose={() => setPw(false)} />}
    </>
  );
}
