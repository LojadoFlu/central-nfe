"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, SECONDARY_NAV, filtrarPorRole } from "@/lib/nav";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";

/** Sidebar — só no desktop (lg+). No mobile a navegação é a BottomNav. */
export function Sidebar() {
  const pathname = usePathname();
  const { role } = useAuth();
  const principais = filtrarPorRole(PRIMARY_NAV, role);
  const secundarios = filtrarPorRole(SECONDARY_NAV, role);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="text-lg font-bold tracking-tight">Central NF-e</span>
      </div>
      <nav className="flex flex-col gap-1 p-3">
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
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        ativo
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </Link>
  );
}
