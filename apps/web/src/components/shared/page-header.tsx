import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** Small uppercase label above the title, e.g. "Experimental". */
  eyebrow?: string;
  /** Right-aligned controls: primary action, filters. */
  actions?: React.ReactNode;
  /** Extra row under the description (status lines, meta). */
  children?: React.ReactNode;
  className?: string;
}

// One header shape for every workspace page, so pages differ in content
// rather than in how their title, description and actions are laid out.
export function PageHeader({ title, description, icon: Icon, eyebrow, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="flex min-w-0 items-start gap-3.5">
        {Icon && (
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 space-y-1">
          {eyebrow && <p className="text-[11px] font-semibold tracking-widest text-primary uppercase">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <div className="max-w-3xl text-sm text-muted-foreground">{description}</div>}
          {children}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-end gap-3">{actions}</div>}
    </header>
  );
}
