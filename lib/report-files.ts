// Dependency-free file writers for the shop report export: a ZIP archive and
// a one-page PDF wrapping a JPEG. Run `node lib/report-files.ts` to self-check.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * A ZIP of the given files, stored uncompressed.
 * ponytail: no deflate; PNG and JPEG-in-PDF are compressed already. Pipe the
 * HTML through CompressionStream("deflate-raw") if its size starts to matter.
 */
export function zip(files: Array<{ name: string; data: Uint8Array }>, date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const body: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); // local file header
    l.setUint16(4, 20, true); // version needed
    l.setUint16(6, 0x0800, true); // UTF-8 names
    l.setUint16(10, time, true);
    l.setUint16(12, day, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true); // compressed = uncompressed (stored)
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true); // central directory header
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true);
    c.setUint16(14, day, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    entry.set(name, 46);

    body.push(local, file.data);
    central.push(entry);
    offset += local.length + size;
  }

  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); // end of central directory
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, central.reduce((n, c) => n + c.length, 0), true);
  e.setUint32(16, offset, true);
  return concat([...body, ...central, end]);
}

/**
 * A single-page PDF showing a JPEG. The page is pageWidth × pageHeight CSS
 * pixels (1px = 0.75pt); the JPEG may have more pixels for sharpness. Viewers
 * cap pages at 14400 units a side, so bigger pages scale the unit with /UserUnit.
 */
export function jpegPdf(
  jpeg: Uint8Array,
  image: { width: number; height: number },
  page: { width: number; height: number },
): Uint8Array {
  const enc = new TextEncoder();
  const unit = Math.max(1, (page.width * 0.75) / 14400, (page.height * 0.75) / 14400);
  const w = ((page.width * 0.75) / unit).toFixed(2);
  const h = ((page.height * 0.75) / unit).toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

  const objects: Array<string | [string, Uint8Array]> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]${unit > 1 ? ` /UserUnit ${unit.toFixed(4)}` : ""} /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
    ],
  ];

  const parts: Uint8Array[] = [enc.encode("%PDF-1.6\n%\xe2\xe3\xcf\xd3\n")];
  let size = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(size);
    const chunk =
      typeof obj === "string"
        ? [enc.encode(`${i + 1} 0 obj\n${obj}\nendobj\n`)]
        : [enc.encode(`${i + 1} 0 obj\n${obj[0]}`), obj[1], enc.encode("\nendstream\nendobj\n")];
    for (const c of chunk) {
      parts.push(c);
      size += c.length;
    }
  });

  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(size),
    "%%EOF\n",
  ].join("\n");
  parts.push(enc.encode(xref));
  return concat(parts);
}

// Self-check: `node lib/report-files.ts` (Node 22.6+ strips the types).
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("report-files.ts")) {
  const assert = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(`report-files: ${msg}`);
  };
  const enc = new TextEncoder();
  assert(crc32(enc.encode("123456789")) === 0xcbf43926, "crc32 test vector");

  const archive = zip([
    { name: "a.txt", data: enc.encode("hello") },
    { name: "dossier/é.txt", data: enc.encode("") },
  ]);
  const eocd = new DataView(archive.buffer, archive.length - 22);
  assert(eocd.getUint32(0, true) === 0x06054b50 && eocd.getUint16(10, true) === 2, "zip end record");
  assert(new DataView(archive.buffer, eocd.getUint32(16, true)).getUint32(0, true) === 0x02014b50, "zip central dir offset");

  const pdf = jpegPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { width: 2, height: 1 }, { width: 40000, height: 10 });
  const text = new TextDecoder("latin1").decode(pdf);
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  assert(text.startsWith("xref", xrefAt), "pdf startxref");
  for (const [i, m] of [...text.matchAll(/^(\d{10}) 00000 n $/gm)].entries()) {
    assert(text.startsWith(`${i + 1} 0 obj`, Number(m[1])), `pdf xref entry ${i + 1}`);
  }
  assert(/\/UserUnit \d/.test(text) && /MediaBox \[0 0 14400\.00/.test(text), "pdf UserUnit for wide pages");
  console.log("report-files: ok");
}
