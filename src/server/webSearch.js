/**
 * AGENT-FLOW F6: web search with several providers. Tried in order until one returns RELEVANT results: Brave Search (only when the person has added a key), then DuckDuckGo's HTML page, then Bing's page, then Wikipedia's search (facts).
 * Why more than one (v0.1.16): DuckDuckGo's free page shows a check page after about ten searches in a few minutes, and a person with no Brave key then had nothing. A provider that refused is rested for a few minutes (so a burst does not keep it blocked),
 * the same query asked again within two minutes is answered from memory, and a page whose hits share no word with the question is not trusted (the next provider is tried). Every answer says which site answered ("via Bing").
 * The result keeps its shape (one block per hit: title, link, snippet) and says who answered ("via Brave"). When every provider fails, the answer is each provider's reason in one line
 * plus what to do, never just an error, and the model is told the browser panel is another way when the window has one.
 *
 * Security (F6): api.search.brave.com is reached only with the person's own key and only from here (web_search). The key goes in the X-Subscription-Token header and nowhere else: it is not in
 * a URL, a log line, a step result or an error text. Every outcome text below is fixed wording or a status number, never the provider's own answer.
 */
import { isIP } from 'node:net';
import { isPrivateAddress } from './download.js';
export const BRAVE_SECRET = 'search:brave';
export const BRAVE_HOST = 'api.search.brave.com';
const LIMIT_MS = 15_000;
const MAX_HITS = 8;
const STRIP = (t) => String(t ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); // one line each: a title or snippet with a line break cannot pass for a link line
const okLink = (link) => {
  if (!/^https?:\/\//i.test(link) || /[\s\u0000-\u001f\u007f]/.test(link)) return false;
  // WS-2: never offer the model a link into the search engine itself, or to a private, loopback, link-local or name-less host: the model could be led to read_url them
  let host;
  try { host = new URL(link).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  if (/(^|\.)bing\.com$/.test(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (!host.includes('.') && !host.includes(':'))) return false;
  if (isIP(host) && isPrivateAddress(host)) return false;
  return true;
};
// WS-3: a snippet that is itself an address must not look like a link line (the quick bar lists only the link lines the search gave it): it gets a leading mark
const block = (title, link, snippet) => { const sn = STRIP(snippet).slice(0, 220); return `- ${STRIP(title)}\n  ${link}\n  ${/^["'(\[<]*https?:\/\//i.test(sn) ? '· ' : ''}${sn}`; };
const timedOut = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';
export const BING_HOST = 'www.bing.com';
export const WIKI_HOST = 'en.wikipedia.org';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sameSite = (address, host) => { try { return new URL(address).hostname === host; } catch { return false; } };
/** Bing's result links are its own redirects (bing.com/ck/a?...&u=a1<base64url of the real address>): the real address, or null. */
export function bingTarget(href) {
  const raw = String(href ?? '').replace(/&amp;/g, '&');
  const u = /[?&]u=a1([^&]+)/.exec(raw);
  if (!u) return okLink(raw) && !sameSite(raw, BING_HOST) ? raw : null;
  try { const real = Buffer.from(u[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); return okLink(real) ? real : null; } catch { return null; }
}
const STOP = new Set(['the', 'and', 'for', 'with', 'what', 'who', 'how', 'why', 'when', 'where', 'which', 'are', 'was', 'were', 'is', 'of', 'in', 'on', 'to', 'a', 'an', 'at', 'by', 'from', 'about', 'today', 'now', 'best', 'vs', 'versus']);
/** A page whose hits share no word with the question is not trusted (a search page that answered a different question). A query with no usable word is trusted. */
export function relevant(query, hits) {
  const words = String(query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return true;
  const text = hits.join('\n').toLowerCase();
  return words.some((w) => text.includes(w));
}

// What a busy person's burst of searches does to a free page: a provider that showed a check page is rested for a few minutes, and the same question asked again soon is answered from memory.
const REST_MS = 5 * 60_000;
const CACHE_MS = 2 * 60_000;
const resting = new Map(); // provider id -> time it may be asked again
const remembered = new Map(); // question -> { at, text }
const CACHE_MAX = 50;
/** WS-4: the memory holds only what is fresh and at most CACHE_MAX questions: old entries go on every write, then the oldest. */
function remember(key, text, at) {
  for (const [k, v] of remembered) if (at - v.at >= CACHE_MS) remembered.delete(k);
  remembered.delete(key);
  remembered.set(key, { at, text });
  while (remembered.size > CACHE_MAX) remembered.delete(remembered.keys().next().value);
}
export const rememberedCount = () => remembered.size;
export function resetWebSearch() { resting.clear(); remembered.clear(); }

/** One provider = how to ask, and how to read the answer. { hits } on success (maybe empty), { reason } on failure. A second keyed provider is one more entry. */
export const searchProviders = [
  {
    id: 'brave', label: 'Brave', needsKey: true,
    async run(query, { fetchImpl, key }) {
      let res;
      try {
        const address = `https://${BRAVE_HOST}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_HITS}`;
        if (new URL(address).origin !== `https://${BRAVE_HOST}`) return { reason: 'Brave could not be reached' }; // the key goes to this origin only
        // redirect: 'error': a redirect would carry the header to another place, so it is never followed
        res = await fetchImpl(address, { headers: { accept: 'application/json', 'x-subscription-token': key }, redirect: 'error', signal: AbortSignal.timeout(LIMIT_MS) });
      } catch (err) { return { reason: timedOut(err) ? 'Brave did not answer in 15 seconds' : 'Brave could not be reached' }; }
      if (res.status === 401 || res.status === 403 || res.status === 422) return { reason: 'Brave refused the key' };
      if (res.status === 429) return { reason: "Brave's free allowance is used up for now" };
      if (!res.ok) return { reason: `Brave answered ${res.status}` };
      let data;
      try { data = await res.json(); } catch { return { reason: 'Brave sent an answer Bunny could not read' }; }
      const hits = [];
      for (const r of data?.web?.results ?? []) {
        if (hits.length >= MAX_HITS) break;
        if (okLink(String(r?.url ?? ''))) hits.push(block(r.title, r.url, r.description));
      }
      return { hits };
    },
  },
  {
    id: 'duckduckgo', label: 'DuckDuckGo', needsKey: false,
    async run(query, { fetchImpl }) {
      let res;
      try {
        res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) bunny-ai', accept: 'text/html' }, signal: AbortSignal.timeout(LIMIT_MS) });
      } catch (err) { return { reason: timedOut(err) ? 'DuckDuckGo did not answer in 15 seconds' : 'DuckDuckGo could not be reached' }; }
      if (res.status === 202 || res.status === 403 || res.status === 429) return { reason: 'DuckDuckGo showed a check page instead of results', rest: true };
      if (!res.ok) return { reason: `DuckDuckGo answered ${res.status}` };
      const html = await res.text();
      if (/anomaly|captcha|unusual traffic/i.test(html) && !/result__a/.test(html)) return { reason: 'DuckDuckGo showed a check page instead of results', rest: true };
      const hits = [];
      const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
      for (let m = re.exec(html); m && hits.length < MAX_HITS; m = re.exec(html)) {
        let link = m[1];
        const real = /[?&]uddg=([^&]+)/.exec(link);
        if (real) { try { link = decodeURIComponent(real[1]); } catch { continue; } }
        if (link.startsWith('//')) link = `https:${link}`;
        if (!okLink(link)) continue; // a link with a line break or a space in it is not a link Bunny lists
        hits.push(block(m[2], link, m[3] ?? ''));
      }
      return { hits };
    },
  },
  {
    id: 'bing', label: 'Bing', needsKey: false,
    async run(query, { fetchImpl }) {
      let res;
      try {
        res = await fetchImpl(`https://${BING_HOST}/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=US&mkt=en-US`, { headers: { 'user-agent': BROWSER_UA, accept: 'text/html', 'accept-language': 'en-US,en;q=0.9', cookie: 'SRCHHPGUSR=SRCHLANG=en; _EDGE_S=mkt=en-US' }, signal: AbortSignal.timeout(LIMIT_MS) });
      } catch (err) { return { reason: timedOut(err) ? 'Bing did not answer in 15 seconds' : 'Bing could not be reached' }; }
      if (res?.url && !sameSite(res.url, BING_HOST)) return { reason: 'Bing could not be reached' }; // an answer from another site is never read
      if (res.status === 403 || res.status === 429) return { reason: 'Bing showed a check page instead of results', rest: true };
      if (!res.ok) return { reason: `Bing answered ${res.status}` };
      const html = await res.text();
      const hits = [];
      for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<li class="b_algo"|<\/ol>|$)/g)) {
        if (hits.length >= MAX_HITS) break;
        const link = bingTarget(m[1]);
        if (!link) continue;
        const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(m[3])?.[1] ?? '';
        hits.push(block(m[2], link, snippet));
      }
      if (!hits.length && /captcha|unusual traffic|verify you are human/i.test(html)) return { reason: 'Bing showed a check page instead of results', rest: true };
      return { hits };
    },
  },
  {
    id: 'wikipedia', label: 'Wikipedia', needsKey: false,
    async run(query, { fetchImpl }) {
      let res;
      try {
        res = await fetchImpl(`https://${WIKI_HOST}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=${MAX_HITS}`, { headers: { 'user-agent': 'bunny-ai (web_search fallback)', accept: 'application/json' }, signal: AbortSignal.timeout(LIMIT_MS) });
      } catch (err) { return { reason: timedOut(err) ? 'Wikipedia did not answer in 15 seconds' : 'Wikipedia could not be reached' }; }
      if (res?.url && !sameSite(res.url, WIKI_HOST)) return { reason: 'Wikipedia could not be reached' };
      if (res.status === 429) return { reason: 'Wikipedia asked Bunny to slow down' };
      if (!res.ok) return { reason: `Wikipedia answered ${res.status}` };
      let data;
      try { data = await res.json(); } catch { return { reason: 'Wikipedia sent an answer Bunny could not read' }; }
      const hits = [];
      for (const r of data?.query?.search ?? []) {
        if (hits.length >= MAX_HITS) break;
        const title = String(r?.title ?? '');
        if (!title) continue;
        hits.push(block(title, `https://${WIKI_HOST}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, r?.snippet ?? ''));
      }
      return { hits };
    },
  },
];

/**
 * @param {string} query
 * @param {{ fetchImpl?: typeof fetch, braveKey?: string|null, browser?: boolean, now?: () => number }} [options] `browser`: this reply can use the browser panel (the desktop window), a last way to look. `now`: a clock (tests).
 * @returns {Promise<string>} the results ("via X" on the first line), 'No results.' when every provider answered with nothing, or throws one Error whose text is each provider's reason.
 */
export async function searchWeb(query, { fetchImpl = globalThis.fetch, braveKey = null, browser = false, now = Date.now } = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('web_search needs a query');
  const reasons = [];
  const key0 = typeof braveKey === 'string' ? braveKey.trim() : '';
  const cached = remembered.get(q.toLowerCase());
  if (cached && now() - cached.at < CACHE_MS) return cached.text; // a keyed answer is never kept here (Brave's terms), so this is only what a free page said
  let answeredEmpty = false;
  for (const p of searchProviders) {
    const key = typeof braveKey === 'string' ? braveKey.trim() : '';
    if (p.needsKey && !key) continue; // with no key Brave is never called
    if ((resting.get(p.id) ?? 0) > now()) { reasons.push(`${p.label} is resting after a check page`); continue; }
    let out;
    try { out = await p.run(q, { fetchImpl, key }); } catch { out = { reason: `${p.label} could not be reached` }; }
    if (out.rest) resting.set(p.id, now() + REST_MS);
    if (out.hits?.length && relevant(q, out.hits)) {
      const text = `(via ${p.label})\n${out.hits.join('\n')}`.split(key0 || '\u0000').join('[key]');
      if (!p.needsKey) remember(q.toLowerCase(), text, now());
      return text;
    }
    if (out.hits?.length) { reasons.push(`${p.label} answered a different question`); continue; }
    if (out.hits) { answeredEmpty = true; reasons.push(`${p.label} found no results`); } else reasons.push(out.reason);
  }
  if (answeredEmpty && reasons.every((r) => /found no results$/.test(r))) return 'No results.';
  const hint = braveKey ? 'Try again in a few minutes.' : 'Try again in a few minutes. A free Brave Search key in Settings, Web search makes this steadier.';
  const panel = browser ? ` The browser panel is another way: browser_open https://duckduckgo.com/?q=${encodeURIComponent(q)} and browser_read it.` : '';
  const redact = (t) => (key0 ? String(t).split(key0).join('[key]') : String(t));
  throw new Error(redact(`The web search did not work. ${reasons.map((r) => `${r}.`).join(' ')} ${hint}${panel}`));
}
