// Job Hunter search API (Vercel serverless function).
// GET /api/search?q=designer&where=Berlin&country=de&remote=1
// Combines free job sources into one list:
//   - Arbeitnow  (no key, jobs in Germany + remote)
//   - Himalayas  (no key, remote jobs worldwide)
//   - Adzuna     (free key, most countries) – only when ADZUNA_APP_ID and ADZUNA_APP_KEY are set

const ADZUNA_COUNTRIES = new Set(["at", "au", "be", "br", "ca", "ch", "de", "es", "fr", "gb", "in", "it", "mx", "nl", "nz", "pl", "sg", "us", "za"]);
const UA = { "User-Agent": "JobHunter/0.1 (+https://github.com)" , Accept: "application/json" };

const cache = new Map(); // warm-instance cache: key -> { at, value }
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

export function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const toIso = (sec) => (Number.isFinite(Number(sec)) && Number(sec) > 0 ? new Date(Number(sec) * 1000).toISOString() : null);
const words = (q) => q.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter((w) => w.length > 1);

// Every search word must appear somewhere in the job text.
export function matchesQuery(text, q) {
  const t = text.toLowerCase();
  return words(q).every((w) => t.includes(w));
}

// ---------- Arbeitnow ----------
async function arbeitnowPages(pages = 3) {
  return cached("arbeitnow", 30 * 60 * 1000, async () => {
    const all = [];
    for (let p = 1; p <= pages; p++) {
      const r = await fetch(`https://www.arbeitnow.com/api/job-board-api?page=${p}`, { headers: UA });
      if (!r.ok) break;
      const j = await r.json();
      if (!Array.isArray(j.data) || !j.data.length) break;
      all.push(...j.data);
    }
    return all;
  });
}

export function normalizeArbeitnow(j) {
  const text = stripHtml(j.description);
  return {
    id: "an-" + j.slug,
    title: String(j.title || ""),
    company: String(j.company_name || ""),
    location: String(j.location || ""),
    remote: !!j.remote,
    url: String(j.url || ""),
    posted: toIso(j.created_at),
    salary: "",
    snippet: text.slice(0, 280),
    tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
    source: "Arbeitnow",
    _text: [j.title, j.company_name, (j.tags || []).join(" "), text].join(" ")
  };
}

async function searchArbeitnow({ q, where, remote }) {
  const raw = await arbeitnowPages();
  return raw.map(normalizeArbeitnow).filter((j) => {
    if (!matchesQuery(j._text, q)) return false;
    if (remote && !j.remote) return false;
    if (where && !remote && !j.remote && !j.location.toLowerCase().includes(where.toLowerCase())) return false;
    return true;
  });
}

// ---------- Himalayas ----------
export function normalizeHimalayas(j) {
  const places = Array.isArray(j.locationRestrictions) ? j.locationRestrictions.map((x) => (typeof x === "string" ? x : x?.name || "")).filter(Boolean) : [];
  const cur = j.currency || "";
  const salary = j.minSalary || j.maxSalary
    ? `${cur} ${j.minSalary ? Math.round(j.minSalary).toLocaleString("en") : ""}${j.maxSalary ? "–" + Math.round(j.maxSalary).toLocaleString("en") : ""}${j.salaryPeriod === "annual" ? " / year" : ""}`.trim()
    : "";
  return {
    id: "hm-" + (j.guid || j.applicationLink || j.title),
    title: String(j.title || ""),
    company: String(j.companyName || ""),
    location: places.length ? "Remote · " + places.slice(0, 3).join(", ") : "Remote · Worldwide",
    remote: true,
    url: String(j.guid || j.applicationLink || "https://himalayas.app"),
    posted: toIso(j.pubDate),
    salary,
    snippet: stripHtml(j.excerpt || j.description).slice(0, 280),
    tags: (Array.isArray(j.categories) ? j.categories : []).slice(0, 4).map((c) => String(c).replace(/-/g, " ")),
    source: "Himalayas",
    _text: [j.title, j.companyName, (j.categories || []).join(" "), j.excerpt].join(" ")
  };
}

async function searchHimalayas({ q }) {
  return cached("hm:" + q.toLowerCase(), 60 * 60 * 1000, async () => {
    const r = await fetch(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}`, { headers: UA });
    if (!r.ok) throw new Error("Himalayas " + r.status);
    const j = await r.json();
    return (Array.isArray(j.jobs) ? j.jobs : []).map(normalizeHimalayas);
  });
}

// ---------- Adzuna (optional) ----------
export function normalizeAdzuna(j, country) {
  const s = j.salary_min || j.salary_max ? `${j.salary_min ? Math.round(j.salary_min).toLocaleString("en") : ""}${j.salary_max && j.salary_max !== j.salary_min ? "–" + Math.round(j.salary_max).toLocaleString("en") : ""}` : "";
  const title = stripHtml(j.title);
  const snippet = stripHtml(j.description);
  return {
    id: "az-" + j.id,
    title,
    company: String(j.company?.display_name || ""),
    location: String(j.location?.display_name || country.toUpperCase()),
    remote: /remote|home ?office|work from home|mobiles arbeiten/i.test(title + " " + snippet),
    url: String(j.redirect_url || ""),
    posted: j.created || null,
    salary: s ? s + " / year (est.)" : "",
    snippet: snippet.slice(0, 280),
    tags: [j.contract_time, j.category?.label].filter(Boolean).map(String),
    source: "Adzuna",
    _text: [title, snippet].join(" ")
  };
}

async function searchAdzuna({ q, where, country, remote }) {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key || !ADZUNA_COUNTRIES.has(country)) return null; // not configured / unsupported
  const what = remote ? `${q} remote` : q;
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}` +
    `&what=${encodeURIComponent(what)}${where && !remote ? "&where=" + encodeURIComponent(where) : ""}&results_per_page=40&max_days_old=45&content-type=application/json`;
  return cached("az:" + url, 30 * 60 * 1000, async () => {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error("Adzuna " + r.status);
    const j = await r.json();
    return (Array.isArray(j.results) ? j.results : []).map((x) => normalizeAdzuna(x, country));
  });
}

// ---------- Handler ----------
export function mergeJobs(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) for (const j of list) {
    // Same job on two boards: compare titles without gender tags like (m/w/d) or (all genders).
    const title = j.title.toLowerCase().replace(/\((?:[mwfdx]\s*\/\s*){1,3}[mwfdx]\)|\(all genders?\)|\(gn\)/g, "");
    const norm = (s) => s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const k = norm(title) + "|" + norm(j.company.toLowerCase());
    if (seen.has(k)) continue;
    seen.add(k);
    const { _text, ...clean } = j;
    out.push(clean);
  }
  out.sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
  return out.slice(0, 80);
}

export default async function handler(req, res) {
  const q = String(req.query.q || "").trim().slice(0, 80);
  const where = String(req.query.where || "").trim().slice(0, 60);
  const country = String(req.query.country || "de").toLowerCase().slice(0, 2);
  const remote = req.query.remote === "1";
  if (!q) return res.status(400).json({ error: "Type a job title or a keyword." });

  const sources = [
    ["Arbeitnow", country === "de" || remote ? searchArbeitnow({ q, where, remote }) : Promise.resolve(null)],
    ["Himalayas", searchHimalayas({ q })],
    ["Adzuna", searchAdzuna({ q, where, country, remote })]
  ];
  const settled = await Promise.allSettled(sources.map(([, p]) => withTimeout(p, 9000)));
  const lists = [];
  const status = settled.map((s, i) => {
    const name = sources[i][0];
    if (s.status === "rejected") return { name, ok: false, count: 0 };
    if (s.value === null) return { name, ok: null, count: 0 }; // not used for this search
    lists.push(s.value);
    return { name, ok: true, count: s.value.length };
  });

  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
  res.status(200).json({ query: { q, where, country, remote }, jobs: mergeJobs(lists), sources: status });
}
