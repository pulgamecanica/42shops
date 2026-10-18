"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Plus, Search, Star, X } from "lucide-react";
import type { Campus, Product, ProductStatus } from "@/lib/types";
import { countryCode } from "@/lib/countries";
import { campusCity, cn, formatAge, formatNumber, normalize } from "@/lib/utils";
import type { Item } from "./all-shops-view";
import { Segmented } from "./controls";
import { PixelArt } from "./pixel-art";
import { Price, ProductImage } from "./product";
import { useDismiss } from "./use-dismiss";

/** A compared shop: one campus ("campus:12") or every campus of a country ("country:France"). */
export type Slot = string;

const ACCENTS = [
  { box: "bg-blue text-white", soft: "bg-white/15", dot: "bg-blue" },
  { box: "bg-sticky text-ink", soft: "bg-black/10", dot: "bg-sticky" },
  { box: "bg-ink text-white", soft: "bg-white/15", dot: "bg-ink" },
  { box: "bg-heart text-white", soft: "bg-white/15", dot: "bg-heart" },
];

export const STATUS_TEXT: Record<ProductStatus, string> = {
  available: "In stock",
  soldout: "Sold out",
  upcoming: "Soon",
  ended: "Ended",
};

const slotValue = (slot: Slot) => slot.slice(slot.indexOf(":") + 1);
const inSlot = (slot: Slot, c: Campus) =>
  slot.startsWith("campus:") ? String(c.id) === slotValue(slot) : c.country === slotValue(slot);

export const slotCampuses = (slot: Slot, campuses: Campus[]) => campuses.filter((c) => inSlot(slot, c));
export const slotMatches = (slot: Slot, item: Item) => item.campuses.some((c) => inSlot(slot, c));

export function slotLabel(slot: Slot, campuses: Campus[]) {
  const value = slotValue(slot);
  if (slot.startsWith("country:")) {
    const n = slotCampuses(slot, campuses).length;
    return { name: value, code: countryCode(value), sub: `${n} ${n === 1 ? "campus" : "campuses"}`, kind: "Country" };
  }
  const c = campuses.find((x) => String(x.id) === value);
  return {
    name: c?.name ?? "Unknown",
    code: c ? countryCode(c.country) : "··",
    sub: c ? [campusCity(c), c.country].filter(Boolean).join(", ") : "",
    kind: "Campus",
  };
}

// ---------------------------------------------------------------------------
// Picker: chips for the chosen shops, plus a popover to add one
// ---------------------------------------------------------------------------
export function ComparePicker({
  campuses,
  loaded,
  slots,
  max,
  onChange,
}: {
  campuses: Campus[];
  loaded: Record<number, Product[]>;
  slots: Slot[];
  max: number;
  onChange: (slots: Slot[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"campus" | "country">("campus");
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const options = useMemo(() => {
    const q = normalize(query.trim());
    if (mode === "country") {
      const countries = [...new Set(campuses.map((c) => c.country))].sort((a, b) => a.localeCompare(b));
      return countries
        .filter((c) => !q || normalize(c).includes(q))
        .map((c) => {
          const n = campuses.filter((x) => x.country === c).length;
          return {
            slot: `country:${c}`,
            code: countryCode(c),
            name: c,
            sub: `${n} ${n === 1 ? "campus" : "campuses"}`,
          };
        });
    }
    return campuses
      .filter((c) => !q || normalize(`${c.name} ${c.city} ${c.country}`).includes(q))
      .map((c) => ({
        slot: `campus:${c.id}`,
        code: countryCode(c.country),
        name: c.name,
        sub: loaded[c.id] ? `${loaded[c.id].length} items` : c.country,
      }));
  }, [campuses, loaded, mode, query]);

  const full = slots.length >= max;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {slots.map((slot, i) => {
          const l = slotLabel(slot, campuses);
          return (
            <motion.span
              key={slot}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-full pl-2 pr-1.5 text-sm font-medium",
                ACCENTS[i % ACCENTS.length].box,
                i >= max && "opacity-40", // past the limit, e.g. after shrinking to a phone
              )}
            >
              <span
                className={cn(
                  "rounded-[5px] px-1 py-0.5 font-pixel text-[10px] leading-none",
                  ACCENTS[i % ACCENTS.length].soft,
                )}
              >
                {l.code}
              </span>
              <span className="max-w-40 truncate">{l.name}</span>
              <button
                onClick={() => onChange(slots.filter((s) => s !== slot))}
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-black/20",
                  ACCENTS[i % ACCENTS.length].soft,
                )}
                aria-label={`Stop comparing ${l.name}`}
              >
                <X size={12} />
              </button>
            </motion.span>
          );
        })}
      </AnimatePresence>

      <div ref={ref} className="relative">
        <motion.button
          whileTap={{ scale: 0.96 }}
          disabled={full}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex h-10 items-center gap-1.5 rounded-full border border-dashed border-ink/40 bg-white px-4 text-sm transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={14} />
          {full ? `${max} shops max${max === 2 ? " on a phone" : ""}` : "Add a shop"}
        </motion.button>

        <AnimatePresence>
          {open ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.12 } }}
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
              style={{ transformOrigin: "top left" }}
              className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(20rem,calc(100vw-2.5rem))] rounded-2xl border border-line bg-white p-2 shadow-[0_20px_40px_-16px_rgba(0,0,0,0.25)]"
            >
              <Segmented
                id="compare-mode"
                label="Pick shops by"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "campus", label: "By campus" },
                  { value: "country", label: "By country" },
                ]}
              />
              <label className="mt-2 flex items-center gap-2 rounded-xl border border-line px-3 focus-within:border-blue">
                <Search size={14} className="text-muted" aria-hidden />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={mode === "campus" ? "Campus, city or country" : "Country"}
                  className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted/80"
                  aria-label="Search shops"
                />
              </label>
              <ul className="mt-2 max-h-72 overflow-y-auto">
                {options.map((o) => {
                  const chosen = slots.includes(o.slot);
                  return (
                    <li key={o.slot}>
                      <button
                        disabled={chosen}
                        onClick={() => {
                          onChange([...slots, o.slot]);
                          setQuery("");
                          setOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-wash disabled:opacity-50"
                      >
                        <span className="inline-grid h-6 min-w-6 place-items-center rounded-[5px] bg-ink px-1 font-pixel text-[10px] leading-none text-white">
                          {o.code}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{o.name}</span>
                          <span className="block truncate text-xs text-muted">{o.sub}</span>
                        </span>
                        {chosen ? <Check size={14} className="text-blue" /> : null}
                      </button>
                    </li>
                  );
                })}
                {options.length === 0 ? <li className="px-3 py-4 text-center text-sm text-muted">No match</li> : null}
              </ul>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board: one column per shop, side by side
// ---------------------------------------------------------------------------
export type Stats = {
  items: number;
  inStock: number;
  inBudget: number;
  cheapest: number | null;
  median: number | null;
  newest: number | null;
};

const BEST: Record<keyof Stats, "max" | "min"> = {
  items: "max",
  inStock: "max",
  inBudget: "max",
  cheapest: "min",
  median: "min",
  newest: "min",
};

/** The best value of each stat across shops, or null when there is nothing to compare against. */
export function bestStats(all: Stats[]): Record<keyof Stats, number | null> {
  const out = {} as Record<keyof Stats, number | null>;
  for (const key of Object.keys(BEST) as Array<keyof Stats>) {
    const values = all.flatMap((s) => (s[key] === null ? [] : [s[key]!]));
    out[key] = all.length < 2 || !values.length ? null : BEST[key] === "max" ? Math.max(...values) : Math.min(...values);
  }
  return out;
}

export function statsOf(items: Item[], wallet: number): Stats {
  const stock = items.filter((i) => i.status === "available");
  const prices = stock.map((i) => i.price).sort((a, b) => a - b);
  const ages = items.flatMap((i) => (i.age === null ? [] : [i.age]));
  return {
    items: items.length,
    inStock: stock.length,
    inBudget: stock.filter((i) => i.price <= wallet).length,
    cheapest: prices.length ? prices[0] : null,
    median: prices.length ? prices[Math.floor(prices.length / 2)] : null,
    newest: ages.length ? Math.min(...ages) : null,
  };
}

function Stat({ label, best, children }: { label: string; best: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line py-1.5 text-xs last:border-0 sm:text-[13px]">
      <dt className="truncate text-muted">{label}</dt>
      <dd className={cn("flex shrink-0 items-center gap-1 tabular", best && "font-medium text-blue")}>
        {best ? <Star size={11} className="fill-current" aria-label="Best" /> : null}
        {children}
      </dd>
    </div>
  );
}

function CompactRow({ item, shared, onOpen }: { item: Item; shared: number; onOpen: () => void }) {
  const dimmed = item.status === "soldout" || item.status === "ended";
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-start gap-2 rounded-2xl p-1.5 text-left transition-colors hover:bg-wash sm:items-center sm:gap-2.5"
    >
      <span
        className={cn(
          "relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-wash p-1 sm:h-12 sm:w-12 sm:p-1.5",
          dimmed && "opacity-45 grayscale",
        )}
      >
        <ProductImage src={item.image} alt="" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("line-clamp-2 text-xs font-medium leading-snug sm:text-[13px]", dimmed && "text-muted")}>
          {item.name}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted sm:mt-0.5">
          <span
            title={STATUS_TEXT[item.status]}
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              item.status === "available" ? "bg-go" : item.status === "upcoming" ? "bg-blue" : "bg-muted",
            )}
          />
          {/* Phones: price sits here, under the name, instead of in its own column. */}
          <Price value={item.price} className="text-[10px] text-ink sm:hidden" />
          <span className="hidden sm:inline">{STATUS_TEXT[item.status]}</span>
          {item.age !== null ? <span className="hidden sm:inline">· {formatAge(item.age)}</span> : null}
          {shared > 1 ? (
            <span className="rounded-full bg-blue-wash px-1.5 font-medium text-blue">in {shared}</span>
          ) : null}
        </span>
      </span>
      <Price value={item.price} className="hidden shrink-0 self-start pt-1 text-[12px] sm:block" />
    </button>
  );
}

export function CompareBoard({
  slots,
  campuses,
  loaded,
  all,
  visible,
  wallet,
  max,
  onOpen,
}: {
  slots: Slot[];
  campuses: Campus[];
  loaded: Record<number, Product[]>;
  /** Every loaded item, for the stats. */
  all: Item[];
  /** Items after search, status, flags and sort, for the lists. */
  visible: Item[];
  wallet: number;
  max: number;
  onOpen: (id: number) => void;
}) {
  const shown = useMemo(() => slots.slice(0, max), [slots, max]);

  const columns = useMemo(
    () =>
      shown.map((slot) => ({
        slot,
        label: slotLabel(slot, campuses),
        ready: slotCampuses(slot, campuses).every((c) => loaded[c.id]),
        stats: statsOf(
          all.filter((i) => slotMatches(slot, i)),
          wallet,
        ),
        list: visible.filter((i) => slotMatches(slot, i)),
      })),
    [shown, campuses, loaded, all, visible, wallet],
  );

  // Star the best value of each stat, only when there is something to compare against.
  const best = useMemo(() => bestStats(columns.map((c) => c.stats)), [columns]);
  const isBest = (key: keyof Stats, v: number | null) => v !== null && v === best[key];

  if (!shown.length) {
    return (
      <div className="grid place-items-center rounded-[22px] border-2 border-dashed border-line px-6 py-20 text-center">
        <PixelArt sprite="star" scale={5} />
        <p className="mt-5 font-display text-3xl">Pick shops to compare</p>
        <p className="mt-2 max-w-sm text-sm text-muted">
          Add up to {max} campuses or whole countries with <span className="font-medium text-ink">Add a shop</span>, and
          they line up side by side.
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid gap-2.5 sm:gap-4"
      style={{ gridTemplateColumns: `repeat(${Math.min(shown.length + 1, max)}, minmax(0, 1fr))` }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {columns.map((col, i) => {
          const accent = ACCENTS[i % ACCENTS.length];
          return (
            <motion.section
              key={col.slot}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 380, damping: 34, delay: i * 0.04 }}
              className="flex min-w-0 flex-col rounded-[22px] border border-line bg-white p-1.5 sm:p-2"
              aria-label={`${col.label.name} shop`}
            >
              <header className={cn("rounded-2xl p-3 sm:p-4", accent.box)}>
                <p className="flex items-center gap-1.5 text-[11px] opacity-80">
                  <span className={cn("rounded-[4px] px-1 py-0.5 font-pixel text-[9px] leading-none", accent.soft)}>
                    {col.label.code}
                  </span>
                  {col.label.kind}
                </p>
                <h2 className="mt-1.5 truncate pb-0.5 font-display text-2xl leading-[1.1] sm:text-[2rem]">
                  {col.label.name}
                </h2>
                <p className="truncate text-[11px] opacity-75 sm:text-xs">{col.label.sub}</p>
              </header>

              <dl className="px-2 pt-2 sm:px-2.5">
                <Stat label="Items" best={isBest("items", col.stats.items)}>
                  {formatNumber(col.stats.items)}
                </Stat>
                <Stat label="In stock" best={isBest("inStock", col.stats.inStock)}>
                  {formatNumber(col.stats.inStock)}
                </Stat>
                <Stat label="In your budget" best={isBest("inBudget", col.stats.inBudget)}>
                  {formatNumber(col.stats.inBudget)}
                </Stat>
                <Stat label="Cheapest" best={isBest("cheapest", col.stats.cheapest)}>
                  {col.stats.cheapest === null ? "–" : <Price value={col.stats.cheapest} className="text-[11px]" />}
                </Stat>
                <Stat label="Median price" best={isBest("median", col.stats.median)}>
                  {col.stats.median === null ? "–" : <Price value={col.stats.median} className="text-[11px]" />}
                </Stat>
                <Stat label="Newest" best={isBest("newest", col.stats.newest)}>
                  {col.stats.newest === null
                    ? "–"
                    : col.stats.newest < 1
                      ? "today"
                      : `${formatAge(col.stats.newest)} ago`}
                </Stat>
              </dl>

              <div className="mt-2 flex items-center justify-between px-2 pb-1 text-[11px] text-muted sm:px-2.5">
                <span className="tabular">
                  {formatNumber(col.list.length)} {col.list.length === 1 ? "match" : "matches"}
                </span>
                <span className={cn("h-1.5 w-6 rounded-full", accent.dot)} aria-hidden />
              </div>

              <div className="no-scrollbar max-h-[70vh] min-h-40 overflow-y-auto">
                {!col.ready && col.list.length === 0 ? (
                  Array.from({ length: 4 }).map((_, k) => <div key={k} className="skeleton m-1.5 h-14 rounded-2xl" />)
                ) : col.list.length === 0 ? (
                  <p className="px-3 py-10 text-center text-xs text-muted">Nothing here matches the filters.</p>
                ) : (
                  col.list.map((item) => (
                    <CompactRow
                      key={item.id}
                      item={item}
                      shared={shown.filter((s) => slotMatches(s, item)).length}
                      onOpen={() => onOpen(item.id)}
                    />
                  ))
                )}
              </div>
            </motion.section>
          );
        })}
      </AnimatePresence>
      {shown.length < max ? (
        // An empty column keeps a lone shop from stretching across the page.
        <div className="grid min-h-60 place-items-center rounded-[22px] border-2 border-dashed border-line p-4 text-center">
          <div>
            <Plus size={20} className="mx-auto text-muted" />
            <p className="mt-2 font-display text-xl sm:text-2xl">Add a shop</p>
            <p className="mt-1 text-xs text-muted">
              {max - shown.length} more {max - shown.length === 1 ? "slot" : "slots"}, campus or country
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
