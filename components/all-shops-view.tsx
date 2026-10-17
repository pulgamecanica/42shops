"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowLeft, ArrowUpRight, Clock, Columns3, Eye, Loader2, RotateCw, Search, X } from "lucide-react";
import type { Campus, Product } from "@/lib/types";
import { countryCode } from "@/lib/countries";
import { ageInDays, cn, formatAge, formatDate, formatNumber, normalize, productStatus } from "@/lib/utils";
import { Segmented, SortMenu } from "./controls";
import { PixelArt } from "./pixel-art";
import { Fact, Price, ProductCard, ProductModal, type ShopItem } from "./product";
import { CompareBoard, ComparePicker, slotCampuses, slotMatches, type Slot } from "./shop-compare";
import { StickyNote } from "./sticky-note";

type Status = "all" | "available" | "affordable" | "unavailable";
type Sort = "featured" | "views" | "newest" | "oldest" | "price-asc" | "price-desc" | "name";
type Flag = "home" | "new" | "low" | "unique" | "once" | "free";

// A product can be listed by several campuses; it becomes one card listing all of them.
export type Item = ShopItem & { campuses: Campus[]; views: number; age: number | null; haystack: string };

const NEW_DAYS = 30;
const PAGE = 48;
const STATUS_RANK = { available: 0, upcoming: 1, soldout: 2, ended: 3 } as const;

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "featured", label: "In stock first" },
  { value: "views", label: "Most viewed" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "price-asc", label: "Price, low to high" },
  { value: "price-desc", label: "Price, high to low" },
  { value: "name", label: "Name" },
];

const FLAGS: Array<{ value: Flag; label: string; test: (i: Item, home: number | null) => boolean }> = [
  { value: "home", label: "My campus", test: (i, home) => i.campuses.some((c) => c.id === home) },
  { value: "new", label: `New, ${NEW_DAYS} days`, test: (i) => i.age !== null && i.age <= NEW_DAYS },
  {
    value: "low",
    label: "Low stock",
    test: (i) => i.status === "available" && i.quantity !== null && i.quantity <= 10,
  },
  { value: "unique", label: "Unique", test: (i) => i.isUnique },
  { value: "once", label: "One per person", test: (i) => i.oneTimePurchase },
  { value: "free", label: "Free", test: (i) => i.price === 0 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts from what the server had cached, then loads the missing shops one at
 * a time (home campus first, then the biggest ones), then refreshes stale ones.
 * `prioritize` moves campuses to the front, e.g. when picked in a filter.
 */
function useShopLoader(
  campuses: Campus[],
  homeCampusId: number | null,
  initialProducts: Record<number, Product[]>,
  stale: number[],
) {
  const [loaded, setLoaded] = useState(initialProducts);
  const [failed, setFailed] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState(0);
  const queue = useRef([
    ...[...campuses]
      .filter((c) => !initialProducts[c.id])
      .sort((a, b) => Number(b.id === homeCampusId) - Number(a.id === homeCampusId) || b.usersCount - a.usersCount)
      .map((c) => c.id),
    ...stale,
  ]);

  useEffect(() => {
    let cancelled = false;
    const attempts = new Map<number, number>();
    setLoading(true);
    (async () => {
      while (!cancelled && queue.current.length) {
        // Peek, don't shift: a cancelled run (strict mode, unmount) leaves the queue intact.
        const id = queue.current[0];
        const started = performance.now();
        let ok = false;
        try {
          const res = await fetch(`/api/campuses/${id}/products`);
          if (res.ok) {
            const products = (await res.json()) as Product[];
            if (cancelled) return;
            setLoaded((prev) => ({ ...prev, [id]: products }));
            ok = true;
          }
        } catch {
          // network error, handled like a failed response
        }
        if (cancelled) return;
        queue.current = queue.current.filter((x) => x !== id);
        if (!ok) {
          const n = (attempts.get(id) ?? 0) + 1;
          attempts.set(id, n);
          if (n < 2) queue.current.push(id);
          else setFailed((f) => [...f, id]);
          await sleep(3000); // likely rate limited, back off
        } else if (performance.now() - started > 300) {
          await sleep(500); // a real 42 API call, not a cache hit: pace the next one
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  const prioritize = useCallback((ids: number[]) => {
    const front = ids.filter((id) => queue.current.includes(id));
    queue.current = [...front, ...queue.current.filter((id) => !front.includes(id))];
  }, []);

  const retry = useCallback(() => {
    setFailed((f) => {
      queue.current.push(...f);
      return [];
    });
    setRun((r) => r + 1);
  }, []);

  return { loaded, failed, loading, prioritize, retry };
}

/** Side-by-side room: 4 shops from tablet width up, 2 on a phone. */
function useCompareMax() {
  const [max, setMax] = useState(4);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    const update = () => setMax(m.matches ? 4 : 2);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return max;
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-ink tabular">{children}</span>;
}

function Badge({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

function CardMeta({ item }: { item: Item }) {
  return (
    <>
      <Badge className="bg-ink text-white" title={item.campuses.map((c) => `${c.name}, ${c.country}`).join("\n")}>
        <span className="font-pixel text-[9px] leading-none text-white/70">
          {countryCode(item.campuses[0].country)}
        </span>
        <span className="truncate">{item.campuses[0].name}</span>
        {item.campuses.length > 1 ? <span className="text-white/70">+{item.campuses.length - 1}</span> : null}
      </Badge>
      {item.age !== null && item.age <= NEW_DAYS ? <Badge className="bg-blue-wash text-blue">New</Badge> : null}
      {item.isUnique ? <Badge className="bg-sticky/60 text-ink">Unique</Badge> : null}
      {item.oneTimePurchase ? <Badge className="bg-heart/10 text-heart">1 per person</Badge> : null}
      <Badge
        className="border border-line text-muted"
        title={`${item.views} ${item.views === 1 ? "view" : "views"} on 42 Shops`}
      >
        <Eye size={11} aria-hidden />
        <span className="tabular">{formatNumber(item.views)}</span>
      </Badge>
      {item.age !== null && item.createdAt ? (
        <Badge className="border border-line text-muted" title={`Listed ${formatDate(item.createdAt)}`}>
          <Clock size={11} aria-hidden />
          {formatAge(item.age)}
        </Badge>
      ) : null}
    </>
  );
}

function LoadProgress({
  done,
  total,
  failed,
  loading,
  onRetry,
}: {
  done: number;
  total: number;
  failed: number;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex h-10 items-center gap-3 rounded-full border border-line bg-white pl-3.5 pr-1.5 text-sm"
      aria-live="polite"
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin text-blue" aria-hidden />
      ) : (
        <PixelArt sprite="coin" scale={2} />
      )}
      <span className="tabular">
        {!loading ? "Shops loaded" : done === total ? "Refreshing shops" : "Visiting shops"} <Num>{done}</Num>
        <span className="text-muted">/{total}</span>
      </span>
      <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-wash" aria-hidden>
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full bg-blue"
          animate={{ width: `${total ? (done / total) * 100 : 0}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 24 }}
        />
      </span>
      {failed > 0 && !loading ? (
        <button
          onClick={onRetry}
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-heart/10 px-3 text-xs font-medium text-heart transition-colors hover:bg-heart hover:text-white"
        >
          <RotateCw size={12} /> Retry {failed}
        </button>
      ) : (
        <span className="w-1.5" />
      )}
    </div>
  );
}

export function AllShopsView({
  campuses,
  initialProducts,
  stale,
  views,
  wallet,
  homeCampusId,
  now,
}: {
  campuses: Campus[];
  initialProducts: Record<number, Product[]>;
  stale: number[];
  views: Record<number, number>;
  wallet: number;
  homeCampusId: number | null;
  now: number;
}) {
  const { loaded, failed, loading, prioritize, retry } = useShopLoader(campuses, homeCampusId, initialProducts, stale);

  const items: Item[] = useMemo(() => {
    const out = new Map<number, Item>();
    // Home campus first, so a shared item's badge names it when it's sold there too.
    const ordered = [...campuses].sort((a, b) => Number(b.id === homeCampusId) - Number(a.id === homeCampusId));
    for (const campus of ordered) {
      for (const p of loaded[campus.id] ?? []) {
        const where = `${campus.name} ${campus.city} ${campus.country}`;
        const seen = out.get(p.id);
        if (seen) {
          seen.campuses.push(campus);
          seen.haystack += ` ${normalize(where)}`;
          continue;
        }
        out.set(p.id, {
          ...p,
          status: productStatus(p, now),
          campuses: [campus],
          views: views[p.id] ?? 0,
          age: p.createdAt ? ageInDays(p.createdAt, now) : null,
          haystack: normalize(`${p.name} ${p.description} ${where}`),
        });
      }
    }
    return [...out.values()];
  }, [campuses, loaded, views, now, homeCampusId]);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("available");
  const [sort, setSort] = useState<Sort>("featured");
  const [country, setCountry] = useState("all");
  const [campusId, setCampusId] = useState("all");
  const [flags, setFlags] = useState<Flag[]>([]);
  const [maxPrice, setMaxPrice] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [compare, setCompare] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const compareMax = useCompareMax();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Built from every campus, loaded or not, so picking one moves it up the queue.
  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of campuses) counts.set(c.country, (counts.get(c.country) ?? 0) + (loaded[c.id]?.length ?? 0));
    return [
      { value: "all", label: "All countries" },
      ...[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => ({ value: c, label: `${c} · ${n}` })),
    ];
  }, [campuses, loaded]);

  const campusOptions = useMemo(
    () => [
      { value: "all", label: "All campuses" },
      ...campuses
        .filter((c) => country === "all" || c.country === country)
        .map((c) => ({ value: String(c.id), label: `${c.name} · ${loaded[c.id] ? loaded[c.id].length : "…"}` })),
    ],
    [campuses, loaded, country],
  );

  // Everything but the status filter, so the status tabs can show live counts.
  const base = useMemo(() => {
    const q = normalize(query.trim());
    const max = maxPrice === "" ? Infinity : Number(maxPrice);
    const tests = FLAGS.filter((f) => flags.includes(f.value));
    return items.filter(
      (i) =>
        (compare
          ? slots.some((slot) => slotMatches(slot, i))
          : (country === "all" || i.campuses.some((c) => c.country === country)) &&
            (campusId === "all" || i.campuses.some((c) => String(c.id) === campusId))) &&
        i.price <= max &&
        (!q || i.haystack.includes(q)) &&
        tests.every((f) => f.test(i, homeCampusId)),
    );
  }, [items, query, maxPrice, country, campusId, flags, homeCampusId, compare, slots]);

  const counts = useMemo(() => {
    const available = base.filter((i) => i.status === "available");
    return {
      all: base.length,
      available: available.length,
      affordable: available.filter((i) => i.price <= wallet).length,
      unavailable: base.length - available.length,
    };
  }, [base, wallet]);

  const visible = useMemo(() => {
    const list = base.filter((i) => {
      if (status === "available") return i.status === "available";
      if (status === "affordable") return i.status === "available" && i.price <= wallet;
      if (status === "unavailable") return i.status !== "available";
      return true;
    });
    const byNewest = (a: Item, b: Item) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id - a.id;
    return list.sort((a, b) => {
      switch (sort) {
        case "views":
          return b.views - a.views || byNewest(a, b);
        case "newest":
          return byNewest(a, b);
        case "oldest":
          return -byNewest(a, b);
        case "price-asc":
          return a.price - b.price || a.name.localeCompare(b.name);
        case "price-desc":
          return b.price - a.price || a.name.localeCompare(b.name);
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.views - a.views || byNewest(a, b);
      }
    });
  }, [base, status, sort, wallet]);

  // Back to the first page whenever the result set changes.
  useEffect(() => setLimit(PAGE), [base, status, sort]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(t.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stats = useMemo(() => {
    const available = items.filter((i) => i.status === "available");
    const mostViewed = items.reduce<Item | null>((best, i) => (i.views > (best?.views ?? 0) ? i : best), null);
    return {
      shops: Object.values(loaded).filter((p) => p.length > 0).length,
      countries: new Set(items.flatMap((i) => i.campuses.map((c) => c.country))).size,
      available: available.length,
      affordable: available.filter((i) => i.price <= wallet).length,
      fresh: items.filter((i) => i.age !== null && i.age <= NEW_DAYS).length,
      mostViewed,
    };
  }, [items, wallet]);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const closeModal = useCallback(() => setSelectedId(null), []);
  const toggleFlag = (f: Flag) => setFlags((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  const filtered =
    query !== "" || (!compare && (country !== "all" || campusId !== "all")) || flags.length > 0 || maxPrice !== "";

  const changeSlots = (next: Slot[]) => {
    setSlots(next);
    prioritize(next.filter((s) => !slots.includes(s)).flatMap((s) => slotCampuses(s, campuses).map((c) => c.id)));
  };
  const toggleCompare = () => {
    if (!compare && slots.length === 0 && homeCampusId !== null) changeSlots([`campus:${homeCampusId}`]);
    setCompare((v) => !v);
  };
  const resetFilters = () => {
    setQuery("");
    setCountry("all");
    setCampusId("all");
    setFlags([]);
    setMaxPrice("");
    setStatus("all");
  };

  const walletNote = (
    <>
      You have <Price value={wallet} className="text-sm" />. That covers {formatNumber(stats.affordable)} of the{" "}
      {formatNumber(stats.available)} items in stock {loading ? "in the shops loaded so far" : "across every campus"}.
    </>
  );

  return (
    <div className="px-5 pb-16 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
        <Link
          href="/shops"
          className="group inline-flex h-10 items-center gap-2 rounded-full pr-3 text-sm text-muted transition-colors hover:text-ink"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full border border-line bg-white transition-all duration-300 ease-out-expo group-hover:-translate-x-1 group-hover:border-ink">
            <ArrowLeft size={15} />
          </span>
          All campuses
        </Link>
        <LoadProgress
          done={Object.keys(loaded).length}
          total={campuses.length}
          failed={failed.length}
          loading={loading}
          onRetry={retry}
        />
      </div>

      <section className="relative grid gap-8 pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-grid h-6 min-w-6 place-items-center rounded-[5px] bg-ink px-1 font-pixel text-[10px] leading-none text-white">
              42
            </span>
            The whole network
          </p>
          <h1 className="mt-3 font-display text-[clamp(3.2rem,9vw,7.5rem)] leading-[0.88] tracking-[-0.02em]">
            Every shop
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
            <Num>{formatNumber(items.length)}</Num> items from <Num>{formatNumber(stats.shops)}</Num> campus shops in{" "}
            <Num>{formatNumber(stats.countries)}</Num> countries. <Num>{formatNumber(stats.available)}</Num> in stock,{" "}
            <Num>{formatNumber(stats.fresh)}</Num> listed in the last {NEW_DAYS} days.
            {stats.mostViewed ? (
              <>
                {" "}
                Most viewed:{" "}
                <button
                  onClick={() => setSelectedId(stats.mostViewed!.id)}
                  className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  {stats.mostViewed.name}
                </button>{" "}
                from {stats.mostViewed.campuses[0].name}.
              </>
            ) : null}
          </p>
        </div>
        <div className="relative hidden lg:block">
          <StickyNote className="w-64" rotate={2.5} delay={0.2} pin={<PixelArt sprite="coin" scale={4} />}>
            {walletNote}
          </StickyNote>
        </div>
      </section>

      <p className="-mt-4 mb-6 rounded-2xl bg-sticky/60 px-4 py-3 font-hand text-[15px] lg:hidden">{walletNote}</p>

      <div className="sticky top-2 z-30 -mx-2 mb-3 flex flex-col gap-2 rounded-[22px] bg-white/80 p-2 backdrop-blur-md sm:top-3 md:flex-row md:items-center">
        <label className="group relative flex flex-1 items-center rounded-full border border-line bg-white transition-[border-color,box-shadow] duration-200 focus-within:border-blue focus-within:shadow-[0_0_0_4px_var(--color-blue-wash)]">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 text-muted group-focus-within:text-blue"
            aria-hidden
          />
          <span className="sr-only">Search every shop</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items, campuses or countries"
            className="h-10 w-full bg-transparent pl-10 pr-10 text-sm outline-none placeholder:text-muted/80"
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 grid h-6 w-6 place-items-center rounded-full bg-wash text-muted hover:bg-ink hover:text-white"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 hidden h-5 min-w-5 select-none items-center justify-center rounded-[5px] border border-line bg-wash px-1.5 font-mono text-[10px] font-medium text-muted shadow-2xs sm:inline-flex">
              /
            </kbd>
          )}
        </label>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Segmented
              id="all-filter"
              label="Filter by availability"
              value={status}
              onChange={setStatus}
              options={[
                { value: "available", label: "In stock", count: counts.available },
                { value: "affordable", label: "In budget", count: counts.affordable },
                { value: "unavailable", label: "Unavailable", count: counts.unavailable },
                { value: "all", label: "All", count: counts.all },
              ]}
            />
          </div>
          <SortMenu value={sort} onChange={setSort} options={SORTS} />
        </div>
      </div>

      <div className={cn("flex flex-wrap items-center gap-2", compare ? "mb-3" : "mb-8 sm:mb-10")}>
        <motion.button
          whileTap={{ scale: 0.95 }}
          aria-pressed={compare}
          onClick={toggleCompare}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
            compare ? "border-blue bg-blue text-white" : "border-line bg-white text-ink hover:border-ink",
          )}
        >
          <Columns3 size={15} />
          {compare ? "Comparing" : "Compare shops"}
        </motion.button>
        {compare ? null : (
          <>
            <SortMenu
              label="Country"
              align="left"
              value={country}
              onChange={(c) => {
                setCountry(c);
                setCampusId("all");
                prioritize(campuses.filter((x) => x.country === c).map((x) => x.id));
              }}
              options={countryOptions}
            />
            <SortMenu
              label="Campus"
              align="left"
              value={campusId}
              onChange={(id) => {
                setCampusId(id);
                prioritize([Number(id)]);
              }}
              options={campusOptions}
            />
          </>
        )}
        <label className="flex h-10 items-center gap-1.5 rounded-full border border-line bg-white pl-4 pr-3 text-sm transition-colors focus-within:border-blue">
          <span className="text-muted">Max</span>
          <span className="font-pixel text-[12px]">₳</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="any"
            className="w-14 bg-transparent font-medium tabular outline-none placeholder:font-normal placeholder:text-muted/80"
            aria-label="Maximum price"
          />
        </label>
        {FLAGS.filter((f) => f.value !== "home" || homeCampusId !== null).map((f) => {
          const on = flags.includes(f.value);
          return (
            <motion.button
              key={f.value}
              whileTap={{ scale: 0.95 }}
              aria-pressed={on}
              onClick={() => toggleFlag(f.value)}
              className={cn(
                "h-10 rounded-full border px-4 text-sm transition-colors",
                on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink",
              )}
            >
              {f.label}
            </motion.button>
          );
        })}
        <AnimatePresence>
          {filtered ? (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={resetFilters}
              className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-muted transition-colors hover:text-heart"
            >
              <X size={14} /> Reset
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {compare ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="-mx-2 mb-8 px-2 py-1 sm:mb-10"
          >
            <ComparePicker campuses={campuses} loaded={loaded} slots={slots} max={compareMax} onChange={changeSlots} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <LayoutGroup>
        {compare ? (
          <CompareBoard
            slots={slots}
            campuses={campuses}
            loaded={loaded}
            all={items}
            visible={visible}
            wallet={wallet}
            max={compareMax}
            onOpen={setSelectedId}
          />
        ) : (
          <motion.div
            layout
            className="relative grid grid-cols-2 gap-x-3.5 gap-y-10 sm:gap-x-5 sm:gap-y-12 md:grid-cols-3 xl:grid-cols-4"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {visible.slice(0, limit).map((item, i) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.92, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16 } }}
                  transition={{
                    type: "spring",
                    stiffness: 380,
                    damping: 32,
                    delay: Math.min(i % PAGE, 10) * 0.025,
                    layout: { type: "spring", stiffness: 380, damping: 34 },
                  }}
                  className={cn(selectedId === item.id && "z-10")}
                >
                  <ProductCard
                    item={item}
                    wallet={wallet}
                    onOpen={() => setSelectedId(item.id)}
                    meta={<CardMeta item={item} />}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}

        <ProductModal
          item={selected}
          wallet={wallet}
          isHomeCampus={Boolean(selected?.campuses.some((c) => c.id === homeCampusId))}
          onClose={closeModal}
          facts={
            selected ? (
              <>
                <Fact label={selected.campuses.length > 1 ? `Sold at ${selected.campuses.length} campuses` : "Campus"}>
                  <span className="flex flex-col items-end gap-1">
                    {selected.campuses.map((c) => (
                      <Link
                        key={c.id}
                        href={`/shops/${c.id}`}
                        className="group inline-flex items-center gap-1 hover:text-blue"
                      >
                        {c.name}, {c.country}
                        <ArrowUpRight size={13} className="text-muted group-hover:text-blue" />
                      </Link>
                    ))}
                  </span>
                </Fact>
                <Fact label="Listed">
                  {selected.createdAt && selected.age !== null
                    ? `${formatDate(selected.createdAt)}, ${selected.age < 1 ? "today" : `${formatAge(selected.age)} ago`}`
                    : "Unknown"}
                </Fact>
                <Fact label="Views on 42 Shops">{formatNumber(selected.views)}</Fact>
              </>
            ) : null
          }
        />
      </LayoutGroup>

      {!compare && visible.length > limit ? (
        <div className="mt-12 flex flex-col items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setLimit((l) => l + PAGE)}
            className="rounded-full bg-ink px-5 py-2.5 text-sm text-white transition-colors hover:bg-blue"
          >
            Show {Math.min(PAGE, visible.length - limit)} more
          </motion.button>
          <span className="text-xs text-muted tabular">
            {formatNumber(limit)} of {formatNumber(visible.length)}
          </span>
        </div>
      ) : null}

      <AnimatePresence>
        {!compare && visible.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center py-16 text-center"
          >
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
              <PixelArt sprite="ghost" scale={6} />
            </motion.div>
            <p className="mt-6 font-display text-3xl">
              {loading
                ? "Visiting the shops…"
                : items.length === 0
                  ? "No shop has listed anything yet"
                  : "Nothing matches these filters"}
            </p>
            <p className="mt-2 text-sm text-muted">
              {loading ? (
                <>Items show up here as each campus answers.</>
              ) : query ? (
                <>No item mentions &ldquo;{query}&rdquo;.</>
              ) : (
                <>Try fewer filters to see more items.</>
              )}
            </p>
            {items.length > 0 && !loading ? (
              <button
                onClick={resetFilters}
                className="mt-6 rounded-full border border-line px-5 py-2.5 text-sm transition-colors hover:border-ink"
              >
                Show every item
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
