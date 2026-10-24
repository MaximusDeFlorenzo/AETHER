import { cn } from '@/lib/utils';

export function PageContainer({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('citizen-rise mx-auto w-full max-w-[1440px] px-4 pt-5 sm:px-6 sm:pt-8 lg:px-8 2xl:px-10', className)}>{children}</div>;
}

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-7">
      <div className="grid gap-1.5">
        <span aria-hidden className="h-1.5 w-10 rounded-full bg-gradient-to-r from-primary to-cyan" />
        <h1 className="text-2xl font-black tracking-tight text-balance sm:text-3xl">{title}</h1>
        {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-black sm:text-xl">
        <span aria-hidden className="h-5 w-1.5 rounded-full bg-gradient-to-b from-primary to-cyan" />
        {children}
      </h2>
      {action}
    </div>
  );
}
