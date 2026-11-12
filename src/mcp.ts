import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Camu, istDate, pageToText, type ContentItem } from "./camu";
import { extractFileText } from "./extract";

const MAX_DOWNLOAD_BYTES = 30_000_000; // refuse very large files so the Worker stays within its memory limit
const DEFAULT_CHARS = 40_000; // one reply holds about this much text; the agent can ask for the next part

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });

function guard<A>(fn: (a: A) => Promise<{ content: any[] }>) {
  return async (a: A) => {
    try { return await fn(a); } catch (e) { return fail(e); }
  };
}

function pickItem(items: ContentItem[], title: string): ContentItem {
  const q = title.trim().toLowerCase();
  const exact = items.filter((i) => i.title.toLowerCase() === q);
  const hits = exact.length ? exact : items.filter((i) => i.title.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No item titled "${title}". Use list_course_files to see titles.`);
  throw new Error(`"${title}" matches several items: ${hits.map((h) => `${h.title} (${h.chapter})`).join("; ")}`);
}

export function createServer(env: Env) {
  const server = new McpServer({ name: "camu", version: "0.1.0" });
  const camu = () => new Camu(env);
  const target = Number(env.MIN_ATTENDANCE) || 75;

  server.registerTool("get_timetable", {
    description: "Class timetable from MyCamu. Defaults to today (IST). Times are local class times.",
    inputSchema: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD (default today, IST)"),
      days: z.number().int().min(1).max(31).optional().describe("How many days from the start date (default 1)"),
    }),
    annotations: { readOnlyHint: true },
  }, guard(async ({ date, days }) => {
    const from = date ?? istDate();
    const to = new Date(Date.parse(from + "T00:00:00Z") + ((days ?? 1) - 1) * 86400000).toISOString().slice(0, 10);
    const rows = await camu().run((c) => c.timetable(from, to));
    if (!rows.length) return text(`No classes found from ${from} to ${to}.`);
    return text(rows.map((r) => `${r.date} ${r.start}-${r.end}  ${r.subject}  (${r.staff}, ${r.location})`).join("\n"));
  }));

  server.registerTool("get_attendance", {
    description: `Attendance per subject, with how many classes you can still miss or must attend to stay at the target (${target}%).`,
    inputSchema: z.object({
      subject: z.string().optional().describe("Filter by subject name or code"),
      target: z.number().min(1).max(99).optional().describe(`Attendance target percent (default ${target})`),
    }),
    annotations: { readOnlyHint: true },
  }, guard(async ({ subject, target: t }) => {
    const goal = t ?? target;
    const a = await camu().run((c) => c.attendance());
    const rows = a.subjects.filter((s: any) => !subject || `${s.code} ${s.name}`.toLowerCase().includes(subject.toLowerCase()));
    const lines = rows.map((s: any) => {
      const pct = s.total ? (100 * s.present) / s.total : 100;
      const advice = pct >= goal
        ? `can miss ${Math.max(0, Math.floor((100 * s.present) / goal - s.total))} more in a row`
        : `must attend next ${Math.ceil((goal * s.total - 100 * s.present) / (100 - goal))} in a row to reach ${goal}%`;
      return `${s.name}: ${s.present}/${s.total} present (${pct.toFixed(1)}%), absent ${s.absent}; ${advice}`;
    });
    return text(`Overall: ${a.overallPercent}%  (target ${goal}%)\n` + (lines.join("\n") || "No matching subject."));
  }));

  server.registerTool("list_subjects", {
    description: "Subjects you are enrolled in this term (from the MyCamu LMS).",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, guard(async () => {
    const subs = await camu().run((c) => c.subjects());
    return text(subs.map((s) => `${s.subDes} - ${s.subNm}`).join("\n") || "No subjects found.");
  }));

  server.registerTool("list_course_files", {
    description: "Lists the chapters, files and pages your professors have uploaded for a subject.",
    inputSchema: z.object({ subject: z.string().describe("Subject name or code, partial is fine") }),
    annotations: { readOnlyHint: true },
  }, guard(async ({ subject }) => {
    const { sub, items } = await camu().run(async (c) => { const sub = await c.findSubject(subject); return { sub, items: await c.content(sub) }; });
    if (!items.length) return text(`${sub.subNm}: nothing uploaded.`);
    let last = "";
    const out: string[] = [`${sub.subNm}: ${items.length} items`];
    for (const i of items) {
      const group = `${i.chapter} / ${i.subChapter}`;
      if (group !== last) { out.push(`\n## ${group}`); last = group; }
      out.push(`- [${i.type}] ${i.title}`);
    }
    return text(out.join("\n"));
  }));

  server.registerTool("get_file", {
    description: "Gets one uploaded item. Pages come back as text. Files come back as a temporary download link that expires in about 5 minutes. To READ or summarize a file, use read_file instead (the agent usually cannot open this link). To store a file in the user's cloud storage, pass the link right away to a storage tool that can save a file from a URL (if one is connected); otherwise give the user the link to open in a browser.",
    inputSchema: z.object({
      subject: z.string(),
      title: z.string().describe("Item title, partial is fine"),
    }),
    annotations: { readOnlyHint: true },
  }, guard(async ({ subject, title }) => {
    const r = await camu().run(async (c) => {
      const sub = await c.findSubject(subject);
      const item = pickItem(await c.content(sub), title);
      if (item.type === "PAGE") return { item, page: pageToText(item.html ?? "") };
      return { item, link: await c.fileLink(item.id) };
    });
    if ("page" in r) return text(`${r.item.title}\n\n${r.page || "(empty page)"}`);
    return text(`${r.link.name}${r.link.external ? " (external link)" : ""}\n${r.link.url}`);
  }));

  server.registerTool("read_file", {
    description: "Reads the TEXT of an uploaded file so you can summarize or answer questions about it. Works for PDF, PowerPoint (.pptx), Word (.docx), Excel (.xlsx) and text files. Long files come back in parts: if the reply says more is available, call again with the given offset. Scanned PDFs have no text and cannot be read.",
    inputSchema: z.object({
      subject: z.string().describe("Subject name or code, partial is fine"),
      title: z.string().describe("Item title, partial is fine (see list_course_files)"),
      offset: z.number().int().min(0).optional().describe("Character position to continue from (default 0)"),
      max_chars: z.number().int().min(1000).max(100000).optional().describe(`Most characters to return (default ${DEFAULT_CHARS})`),
    }),
    annotations: { readOnlyHint: true },
  }, guard(async ({ subject, title, offset, max_chars }) => {
    const r = await camu().run(async (c) => {
      const sub = await c.findSubject(subject);
      const item = pickItem(await c.content(sub), title);
      if (item.type === "PAGE") return { item, page: pageToText(item.html ?? "") };
      return { item, link: await c.fileLink(item.id) };
    });
    let body: string, kind: string, note: string | undefined;
    if ("page" in r) { body = r.page ?? ""; kind = "Page"; }
    else {
      if (r.link.external) return text(`${r.item.title} is an external link, not a file: ${r.link.url}`);
      const res = await fetch(r.link.url);
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_DOWNLOAD_BYTES) throw new Error(`File is too large to read here (${(len / 1e6).toFixed(0)} MB). Use get_file for a download link.`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`File is too large to read here (${(buf.byteLength / 1e6).toFixed(0)} MB). Use get_file for a download link.`);
      ({ text: body, kind, note } = await extractFileText(buf, r.link.name, r.link.contentType));
    }
    const start = offset ?? 0, size = max_chars ?? DEFAULT_CHARS;
    if (!body.trim()) return text(`${r.item.title} (${kind}): no text found.${note ? " " + note : ""}`);
    if (start >= body.length) return text(`${r.item.title}: offset ${start} is past the end (${body.length} characters).`);
    const part = body.slice(start, start + size), end = start + part.length;
    const head = `${r.item.title} (${kind}), characters ${start}-${end} of ${body.length}${note ? "\n" + note : ""}`;
    const tail = end < body.length ? `\n\n[More available. Call read_file again with offset=${end}.]` : "\n\n[End of file.]";
    return text(`${head}\n\n${part}${tail}`);
  }));

  return server;
}
