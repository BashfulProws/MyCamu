// Pulls plain text out of course files so an AI agent can read them. Runs inside the Worker, so the file is
// fetched and parsed here and only the text goes back to the agent.
//
// Supported: PDF, PowerPoint (.pptx and old .ppt), Word (.docx and old .doc), Excel (.xlsx and old .xls),
// OpenDocument (.odt .odp .ods), RTF, HTML, plain text, and ZIP files containing those.

import * as CFB from "cfb";
import { unzipSync, strFromU8 } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";

export interface Extracted {
  text: string;
  kind: string;
  note?: string; // e.g. "no text layer, probably a scan"
}

const ext = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
const cp1252 = new TextDecoder("windows-1252");
const utf16 = new TextDecoder("utf-16le");

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

const tidy = (t: string) => t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// Text of each <w:p> / <a:p> paragraph, joined by newlines.
function paragraphs(xml: string, para: string, run: string): string {
  const out: string[] = [];
  const pRe = new RegExp(`<${para}[ >][\\s\\S]*?</${para}>`, "g");
  const tRe = new RegExp(`<${run}(?: [^>]*)?>([^<]*)</${run}>|<(?:w:tab|w:br)\\s*/>`, "g");
  for (const p of xml.match(pRe) ?? []) {
    let line = "";
    for (const m of p.matchAll(tRe)) line += m[1] !== undefined ? decodeXml(m[1]) : " ";
    if (line.trim()) out.push(line.trim());
  }
  return out.join("\n");
}

const numeric = (a: string, b: string) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

// ---------------------------------------------------------------------------------------------------------
// ZIP helpers

// Lists entry names without unpacking anything, so a huge archive cannot exhaust memory.
function zipEntries(bytes: Uint8Array): { name: string; size: number }[] {
  const entries: { name: string; size: number }[] = [];
  unzipSync(bytes, { filter: (f) => { if (!f.name.endsWith("/") && !f.name.startsWith("__MACOSX/")) entries.push({ name: f.name, size: f.originalSize }); return false; } });
  return entries;
}

const unzipOnly = (bytes: Uint8Array, wanted: string[]) => unzipSync(bytes, { filter: (f) => wanted.includes(f.name) });

const READABLE_IN_ZIP = /\.(pdf|pptx|ppsx|docx|xlsx|odt|odp|ods|doc|ppt|xls|rtf|txt|md|csv|html?)$/i;

async function readZip(bytes: Uint8Array): Promise<Extracted> {
  const entries = zipEntries(bytes);
  const names = entries.map((e) => e.name);
  const MAX_ENTRY = 15_000_000;
  const readable = entries.filter((e) => READABLE_IN_ZIP.test(e.name) && e.size <= MAX_ENTRY).slice(0, 5).map((e) => e.name);
  if (!readable.length) throw new Error(`This ZIP has no readable files. It contains: ${names.slice(0, 15).join(", ") || "(nothing)"}. Use get_file to download it.`);
  const z = unzipOnly(bytes, readable);
  const parts: string[] = [];
  for (const n of readable) {
    const f = z[n];
    const r = await extractFileText(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer, n);
    parts.push(`===== ${n} (${r.kind}) =====\n${r.text}`);
  }
  const skipped = names.length - readable.length;
  return { kind: `ZIP with ${names.length} files`, text: parts.join("\n\n"), note: skipped > 0 ? `${skipped} other file(s) in the ZIP were not read: ${names.filter((n) => !readable.includes(n)).slice(0, 10).join(", ")}` : undefined };
}

// ---------------------------------------------------------------------------------------------------------
// OpenDocument (.odt .odp .ods)

function readOdf(bytes: Uint8Array, kind: "odt" | "odp" | "ods"): Extracted {
  const xml = strFromU8(unzipOnly(bytes, ["content.xml"])["content.xml"] ?? new Uint8Array());
  if (!xml) throw new Error("Not a valid OpenDocument file");
  const flat = (s: string) => decodeXml(s
    .replace(/<text:(?:line-break)\s*\/>/g, "\n").replace(/<text:tab\s*\/>/g, "\t").replace(/<text:s(?: [^>]*)?\/>/g, " ")
    .replace(/<\/text:[ph]>/g, "\n").replace(/<[^>]+>/g, ""));
  if (kind === "ods") {
    const out: string[] = [];
    for (const t of xml.matchAll(/<table:table [^>]*table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/g)) {
      const rows: string[] = [];
      for (const r of t[2].matchAll(/<table:table-row[ >][\s\S]*?<\/table:table-row>/g)) {
        const cells = [...r[0].matchAll(/<table:table-cell(?: [^>]*)?\/>|<table:table-cell(?: [^>]*)?>([\s\S]*?)<\/table:table-cell>/g)].map((c) => flat(c[1] ?? "").trim().replace(/\n+/g, " "));
        if (cells.some(Boolean)) rows.push(cells.join("\t"));
      }
      out.push(`--- Sheet: ${decodeXml(t[1])} ---\n${rows.join("\n")}`);
    }
    return { kind: "OpenDocument spreadsheet", text: out.join("\n\n") };
  }
  const body = xml.slice(xml.indexOf("<office:body"));
  if (kind === "odp") {
    let n = 0;
    const marked = body.replace(/<draw:page(?: |>)/g, (m) => `\n--- Slide ${++n} ---\n${m}`);
    return { kind: `OpenDocument presentation, ${n} slides`, text: tidy(flat(marked)) };
  }
  return { kind: "OpenDocument text", text: tidy(flat(body)) };
}

// ---------------------------------------------------------------------------------------------------------
// RTF

const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "object", "themedata", "colorschememapping", "datastore", "latentstyles", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "fldinst"]);

function readRtf(src: string): string {
  const out: string[] = [];
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false, uc = 1, skipChars = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") { stack.push({ skip, uc }); continue; }
    if (ch === "}") { const s = stack.pop(); if (s) { skip = s.skip; uc = s.uc; } continue; }
    if (ch === "\\") {
      const nx = src[i + 1];
      if (nx === "\\" || nx === "{" || nx === "}") { if (!skip && skipChars === 0) out.push(nx); else if (skipChars > 0) skipChars--; i++; continue; }
      if (nx === "'") {
        const code = parseInt(src.substr(i + 2, 2), 16); i += 3;
        if (skipChars > 0) skipChars--; else if (!skip && !Number.isNaN(code)) out.push(cp1252.decode(new Uint8Array([code])));
        continue;
      }
      if (nx === "*") { skip = true; i++; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
      if (!m) { i++; continue; }
      i += m[0].length - 1;
      const w = m[1], n = m[2] !== undefined ? Number(m[2]) : undefined;
      if (RTF_SKIP.has(w)) { skip = true; continue; }
      if (skip) continue;
      if (w === "par" || w === "line" || w === "sect" || w === "page") out.push("\n");
      else if (w === "tab" || w === "cell") out.push("\t");
      else if (w === "row") out.push("\n");
      else if (w === "emdash") out.push("—"); else if (w === "endash") out.push("–");
      else if (w === "lquote") out.push("‘"); else if (w === "rquote") out.push("’");
      else if (w === "ldblquote") out.push("“"); else if (w === "rdblquote") out.push("”");
      else if (w === "bullet") out.push("•");
      else if (w === "uc" && n !== undefined) uc = n;
      else if (w === "u" && n !== undefined) { out.push(String.fromCharCode(n < 0 ? n + 65536 : n)); skipChars = uc; }
      continue;
    }
    if (ch === "\r" || ch === "\n") continue;
    if (skipChars > 0) { skipChars--; continue; }
    if (!skip) out.push(ch);
  }
  return tidy(out.join(""));
}

// ---------------------------------------------------------------------------------------------------------
// Old binary Office files (.doc .ppt .xls) are OLE "compound files". `cfb` opens the container; the readers
// below parse the streams inside.

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function oleStream(c: CFB.CFB$Container, ...names: string[]): Uint8Array | undefined {
  for (const n of names) {
    const e = CFB.find(c, "/" + n);
    if (e && e.content) return new Uint8Array(e.content as ArrayLike<number>);
  }
  return undefined;
}

// Old .doc: text lives in "pieces" listed in a table inside the 0Table/1Table stream.
function readDoc(c: CFB.CFB$Container): string {
  const wd = oleStream(c, "WordDocument");
  if (!wd || wd.length < 0x1b0 || u16(wd, 0) !== 0xa5ec) throw new Error("This .doc file is in an older Word format that cannot be read here.");
  const flags = u16(wd, 0x0a);
  if (flags & 0x0100) throw new Error("This Word file is password protected.");
  const table = oleStream(c, flags & 0x0200 ? "1Table" : "0Table");
  if (!table) throw new Error("Could not find the text table in this .doc file.");
  const ccpText = u32(wd, 0x4c);
  const fcClx = u32(wd, 0x1a2), lcbClx = u32(wd, 0x1a6);
  let p = fcClx;
  const end = fcClx + lcbClx;
  while (p < end && table[p] === 1) p += 3 + u16(table, p + 1); // skip formatting-only entries
  if (table[p] !== 2) throw new Error("Could not read the text layout of this .doc file.");
  const plc = p + 5;
  const n = (u32(table, p + 1) - 4) / 12;
  let raw = "";
  for (let i = 0; i < n; i++) {
    const cpStart = u32(table, plc + 4 * i);
    const len = Math.min(u32(table, plc + 4 * (i + 1)), ccpText) - cpStart;
    if (len <= 0) break;
    const fc = u32(table, plc + 4 * (n + 1) + 8 * i + 2);
    if (fc & 0x40000000) { const o = (fc & 0x3fffffff) >>> 1; raw += cp1252.decode(wd.subarray(o, o + len)); }
    else raw += utf16.decode(wd.subarray(fc, fc + len * 2));
  }
  // Clean Word's control characters. Field codes sit between \x13 and \x14; only the visible result (up to \x15) is kept.
  let out = "", depth = 0, inCode = false;
  const codeStack: boolean[] = [];
  for (const ch of raw) {
    if (ch === "\x13") { codeStack.push(inCode); inCode = true; depth++; continue; }
    if (ch === "\x14") { if (depth) inCode = false; continue; }
    if (ch === "\x15") { if (depth) { inCode = codeStack.pop() ?? false; depth--; } continue; }
    if (inCode) continue;
    if (ch === "\r" || ch === "\x0b" || ch === "\x0c") out += "\n";
    else if (ch === "\x07") out += out.endsWith("\t") || out.endsWith("\n") ? "\n" : "\t";
    else if (ch === "\x1e") out += "-";
    else if (ch < " " && ch !== "\t" && ch !== "\n") continue;
    else out += ch;
  }
  return tidy(out);
}

// Old .ppt: a tree of records. Text is stored in TextChars (UTF-16) and TextBytes (single byte) atoms.
function readPpt(c: CFB.CFB$Container): string {
  const s = oleStream(c, "PowerPoint Document");
  if (!s) throw new Error("Could not find the slides in this .ppt file.");
  const T_SLIDE = 0x03ee, T_NOTES = 0x03f0, T_MASTER = 0x03f8, T_SLWT = 0x0ff0, T_PERSIST = 0x03f3, T_CHARS = 0x0fa0, T_BYTES = 0x0fa8, T_HANDOUT = 0x0fc9;
  const listGroups: string[][] = [];   // text placed in slide placeholders (title, body)
  const slideGroups: string[][] = [];  // text in text boxes drawn on each slide
  const notes: string[] = [];
  const text = (type: number, off: number, len: number) =>
    (type === T_CHARS ? utf16.decode(s.subarray(off, off + len)) : cp1252.decode(s.subarray(off, off + len))).replace(/[\r\x0b]/g, "\n").replace(/\x00/g, "").trim();

  const walk = (start: number, end: number, where: "slide" | "list" | "notes" | "skip" | "other") => {
    let p = start;
    while (p + 8 <= end) {
      const verInst = u16(s, p), type = u16(s, p + 2), len = u32(s, p + 4);
      const body = p + 8, next = body + len;
      if (next > end || next < body) break;
      if ((verInst & 0xf) === 0xf) {
        if (type === T_MASTER || type === T_HANDOUT) { p = next; continue; }
        if (type === T_SLIDE) { slideGroups.push([]); walk(body, next, "slide"); }
        else if (type === T_NOTES) walk(body, next, "notes");
        else if (type === T_SLWT) {
          const inst = verInst >> 4;
          walk(body, next, inst === 0 ? "list" : inst === 2 ? "notes" : "skip");
        } else walk(body, next, where);
      } else if (type === T_PERSIST && where === "list") listGroups.push([]);
      else if ((type === T_CHARS || type === T_BYTES) && where !== "skip") {
        const t = text(type, body, len);
        if (t) {
          if (where === "list") (listGroups[listGroups.length - 1] ?? (listGroups.push([]), listGroups[0])).push(t);
          else if (where === "slide") slideGroups[slideGroups.length - 1].push(t);
          else if (where === "notes") notes.push(t);
        }
      }
      p = next;
    }
  };
  walk(0, s.length, "other");

  const count = Math.max(listGroups.length, slideGroups.length);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const body = [...(listGroups[i] ?? []), ...(slideGroups[i] ?? [])].join("\n");
    parts.push(`--- Slide ${i + 1} ---\n${body}`);
  }
  // Drop the template's placeholder prompts that PowerPoint stores with the notes page.
  const realNotes = notes.flatMap((n) => n.split("\n")).filter((l) => l.trim() && !/^(\*|\d+|Click to edit.*|(Second|Third|Fourth|Fifth) level)$/.test(l.trim()));
  if (realNotes.length) parts.push(`--- Speaker notes (in order, may not line up with slides) ---\n${realNotes.join("\n")}`);
  return parts.join("\n\n");
}

// Old .xls (Excel 97-2003, BIFF8): read the shared string table and the cell records of each sheet.
function readXls(c: CFB.CFB$Container): string {
  const wb = oleStream(c, "Workbook", "Book");
  if (!wb) throw new Error("Could not find the workbook in this .xls file.");
  const BOF = 0x0809, EOF = 0x000a, SST = 0x00fc, CONTINUE = 0x003c, BOUNDSHEET = 0x0085, LABELSST = 0x00fd, LABEL = 0x0204,
    NUMBER = 0x0203, RK = 0x027e, MULRK = 0x00bd, FORMULA = 0x0006, STRING = 0x0207;
  if (u16(wb, 0) !== BOF || u16(wb, 4) < 0x0600) throw new Error("This .xls file uses an old Excel format (before 1997) that cannot be read here.");

  const recs: { type: number; at: number; len: number }[] = [];
  for (let p = 0; p + 4 <= wb.length;) { const type = u16(wb, p), len = u16(wb, p + 2); recs.push({ type, at: p + 4, len }); p += 4 + len; }

  // Read a string that starts at chunk[ci][off]. The characters can continue into following CONTINUE chunks,
  // and each chunk that continues character data starts with one flag byte (high-byte or not).
  const readStr = (chunks: Uint8Array[], ci: number, off: number, cch: number, flags: number): { s: string; ci: number; off: number } => {
    let hi = (flags & 1) === 1, out = "";
    while (cch > 0) {
      if (off >= chunks[ci].length) { ci++; if (ci >= chunks.length) break; hi = (chunks[ci][0] & 1) === 1; off = 1; continue; }
      const room = chunks[ci].length - off, size = hi ? 2 : 1, take = Math.min(cch, Math.floor(room / size));
      if (take <= 0) { off = chunks[ci].length; continue; }
      const seg = chunks[ci].subarray(off, off + take * size);
      out += hi ? utf16.decode(seg) : cp1252.decode(seg);
      off += take * size; cch -= take;
    }
    return { s: out, ci, off };
  };
  const skipBytes = (chunks: Uint8Array[], ci: number, off: number, n: number) => {
    while (n > 0 && ci < chunks.length) { const room = chunks[ci].length - off; if (n < room) { off += n; n = 0; } else { n -= room; ci++; off = 0; } }
    return { ci, off };
  };

  // Shared strings (SST plus its CONTINUE records).
  const sst: string[] = [];
  const si = recs.findIndex((r) => r.type === SST);
  if (si >= 0) {
    const chunks: Uint8Array[] = [wb.subarray(recs[si].at, recs[si].at + recs[si].len)];
    for (let k = si + 1; k < recs.length && recs[k].type === CONTINUE; k++) chunks.push(wb.subarray(recs[k].at, recs[k].at + recs[k].len));
    const unique = u32(chunks[0], 4);
    let ci = 0, off = 8;
    for (let n = 0; n < unique && ci < chunks.length; n++) {
      if (off + 3 > chunks[ci].length) { ci++; off = 0; if (ci >= chunks.length) break; }
      const ch = chunks[ci];
      const cch = u16(ch, off), flags = ch[off + 2]; off += 3;
      let runs = 0, ext = 0;
      if (flags & 0x08) { runs = u16(ch, off); off += 2; }
      if (flags & 0x04) { ext = u32(ch, off); off += 4; }
      const r = readStr(chunks, ci, off, cch, flags);
      sst.push(r.s); ci = r.ci; off = r.off;
      ({ ci, off } = skipBytes(chunks, ci, off, runs * 4 + ext));
    }
  }

  const sheetNames: string[] = [];
  for (const r of recs) if (r.type === BOUNDSHEET) { const cch = wb[r.at + 6], fl = wb[r.at + 7]; sheetNames.push(readStr([wb.subarray(r.at + 8, r.at + r.len)], 0, 0, cch, fl).s); }

  const rk = (v: number) => {
    let x: number;
    if (v & 2) x = (v | 0) >> 2;
    else { const dv = new DataView(new ArrayBuffer(8)); dv.setUint32(4, v & 0xfffffffc, true); x = dv.getFloat64(0, true); }
    return v & 1 ? x / 100 : x;
  };
  const f64 = (o: number) => new DataView(wb.buffer, wb.byteOffset + o, 8).getFloat64(0, true);
  const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10));

  const sheets: Map<number, Map<number, string>>[] = [];
  let cur: Map<number, Map<number, string>> | null = null;
  let lastFormula: { row: number; col: number } | null = null;
  const put = (row: number, col: number, v: string) => { if (!cur) return; let r = cur.get(row); if (!r) cur.set(row, (r = new Map())); r.set(col, v); };
  for (const r of recs) {
    if (r.type === BOF) {
      // dt 0x0010 = worksheet. Anything else (workbook globals, charts, macros) holds no cells we read.
      if (u16(wb, r.at + 2) === 0x0010) { cur = new Map(); sheets.push(cur); } else cur = null;
      continue;
    }
    if (r.type === EOF) continue;
    if (!cur) continue;
    const row = u16(wb, r.at), col = u16(wb, r.at + 2);
    if (r.type === LABELSST) put(row, col, sst[u32(wb, r.at + 6)] ?? "");
    else if (r.type === NUMBER) put(row, col, num(f64(r.at + 6)));
    else if (r.type === RK) put(row, col, num(rk(u32(wb, r.at + 6))));
    else if (r.type === MULRK) { const last = u16(wb, r.at + r.len - 2); for (let k = col; k <= last; k++) put(row, k, num(rk(u32(wb, r.at + 4 + (k - col) * 6 + 2)))); }
    else if (r.type === LABEL) { const cch = u16(wb, r.at + 6), fl = wb[r.at + 8]; put(row, col, readStr([wb.subarray(r.at + 9, r.at + r.len)], 0, 0, cch, fl).s); }
    else if (r.type === FORMULA) {
      // The 8-byte result at +6 is a number, unless its last two bytes are 0xFFFF: then its first byte says what it is.
      const res = r.at + 6;
      if (u16(wb, res + 6) !== 0xffff) { lastFormula = null; put(row, col, num(f64(res))); }
      else if (wb[res] === 0) lastFormula = { row, col };            // text: arrives in the next STRING record
      else { lastFormula = null; if (wb[res] === 1) put(row, col, wb[res + 2] ? "TRUE" : "FALSE"); }
    } else if (r.type === STRING && lastFormula) {
      const cch = u16(wb, r.at), fl = wb[r.at + 2];
      put(lastFormula.row, lastFormula.col, readStr([wb.subarray(r.at + 3, r.at + r.len)], 0, 0, cch, fl).s); lastFormula = null;
    }
  }
  const out = sheets.map((m, i) => {
    const rows = [...m.keys()].sort((a, b) => a - b).map((ri) => {
      const cells = m.get(ri)!, maxc = Math.max(...cells.keys());
      return Array.from({ length: maxc + 1 }, (_, k) => cells.get(k) ?? "").join("\t");
    });
    return `--- Sheet: ${sheetNames[i] ?? i + 1} ---\n${rows.join("\n")}`;
  });
  return out.join("\n\n");
}

function readOle(bytes: Uint8Array, e: string): Extracted {
  let c: CFB.CFB$Container;
  try { c = CFB.read(bytes, { type: "array" }); } catch { throw new Error("Could not open this Office file. It may be damaged."); }
  const has = (n: string) => !!CFB.find(c, "/" + n);
  if (has("WordDocument")) return { kind: "Word document (old .doc)", text: readDoc(c) };
  if (has("PowerPoint Document")) return { kind: "PowerPoint (old .ppt)", text: readPpt(c) };
  if (has("Workbook") || has("Book")) return { kind: "Excel (old .xls)", text: readXls(c) };
  throw new Error(`Cannot read this .${e || "unknown"} file (an Office file of a type that is not supported). Use get_file to download it.`);
}

// ---------------------------------------------------------------------------------------------------------
// New Office files (.pptx .docx .xlsx)

function readPptx(bytes: Uint8Array): Extracted {
  const z = unzipSync(bytes);
  const slides = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort(numeric);
  const parts = slides.map((k, i) => {
    const n = Number(k.match(/(\d+)\.xml$/)![1]);
    const body = paragraphs(strFromU8(z[k]), "a:p", "a:t");
    // A slide's notes are found through its relationships file, because notesSlide numbers do not match slide numbers.
    const rels = z[`ppt/slides/_rels/slide${n}.xml.rels`];
    const target = rels ? strFromU8(rels).match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1] : undefined;
    const nf = target ? z[`ppt/notesSlides/${target}`] : undefined;
    const nt = nf ? paragraphs(strFromU8(nf), "a:p", "a:t").split("\n").filter((l) => !/^\d+$/.test(l)).join("\n") : "";
    return `--- Slide ${i + 1} ---\n${body}${nt ? `\n[Speaker notes]\n${nt}` : ""}`;
  });
  return { kind: `PowerPoint, ${slides.length} slides`, text: parts.join("\n\n") };
}

function readXlsx(bytes: Uint8Array): Extracted {
  const z = unzipSync(bytes);
  const shared = z["xl/sharedStrings.xml"]
    ? [...strFromU8(z["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        decodeXml([...m[1].matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join("")))
    : [];
  const wbXml = z["xl/workbook.xml"] ? strFromU8(z["xl/workbook.xml"]) : "";
  const names = [...wbXml.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const sheets = Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort(numeric);
  const parts = sheets.map((k, i) => {
    const rows: string[] = [];
    for (const r of strFromU8(z[k]).matchAll(/<row[ >][\s\S]*?<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[0].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = c[2]?.match(/<v>([^<]*)<\/v>/)?.[1] ?? c[2]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? "";
        cells.push(/t="s"/.test(c[1]) ? shared[Number(v)] ?? "" : decodeXml(v));
      }
      if (cells.some(Boolean)) rows.push(cells.join("\t"));
    }
    return `--- Sheet: ${names[i] ?? i + 1} ---\n${rows.join("\n")}`;
  });
  return { kind: `Excel, ${sheets.length} sheets`, text: parts.join("\n\n") };
}

// ---------------------------------------------------------------------------------------------------------

export async function extractFileText(buf: ArrayBuffer, fileName: string, contentType?: string): Promise<Extracted> {
  let e = ext(fileName);
  const bytes = new Uint8Array(buf);
  const ct = (contentType ?? "").toLowerCase();

  // Trust the contents over the file name.
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isPdf) e = "pdf";
  else if (isOle) return readOle(bytes, e);
  else if (isZip) {
    let names: string[] = [];
    try { names = zipEntries(bytes).map((x) => x.name); } catch { /* not a readable ZIP: handled below */ }
    if (names.includes("ppt/slides/slide1.xml")) e = "pptx";
    else if (names.includes("word/document.xml")) e = "docx";
    else if (names.includes("xl/workbook.xml")) e = "xlsx";
    else if (names.includes("mimetype") && names.includes("content.xml")) {
      const mt = strFromU8(unzipOnly(bytes, ["mimetype"])["mimetype"] ?? new Uint8Array());
      if (mt.includes("text")) return readOdf(bytes, "odt");
      if (mt.includes("presentation")) return readOdf(bytes, "odp");
      if (mt.includes("spreadsheet")) return readOdf(bytes, "ods");
    } else if (names.length) return await readZip(bytes);
  } else if (bytes[0] === 0x7b && bytes[1] === 0x5c && bytes[2] === 0x72 && bytes[3] === 0x74 && bytes[4] === 0x66) e = "rtf";

  if (e === "pdf" || ct.includes("pdf")) {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`);
    const chars = (text as string[]).join("").replace(/\s/g, "").length;
    return {
      kind: `PDF, ${totalPages} pages`,
      text: pages.join("\n\n"),
      note: chars < 20 * Math.max(1, totalPages) ? "Very little text found. This PDF is probably scanned images, so it cannot be read here." : undefined,
    };
  }
  if (e === "pptx" || e === "ppsx") return readPptx(bytes);
  if (e === "docx") {
    const doc = unzipOnly(bytes, ["word/document.xml"])["word/document.xml"];
    if (!doc) throw new Error("Not a valid .docx file");
    return { kind: "Word document", text: paragraphs(strFromU8(doc), "w:p", "w:t") };
  }
  if (e === "xlsx") return readXlsx(bytes);
  if (e === "rtf") return { kind: "Rich Text file", text: readRtf(new TextDecoder("latin1").decode(bytes)) };

  if (["txt", "md", "csv", "tsv", "json", "xml", "html", "htm"].includes(e) || ct.startsWith("text/")) {
    let t = new TextDecoder("utf-8").decode(bytes);
    if (e === "html" || e === "htm") t = decodeXml(t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " "));
    return { kind: e === "html" || e === "htm" ? "Web page" : "Text file", text: tidy(t) };
  }

  throw new Error(
    `Cannot read .${e || "unknown"} files as text (supported: PDF, PowerPoint, Word, Excel, OpenDocument, RTF, HTML and plain text). ` +
    `Images, videos and other file types need to be downloaded with get_file instead.`,
  );
}
