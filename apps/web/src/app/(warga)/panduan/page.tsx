'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Check, ClipboardList, HeartHandshake, HeartPulse, Info, Siren, TriangleAlert, X } from 'lucide-react';
import { useLocationPicker } from '@/components/citizen/citizen-shell';
import { card } from '@/components/citizen/home-widgets';
import { HazardIcon } from '@/components/citizen/hazard-icon';
import { PageContainer, PageHeading } from '@/components/citizen/page-container';
import { GUIDE_ORDER, GUIDES, isGuideKey, MASK_GUIDE, type GuideKey } from '@/lib/citizen/guides';
import { cn } from '@/lib/utils';

// One color family per phase: a tinted header, a solid icon chip and
// step numbers ringed in the same hue, joined by a timeline rail.
const PHASES = [
  {
    key: 'before',
    label: 'Sebelum',
    tagline: 'Bersiap',
    icon: ClipboardList,
    header: 'bg-accent',
    chip: 'bg-primary text-primary-foreground',
    num: 'border-primary/40 text-primary',
  },
  {
    key: 'during',
    label: 'Saat',
    tagline: 'Selamatkan diri',
    icon: Siren,
    header: 'bg-lv-siaga-soft',
    chip: 'bg-lv-siaga text-white dark:text-background',
    num: 'border-lv-siaga/50 text-lv-siaga',
  },
  {
    key: 'after',
    label: 'Setelah',
    tagline: 'Pulih dengan aman',
    icon: HeartHandshake,
    header: 'bg-lv-normal-soft',
    chip: 'bg-lv-normal text-white dark:text-background',
    num: 'border-lv-normal/50 text-lv-normal',
  },
] as const;

function MaskIllustration() {
  return (
    <svg viewBox="0 0 220 120" className="mx-auto h-auto w-full max-w-[240px]" role="img" aria-label="Cara memasang masker: tekan penjepit logam di hidung">
      <ellipse cx="110" cy="64" rx="64" ry="54" className="fill-muted" />
      <path d="M58 54c30-16 74-16 104 0v20c0 22-24 38-52 38S58 96 58 74z" className="fill-card stroke-border" strokeWidth="3" />
      <path d="M92 46c10-6 26-6 36 0" className="stroke-lv-normal" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M58 60L22 42M162 60l36-18M62 88L26 102M158 88l36 14" className="stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" />
      <text x="110" y="24" textAnchor="middle" className="fill-lv-normal" fontSize="12" fontWeight="800">
        tekan penjepit hidung
      </text>
    </svg>
  );
}

function MaskGuide() {
  const icons = {
    good: { icon: Check, tone: 'bg-lv-normal-soft', dot: 'bg-lv-normal' },
    partial: { icon: TriangleAlert, tone: 'bg-lv-waspada-soft', dot: 'bg-lv-waspada' },
    bad: { icon: X, tone: 'bg-lv-awas-soft', dot: 'bg-lv-awas' },
  };
  return (
    <section id="masker" className={cn(card, 'grid gap-5 lg:grid-cols-2 lg:gap-8')}>
      <div className="grid content-start gap-3">
        <h2 className="text-xl font-black">Masker yang tepat untuk asap</h2>
        {MASK_GUIDE.options.map((option) => {
          const style = icons[option.verdict];
          return (
            <div key={option.name} className={cn('flex gap-3 rounded-2xl p-3', style.tone)}>
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-white dark:text-background', style.dot)}>
                <style.icon className="h-4 w-4" strokeWidth={3} />
              </span>
              <span>
                <span className="block font-black">{option.name}</span>
                <span className="text-sm">{option.text}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="grid content-start gap-3">
        <MaskIllustration />
        <h3 className="text-lg font-black">Cara memakai N95 dengan benar</h3>
        <ol className="grid gap-2">
          {MASK_GUIDE.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-[15px]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-black text-primary">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <p className="flex gap-2 rounded-2xl bg-lv-waspada-soft p-3 text-sm font-bold">
          <HeartPulse className="mt-0.5 h-4 w-4 shrink-0 text-lv-waspada" /> {MASK_GUIDE.caution}
        </p>
      </div>
    </section>
  );
}

function GuideContent() {
  const params = useSearchParams();
  const requested = params.get('jenis');
  const active: GuideKey = isGuideKey(requested) ? requested : 'banjir';
  const guide = GUIDES[active];

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
      <nav
        aria-label="Jenis bencana"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:sticky lg:top-24 lg:grid-cols-1"
      >
        {GUIDE_ORDER.map((key) => (
          <Link
            key={key}
            href={`/panduan?jenis=${key}`}
            scroll={false}
            aria-current={key === active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-2xl border px-4 py-3 font-extrabold transition-all',
              key === active
                ? 'border-transparent bg-gradient-to-r from-primary to-navy text-primary-foreground shadow-[0_10px_24px_-12px_var(--primary)]'
                : 'border-border/60 bg-card/90 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent',
            )}
          >
            <HazardIcon guide={key} className="h-5 w-5" />
            {GUIDES[key].label}
          </Link>
        ))}
      </nav>

      <div className="grid min-w-0 gap-5">
        {guide.note && (
          <p
            className={cn(
              'flex gap-3 rounded-3xl p-4 sm:p-5',
              guide.note.tone === 'warning' ? 'bg-lv-waspada-soft' : 'bg-accent',
            )}
          >
            <Info className={cn('mt-0.5 h-5 w-5 shrink-0', guide.note.tone === 'warning' ? 'text-lv-waspada' : 'text-primary')} />
            <span>
              <strong className="block">{guide.note.title}</strong>
              {guide.note.text}
            </span>
          </p>
        )}

        {active === 'asap' && <MaskGuide />}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PHASES.map((phase) => {
            const steps = guide[phase.key];
            return (
              <section key={phase.key} className={cn(card, 'flex flex-col overflow-hidden p-0')}>
                <header className={cn('flex items-center gap-3 px-5 py-4', phase.header)}>
                  <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl shadow-sm', phase.chip)}>
                    <phase.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-extrabold tracking-wide text-foreground/70 uppercase">
                      {phase.tagline}
                    </span>
                    <span className="block text-lg leading-tight font-black">
                      {phase.label} {guide.noun}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-card/80 px-2.5 py-1 text-xs font-extrabold text-foreground/70">
                    {steps.length} langkah
                  </span>
                </header>
                <ol className="grid px-5 py-4">
                  {steps.map((tip, index) => (
                    <li
                      key={tip}
                      className="relative flex gap-3 pb-4 text-[15px] leading-snug last:pb-0 before:absolute before:top-8 before:bottom-1 before:left-[13px] before:w-0.5 before:rounded-full before:bg-border last:before:hidden"
                    >
                      <span
                        className={cn(
                          'relative grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 bg-card text-xs font-black',
                          phase.num,
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="pt-0.5">{tip}</span>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ReplayIntro() {
  const { openIntro } = useLocationPicker();
  return (
    <div className={cn(card, 'mt-8 flex flex-wrap items-center justify-between gap-3')}>
      <p className="text-sm text-muted-foreground">Ingin melihat lagi penjelasan singkat cara kerja AETHER Siaga?</p>
      <button
        type="button"
        onClick={openIntro}
        className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-extrabold hover:bg-accent"
      >
        Lihat pengenalan aplikasi
      </button>
    </div>
  );
}

export default function GuidePage() {
  return (
    <PageContainer>
      <PageHeading
        title="Panduan keselamatan"
        description="Apa yang dilakukan sebelum, saat, dan setelah bencana. Bisa dibaca kapan saja, termasuk saat sinyal lemah."
      />
      <Suspense fallback={null}>
        <GuideContent />
      </Suspense>
      <ReplayIntro />
    </PageContainer>
  );
}
