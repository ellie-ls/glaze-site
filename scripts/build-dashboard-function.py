"""Builds a one-file copy of the glaze-lookup edge function for pasting into the Supabase dashboard.

The real function (supabase/functions/glaze-lookup/index.ts) imports the shared parser from
supabase/functions/_shared/glaze-parse.js. The dashboard editor works best with a single file,
so this script pastes the parser and the function together into:

    supabase/functions/glaze-lookup/paste-into-dashboard.js

Run it again whenever the parser or the function changes:  python3 scripts/build-dashboard-function.py
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = (root / "supabase/functions/_shared/glaze-parse.js").read_text()
server = '''
// ---------------------------------------------------------------------------------------------
// The edge function: looks a glaze up on Mayco and Coyote and returns what they say about it.
// Called by the site as  GET {SUPABASE_URL}/functions/v1/glaze-lookup?q=cobalt

const P = globalThis.GlazeParse;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

const UA = { "User-Agent": "Mozilla/5.0 (glaze-lookup; Westridge Ceramics)" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Mayco's store catalog has more detail than its public pages (food safety, SKU)
async function searchMayco(q) {
  const url = "https://www.maycocolors.com/wp-json/wc/store/v1/products?per_page=8&search=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const products = await res.json();
  return products.map(P.fromMaycoStore);
}

// Coyote's whole glaze list is one page, so keep it in memory for an hour
let coyoteCache = null;

async function searchCoyote(q) {
  if (!coyoteCache || Date.now() - coyoteCache.at > 60 * 60 * 1000) {
    const res = await fetch("https://coyoteclay.com/BuyCone6.html", { headers: UA, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const html = new TextDecoder("latin1").decode(await res.arrayBuffer());
    coyoteCache = { at: Date.now(), items: P.coyoteFromHtml(html) };
  }
  return coyoteCache.items.filter((it) => P.matches(q, it));
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
'''
header = '''// glaze-lookup: Supabase edge function for the Westridge Ceramics glaze site.
// GENERATED FILE: paste this whole file into the Supabase dashboard editor.
// Built by scripts/build-dashboard-function.py from supabase/functions/_shared/glaze-parse.js;
// edit those sources and rebuild rather than editing this copy.

'''
out = root / "supabase/functions/glaze-lookup/paste-into-dashboard.js"
out.write_text(header + parser.strip() + "\n" + server)
print(f"Wrote {out.relative_to(root)} ({len(out.read_text().splitlines())} lines)")
