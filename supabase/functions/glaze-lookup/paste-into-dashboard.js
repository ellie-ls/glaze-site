// glaze-lookup: Supabase edge function for the Westridge Ceramics glaze site.
// GENERATED FILE: paste this whole file into the Supabase dashboard editor.
// Built by scripts/build-dashboard-function.py from supabase/functions/_shared/glaze-parse.js;
// edit those sources and rebuild rather than editing this copy.

// Turns glaze info found on manufacturer websites into the fields our form uses.
// Shared by the browser (js/glaze-lookup.js) and the Supabase edge function.
//
// Rule: only fill a field when the source states it outright. If a source is
// ambiguous (for example it says both "matte" and "glossy"), the field stays blank.
(function () {
  const BANDS = { low: "Lowfire", mid: "Midfire", high: "Highfire" };

  function decode(html) {
    return String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&#8217;|&rsquo;/g, "'")
      .replace(/&#8211;|&ndash;/g, "–")
      .replace(/&#8212;|&mdash;/g, "—")
      .replace(/&reg;|&#174;/g, "®")
      .replace(/&trade;|&#8482;/g, "™")
      .replace(/&#\d+;/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  // "Cone 06" stays as the string "06" so low-fire cones keep their leading zero.
  function cones(text) {
    const found = [];
    const re = /\bcones?\s*(0?\d{1,2})(?:\s*(?:-|–|to|\/|and|&)\s*(?:cone\s*)?(0?\d{1,2}))?/gi;
    let m;
    while ((m = re.exec(String(text || "")))) {
      for (const c of [m[1], m[2]]) if (c && !found.includes(c)) found.push(c);
    }
    return found;
  }

  function band(cone) {
    if (cone.startsWith("0")) return "low";
    const n = Number(cone);
    if (n <= 3) return "low";
    if (n <= 7) return "mid";
    return "high";
  }

  function coneSort(a, b) {
    // 06 is cooler than 04, which is cooler than 1
    const v = (c) => (c.startsWith("0") && c.length > 1 ? -Number(c) : Number(c));
    return v(a) - v(b);
  }

  function formatFiring(list) {
    if (!list.length) return "";
    const sorted = [...list].sort(coneSort);
    const bands = [...new Set(sorted.map(band))];
    const range = sorted.length > 1 ? sorted[0] + "-" + sorted[sorted.length - 1] : sorted[0];
    if (bands.length === 1) return BANDS[bands[0]] + ", Cone " + range;
    return "Cone " + sorted.join(", ");
  }

  // Returns the single label whose pattern appears in the text, or "" when none or several do.
  function onlyOne(text, options) {
    const hits = options.filter(([, re]) => re.test(text)).map(([label]) => label);
    const unique = [...new Set(hits)];
    return unique.length === 1 ? unique[0] : "";
  }

  function finish(text) {
    return onlyOne(text, [
      ["Glossy", /\b(high[- ]?gloss|glossy|gloss)\b/i],
      ["Satin", /\bsatin\b/i],
      ["Matte", /\bmatte?\b/i],
    ]);
  }

  function opacity(text) {
    // Check "semi-transparent" first so it is not also counted as "transparent"
    const t = text.replace(/semi[- ]transparent/gi, "SEMITRANSPARENT");
    return onlyOne(t, [
      ["Semi-transparent", /SEMITRANSPARENT/],
      ["Transparent", /\btransparent\b/i],
      ["Translucent", /\btranslucent\b/i],
      ["Opaque", /\bopaque\b/i],
    ]);
  }

  function fluidity(text) {
    const very = /\bvery (fluid|runny|mobile)\b/i.test(text);
    const some = /\b(fluid|runny|mobile|will run|runs)\b/i.test(text);
    const stable = /\b(stable|does not run|doesn't run|non[- ]?running)\b/i.test(text);
    if (stable && some) return ""; // contradictory, leave blank
    if (very) return "Very fluid";
    if (some) return "Fluid, may run";
    if (stable) return "Stable, does not run";
    return "";
  }

  function application(text) {
    const out = [];
    if (/\b(brush[- ]?on|brushing|brushability|brushable|brush strokes?)\b/i.test(text)) out.push("Brush On");
    if (/\b(dip|dipping)\b/i.test(text)) out.push("Dip");
    return out.join(", ");
  }

  function foodSafe(text) {
    if (/\bnot (dinnerware|food)[- ]safe\b/i.test(text)) return "No, not dinnerware safe";
    if (/\b(dinnerware|food)[- ]safe\b/i.test(text)) return "Yes, dinnerware safe";
    return "";
  }

  function fromText(text) {
    return {
      firingRange: formatFiring(cones(text)),
      application: application(text),
      finish: finish(text),
      opacity: opacity(text),
      foodSafe: foodSafe(text),
      fluidity: fluidity(text),
    };
  }

  // ---- Mayco ----

  // Mayco product slugs start with the product code, e.g. "sw-123-sapphire" -> "SW-123"
  function maycoCodeFromSlug(slug) {
    const m = /^([a-z]{1,4})-?(\d{2,4})\b/i.exec(slug || "");
    return m ? m[1].toUpperCase() + "-" + m[2] : "";
  }

  function cleanName(name) {
    return decode(name).replace(/\s*-\s*DISCONTINUED\s*$/i, "").trim();
  }

  // WooCommerce Store API product (used by the edge function: has attributes and SKU)
  function fromMaycoStore(p) {
    const text = decode(p.short_description) + "\n" + decode(p.description);
    const fields = fromText(text);

    // Mayco shows food safety as icon images, e.g. ".../dinnerware-safe.png"
    const attr = (name) => (p.attributes || []).find((a) => a.name.toLowerCase() === name);
    const icons = (a) => (a ? a.terms.map((t) => t.name.toLowerCase()) : []);
    const dinner = icons(attr("dinnerware safe"));
    const label = icons(attr("food safe")).concat(icons(attr("toxicology")));
    let safe = "";
    if (dinner.some((s) => s.includes("not-dinnerware-safe"))) safe = "No, not dinnerware safe";
    else if (dinner.some((s) => s.includes("dinnerware-safe"))) safe = "Yes, dinnerware safe";
    if (label.some((s) => /\/ap[-.]/.test(s))) safe = safe ? safe + ", AP non-toxic" : "AP non-toxic";
    else if (label.some((s) => /\/cl[-.]/.test(s))) safe = safe ? safe + ", CL caution label" : "CL caution label";
    if (safe) fields.foodSafe = safe;

    const skip = ["color", "fired", "discontinued products"];
    const tags = (p.categories || []).map((c) => decode(c.name)).filter((n) => !skip.includes(n.toLowerCase()));

    return {
      name: cleanName(p.name),
      code: (p.sku || "").toUpperCase() || maycoCodeFromSlug(p.slug),
      brand: "Mayco",
      ...fields,
      tags,
      image: p.images && p.images[0] ? p.images[0].src : "",
      source: "maycocolors.com",
      url: p.permalink,
    };
  }

  // WordPress REST product (used directly from the browser). The photo comes from the
  // page's share-preview image, the only image this endpoint exposes.
  function fromMaycoWp(p) {
    const og = p.yoast_head_json && p.yoast_head_json.og_image;
    const text = decode(p.excerpt && p.excerpt.rendered);
    const classes = p.class_list || [];
    const tags = classes
      .filter((c) => c.startsWith("product_cat-") && !/-(color|fired|discontinued-products)$/.test(c))
      .map((c) => c.replace("product_cat-", "").replace(/-/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()));
    return {
      name: cleanName(p.title && p.title.rendered),
      code: maycoCodeFromSlug(p.slug),
      brand: "Mayco",
      ...fromText(text),
      tags,
      image: og && og[0] ? og[0].url : "",
      source: "maycocolors.com",
      url: p.link,
    };
  }

  // ---- Coyote ----

  // Coyote's shop page lists every glaze as a hidden form field, e.g. value="Cobalt Blue MBG008",
  // and states that all of them are fired between cone 5 and cone 6.
  function coyoteFromHtml(html) {
    const pageCones = /between\s+witness\s+cone\s+5\s+and\s+witness\s+cone\s+6/i.test(decode(html)) ? "Midfire, Cone 5-6" : "";
    // Each glaze's tile photo is listed with its code in the file name: 'Images/.../GLCobalt Blue MBG008 RC.jpg'
    const photos = new Map();
    const pic = /['"](Images\/[^'"]*?\b(MBG\d+)\b[^'"]*?\.(?:jpe?g|png))['"]/gi;
    let p;
    while ((p = pic.exec(html))) {
      const code = p[2].toUpperCase();
      if (!photos.has(code)) photos.set(code, "https://coyoteclay.com/" + encodeURI(p[1]));
    }

    const seen = new Set();
    const out = [];
    const re = /name="ID"\s+type="hidden"\s+value="([^"]+?)\s+(MBG\d+)"/gi;
    let m;
    while ((m = re.exec(html))) {
      const code = m[2].toUpperCase();
      if (seen.has(code)) continue;
      seen.add(code);
      const name = decode(m[1]).trim();
      out.push({
        name,
        code,
        brand: "Coyote",
        firingRange: pageCones,
        application: "",
        finish: finish(name), // only when the name itself says it, e.g. "Alabaster Satin"
        opacity: "",
        foodSafe: "",
        fluidity: "",
        tags: [],
        image: photos.get(code) || "",
        source: "coyoteclay.com",
        url: "https://coyoteclay.com/BuyCone6.html",
      });
    }
    return out;
  }

  // ---- Shared helpers for catalog names like "5537 COBALT BLUE" or "WC-108 POWER TURQUOISE ^5 GLAZE" ----

  // "COBALT BLUE" -> "Cobalt Blue" (keeps short all-caps words like "AP" or "SW")
  function titleCase(text) {
    return String(text || "").toLowerCase().replace(/\b([a-z])([a-z']*)/g, (m, a, b) => a.toUpperCase() + b)
      .replace(/\b(Ap|Cl|Ii|Iii)\b/g, (m) => m.toUpperCase());
  }

  // Splits the product code off a catalog name: "5537 COBALT BLUE", "MS-47 CASTILE BLUE",
  // "TURQUOISE MATTE - WC-554 ^10", "ANTIQUE TURQUOISE MS-258"
  function splitCode(title) {
    const t = title || "";
    const lead = /^\s*([a-z]{0,4}-?\d{1,5}[a-z]?)\s+(.+)$/i.exec(t);
    if (lead) return { code: lead[1].toUpperCase(), rest: lead[2] };
    const inside = /\s*-?\s*\b([a-z]{1,4}-\d{1,5}[a-z]?)\b/i.exec(t);
    if (inside) {
      const rest = (t.slice(0, inside.index) + " " + t.slice(inside.index + inside[0].length)).replace(/^[\s\-–]+|[\s\-–]+$/g, "");
      return { code: inside[1].toUpperCase(), rest };
    }
    return { code: "", rest: t };
  }

  // ---- Spectrum Glazes (WordPress, readable from the browser) ----
  // categoryNames: the product's category names, e.g. "1100 Series - Cone 4-6 Stoneware Glazes"
  // Sample packs and kits aren't glazes
  function isSpectrumKit(p, categoryNames) {
    return /econo|sample|kit|pack/i.test(decode(p.title && p.title.rendered)) || categoryNames.some((c) => /sample|econo/i.test(c));
  }

  function fromSpectrumWp(p, categoryNames) {
    const og = p.yoast_head_json && p.yoast_head_json.og_image;
    const { code, rest } = splitCode(decode(p.title && p.title.rendered));
    const text = decode(p.excerpt && p.excerpt.rendered) + "\n" + categoryNames.join("\n");
    return {
      name: titleCase(rest),
      code,
      brand: "Spectrum",
      ...fromText(text),
      tags: categoryNames,
      image: og && og[0] ? og[0].url : "",
      source: "spectrumglazes.com",
      url: p.link,
    };
  }

  // ---- Laguna Clay (Shopify, readable from the browser) ----
  // Titles carry the cone after a caret: "WC-108 POWER TURQUOISE ^5 GLAZE"
  function fromLaguna(p) {
    const { code, rest } = splitCode(decode(p.title));
    const coneText = rest.replace(/\^\s*(0?\d{1,2})/g, " cone $1 ");
    const name = titleCase(rest.replace(/\^\s*0?\d{1,2}/g, " ").replace(/\b(liquid\s+)?glaze\b/gi, " ")
      .replace(/\b(pint|pt|dry|\d+\s*(lb|lbs|oz))\b\.?/gi, " ").replace(/\s+-\s+/g, " ")
      .replace(/\s+/g, " ").replace(/^[\s\-–]+|[\s\-–]+$/g, ""));
    const fields = fromText(coneText + "\n" + decode(p.body_html));
    return {
      name,
      code,
      brand: "Laguna",
      ...fields,
      tags: [p.product_type].filter(Boolean),
      image: p.images && p.images[0] ? p.images[0].src : "",
      source: "lagunaclay.com",
      url: "https://lagunaclay.com/products/" + p.handle,
    };
  }

  // ---- Matching ----

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Every word the person typed has to appear in the name, brand, or code
  function matches(query, item) {
    const hay = norm(item.brand + " " + item.name + " " + item.code);
    return norm(query).split(" ").filter(Boolean).every((w) => hay.includes(w));
  }

  // 0 = exact name or code, 1 = name starts with it, 2 = brand + name starts with it, 3 = anywhere
  function score(query, it) {
    const q = norm(query);
    const n = norm(it.name);
    if (n === q || norm(it.code) === q) return 0;
    if (n.startsWith(q)) return 1;
    if (norm(it.brand + " " + it.name).startsWith(q)) return 2;
    return 3;
  }

  // Best matches first; within equally good matches, brands take turns so no one brand crowds the list
  function rank(query, items) {
    const sorted = [...items].sort((a, b) => score(query, a) - score(query, b) || a.name.localeCompare(b.name));
    const turn = new Map();
    const keyed = sorted.map((it) => {
      const k = score(query, it) + "|" + it.brand;
      turn.set(k, (turn.get(k) || 0) + 1);
      return { it, s: score(query, it), t: turn.get(k) };
    });
    return keyed.sort((a, b) => a.s - b.s || a.t - b.t).map((x) => x.it);
  }

  globalThis.GlazeParse = {
    decode, cones, band, formatFiring, fromText,
    fromMaycoStore, fromMaycoWp, coyoteFromHtml, isSpectrumKit, fromSpectrumWp, fromLaguna, matches, rank,
  };
})();

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
