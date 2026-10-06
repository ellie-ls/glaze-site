// Searches glaze makers' websites for a glaze by name.
//
// Searched straight from the browser (these sites allow it):
//   • Mayco        (maycocolors.com)
//   • Spectrum     (spectrumglazes.com)
//   • Laguna       (lagunaclay.com: its whole glaze catalog is loaded once, then searched here)
// Searched through our Supabase edge function "glaze-lookup", once it's deployed:
//   • Coyote       (coyoteclay.com doesn't let browsers read it directly)
//   • Mayco again, with more detail (food safety, SKU)
const GlazeLookup = (function () {
  let functionAvailable = true;
  const P = GlazeParse;

  async function viaFunction(query, signal) {
    const url = SUPABASE_URL + "/functions/v1/glaze-lookup?q=" + encodeURIComponent(query);
    const res = await fetch(url, {
      signal,
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
    });
    if (!res.ok) throw new Error("glaze-lookup returned " + res.status);
    const body = await res.json();
    return body.results || [];
  }

  async function mayco(query, signal) {
    const url =
      "https://www.maycocolors.com/wp-json/wp/v2/product?per_page=8&_fields=title,slug,link,excerpt,class_list,yoast_head_json.og_image&search=" +
      encodeURIComponent(query);
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    return (await res.json()).map(P.fromMaycoWp);
  }

  // Spectrum's category names ("1100 Series – Cone 4/6 ...") carry the cone and series, so load them once
  let spectrumCategories = null;
  function loadSpectrumCategories() {
    spectrumCategories = spectrumCategories || fetch("https://www.spectrumglazes.com/wp-json/wp/v2/product_cat?per_page=100&_fields=id,name")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => Object.fromEntries(list.map((c) => [c.id, P.decode(c.name)])))
      .catch(() => ({}));
    return spectrumCategories;
  }

  async function spectrum(query, signal) {
    const url =
      "https://www.spectrumglazes.com/wp-json/wp/v2/product?per_page=10&_fields=title,slug,link,excerpt,product_cat,yoast_head_json.og_image&search=" +
      encodeURIComponent(query);
    const [res, cats] = await Promise.all([fetch(url, { signal }), loadSpectrumCategories()]);
    if (!res.ok) return [];
    return (await res.json())
      .map((p) => ({ p, names: (p.product_cat || []).map((id) => cats[id]).filter(Boolean) }))
      .filter(({ p, names }) => !P.isSpectrumKit(p, names))
      .map(({ p, names }) => P.fromSpectrumWp(p, names));
  }

  // Laguna has no search the browser may use, but its glaze collection can be read page by page.
  // It's loaded the first time someone searches, then kept for the visit.
  let lagunaCatalog = null;
  function loadLaguna() {
    lagunaCatalog = lagunaCatalog || (async () => {
      const all = [];
      for (let page = 1; page <= 4; page++) {
        const res = await fetch(`https://lagunaclay.com/collections/glaze/products.json?limit=250&page=${page}`);
        if (!res.ok) break;
        const { products } = await res.json();
        all.push(...products.map(P.fromLaguna));
        if (products.length < 250) break;
      }
      // The same glaze is listed as a pint and as dry mix; keep one
      const seen = new Set();
      return all.filter((g) => { const k = g.code || g.name; if (seen.has(k)) return false; seen.add(k); return true; });
    })().catch((err) => { lagunaCatalog = null; throw err; });
    return lagunaCatalog;
  }

  async function laguna(query) {
    const catalog = await loadLaguna();
    return catalog.filter((g) => P.matches(query, g)).slice(0, 8);
  }

  async function search(query, signal) {
    // Coyote (and detailed Mayco) need the edge function; plain Mayco is the fallback
    const viaServer = (async () => {
      if (functionAvailable && typeof SUPABASE_URL !== "undefined") {
        try {
          return await viaFunction(query, signal);
        } catch (err) {
          if (err.name === "AbortError") throw err;
          functionAvailable = false; // not deployed: stop trying for this visit
          console.info("glaze-lookup function unavailable, searching Mayco directly.", err.message);
        }
      }
      return mayco(query, signal);
    })();

    // Every source runs at once; one that fails or is slow just adds nothing
    const settled = await Promise.allSettled([viaServer, spectrum(query, signal), laguna(query)]);
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
    const results = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));

    // Same brand and code from two sources: keep the first
    const seen = new Set();
    const unique = results.filter((g) => {
      const k = g.brand + "|" + (g.code || g.name).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Some sites' own search is loose (Mayco returns "Haystack" for "tic tac"); keep the ones whose
    // name or code really contains what was typed, unless that would leave nothing
    const close = unique.filter((g) => P.matches(query, g));
    return P.rank(query, close.length ? close : unique).slice(0, 12);
  }

  return { search };
})();
