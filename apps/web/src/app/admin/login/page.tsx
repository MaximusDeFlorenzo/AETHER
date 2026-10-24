'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CloudRain,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Map as MapIcon,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { BrandLogo } from '@/components/shared/brand-logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const HIGHLIGHTS = [
  { icon: MapIcon, text: 'Live hazard map and district risk assessments' },
  { icon: CloudRain, text: 'Rainfall outlook for flood and landslide hazard' },
  { icon: Truck, text: 'Shelters, resources and response planning' },
];

// WebGL-only and ~60 KB, so it loads after the form instead of blocking it.
const Topography = dynamic(() => import('@/components/shared/topography'), { ssr: false });

export default function AdminLoginPage() {
  const router = useRouter();
  const { hasHydrated, accessToken } = useAuthStore();
  const login = useLogin();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  // Signed-in staff land on the analyst workspace (the original AETHER
  // view), not the citizen portal that now lives at `/`.
  useEffect(() => {
    if (hasHydrated && accessToken) {
      router.replace('/risk-map');
    }
  }, [hasHydrated, accessToken, router]);

  const onSubmit = (values: LoginFormValues) => {
    login.mutate(values, {
      onSuccess: () => router.replace('/risk-map'),
    });
  };

  return (
    <div className="grid min-h-svh flex-1 bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-[oklch(0.22_0.06_255)] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        {/* Soft radial glow + animated contour terrain: a map-room backdrop, no imagery to load. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <Topography mouseInteraction={false} />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-[oklch(0.68_0.15_255)] opacity-30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 h-[24rem] w-[24rem] rounded-full bg-[oklch(0.7_0.14_200)] opacity-20 blur-3xl"
        />

        <BrandLogo priority markClassName="h-10" className="relative self-start text-white [&>span]:text-2xl" />

        <div className="relative grid max-w-md gap-6">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance xl:text-5xl">
            Disaster intelligence for Indonesia.
          </h1>
          <p className="text-base leading-relaxed text-white/70">
            Earthquakes, floods, landslides and wildfires in one workspace, with risk assessments, rainfall outlooks and
            resource planning for analysts and agency staff.
          </p>
          <ul className="grid gap-3 text-sm text-white/80">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">Data: BMKG · BNPB InaRISK · NASA FIRMS · JAXA GSMaP</p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="grid w-full max-w-sm gap-8">
          <div className="grid gap-6">
            <BrandLogo markClassName="h-10" className="text-foreground lg:hidden [&>span]:text-2xl" />
            <div className="grid gap-2">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <ShieldCheck className="h-3.5 w-3.5" /> Staff access
              </span>
              <h2 className="text-2xl font-semibold tracking-tight">Sign in to AETHER</h2>
              <p className="text-sm text-muted-foreground">Restricted area for analysts and agency staff.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@agency.go.id"
                  className="h-11 pl-9"
                  aria-invalid={!!errors.email}
                  {...register('email')}
                />
              </div>
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="h-11 pr-11 pl-9"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 right-1.5 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>

            {login.isError && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>Incorrect email or password.</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="h-11 w-full text-base" disabled={login.isPending}>
              {login.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {login.isPending ? 'Signing in…' : 'Sign in'}
              {!login.isPending && <ArrowRight className="ml-1 h-4 w-4" />}
            </Button>
          </form>

          <div className="grid gap-3 border-t border-border/60 pt-6 text-sm text-muted-foreground">
            <p>Accounts are issued by your AETHER administrator.</p>
            <Link href="/" className="inline-flex w-fit items-center gap-1 font-medium text-primary hover:underline">
              <ArrowLeft className="h-4 w-4" /> Back to AETHER Siaga (public portal)
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
