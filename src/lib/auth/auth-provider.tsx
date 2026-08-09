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
import { doc, getDoc } from "firebase/firestore";
import { getFirebase } from "../firebase/client";
import { isFirebaseConfigured } from "../firebase/config";
import { parseRole, type Role } from "./roles";
import type { Perfil, StatusUsuario } from "./permissoes";

interface AuthState {
  user: User | null;
  role: Role | null;
  isAdmin: boolean;
  status: StatusUsuario | null;
  perfil: Perfil | null;
  /** CNPJs (companyIds) que o usuário pode acessar; vazio = todos (admin). */
  companyIds: string[];
  loading: boolean;
  configured: boolean;
  podeModulo: (key: string) => boolean;
  podeAcao: (key: string) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  recarregar: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function parseCompanyIds(claims: Record<string, unknown>): string[] {
  const bruto = claims.companyIds;
  return Array.isArray(bruto) ? bruto.map(String).filter(Boolean) : [];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<StatusUsuario | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = role === "admin";

  const lerClaims = useCallback(async (u: User, forcar = false): Promise<void> => {
    const token = await u.getIdTokenResult(forcar);
    const r = parseRole(token.claims.role);
    setRole(r);
    setCompanyIds(parseCompanyIds(token.claims));
    const admin = r === "admin";
    setStatus(admin ? "ativo" : ((token.claims.status as StatusUsuario) ?? "pendente"));
    const rid = (token.claims.roleId as string) ?? null;
    if (!admin && rid) {
      try {
        const fb = getFirebase();
        if (fb) {
          const snap = await getDoc(doc(fb.db, "nfe_roles", rid));
          setPerfil(snap.exists() ? ({ id: snap.id, ...(snap.data() as object) } as Perfil) : null);
        }
      } catch {
        setPerfil(null);
      }
    } else {
      setPerfil(null);
    }
  }, []);

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
        setStatus(null);
        setPerfil(null);
        setCompanyIds([]);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [lerClaims]);

  const recarregar = useCallback(async (): Promise<void> => {
    const fb = getFirebase();
    if (fb?.auth.currentUser) await lerClaims(fb.auth.currentUser, true);
  }, [lerClaims]);

  const podeModulo = useCallback(
    (key: string) => isAdmin || (perfil?.modulos?.includes(key) ?? false),
    [isAdmin, perfil],
  );
  const podeAcao = useCallback(
    (key: string) => isAdmin || (perfil?.acoes?.includes(key) ?? false),
    [isAdmin, perfil],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      isAdmin,
      status,
      perfil,
      companyIds,
      loading,
      configured: isFirebaseConfigured,
      podeModulo,
      podeAcao,
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
    [user, role, isAdmin, status, perfil, companyIds, loading, podeModulo, podeAcao, recarregar],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>.");
  return ctx;
}
