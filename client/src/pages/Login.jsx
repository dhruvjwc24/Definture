import { useState } from 'react';
import { useAuth } from '../auth.jsx';

const DEMO = [
  ['Executive', 'exec@apex.com'], ['Tenant admin', 'admin@apex.com'], ['Plant manager (P1)', 'gm@apex.com'], ['Part manager', 'manager@apex.com'],
  ['Supervisor', 'supervisor@apex.com'], ['Line lead', 'lead@apex.com'], ['Operator', 'operator@apex.com'], ['Supply planner', 'planner@apex.com'],
  ['Quality engineer', 'quality@apex.com'], ['Supplier admin', 'supplier.admin@castings.com'], ['Supplier user', 'supplier.op@castings.com'],
];

export default function Login() {
  const { login } = useAuth();
  const [f, setF] = useState({ company: 'apex', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try { await login(f.company, f.email, f.password); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <div className="login-side">
        <h1>Smart TAKT Board</h1>
        <p>OEE, TAKT and supply-chain visibility for manufacturers and their suppliers.</p>
        <ul><li>Live OEE, bottleneck and line-balance analytics</li><li>Incoming inventory, shipments and delay risk</li><li>Persona-based access to features, fields and records</li></ul>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <h2>Sign in</h2>
          {err && <div className="alert">{err}</div>}
          <div className="field"><label>Company code</label><input type="text" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} autoComplete="organization" /></div>
          <div className="field"><label>Email</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" autoFocus /></div>
          <div className="field"><label>Password</label><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" /></div>
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="demo-list">
          <div className="muted" style={{ marginBottom: 6 }}>Demo logins (password <code>Welcome1!</code>)</div>
          {DEMO.map(([n, e]) => <button key={e} type="button" onClick={() => setF({ company: 'apex', email: e, password: 'Welcome1!' })}>{n}</button>)}
        </div>
      </div>
    </div>
  );
}
