"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { getFirebase } from "../firebase/client";
import { isFirebaseConfigured } from "../firebase/config";
import { parseRole, type Role } from "./roles";

interface AuthState {
  user: User | null;
  role: Role | null;
  /** CNPJs (companyIds) que o usuário pode acessar; vazio = todos (admin). */
  companyIds: string[];
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  /** Recarrega o token e relê os claims (após mudança de papel). */
  recarregar: () => Promise<Role | null>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function parseCompanyIds(claims: Record<string, unknown>): string[] {
  const bruto = claims.companyIds;
  return Array.isArray(bruto) ? bruto.map(String).filter(Boolean) : [];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const lerClaims = useCallback(
    async (u: User, forcar = false): Promise<Role | null> => {
      const token = await u.getIdTokenResult(forcar);
      const r = parseRole(token.claims.role);
      setRole(r);
      setCompanyIds(parseCompanyIds(token.claims));
      return r;
    },
    [],
  );

  useEffect(() => {
    const fb = getFirebase();
    if (!fb) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(fb.auth, async (u) => {
      setUser(u);
      if (u) {
        await lerClaims(u);
      } else {
        setRole(null);
        setCompanyIds([]);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [lerClaims]);

  const recarregar = useCallback(async (): Promise<Role | null> => {
    const fb = getFirebase();
    if (!fb?.auth.currentUser) return null;
    return lerClaims(fb.auth.currentUser, true);
  }, [lerClaims]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      companyIds,
      loading,
      configured: isFirebaseConfigured,
      signIn: async (email, password) => {
        const fb = getFirebase();
        if (!fb) throw new Error("Firebase não configurado.");
        await signInWithEmailAndPassword(fb.auth, email, password);
      },
      signOutUser: async () => {
        const fb = getFirebase();
        if (fb) await signOut(fb.auth);
      },
      recarregar,
    }),
    [user, role, companyIds, loading, recarregar],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>.");
  return ctx;
}
