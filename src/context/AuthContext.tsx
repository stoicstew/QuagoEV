import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface AuthContextType {
  authenticated: boolean;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>(null!);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/auth/status', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false));
  }, []);

  const login = async () => {
    const res = await fetch('/auth/login');
    const { url } = await res.json();
    window.location.href = url;
  };

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    setAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ authenticated, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
