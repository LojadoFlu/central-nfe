import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.6rem] font-bold leading-[1.1] tracking-[-0.021em] text-balance sm:text-[2rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-prose text-[0.95rem] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
