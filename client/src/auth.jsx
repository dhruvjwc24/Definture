import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const PLURAL = (s) => (/y$/i.test(s) ? s.replace(/y$/i, 'ies') : /s$/i.test(s) ? s : s + 's');

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const logout = useCallback(() => { setToken(null); setSession(null); }, []);
  const refresh = useCallback(async () => { setSession(await api('/auth/me')); }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (getToken()) refresh().catch(logout).finally(() => setLoading(false));
  }, [logout, refresh]);

  const value = useMemo(() => {
    const perms = session?.permissions || {};
    return {
      session, loading, logout, refresh,
      login: async (company, email, password) => { const { token } = await api('/auth/login', { method: 'POST', body: { company, email, password } }); setToken(token); await refresh(); },
      // can('machines','c') -> Create; r Read; e Edit; d Delete; a Approve
      can: (resource, action = 'r') => !!perms[resource]?.[action],
      canAny: (...resources) => resources.some((r) => perms[r]?.r),
      hidden: (resource, field) => !!session?.hiddenFields?.[resource]?.includes(field),
      label: (key, plural) => { const l = session?.tenant?.labels?.[key] || key; return plural ? PLURAL(l) : l; },
      targets: Object.fromEntries((session?.targets || []).map((t) => [t.metric, t])),
    };
  }, [session, loading, logout, refresh]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
