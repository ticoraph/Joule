import { type User, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { auth, firebaseConfigured, googleProvider } from "../lib/firebase";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);

  useEffect(() => {
    if (!firebaseConfigured || !auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const login = async () => {
    if (!auth) return;
    await signInWithPopup(auth, googleProvider);
  };
  const logout = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
