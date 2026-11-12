// Pulls plain text out of course files so an AI agent can read them. Runs inside the Worker, so the file is
// fetched and parsed here and only the text goes back to the agent.

import { unzipSync, strFromU8 } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";

export interface Extracted {
  text: string;
  kind: string;
  note?: string; // e.g. "no text layer, probably a scan"
}

const ext = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

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

// A plain ZIP: read the files inside that we can read (PDF and Office files, up to a few).
async function readZip(bytes: Uint8Array): Promise<Extracted> {
  // First pass only lists the entries (nothing is unpacked), so a huge archive cannot exhaust memory.
  const entries: { name: string; size: number }[] = [];
  unzipSync(bytes, { filter: (f) => { if (!f.name.endsWith("/") && !f.name.startsWith("__MACOSX/")) entries.push({ name: f.name, size: f.originalSize }); return false; } });
  const names = entries.map((e) => e.name);
  const MAX_ENTRY = 15_000_000;
  const readable = entries.filter((e) => /\.(pdf|pptx|docx|xlsx|txt|md|csv|html?)$/i.test(e.name) && e.size <= MAX_ENTRY).slice(0, 5).map((e) => e.name);
  if (!readable.length) throw new Error(`This ZIP has no readable files. It contains: ${names.slice(0, 15).join(", ") || "(nothing)"}. Use get_file to download it.`);
  const z = unzipSync(bytes, { filter: (f) => readable.includes(f.name) });
  const parts: string[] = [];
  for (const n of readable) {
    const f = z[n];
    const r = await extractFileText(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer, n);
    parts.push(`===== ${n} (${r.kind}) =====\n${r.text}`);
  }
  const skipped = names.length - readable.length;
  return { kind: `ZIP with ${names.length} files`, text: parts.join("\n\n"), note: skipped > 0 ? `${skipped} other file(s) in the ZIP were not read: ${names.filter((n) => !readable.includes(n)).slice(0, 10).join(", ")}` : undefined };
}

const numeric = (a: string, b: string) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

export async function extractFileText(buf: ArrayBuffer, fileName: string, contentType?: string): Promise<Extracted> {
  let e = ext(fileName);
  const bytes = new Uint8Array(buf);
  const ct = (contentType ?? "").toLowerCase();

  // Trust the contents over the file name: look inside ZIP-based files, and recognise PDFs by their header.
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) e = "pdf";
  else if (bytes[0] === 0x50 && bytes[1] === 0x4b && !["pptx", "ppsx", "docx", "xlsx"].includes(e)) {
    let names: string[] = [];
    try {
      names = Object.keys(unzipSync(bytes, { filter: (f) => /^(ppt\/slides\/slide1\.xml|word\/document\.xml|xl\/workbook\.xml)$/.test(f.name) }));
    } catch { /* not a readable ZIP: fall through to the unsupported message */ }
    if (names.includes("ppt/slides/slide1.xml")) e = "pptx";
    else if (names.includes("word/document.xml")) e = "docx";
    else if (names.includes("xl/workbook.xml")) e = "xlsx";
    else if (e === "zip") return await readZip(bytes);
  }

  if (e === "pdf" || ct.includes("pdf")) {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`);
    const all = pages.join("\n\n");
    const chars = (text as string[]).join("").replace(/\s/g, "").length;
    return {
      kind: `PDF, ${totalPages} pages`,
      text: all,
      note: chars < 20 * Math.max(1, totalPages) ? "Very little text found. This PDF is probably scanned images, so it cannot be read here." : undefined,
    };
  }

  if (e === "pptx" || e === "ppsx") {
    const z = unzipSync(bytes);
    const slides = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort(numeric);
    const notes = (n: number) => z[`ppt/notesSlides/notesSlide${n}.xml`];
    const parts = slides.map((k, i) => {
      const n = Number(k.match(/(\d+)\.xml$/)![1]);
      const body = paragraphs(strFromU8(z[k]), "a:p", "a:t");
      const nt = notes(n) ? paragraphs(strFromU8(notes(n)), "a:p", "a:t") : "";
      return `--- Slide ${i + 1} ---\n${body}${nt ? `\n[Speaker notes]\n${nt}` : ""}`;
    });
    return { kind: `PowerPoint, ${slides.length} slides`, text: parts.join("\n\n") };
  }

  if (e === "docx") {
    const z = unzipSync(bytes);
    const doc = z["word/document.xml"];
    if (!doc) throw new Error("Not a valid .docx file");
    return { kind: "Word document", text: paragraphs(strFromU8(doc), "w:p", "w:t") };
  }

  if (e === "xlsx") {
    const z = unzipSync(bytes);
    const shared = z["xl/sharedStrings.xml"]
      ? [...strFromU8(z["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
          decodeXml([...m[1].matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join("")))
      : [];
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
      return `--- Sheet ${i + 1} ---\n${rows.join("\n")}`;
    });
    return { kind: `Excel, ${sheets.length} sheets`, text: parts.join("\n\n") };
  }

  if (["txt", "md", "csv", "tsv", "json", "xml", "html", "htm", "rtf"].includes(e) || ct.startsWith("text/")) {
    let t = new TextDecoder("utf-8").decode(bytes);
    if (e === "html" || e === "htm") t = decodeXml(t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " "));
    return { kind: "Text file", text: t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() };
  }

  throw new Error(
    `Cannot read .${e || "unknown"} files as text (supported: PDF, PowerPoint .pptx, Word .docx, Excel .xlsx, and plain text). ` +
    `Old .ppt, .doc and .xls files, images, videos and archives need to be downloaded with get_file instead.`,
  );
}
