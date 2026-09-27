'use client';

// Who is signed in, shared across the app. `user` is undefined while we ask
// the API, null when signed out. When any request reports the session has
// expired, the user is sent to the login page and brought back afterwards.

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthenticated } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const router = useRouter();

  useEffect(() => {
    api('/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(
    () =>
      onUnauthenticated(() => {
        setUser(null);
        const next = encodeURIComponent(window.location.pathname);
        router.replace(`/login?expired=1&next=${next}`);
      }),
    [router],
  );

  const login = useCallback(async (email, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { email, password } });
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (email, password) => {
    const res = await api('/auth/register', { method: 'POST', body: { email, password } });
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    router.replace('/login');
  }, [router]);

  const value = useMemo(() => ({ user, login, register, logout }), [user, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** For pages that need a signed-in user: redirects to login otherwise. */
export function useRequireAuth() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (user === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [user, router, pathname]);
  return user;
}
