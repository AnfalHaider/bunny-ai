/**
 * AGENT-FLOW F6: web search with a second provider. Tried in order until one returns results: Brave Search (only when the person has added a key), then DuckDuckGo's HTML page (as before).
 * The result keeps its shape (one block per hit: title, link, snippet) and says who answered ("via Brave"). When every provider fails, the answer is each provider's reason in one line
 * plus what to do, never just an error, and the model is told the browser panel is another way when the window has one.
 *
 * Security (F6): api.search.brave.com is reached only with the person's own key and only from here (web_search). The key goes in the X-Subscription-Token header and nowhere else: it is not in
 * a URL, a log line, a step result or an error text. Every outcome text below is fixed wording or a status number, never the provider's own answer.
 */
export const BRAVE_SECRET = 'search:brave';
export const BRAVE_HOST = 'api.search.brave.com';
const LIMIT_MS = 15_000;
const MAX_HITS = 8;
const STRIP = (t) => String(t ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); // one line each: a title or snippet with a line break cannot pass for a link line
const okLink = (link) => /^https?:\/\//i.test(link) && !/[\s\u0000-\u001f\u007f]/.test(link);
const block = (title, link, snippet) => `- ${STRIP(title)}\n  ${link}\n  ${STRIP(snippet).slice(0, 220)}`;
const timedOut = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

/** One provider = how to ask, and how to read the answer. { hits } on success (maybe empty), { reason } on failure. A second keyed provider is one more entry. */
export const searchProviders = [
  {
    id: 'brave', label: 'Brave', needsKey: true,
    async run(query, { fetchImpl, key }) {
      let res;
      try {
        res = await fetchImpl(`https://${BRAVE_HOST}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_HITS}`, { headers: { accept: 'application/json', 'x-subscription-token': key }, signal: AbortSignal.timeout(LIMIT_MS) });
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
      if (res.status === 202 || res.status === 403 || res.status === 429) return { reason: 'DuckDuckGo showed a check page instead of results' };
      if (!res.ok) return { reason: `DuckDuckGo answered ${res.status}` };
      const html = await res.text();
      if (/anomaly|captcha|unusual traffic/i.test(html) && !/result__a/.test(html)) return { reason: 'DuckDuckGo showed a check page instead of results' };
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
];

/**
 * @param {string} query
 * @param {{ fetchImpl?: typeof fetch, braveKey?: string|null, browser?: boolean }} [options] `browser`: this reply can use the browser panel (the desktop window), a last way to look.
 * @returns {Promise<string>} the results ("via X" on the first line), 'No results.' when every provider answered with nothing, or throws one Error whose text is each provider's reason.
 */
export async function searchWeb(query, { fetchImpl = globalThis.fetch, braveKey = null, browser = false } = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('web_search needs a query');
  const reasons = [];
  let answeredEmpty = false;
  for (const p of searchProviders) {
    const key = typeof braveKey === 'string' ? braveKey.trim() : '';
    if (p.needsKey && !key) continue; // with no key Brave is never called
    const out = await p.run(q, { fetchImpl, key });
    if (out.hits?.length) return `(via ${p.label})\n${out.hits.join('\n')}`;
    if (out.hits) { answeredEmpty = true; reasons.push(`${p.label} found no results`); } else reasons.push(out.reason);
  }
  if (answeredEmpty && reasons.every((r) => /found no results$/.test(r))) return 'No results.';
  const hint = braveKey ? 'Try again in a minute.' : 'Try again in a minute, or add a Brave Search key in Settings, Web search.';
  const panel = browser ? ` The browser panel is another way: browser_open https://duckduckgo.com/?q=${encodeURIComponent(q)} and browser_read it.` : '';
  throw new Error(`The web search did not work. ${reasons.map((r) => `${r}.`).join(' ')} ${hint}${panel}`);
}
