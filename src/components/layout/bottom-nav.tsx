"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, MAIS_ITEM, filtrarPorPermissao } from "@/lib/nav";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";

/** Barra de navegação inferior — só no mobile (escondida em lg+). */
export function BottomNav() {
  const pathname = usePathname();
  const { isAdmin, podeModulo } = useAuth();
  const itens = [...filtrarPorPermissao(PRIMARY_NAV, { isAdmin, podeModulo }), MAIS_ITEM];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur safe-bottom lg:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {itens.map((item) => {
          const ativo =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors",
                  ativo ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("size-5", ativo && "stroke-[2.5]")} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
