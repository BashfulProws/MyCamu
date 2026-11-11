// Client for Camu's internal web API (portal at student.camu.in, LMS at teacher.camu.in).
// Endpoints and request shapes were verified against a real student account.
// Nothing here logs responses: they contain personal data.

export class CamuAuthError extends Error {}

type Host = "portal" | "lms";
type Jar = Record<string, string>;

interface Session {
  jars: Record<Host, Jar>;
  stuId: string;
  prog: Record<string, any>; // current progression record from login
  lmsProg?: Record<string, any>; // matching record from /lms/get-stu-prog-det
  at: number;
}

export interface LmsSubject {
  subjId: string;
  deptId: string;
  SecID: string;
  CrID: string;
  PrID: string;
  SemID: string;
  AcYr: string;
  subNm: string;
  subDes: string;
}

export interface ContentItem {
  id: string;
  title: string;
  type: string; // FILE | PAGE | ...
  chapter: string;
  subChapter: string;
  html?: string;
}

const SESSION_KEY = "camu:session";
const COOLDOWN_KEY = "camu:login-cooldown";
const SESSION_MAX_AGE_MS = 6 * 3600 * 1000;

export function istDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d); // YYYY-MM-DD
}

function usrTime(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${parts.day}-${parts.month}-${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
}

export function pageToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export class Camu {
  private s!: Session;
  constructor(private env: Env) {}

  /** Run `fn` with a valid session; re-login once if Camu says the session is dead. */
  async run<T>(fn: (c: Camu) => Promise<T>): Promise<T> {
    const cached = await this.env.OAUTH_KV.get<Session>(SESSION_KEY, "json");
    if (cached && Date.now() - cached.at < SESSION_MAX_AGE_MS) this.s = cached;
    else await this.login();
    try {
      return await this.save(await fn(this));
    } catch (e) {
      if (!(e instanceof CamuAuthError)) throw e;
      await this.login();
      return await this.save(await fn(this));
    }
  }

  private async save<T>(result: T): Promise<T> {
    await this.env.OAUTH_KV.put(SESSION_KEY, JSON.stringify(this.s), { expirationTtl: SESSION_MAX_AGE_MS / 1000 });
    return result;
  }

  private async http(host: Host, method: "GET" | "POST", path: string, body?: unknown, allowRedirect = false): Promise<any> {
    const base = host === "portal" ? this.env.CAMU_BASE_URL : this.env.CAMU_LMS_URL;
    const jar = this.s.jars[host];
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
        csrf: "token",
        appversion: "v2",
        clienttzofst: "330",
        Origin: base,
        Referer: base + "/",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1);
    }
    if (allowRedirect && res.status >= 300 && res.status < 400) return null;
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new CamuAuthError(`${host} ${path} returned ${res.status}`);
    }
    let json: any;
    try { json = await res.json(); } catch { throw new CamuAuthError(`${host} ${path} returned non-JSON`); }
    const code = json?.output?.errors?.code ?? json?.output?.data?.code;
    if (typeof code === "string" && /SESSION|UNAUTH|NOT_LOGGED|LOGIN_REQ/i.test(code)) throw new CamuAuthError(code);
    return json;
  }

  private async login(): Promise<void> {
    // After any failed login, stop trying for a while: repeated bad logins can trigger Camu's
    // rate limit or lock the account.
    if (await this.env.OAUTH_KV.get(COOLDOWN_KEY)) {
      throw new Error("Camu login is paused for a few minutes after a failed attempt. Try again shortly.");
    }
    this.s = { jars: { portal: {}, lms: {} }, stuId: "", prog: {}, at: Date.now() };
    const r = await this.http("portal", "POST", "/login/validate", { dtype: "M", Email: this.env.CAMU_EMAIL, pwd: this.env.CAMU_PASSWORD });
    const data = r?.output?.data;
    if (!data || data.code === "INCRT_CRD" || !data.progressionData?.length) {
      const reason = r?.output?.errors?.[0]?.code ?? data?.code ?? "unexpected response";
      await this.env.OAUTH_KV.put(COOLDOWN_KEY, reason, { expirationTtl: reason === "RATE_LIMIT_EXCEEDED" ? 900 : 300 });
      throw new Error(
        reason === "RATE_LIMIT_EXCEEDED"
          ? "Camu is rate-limiting logins. Pausing for 15 minutes."
          : `Camu login failed (${reason}). Check the CAMU_EMAIL and CAMU_PASSWORD secrets. Pausing for 5 minutes.`,
      );
    }
    this.s.prog = data.progressionData[0];
    this.s.stuId = data.logindetails.Student[0].StuID;
  }

  // ---- portal: timetable and attendance -------------------------------------------------

  async timetable(from: string, to: string) {
    const r = await this.http("portal", "POST", "/api/Timetable/get", {
      ...this.s.prog, enableV2: true, start: from, end: to, usrTime: usrTime(),
      schdlTyp: "slctdSchdl", isShowCancelledPeriod: true, isFromTt: true,
    });
    const days: any[] = r?.output?.data ?? [];
    // Times carry a "+00:00" label but are the local wall-clock times, so they are not converted.
    return days.flatMap((d) => d.Periods ?? []).map((p: any) => ({
      date: String(p.start).slice(0, 10),
      start: String(p.start).slice(11, 16),
      end: String(p.end).slice(11, 16),
      subject: p.SubNa as string,
      staff: p.StaffNm as string,
      location: p.Location as string,
    })).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }

  async attendance() {
    const p = this.s.prog;
    const r = await this.http("portal", "POST", "/api/Attendance/getDtaForStupage", {
      InId: p.InId, PrID: p.PrID, CrID: p.CrID, DeptID: p.DeptID, SemID: p.SemID, AcYr: p.AcYr, SecID: p.SecID,
      CmProgID: p._id, StuID: this.s.stuId, isFE: !!p.isFE, isForWeb: true, isFrAbLg: true, isMinAttPer: true,
    });
    const d = r?.output?.data;
    if (!d) throw new Error("Camu returned no attendance data");
    return {
      overallPercent: d.OvrAllPrcntg as number,
      subjects: (d.subjectList ?? []).map((s: any) => ({
        code: s.SubjCd as string, name: s.SubjNm as string,
        present: s.pnt as number, absent: s.absentCnt as number, total: s.all as number, percent: s.p as number,
      })),
    };
  }

  // ---- LMS: subjects, content, files ----------------------------------------------------

  private async lms(path: string, body: unknown): Promise<any> {
    if (!Object.keys(this.s.jars.lms).length) await this.authLms();
    return this.http("lms", "POST", path, body);
  }

  private async authLms() {
    const t = await this.http("portal", "POST", "/api/login/get-lms-auth-token", {});
    const token = t?.output?.data?.token;
    if (!token) throw new CamuAuthError("no LMS token");
    await this.http("lms", "POST", "/lms/auth", { token }, true); // answers 301 but sets the session cookie
    if (!Object.keys(this.s.jars.lms).length) throw new CamuAuthError("LMS login did not set a session");
  }

  private async lmsContext() {
    if (this.s.lmsProg) return;
    const r = await this.lms("/lms/get-stu-prog-det", {});
    const all: any[] = r?.output?.data ?? [];
    this.s.lmsProg = all.find((x) => x.semRstd === this.s.prog.SemID) ?? all[0];
    if (!this.s.lmsProg) throw new Error("LMS has no programme record for you");
  }

  async subjects(): Promise<LmsSubject[]> {
    await this.lmsContext();
    const r = await this.lms("/lms/get-stu-sub-det", {
      ...this.s.lmsProg, ...this.s.prog, semRstd: this.s.lmsProg!.semRstd,
      isFrmLms: true, isAllSubj: "No", Origins: "AsgmtTracker", studId: this.s.stuId,
    });
    return r?.output?.data ?? [];
  }

  async findSubject(query: string): Promise<LmsSubject> {
    const subs = await this.subjects();
    const q = query.trim().toLowerCase();
    const exact = subs.filter((s) => s.subNm.toLowerCase() === q || s.subDes.toLowerCase() === q);
    const hits = exact.length ? exact : subs.filter((s) => `${s.subDes} ${s.subNm}`.toLowerCase().includes(q));
    if (hits.length === 1) return hits[0];
    const names = (hits.length ? hits : subs).map((s) => s.subNm).join("; ");
    throw new Error(hits.length ? `"${query}" matches several subjects: ${names}` : `No subject matches "${query}". Subjects: ${names}`);
  }

  async content(subject: LmsSubject): Promise<ContentItem[]> {
    await this.lmsContext();
    const cur = this.s.prog;
    const plans = await this.lms("/TeachContentDefinition/searchbyteachcriteria/", {
      InId: cur.InId, PrID: cur.PrID, CrID: cur.CrID, DeptID: subject.deptId, SemID: this.s.lmsProg!.semRstd,
      SecID: subject.SecID, AcYr: cur.AcYr, SubjId: subject.subjId, isFE: false, StudID: this.s.stuId, isFrmLms: true,
    });
    const plan = (plans?.output?.data ?? []).find((x: any) => x.SubjId === subject.subjId);
    if (!plan) return [];
    const items = await this.lms("/teaching-content/get-subchapter-items", {
      tCntId: plan.TPID, subjId: subject.subjId, PrID: subject.PrID, CrID: subject.CrID, AcYr: subject.AcYr,
      DeptID: subject.deptId, SemID: subject.SemID, SecID: subject.SecID, isExpAll: true,
    });
    const chapters: any[] = plan.Chapter ?? [];
    const chapName = new Map(chapters.map((c) => [c._id, c.ChapName as string]));
    const subName = new Map<string, string>(chapters.flatMap((c) => (c.SubChapter ?? []).map((s: any): [string, string] => [s._id, s.Name])));
    const order = new Map(chapters.map((c, i) => [c._id, i]));
    const list: any[] = items?.output?.data?.aContents ?? [];
    return list
      .sort((a, b) => (order.get(a.chapId) ?? 0) - (order.get(b.chapId) ?? 0) || (a.seqNo ?? 0) - (b.seqNo ?? 0))
      .map((it) => ({
        id: it._id, title: it.title, type: it.type,
        chapter: chapName.get(it.chapId) ?? "", subChapter: subName.get(it.sChpId) ?? "",
        html: it.page?.html,
      }));
  }

  /** Returns a temporary download URL (or an external link) for a FILE item. */
  async fileLink(itemId: string): Promise<{ name: string; url: string; contentType?: string; external: boolean }> {
    const det = await this.lms("/lms-content/get-cntn-det-for-list-or-edit", { contntId: itemId, projct: { title: 1, isView: 1, file: 1, vSts: 1 } });
    const file = det?.output?.data?.file;
    if (!file) throw new Error("This item has no file");
    if (file.fileTy && file.fileTy !== "LOCL") {
      return { name: file.name ?? det.output.data.title, url: file.url ?? file.link ?? file.embedUrl, external: true };
    }
    const dl = await this.lms("/lms/centralreportstore/initialize-FileDownload", { ...file, name: file.name });
    const url = dl?.output?.data?.presignedUrl;
    if (!url) throw new Error("Camu did not return a download link");
    return { name: file.name ?? det.output.data.title, url, contentType: dl.output.data.ContentType, external: false };
  }
}
