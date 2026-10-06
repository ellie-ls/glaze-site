// Searches the web for a glaze by name.
//
// 1. Asks our Supabase edge function "glaze-lookup", which searches Mayco and Coyote.
// 2. If that function isn't deployed yet, falls back to Mayco's public API, which
//    browsers are allowed to read directly (Coyote can only be reached through step 1).
const GlazeLookup = (function () {
  let functionAvailable = true;

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

  async function viaMaycoDirect(query, signal) {
    const url =
      "https://www.maycocolors.com/wp-json/wp/v2/product?per_page=8&_fields=title,slug,link,excerpt,class_list&search=" +
      encodeURIComponent(query);
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const products = await res.json();
    return GlazeParse.rank(query, products.map(GlazeParse.fromMaycoWp));
  }

  async function search(query, signal) {
    if (functionAvailable && typeof SUPABASE_URL !== "undefined") {
      try {
        return await viaFunction(query, signal);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        functionAvailable = false; // not deployed: stop trying for this visit
        console.info("glaze-lookup function unavailable, searching Mayco directly.", err.message);
      }
    }
    return viaMaycoDirect(query, signal);
  }

  return { search };
})();
