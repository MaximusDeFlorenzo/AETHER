import Image from 'next/image';
import { cn } from '@/lib/utils';

/** The AETHER mark (blue/teal ribbon "A", transparent PNG). */
export function BrandMark({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      width={256}
      height={186}
      priority={priority}
      unoptimized
      className={cn('h-7 w-auto', className)}
    />
  );
}

/** Mark + "AETHER" wordmark. The text takes `currentColor`, so it reads on
 * light, dark and navy surfaces alike. */
export function BrandLogo({
  className,
  markClassName,
  priority,
}: {
  className?: string;
  markClassName?: string;
  priority?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark className={markClassName} priority={priority} />
      <span className="text-lg font-bold tracking-[0.12em]">AETHER</span>
    </span>
  );
}
