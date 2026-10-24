'use client';

import { useState } from 'react';
import {
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Trash2,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRegionStatus } from '@/hooks/use-region-status';
import { locationFullName, locationSummary } from '@/lib/citizen/geo';
import { HAZARD_NOUN, LEVEL_META, type RegionStatus } from '@/lib/citizen/status';
import type { CitizenLocation, WatchedLocation } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';
import { useLocationPicker } from './citizen-shell';
import { card } from './home-widgets';

const MAX_FAMILY = 5;
const DEFAULT_LABEL_PREFIX = 'Keluarga di ';

/** Indonesian number as typed (0812…, +62 812…, 812…) → 62812… for wa.me. */
export function toWhatsAppNumber(phone: string): string | null {
  let digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return digits.length >= 9 && digits.length <= 15 ? digits : null;
}

function isValidPhone(phone: string) {
  return phone.trim() === '' || toWhatsAppNumber(phone) !== null;
}

function isValidEmail(email: string) {
  return email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

interface ContactDraft {
  label: string;
  phone: string;
  email: string;
}

const EMPTY_DRAFT: ContactDraft = { label: '', phone: '', email: '' };

function isDefaultLabel(label: string) {
  return label.startsWith(DEFAULT_LABEL_PREFIX);
}

function draftOf(item: WatchedLocation): ContactDraft {
  // An auto-generated "Keluarga di …" name is shown as an empty field, so
  // typing a real name doesn't mean deleting placeholder text first.
  return { label: isDefaultLabel(item.label) ? '' : item.label, phone: item.phone ?? '', email: item.email ?? '' };
}

function isValidDraft(draft: ContactDraft) {
  return isValidPhone(draft.phone) && isValidEmail(draft.email);
}

/** Draft → stored fields; blanks become undefined so nothing empty is kept. */
function contactPatch(draft: ContactDraft, area: string) {
  return {
    label: draft.label.trim() || `${DEFAULT_LABEL_PREFIX}${area}`,
    phone: draft.phone.trim() || undefined,
    email: draft.email.trim().toLowerCase() || undefined,
  };
}

function itemKey(item: { districtId: string; villageId: string | null }) {
  return `${item.districtId}-${item.villageId ?? ''}`;
}

function statusLabel(status: RegionStatus) {
  if (status.alert) return status.alert.title;
  const noun = status.hazardType ? ` ${HAZARD_NOUN[status.hazardType]}` : '';
  return `${LEVEL_META[status.level].label}${status.level === 'normal' ? '' : noun}`;
}

function checkInMessage(label: string, area: string, status: RegionStatus | null | undefined) {
  const hello = isDefaultLabel(label) ? 'Halo' : `Halo ${label}`;
  if (!status || status.level === 'normal') {
    return `${hello}, sekadar mengabari: menurut AETHER Siaga, wilayah ${area} saat ini berstatus Normal. Tetap jaga diri ya.`;
  }
  return `${hello}, AETHER Siaga menunjukkan wilayah ${area} berstatus ${statusLabel(status)}. Apakah kamu dan keluarga aman? Kabari aku ya.`;
}

function Field({
  id,
  label,
  icon: Icon,
  error,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; icon: LucideIcon; error?: string | null }) {
  return (
    <div className="grid content-start gap-1">
      <label htmlFor={id} className="text-[13px] font-bold text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id}
          aria-invalid={!!error}
          className={cn(
            'h-11 w-full min-w-0 rounded-xl border bg-card pr-3 pl-9 text-[15px] transition-colors outline-none focus:border-primary focus:ring-3 focus:ring-primary/15',
            error ? 'border-lv-awas' : 'border-border',
          )}
          {...input}
        />
      </div>
      {error && <span className="text-xs font-bold text-lv-awas">{error}</span>}
    </div>
  );
}

/** Name full width; phone + email side by side only when the card itself
 * is wide enough (container query — the card is half-width on desktop). */
function ContactFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: ContactDraft;
  onChange: (value: ContactDraft) => void;
}) {
  return (
    <div className="@container">
      <div className="grid gap-3 @md:grid-cols-2">
        <div className="@md:col-span-2">
          <Field
            id={`${idPrefix}-label`}
            label="Nama"
            icon={UserRound}
            value={value.label}
            onChange={(event) => onChange({ ...value, label: event.target.value })}
            placeholder="Misalnya: Ibu, Kakak"
            maxLength={40}
          />
        </div>
        <Field
          id={`${idPrefix}-phone`}
          label="Nomor HP / WhatsApp"
          icon={Phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value.phone}
          onChange={(event) => onChange({ ...value, phone: event.target.value })}
          placeholder="0812 3456 7890"
          maxLength={20}
          error={isValidPhone(value.phone) ? null : 'Contoh yang benar: 0812 3456 7890'}
        />
        <Field
          id={`${idPrefix}-email`}
          label="Email / Gmail"
          icon={Mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={value.email}
          onChange={(event) => onChange({ ...value, email: event.target.value })}
          placeholder="nama@gmail.com"
          maxLength={80}
          error={isValidEmail(value.email) ? null : 'Contoh yang benar: nama@gmail.com'}
        />
      </div>
    </div>
  );
}

/** The location minus its headline part, e.g. "Kec. Sagulung, Kota Batam". */
function areaDetail(location: CitizenLocation) {
  const full = locationFullName(location);
  const head = `${locationSummary(location)}, `;
  return full.startsWith(head) ? full.slice(head.length) : full;
}

/** "● Normal · Kec. Sagulung, Kota Batam" — status first, then where. */
function StatusLine({
  status,
  isLoading,
  detail,
}: {
  status: RegionStatus | null | undefined;
  isLoading: boolean;
  detail: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs">
      {isLoading || !status ? (
        <Skeleton className="h-3.5 w-14 rounded-full" />
      ) : (
        <span className={cn('inline-flex shrink-0 items-center gap-1 font-extrabold', LEVEL_META[status.level].text)}>
          <span className={cn('h-2 w-2 rounded-full', LEVEL_META[status.level].solid)} aria-hidden />
          {statusLabel(status)}
        </span>
      )}
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="truncate text-muted-foreground">{detail}</span>
    </span>
  );
}

function OwnRow({ location }: { location: CitizenLocation }) {
  const { status, isLoading } = useRegionStatus(location);
  return (
    <li className="flex items-center gap-3 bg-accent/40 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-cyan text-white">
        <MapPin className="h-5 w-5" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-extrabold">{locationSummary(location)}</span>
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-black tracking-wide text-primary-foreground uppercase">
            Anda
          </span>
        </span>
        <StatusLine status={status} isLoading={isLoading} detail={areaDetail(location)} />
      </span>
    </li>
  );
}

const iconAction =
  'grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform hover:-translate-y-0.5';

function FamilyRow({
  item,
  editing,
  onEdit,
  onDone,
}: {
  item: WatchedLocation;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const { status, isLoading } = useRegionStatus(item);
  const removeWatched = useCitizenStore((state) => state.removeWatched);
  const updateWatched = useCitizenStore((state) => state.updateWatched);
  const addWatched = useCitizenStore((state) => state.addWatched);
  const { openPicker } = useLocationPicker();
  const [draft, setDraft] = useState<ContactDraft>(() => draftOf(item));

  const wa = item.phone ? toWhatsAppNumber(item.phone) : null;
  const area = locationSummary(item);
  const urgent = !!status && status.level !== 'normal';
  const message = checkInMessage(item.label, area, status);
  const valid = isValidDraft(draft);
  const initial = isDefaultLabel(item.label) ? null : item.label.trim().charAt(0).toUpperCase();

  const startEdit = () => {
    setDraft(draftOf(item));
    onEdit();
  };

  const save = () => {
    if (!valid) return;
    updateWatched(item.districtId, item.villageId, contactPatch(draft, area));
    onDone();
  };

  // Wrong area picked: swap the location, keep the (edited) contact details.
  const changeArea = () =>
    openPicker({
      title: 'Ganti wilayah keluarga',
      onPicked: (picked) => {
        removeWatched(item.districtId, item.villageId);
        addWatched({ ...picked, ...contactPatch(draft, locationSummary(picked)) });
        onDone();
      },
    });

  const custom = !isDefaultLabel(item.label);

  return (
    <li
      className={cn(
        'grid gap-3 p-3 transition-colors',
        editing ? 'bg-accent/30' : urgent && 'bg-lv-siaga-soft/40',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-black',
            status ? cn(LEVEL_META[status.level].soft, LEVEL_META[status.level].text) : 'bg-muted text-muted-foreground',
          )}
          aria-hidden
        >
          {initial || <Users className="h-5 w-5" />}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-extrabold">{custom ? item.label : area}</span>
          <StatusLine
            status={status}
            isLoading={isLoading}
            detail={custom ? locationFullName(item) : areaDetail(item)}
          />
        </span>
        {!editing && (
          <span className="flex shrink-0 items-center gap-1.5">
            {wa && (
              <a
                href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp ${item.label}`}
                title={urgent ? 'Tanya kabar lewat WhatsApp' : 'WhatsApp'}
                className={cn(
                  iconAction,
                  urgent
                    ? 'bg-[#25d366] text-[#0b3d1f] shadow-[0_8px_18px_-10px_#25d366]'
                    : 'bg-[#25d366]/15 text-[#128c4a] dark:text-[#5fe39a]',
                )}
              >
                <MessageCircle className="h-4 w-4" />
              </a>
            )}
            {wa && (
              <a href={`tel:+${wa}`} aria-label={`Telepon ${item.label}`} title="Telepon" className={cn(iconAction, 'bg-accent text-primary')}>
                <Phone className="h-4 w-4" />
              </a>
            )}
            {item.email && (
              <a
                href={`mailto:${item.email}?subject=${encodeURIComponent(`Kabar wilayah ${area}`)}&body=${encodeURIComponent(message)}`}
                aria-label={`Email ${item.label}`}
                title="Email"
                className={cn(iconAction, 'bg-muted text-foreground')}
              >
                <Mail className="h-4 w-4" />
              </a>
            )}
            {!wa && !item.email ? (
              <button
                type="button"
                onClick={startEdit}
                className="inline-flex h-9 items-center gap-1 rounded-xl bg-accent px-2.5 text-xs font-extrabold text-primary transition-colors hover:bg-accent/70"
              >
                <Plus className="h-3.5 w-3.5" /> Kontak
              </button>
            ) : (
              <button
                type="button"
                onClick={startEdit}
                aria-label={`Ubah ${item.label}`}
                title="Ubah"
                className={cn(iconAction, 'text-muted-foreground hover:bg-accent hover:text-foreground')}
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </span>
        )}
      </div>

      {editing ? (
        <div className="grid gap-4 border-t border-border/60 pt-3">
          <ContactFields idPrefix={`family-${itemKey(item)}`} value={draft} onChange={setDraft} />

          <div className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
            <MapPin className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-muted-foreground">Wilayah</span>
              <span className="block truncate text-sm font-extrabold">{locationFullName(item)}</span>
            </span>
            <button
              type="button"
              onClick={changeArea}
              disabled={!valid}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-extrabold text-primary hover:bg-accent disabled:opacity-50"
            >
              Ganti
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => removeWatched(item.districtId, item.villageId)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-extrabold text-lv-awas hover:bg-lv-awas-soft"
            >
              <Trash2 className="h-4 w-4" /> Hapus
            </button>
            <button
              type="button"
              onClick={onDone}
              className="ml-auto h-10 rounded-xl px-4 text-sm font-extrabold text-muted-foreground hover:bg-accent"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!valid}
              className="h-10 rounded-xl bg-primary px-5 text-sm font-extrabold text-primary-foreground disabled:opacity-50"
            >
              Simpan
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The citizen's own area plus up to five family areas, each with an
 * optional phone number and email for a one-tap call, WhatsApp or email
 * check-in. All of it stays in this browser — nothing about family members
 * reaches the server. Only one form (add or a row's edit) is open at a time.
 */
export function FamilyAreas() {
  const location = useCitizenStore((state) => state.location);
  const watched = useCitizenStore((state) => state.watched);
  const addWatched = useCitizenStore((state) => state.addWatched);
  const { openPicker } = useLocationPicker();
  // null = nothing open, 'new' = the add form, otherwise the row being edited.
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);

  const startAdd = () => {
    setDraft(EMPTY_DRAFT);
    setOpen('new');
  };

  const add = () => {
    if (!isValidDraft(draft)) return;
    openPicker({
      title: 'Wilayah keluarga',
      onPicked: (picked) => {
        addWatched({ ...picked, ...contactPatch(draft, locationSummary(picked)) });
        setDraft(EMPTY_DRAFT);
        setOpen(null);
      },
    });
  };

  return (
    <section id="keluarga" className={cn(card, 'grid scroll-mt-24 gap-4')}>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-primary/25 text-primary">
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-tight font-black">Keluarga yang Anda pantau</h2>
          <p className="text-sm text-muted-foreground">Kabari keluarga dengan satu ketukan.</p>
        </div>
        {watched.length > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-extrabold text-accent-foreground">
            {watched.length}/{MAX_FAMILY}
          </span>
        )}
      </div>

      {(location || watched.length > 0) && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-background">
          {location && <OwnRow location={location} />}
          {watched.map((item) => (
            <FamilyRow
              key={itemKey(item)}
              item={item}
              editing={open === itemKey(item)}
              onEdit={() => setOpen(itemKey(item))}
              onDone={() => setOpen(null)}
            />
          ))}
        </ul>
      )}

      {watched.length >= MAX_FAMILY ? (
        <p className="text-sm text-muted-foreground">
          Maksimal {MAX_FAMILY} wilayah keluarga. Hapus salah satu untuk menambah yang baru.
        </p>
      ) : open === 'new' ? (
        <div className="grid gap-4 rounded-2xl border border-primary/40 bg-accent/30 p-3">
          <div>
            <p className="font-extrabold">Tambah keluarga</p>
            <p className="text-xs text-muted-foreground">Semua kolom boleh dikosongkan. Wilayahnya dipilih di langkah berikutnya.</p>
          </div>
          <ContactFields idPrefix="family-new" value={draft} onChange={setDraft} />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="h-10 rounded-xl px-4 text-sm font-extrabold text-muted-foreground hover:bg-accent"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={add}
              disabled={!isValidDraft(draft)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-extrabold text-primary-foreground disabled:opacity-50"
            >
              <MapPin className="h-4 w-4" /> Pilih wilayah
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startAdd}
          className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/40 font-extrabold text-primary transition-colors hover:border-primary hover:bg-accent"
        >
          <Plus className="h-4 w-4" /> Tambah keluarga
        </button>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0" /> Nomor dan email keluarga hanya disimpan di perangkat ini.
      </p>
    </section>
  );
}
