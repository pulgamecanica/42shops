"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Download, Loader2, X } from "lucide-react";
import type { Campus, Product } from "@/lib/types";
import { jpegPdf, zip } from "@/lib/report-files";
import { cn, formatAge, formatNumber } from "@/lib/utils";
import type { Item } from "./all-shops-view";
import { Segmented } from "./controls";
import {
  ComparePicker,
  STATUS_TEXT,
  bestStats,
  slotCampuses,
  slotLabel,
  slotMatches,
  statsOf,
  type Slot,
  type Stats,
} from "./shop-compare";

type Format = "html" | "png" | "pdf";
const FORMATS: Array<{ value: Format; label: string }> = [
  { value: "pdf", label: "PDF" },
  { value: "html", label: "HTML" },
  { value: "png", label: "PNG" },
];

// Report palette, the app's theme tokens as plain colors (the report has no Tailwind).
const ACCENTS = [
  ["#2f6bff", "#ffffff"],
  ["#f5d33f", "#000000"],
  ["#000000", "#ffffff"],
  ["#ff3b5c", "#ffffff"],
];
const STATUS_DOT = { available: "#12a35c", upcoming: "#2f6bff", soldout: "#6e6e76", ended: "#6e6e76" } as const;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const price = (n: number) => (n === 0 ? "Free" : `₳${formatNumber(n)}`);

// ---------------------------------------------------------------------------
// Assets: inline fonts and small thumbnails, so the files work offline
// ---------------------------------------------------------------------------
const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

let fontCss: Promise<string> | null = null;

/** The app's own @font-face rules (Latin subset), with the font files inlined. */
function embeddedFonts(): Promise<string> {
  return (fontCss ??= (async () => {
    const rules: CSSFontFaceRule[] = [];
    const walk = (list: CSSRuleList) => {
      for (const rule of list) {
        if (rule instanceof CSSFontFaceRule) rules.push(rule);
        else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // cross-origin sheet, not ours
      }
    }
    const wanted = rules.filter(
      (r) =>
        /^"?(Instrument Serif|Silkscreen|Geist Variable)"?$/.test(r.style.getPropertyValue("font-family")) &&
        r.style.getPropertyValue("font-style") !== "italic" &&
        // Latin subset only; browsers normalize U+0000-00FF to U+0-FF.
        /U\+0+-0*FF\b/i.test(r.style.getPropertyValue("unicode-range") || "U+0-FF"),
    );
    const css = await Promise.all(
      wanted.map(async (r) => {
        const url = /url\(["']?([^"')]+)/.exec(r.style.getPropertyValue("src"))?.[1];
        if (!url) return "";
        try {
          const blob = await fetch(new URL(url, r.parentStyleSheet?.href ?? location.href)).then((res) => res.blob());
          return r.cssText.replace(/src:[^;]+;/, `src: url(${await toDataUrl(blob)});`);
        } catch {
          return "";
        }
      }),
    );
    return css.join("\n");
  })());
}

const thumbs = new Map<string, Promise<string | null>>();

/** A 96px JPEG of a product image, on the card's grey, as a data URL. */
function thumb(src: string | null): Promise<string | null> {
  if (!src) return Promise.resolve(null);
  let pending = thumbs.get(src);
  if (!pending) {
    pending = (async () => {
      try {
        const bitmap = await createImageBitmap(await fetch(src).then((r) => r.blob()));
        const size = 96;
        const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#f4f4f6";
        ctx.fillRect(0, 0, size, size);
        const scale = Math.min((size - 12) / bitmap.width, (size - 12) / bitmap.height);
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
        return canvas.toDataURL("image/jpeg", 0.82);
      } catch {
        return null;
      }
    })();
    thumbs.set(src, pending);
  }
  return pending;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Report markup: one column per shop, laid out horizontally
// ---------------------------------------------------------------------------
type Column = {
  name: string;
  code: string;
  kind: string;
  sub: string;
  stats: Stats;
  items: Item[];
};

const REPORT_CSS = `
.report { box-sizing: border-box; width: max-content; min-width: 100%; padding: 48px; background: #e9e9ec;
  font-family: "Geist Variable", ui-sans-serif, system-ui, sans-serif; color: #000; -webkit-font-smoothing: antialiased; }
.report * { box-sizing: border-box; margin: 0; }
.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 48px; margin-bottom: 32px; }
.brand { font-family: Silkscreen, monospace; font-size: 12px; letter-spacing: .04em; color: #6e6e76; }
.title { font-family: "Instrument Serif", Georgia, serif; font-size: 88px; line-height: .9; letter-spacing: -.02em; margin-top: 10px; }
.meta { font-size: 14px; color: #6e6e76; text-align: right; line-height: 1.6; }
.meta b { color: #000; font-weight: 500; }
.board { display: flex; gap: 16px; align-items: flex-start; }
.col { width: 300px; flex: none; background: #fff; border-radius: 22px; padding: 8px; box-shadow: 0 0 0 1px rgba(0,0,0,.04), 0 24px 48px -24px rgba(0,0,0,.16); }
.top { border-radius: 16px; padding: 16px; }
.kind { font-size: 11px; opacity: .8; display: flex; gap: 6px; align-items: center; }
.code { font-family: Silkscreen, monospace; font-size: 9px; line-height: 1; padding: 3px 4px; border-radius: 4px; background: rgba(255,255,255,.18); }
.name { font-family: "Instrument Serif", Georgia, serif; font-size: 32px; line-height: 1.1; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { font-size: 12px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
dl { padding: 8px 10px 0; }
.stat { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #e4e4e8; }
.stat:last-child { border: 0; }
dt { color: #6e6e76; }
dd { font-variant-numeric: tabular-nums; }
.best { color: #2f6bff; font-weight: 500; }
.count { font-size: 11px; color: #6e6e76; padding: 8px 10px 4px; }
.row { display: flex; gap: 10px; align-items: center; padding: 6px; }
.row img, .row .ph { width: 44px; height: 44px; border-radius: 12px; flex: none; background: #f4f4f6; display: block; }
.row .txt { flex: 1; min-width: 0; }
.row .n { font-size: 13px; font-weight: 500; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row .s { font-size: 11px; color: #6e6e76; margin-top: 2px; display: flex; gap: 5px; align-items: center; }
.dot { width: 6px; height: 6px; border-radius: 99px; display: inline-block; }
.shared { background: #eaf0ff; color: #2f6bff; border-radius: 99px; padding: 0 6px; font-weight: 500; }
.p { font-family: Silkscreen, monospace; font-size: 12px; white-space: nowrap; align-self: flex-start; padding-top: 4px; }
.dim { opacity: .45; filter: grayscale(1); }
.empty { font-size: 12px; color: #6e6e76; text-align: center; padding: 32px 12px; }
`;

function reportBody(columns: Column[], images: Map<string, string | null>, note: string, slots: Slot[]): string {
  const best = bestStats(columns.map((c) => c.stats));
  const stat = (label: string, key: keyof Stats) => (s: Stats) => {
    const isBest = s[key] !== null && s[key] === best[key];
    return `<div class="stat"><dt>${label}</dt><dd class="${isBest ? "best" : ""}">${isBest ? "★ " : ""}${
      s[key] === null ? "–" : formatValue(key, s[key]!)
    }</dd></div>`;
  };
  const rows = [
    stat("Items", "items"),
    stat("In stock", "inStock"),
    stat("In your budget", "inBudget"),
    stat("Cheapest", "cheapest"),
    stat("Median price", "median"),
    stat("Newest", "newest"),
  ];
  const cols = columns
    .map((col, i) => {
      const [bg, fg] = ACCENTS[i % ACCENTS.length];
      const items = col.items
        .map((item) => {
          const img = images.get(item.image ?? "");
          const shared = slots.filter((s) => slotMatches(s, item)).length;
          const dim = item.status === "soldout" || item.status === "ended";
          return `<div class="row"><span class="${dim ? "dim" : ""}">${
            img ? `<img src="${img}" alt="" />` : `<span class="ph"></span>`
          }</span><div class="txt"><div class="n">${esc(item.name)}</div><div class="s"><span class="dot" style="background:${
            STATUS_DOT[item.status]
          }"></span>${STATUS_TEXT[item.status]}${item.age !== null ? ` · ${formatAge(item.age)}` : ""}${
            shared > 1 ? ` <span class="shared">in ${shared}</span>` : ""
          }</div></div><span class="p">${price(item.price)}</span></div>`;
        })
        .join("");
      return `<section class="col"><div class="top" style="background:${bg};color:${fg}"><div class="kind"><span class="code"${
        fg === "#000000" ? ' style="background:rgba(0,0,0,.1)"' : ""
      }>${esc(col.code)}</span>${col.kind}</div><div class="name">${esc(col.name)}</div><div class="sub">${esc(col.sub)}</div></div><dl>${rows
        .map((r) => r(col.stats))
        .join(
          "",
        )}</dl><div class="count">${formatNumber(col.items.length)} ${col.items.length === 1 ? "item" : "items"}</div>${
        items || `<div class="empty">Nothing here matches the filters.</div>`
      }</section>`;
    })
    .join("");
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  return `<div class="report"><div class="head"><div><div class="brand">42 SHOPS</div><div class="title">Shop comparison</div></div><div class="meta"><b>${columns.length}</b> shops · ${esc(
    note,
  )}<br />Generated ${esc(date)}</div></div><div class="board">${cols}</div></div>`;
}

function formatValue(key: keyof Stats, v: number): string {
  if (key === "cheapest" || key === "median") return price(v);
  if (key === "newest") return v < 1 ? "today" : `${formatAge(v)} ago`;
  return formatNumber(v);
}

const htmlDocument = (body: string, fonts: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>42 Shops comparison</title><style>${fonts}\nhtml,body{margin:0;background:#e9e9ec}${REPORT_CSS}</style></head><body>${body}</body></html>`;

/** Rasterize the report: measure it in the page, then draw it through an SVG foreignObject. */
async function rasterize(body: string, fonts: string) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;";
  host.innerHTML = `<style>${REPORT_CSS}</style>${body}`;
  document.body.appendChild(host);
  const report = host.querySelector(".report") as HTMLElement;
  await Promise.all([...report.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
  const width = Math.ceil(report.scrollWidth);
  const height = Math.ceil(report.scrollHeight);
  const node = document.createElement("div");
  node.innerHTML = `<style>${fonts}\n${REPORT_CSS}</style>${body}`;
  const xhtml = new XMLSerializer().serializeToString(node);
  host.remove();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  await new Promise((r) => setTimeout(r, 100)); // let the inlined fonts settle

  // 2x when it fits; browsers cap canvases near 32k px a side and ~250M px in area.
  const scale = Math.min(2, 32000 / width, 32000 / height, Math.sqrt(250e6 / (width * height)));
  const canvas = Object.assign(document.createElement("canvas"), {
    width: Math.floor(width * scale),
    height: Math.floor(height * scale),
  });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e9e9ec";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = (type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), type, quality),
    );
  return { width, height, canvas, png: await blob("image/png"), jpeg: await blob("image/jpeg", 0.9) };
}

type Result = {
  html: string;
  png: Blob;
  pngUrl: string;
  pdf: Blob;
  width: number;
  height: number;
};

async function buildReport(
  columns: Column[],
  note: string,
  slots: Slot[],
  onProgress: (text: string) => void,
): Promise<Result> {
  const sources = [...new Set(columns.flatMap((c) => c.items.map((i) => i.image ?? "")).filter(Boolean))];
  let done = 0;
  const [fonts, pairs] = await Promise.all([
    embeddedFonts(),
    pool(sources, 6, async (src) => {
      const data = await thumb(src);
      onProgress(`Images ${++done}/${sources.length}`);
      return [src, data] as const;
    }),
  ]);
  onProgress("Drawing");
  const body = reportBody(columns, new Map(pairs), note, slots);
  const raster = await rasterize(body, fonts);
  const jpeg = new Uint8Array(await raster.jpeg.arrayBuffer());
  const pdf = new Blob(
    [jpegPdf(jpeg, { width: raster.canvas.width, height: raster.canvas.height }, raster)] as BlobPart[],
    { type: "application/pdf" },
  );
  return {
    html: htmlDocument(body, fonts),
    png: raster.png,
    pngUrl: URL.createObjectURL(raster.png),
    pdf,
    width: raster.width,
    height: raster.height,
  };
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function ExportModal({
  open,
  onClose,
  initialSlots,
  campuses,
  loaded,
  prioritize,
  all,
  visible,
  wallet,
  note,
}: {
  open: boolean;
  onClose: () => void;
  initialSlots: Slot[];
  campuses: Campus[];
  loaded: Record<number, Product[]>;
  prioritize: (ids: number[]) => void;
  /** Every loaded item, for the stats. */
  all: Item[];
  /** Items after the page's search, filters and sort, for the lists. */
  visible: Item[];
  wallet: number;
  /** Human summary of the active filters, printed on the report. */
  note: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [formats, setFormats] = useState<Format[]>(["pdf", "html", "png"]);
  const [preview, setPreview] = useState<Format>("html");
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) setSlots(initialSlots);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const waiting = slots.flatMap((s) => slotCampuses(s, campuses)).filter((c) => !loaded[c.id]).length;

  const columns = useMemo<Column[]>(
    () =>
      slots.map((slot) => ({
        ...slotLabel(slot, campuses),
        stats: statsOf(
          all.filter((i) => slotMatches(slot, i)),
          wallet,
        ),
        items: visible.filter((i) => slotMatches(slot, i)),
      })),
    [slots, campuses, all, visible, wallet],
  );

  // Rebuild the files whenever the selection settles; the preview shows the real output.
  useEffect(() => {
    if (!open || waiting > 0 || columns.length === 0) return;
    const id = ++run.current;
    const t = window.setTimeout(async () => {
      setError(null);
      setProgress("Preparing");
      try {
        const built = await buildReport(columns, note, slots, (text) => id === run.current && setProgress(text));
        if (id !== run.current) return URL.revokeObjectURL(built.pngUrl);
        setResult((old) => {
          if (old) URL.revokeObjectURL(old.pngUrl);
          return built;
        });
      } catch (err) {
        if (id === run.current) setError(err instanceof Error ? err.message : "Export failed");
      } finally {
        if (id === run.current) setProgress(null);
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [open, waiting, columns, note, slots]);

  const download = async () => {
    if (!result) return;
    const enc = new TextEncoder();
    const files = await Promise.all(
      formats.map(async (f) => ({
        name: `comparison.${f}`,
        data:
          f === "html"
            ? enc.encode(result.html)
            : new Uint8Array(await (f === "png" ? result.png : result.pdf).arrayBuffer()),
      })),
    );
    const url = URL.createObjectURL(new Blob([zip(files)] as BlobPart[], { type: "application/zip" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `42shops-comparison-${new Date().toISOString().slice(0, 10)}.zip`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  if (!mounted) return null;

  const busy = progress !== null || waiting > 0;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6" key="export-modal">
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="relative z-10 flex max-h-[94dvh] w-full max-w-6xl flex-col gap-5 overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.4)] sm:rounded-[28px] sm:p-7"
          >
            <div className="flex items-start justify-between gap-4 pr-10">
              <div>
                <h2 id="export-title" className="font-display text-4xl leading-none sm:text-5xl">
                  Export a report
                </h2>
                <p className="mt-2 max-w-xl text-sm text-muted">
                  As many shops as you like, side by side in one long horizontal report. Uses this page&apos;s search
                  and filters: {note}.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Shops</p>
              <ComparePicker
                campuses={campuses}
                loaded={loaded}
                slots={slots}
                max={Infinity}
                onChange={(next) => {
                  setSlots(next);
                  prioritize(next.flatMap((s) => slotCampuses(s, campuses).map((c) => c.id)));
                }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-1 text-xs font-medium uppercase tracking-wide text-muted">Formats</p>
                {FORMATS.map((f) => {
                  const on = formats.includes(f.value);
                  return (
                    <motion.button
                      key={f.value}
                      whileTap={{ scale: 0.95 }}
                      aria-pressed={on}
                      onClick={() =>
                        setFormats((prev) => (on ? prev.filter((x) => x !== f.value) : [...prev, f.value]))
                      }
                      className={cn(
                        "h-9 rounded-full border px-4 text-sm transition-colors",
                        on ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink",
                      )}
                    >
                      {f.label}
                    </motion.button>
                  );
                })}
              </div>
              <div className="w-full sm:w-auto">
                <Segmented
                  id="export-preview"
                  label="Preview"
                  value={preview}
                  onChange={setPreview}
                  options={FORMATS}
                />
              </div>
            </div>

            <div className="relative h-[50dvh] min-h-72 overflow-hidden rounded-[22px] border border-line bg-canvas">
              {result && slots.length > 0 ? (
                preview === "html" ? (
                  <iframe title="HTML preview" srcDoc={result.html} sandbox="" className="h-full w-full" />
                ) : (
                  <div className="h-full overflow-auto">
                    {/* The PDF is this same image on one page, so the preview shows it as printed. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={result.pngUrl}
                      alt="Report preview"
                      style={{ width: result.width, maxWidth: "none" }}
                      className={cn(preview === "pdf" && "m-6 bg-white shadow-[0_20px_40px_-16px_rgba(0,0,0,0.35)]")}
                    />
                  </div>
                )
              ) : null}
              {busy || !result || slots.length === 0 || error ? (
                <div className="absolute inset-0 grid place-items-center bg-canvas/70 backdrop-blur-[2px]">
                  <p className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm shadow-sm">
                    {slots.length === 0 ? (
                      "Add shops to preview the report"
                    ) : error ? (
                      <span className="text-heart">{error}</span>
                    ) : (
                      <>
                        <Loader2 size={14} className="animate-spin text-blue" />
                        {waiting > 0
                          ? `Loading ${waiting} ${waiting === 1 ? "shop" : "shops"}`
                          : (progress ?? "Preparing")}
                      </>
                    )}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
              <p className="text-xs text-muted">
                {result ? (
                  <>
                    {formatNumber(result.width)} × {formatNumber(result.height)} px · PNG{" "}
                    {(result.png.size / 1e6).toFixed(1)} MB · PDF {(result.pdf.size / 1e6).toFixed(1)} MB
                  </>
                ) : (
                  "Files are built in your browser; nothing is uploaded."
                )}
              </p>
              <motion.button
                whileTap={{ scale: 0.97 }}
                disabled={!result || busy || formats.length === 0 || slots.length === 0}
                onClick={download}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={15} />
                Download .zip
                {formats.length ? (
                  <span className="text-white/60">
                    ({formats.length} {formats.length === 1 ? "file" : "files"})
                  </span>
                ) : null}
              </motion.button>
            </div>

            <motion.button
              onClick={onClose}
              whileHover={{ rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-wash text-ink sm:right-6 sm:top-6"
              aria-label="Close export"
            >
              <X size={18} />
            </motion.button>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
