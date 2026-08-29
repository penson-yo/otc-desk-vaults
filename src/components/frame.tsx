import { cn } from "@/lib/utils";

export function Frame({
  title,
  action,
  live,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  live?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("pop rounded-xl border border-frame bg-paper-2 p-[5px]", className)}>
      <div className="rounded-[9px] border border-line bg-paper px-3.5 py-3.5">
        {title ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-ink">
              {live ? (
                <span
                  aria-hidden
                  className="lamp h-[6px] w-[6px] shrink-0 rounded-full bg-phos"
                />
              ) : null}
              <span className="truncate">{title}</span>
            </h2>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
