"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, SECONDARY_NAV, filtrarPorPermissao } from "@/lib/nav";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand";

/** Sidebar — só no desktop (lg+). No mobile a navegação é a BottomNav. */
export function Sidebar() {
  const pathname = usePathname();
  const { isAdmin, podeModulo } = useAuth();
  const ctx = { isAdmin, podeModulo };
  const principais = filtrarPorPermissao(PRIMARY_NAV, ctx);
  const secundarios = filtrarPorPermissao(SECONDARY_NAV, ctx);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border/60 bg-card lg:block">
      <div className="flex h-14 items-center gap-2 border-b border-border/60 px-4">
        <BrandMark />
      </div>
      <nav className="flex flex-col gap-0.5 overflow-y-auto p-3">
        {principais.map((i) => (
          <NavLink key={i.href} href={i.href} pathname={pathname} icon={i.icon} label={i.label} />
        ))}
        <div className="my-2 h-px bg-border" />
        {secundarios.map((i) => (
          <NavLink key={i.href} href={i.href} pathname={pathname} icon={i.icon} label={i.label} />
        ))}
      </nav>
    </aside>
  );
}

function NavLink({
  href,
  pathname,
  icon: Icon,
  label,
}: {
  href: string;
  pathname: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const ativo = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "press flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-colors duration-200",
        ativo
          ? "bg-primary/12 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className={cn("size-[1.05rem] shrink-0", ativo && "stroke-[2.4]")} />
      {label}
    </Link>
  );
}
