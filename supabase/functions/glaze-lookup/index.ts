// Looks up a glaze by name on manufacturer websites and returns what they state about it.
// Browsers can't read most of these sites directly (CORS), so this runs on Supabase.
//
// Deploy:  supabase functions deploy glaze-lookup --no-verify-jwt
// Call:    GET {SUPABASE_URL}/functions/v1/glaze-lookup?q=cobalt

import "../_shared/glaze-parse.js";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GlazeParse;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

const UA = { "User-Agent": "Mozilla/5.0 (glaze-lookup; Westridge Ceramics)" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function searchMayco(q: string) {
  const url = "https://www.maycocolors.com/wp-json/wc/store/v1/products?per_page=8&search=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  // deno-lint-ignore no-explicit-any
  const products: any[] = await res.json();
  return products.map(P.fromMaycoStore);
}

// Coyote's full glaze list is one page, so keep it in memory for an hour
let coyoteCache: { at: number; items: unknown[] } | null = null;

async function searchCoyote(q: string) {
  if (!coyoteCache || Date.now() - coyoteCache.at > 60 * 60 * 1000) {
    const res = await fetch("https://coyoteclay.com/BuyCone6.html", { headers: UA, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const html = new TextDecoder("latin1").decode(await res.arrayBuffer());
    coyoteCache = { at: Date.now(), items: P.coyoteFromHtml(html) };
  }
  // deno-lint-ignore no-explicit-any
  return coyoteCache.items.filter((it: any) => P.matches(q, it));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 80);
  if (q.length < 2) return json({ results: [] });

  // A source that fails or times out just contributes nothing
  const settled = await Promise.allSettled([searchMayco(q), searchCoyote(q)]);
  const results = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));

  return json({ results: P.rank(q, results).slice(0, 8) });
});
