import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { BottomNav } from "./bottom-nav";

/** Estrutura da área logada: sidebar (desktop) + topbar + conteúdo + bottom-nav (mobile). */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {/* pb extra no mobile para o conteúdo não ficar sob a bottom-nav */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 lg:pb-8">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
