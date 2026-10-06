// Westridge Ceramics Glazes: grid, sort + filters, detail panel, and upload panel.
// Glazes live in Supabase (see js/glaze-store.js). If the database hasn't been set up yet,
// the page shows MOCK_GLAZES instead and changes last only until the page reloads.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const EASE = "cubic-bezier(.2, .7, .2, 1)";

// ---------- Data ----------

let nextId = 1; // only for sample mode
const glazes = []; // filled from the database at start-up
let usingDatabase = false;

const FILTERS = {
  application: ["Brush On", "Dip"],
  firing: ["Low Fire", "Mid Fire", "Cone 4", "Cone 5", "Cone 6"],
  finish: ["Glossy", "Matte", "Smooth", "Textured", "Speckled"],
  opacity: ["Transparent", "Translucent", "Opaque"],
  foodSafe: ["Food Safe", "Not Food Safe"],
  brand: ["Coyote", "Amaco", "Mayco"],
};

const COLORS = [
  ["red", "#e2665a"], ["orange", "#f0a058"], ["yellow", "#f2d36b"], ["green", "#98c47b"],
  ["teal", "#5fbcc0"], ["blue", "#6aa0e0"], ["purple", "#a184cf"],
  ["pink", "#f0b9cf"], ["brown", "#7a5137"], ["beige", "#e2d3b3"], ["white", "#ffffff"],
  ["grey", "#9a9a9a"], ["black", "#1c1714"],
  ["multi", "conic-gradient(#e2665a, #f2d36b, #98c47b, #5fbcc0, #6aa0e0, #a184cf, #e2665a)"],
];

const state = {
  sort: "newest",
  filters: Object.fromEntries([...Object.keys(FILTERS), "color"].map((k) => [k, new Set()])),
  query: "",
  favoritesOnly: false,
  user: null, // the logged-in Supabase user, if any
  panel: null, // null | "detail" | "upload"
  selectedId: null,
};

// ---------- Matching ----------

function matchesFilter(g, key, option) {
  const has = (field) => (g[field] || "").toLowerCase().includes(option.toLowerCase());
  switch (key) {
    case "application": return has("application");
    case "opacity": return has("opacity");
    case "brand": return g.brand === option;
    case "color": return g.colorFamily === option;
    case "foodSafe": {
      const v = (g.foodSafe || "").toLowerCase();
      return option === "Food Safe" ? v.startsWith("yes") : v.startsWith("no");
    }
    case "finish":
      return has("finish") || (g.tags || []).some((t) => t.toLowerCase() === option.toLowerCase());
    case "firing": {
      const cones = GlazeParse.cones(g.firingRange);
      if (option === "Low Fire") return cones.some((c) => GlazeParse.band(c) === "low") || /low\s?fire/i.test(g.firingRange);
      if (option === "Mid Fire") return cones.some((c) => GlazeParse.band(c) === "mid") || /mid\s?fire/i.test(g.firingRange);
      const wanted = option.replace("Cone ", "");
      // "Cone 4-6" covers cone 5 too
      const nums = cones.filter((c) => !c.startsWith("0")).map(Number);
      return nums.length > 0 && Number(wanted) >= Math.min(...nums) && Number(wanted) <= Math.max(...nums);
    }
  }
  return true;
}

function visibleGlazes() {
  const q = state.query.trim().toLowerCase();
  const list = glazes.filter((g) => {
    if (state.favoritesOnly && !g.favorited) return false;
    if (q) {
      const hay = [g.name, g.code, g.brand, ...(g.tags || [])].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    for (const [key, chosen] of Object.entries(state.filters)) {
      if (chosen.size && ![...chosen].some((opt) => matchesFilter(g, key, opt))) return false;
    }
    return true;
  });
  if (state.sort === "favorited") list.sort((a, b) => favoriteCount(b) - favoriteCount(a));
  else if (state.sort === "az") list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  else if (state.sort === "color") list.sort((a, b) => rainbowKey(a) - rainbowKey(b) || a.name.localeCompare(b.name));
  else list.sort((a, b) => String(b.added).localeCompare(String(a.added)));
  return list;
}

// Rainbow order: red, orange, yellow, green, teal, blue, purple, pink,
// then the neutrals from white to black, then glazes with no known color.
function rainbowKey(g) {
  const hex = g.sortColor || g.color;
  if (!hex) return 3000;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, gr = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, gr, b), min = Math.min(r, gr, b), l = (max + min) / 2, d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.15) return 1000 + (1 - l) * 1000; // neutrals, light to dark
  let h = max === r ? ((gr - b) / d) % 6 : max === gr ? (b - r) / d + 2 : (r - gr) / d + 4;
  h = (h * 60 + 360) % 360;
  return h; // 0 is red; pinks and plums (330°+) close out the rainbow
}

// Average color of a photo, so uploaded glazes take their place in rainbow order
function averageColor(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 24;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 24, 24);
      const px = ctx.getImageData(4, 4, 16, 16).data; // skip the edges, usually background
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
      const k = px.length / 4;
      resolve("#" + [r, g, b].map((v) => Math.round(v / k).toString(16).padStart(2, "0")).join(""));
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

// ---------- Glaze tile artwork ----------

// Mock glazes have no photos, so paint a glaze-like tile from their colors
function tileBackground(g) {
  if (g.photo) return `center / cover no-repeat url("${g.photo}")`;
  if (!g.color) return "";
  const c = g.color, a = g.accent || g.color;
  const layers = [
    // glassy highlight
    `radial-gradient(70% 55% at 28% 22%, color-mix(in srgb, white 38%, transparent), transparent 70%)`,
    // where the glaze breaks thin at the bottom edge
    `linear-gradient(to top, color-mix(in srgb, ${a} 85%, white) 0 5%, color-mix(in srgb, ${a} 60%, transparent) 9%, transparent 22%)`,
    // pooling
    `radial-gradient(60% 45% at 72% 78%, color-mix(in srgb, ${a} 55%, transparent), transparent 75%)`,
  ];
  if (g.speckled) layers.push(`center / cover url("${speckles(g.id)}")`);
  layers.push(`radial-gradient(130% 100% at 35% 30%, color-mix(in srgb, ${c} 82%, white), ${c} 55%, color-mix(in srgb, ${c} 75%, black))`);
  return layers.join(", ");
}

// Iron specks scattered at random (seeded so a glaze always looks the same)
const speckleCache = new Map();
function speckles(seed) {
  if (speckleCache.has(seed)) return speckleCache.get(seed);
  const size = 240;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 260; i++) {
    const r = rand() < 0.85 ? 0.5 + rand() * 0.9 : 1.4 + rand() * 1.4;
    ctx.fillStyle = `rgba(52, 34, 22, ${0.45 + rand() * 0.45})`;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const url = canvas.toDataURL();
  speckleCache.set(seed, url);
  return url;
}

// ---------- Animation helpers ----------

// Records where elements are, runs `change`, then glides them from old to new spots.
// Cards also ease between sizes (columns get narrower when the side panel opens),
// and each card starts a moment after the one before so the grid ripples instead of jumping.
const GLIDE = "cubic-bezier(.25, .8, .3, 1)";
function flip(getEls, change, { duration = 720, stagger = 14 } = {}) {
  if (reduceMotion.matches) return change();
  const before = new Map(getEls().map((el) => [el, el.getBoundingClientRect()]));
  change();
  getEls().forEach((el, i) => {
    const a = before.get(el);
    const b = el.getBoundingClientRect();
    const delay = Math.min(i * stagger, 220);
    if (!a) {
      el.animate([{ opacity: 0, transform: "translateY(10px) scale(.97)" }, { opacity: 1, transform: "none" }],
        { duration: 520, delay, easing: GLIDE, fill: "backwards" });
      return;
    }
    const dx = a.left - b.left, dy = a.top - b.top;
    const sx = a.width / b.width, sy = a.height / b.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return;
    el.animate(
      [{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: "0 0", transform: "none" }],
      { duration, delay, easing: GLIDE, fill: "backwards" }
    );
  });
}

const restartClass = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

// ---------- Grid ----------

const gridEl = $("#grid");
const cards = new Map(); // glaze id -> card element, reused so cards can animate between spots

const HEART_PATH = "M12 20C9.2 18 4.4 14.4 3.1 10.9 1.9 7.6 4 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.2 0 5.3 3.1 4.1 6.4C19.6 14.4 14.8 18 12 20z";

function cardFor(g) {
  let card = cards.get(g.id);
  if (!card) {
    card = document.createElement("div");
    card.className = "card";
    // Two separate buttons: the tile opens the glaze, the heart likes it without opening anything
    card.innerHTML = `
      <button class="card-open"><div class="tile"></div><span class="card-name"></span></button>
      <button class="card-fav" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART_PATH}"/></svg>
      </button>`;
    $(".card-open", card).addEventListener("click", () => openDetail(g.id));
    $(".card-fav", card).addEventListener("click", () => toggleFavorite(g));
    cards.set(g.id, card);
  }
  $(".tile", card).style.background = tileBackground(g);
  $(".card-name", card).textContent = g.name;
  const fav = $(".card-fav", card);
  fav.setAttribute("aria-pressed", String(g.favorited));
  fav.title = g.favorited ? "Remove from favorites" : "Add to favorites";
  fav.setAttribute("aria-label", `${fav.title}: ${g.name}`);
  card.classList.toggle("is-active", state.panel === "detail" && state.selectedId === g.id);
  return card;
}

function renderGrid() {
  const list = visibleGlazes();
  const keep = new Set(list.map((g) => g.id));
  for (const [id, card] of cards) if (!keep.has(id)) card.remove();
  list.forEach((g) => gridEl.append(cardFor(g)));
  $("#empty").hidden = list.length > 0;
}

const visibleCards = () => $$(".card", gridEl);
function updateGrid() {
  // If the open glaze no longer matches the search or filters, close its panel
  if (state.panel === "detail" && !visibleGlazes().some((g) => g.id === state.selectedId)) {
    closePanel();
    return;
  }
  flip(visibleCards, renderGrid);
}

// ---------- Favorites (saved on the person's account) ----------
// Each account keeps a list of glaze keys in its Supabase user data ("favorites"),
// so hearts survive a reload and follow the person to any browser they log in from.
// g.favorites is the sample count from everyone else; your own heart adds one.

const glazeKey = (g) => (g.code || g.name).trim().toUpperCase();
const favoriteCount = (g) => g.favorites + (g.favorited ? 1 : 0);
const savedFavorites = () => new Set((state.user && state.user.user_metadata && state.user.user_metadata.favorites) || []);

// Updates every heart for this glaze: its gallery tile and the side panel if it's open
function showFavorite(g, { pop = false } = {}) {
  const card = cards.get(g.id);
  if (card) {
    cardFor(g);
    if (pop) restartClass($(".card-fav", card), "pop");
  }
  if (state.panel === "detail" && state.selectedId === g.id) {
    const fav = $("#panel [data-fav]");
    fav.setAttribute("aria-pressed", String(g.favorited));
    $("#panel [data-count]").textContent = favoriteCount(g);
    if (pop) restartClass(fav, "pop");
  }
}

// Marks the glazes the logged-in person has hearted (or clears them on log out)
function applySavedFavorites() {
  const keys = savedFavorites();
  let changed = false;
  for (const g of glazes) {
    const on = keys.has(glazeKey(g));
    if (g.favorited !== on) { g.favorited = on; changed = true; showFavorite(g); }
  }
  if (!state.user && state.favoritesOnly) {
    state.favoritesOnly = false;
    $("#favFilter").setAttribute("aria-pressed", "false");
    changed = true;
  }
  if (changed && (state.favoritesOnly || state.sort === "favorited" || !state.user)) updateGrid();
}

async function toggleFavorite(g) {
  if (!state.user) return openLogin("Log in to heart glazes and keep your favorites.");

  // Show the change right away, then save it to the account
  g.favorited = !g.favorited;
  showFavorite(g, { pop: true });
  if (state.favoritesOnly || state.sort === "favorited") updateGrid();

  // Build the list from what's on screen (so quick double-hearts don't undo each other),
  // keeping any saved keys for glazes that aren't on this page
  const shown = new Set(glazes.map(glazeKey));
  const keys = new Set([...savedFavorites()].filter((k) => !shown.has(k)));
  glazes.forEach((x) => { if (x.favorited) keys.add(glazeKey(x)); });
  const { data, error } = await db.auth.updateUser({ data: { favorites: [...keys] } });
  if (error) {
    console.warn("Couldn't save favorite:", error.message);
    g.favorited = !g.favorited; // put it back the way it was
    showFavorite(g);
    if (state.favoritesOnly || state.sort === "favorited") updateGrid();
    return;
  }
  // Only adopt the saved copy if nothing else changed while it was saving
  const now = new Set(glazes.filter((x) => x.favorited).map(glazeKey));
  const saved = new Set(data.user.user_metadata.favorites || []);
  if ([...now].every((k) => saved.has(k)) && [...saved].filter((k) => shown.has(k)).every((k) => now.has(k))) setUser(data.user);
  else state.user = data.user;
}

// ---------- Sort + filter panel ----------

const sortEl = $("#sort");

function buildSortPanel() {
  $("#swatches").innerHTML = COLORS.map(
    ([name, bg]) => `<button class="swatch" data-color="${name}" aria-pressed="false" title="${name}" style="background:${bg}"></button>`
  ).join("");
  $$(".opts[data-filter]").forEach((box) => {
    box.innerHTML = FILTERS[box.dataset.filter]
      .map((opt) => `<button class="opt" aria-pressed="false" data-value="${opt}">${opt}</button>`)
      .join("");
  });
  syncSortPanel();
}

function syncSortPanel() {
  $$("[data-sort]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sort === state.sort)));
  $$(".swatch").forEach((b) => b.setAttribute("aria-pressed", String(state.filters.color.has(b.dataset.color))));
  $$(".opts[data-filter]").forEach((box) => {
    const chosen = state.filters[box.dataset.filter];
    $$(".opt", box).forEach((b) => b.setAttribute("aria-pressed", String(chosen.has(b.dataset.value))));
  });
  const count = Object.values(state.filters).reduce((n, s) => n + s.size, 0);
  const clear = $("#clearFilters");
  clear.hidden = count === 0;
  clear.textContent = `Clear (${count})`;
}

sortEl.addEventListener("click", (e) => {
  const sortBtn = e.target.closest("[data-sort]");
  if (sortBtn) { state.sort = sortBtn.dataset.sort; syncSortPanel(); updateGrid(); }

  const swatch = e.target.closest(".swatch");
  const opt = e.target.closest(".opts .opt");
  if (swatch || opt) {
    const set = swatch ? state.filters.color : state.filters[opt.parentElement.dataset.filter];
    const value = swatch ? swatch.dataset.color : opt.dataset.value;
    set.has(value) ? set.delete(value) : set.add(value);
    syncSortPanel();
    updateGrid();
  }
});

$("#resetAll").addEventListener("click", () => {
  Object.values(state.filters).forEach((set) => set.clear());
  state.query = "";
  $("#search").value = "";
  state.favoritesOnly = false;
  $("#favFilter").setAttribute("aria-pressed", "false");
  syncSortPanel();
  updateGrid();
});

$("#clearFilters").addEventListener("click", () => {
  Object.values(state.filters).forEach((set) => set.clear());
  syncSortPanel();
  updateGrid();
});

// ---------- Search + favorites filter ----------

$("#search").addEventListener("input", (e) => { state.query = e.target.value; updateGrid(); });

$("#favFilter").addEventListener("click", (e) => {
  if (!state.user) return openLogin("Log in to see the glazes you've hearted.");
  state.favoritesOnly = !state.favoritesOnly;
  e.currentTarget.setAttribute("aria-pressed", String(state.favoritesOnly));
  updateGrid();
});

// ---------- Side panel ----------

const layoutEl = $("#layout");
const panelEl = $("#panel");

function showPanel(mode, fill) {
  const wasOpen = !!state.panel;
  state.panel = mode;
  syncActions();
  const draw = () => {
    panelEl.replaceChildren(fill());
    layoutEl.classList.add("has-panel");
    renderGrid();
  };
  panelEl.classList.remove("leaving", "entering", "swapping");
  flip(visibleCards, draw);
  restartClass(panelEl, wasOpen ? "swapping" : "entering");
}

// `alsoChange` runs inside the same glide, e.g. taking a deleted card out of the grid
function closePanel(alsoChange) {
  if (!state.panel || panelEl.classList.contains("leaving")) return; // already closing
  const finish = () => {
    state.panel = null;
    state.selectedId = null;
    syncActions();
    flip(visibleCards, () => {
      layoutEl.classList.remove("has-panel");
      panelEl.classList.remove("leaving");
      panelEl.replaceChildren();
      if (alsoChange) alsoChange();
      renderGrid();
    });
  };
  if (reduceMotion.matches) return finish();
  panelEl.classList.remove("entering", "swapping");
  panelEl.classList.add("leaving");
  setTimeout(finish, 240);
}

panelEl.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closePanel(); });

function syncActions() {
  $("#uploadBtn").classList.toggle("is-current", state.panel === "upload");
}

// ---------- Detail panel ----------

const ATTRS = [
  ["Firing Range", "firingRange"], ["Application", "application"], ["Finish", "finish"],
  ["Opacity", "opacity"], ["Food Safe", "foodSafe"], ["Fluidity", "fluidity"],
];

// Signed-in people can change the sample glazes and anything they added themselves
function canEdit(g) {
  return !!state.user && (!g.addedBy || g.addedBy === state.user.id);
}

function openDetail(id, { force = false } = {}) {
  if (!force && state.panel === "detail" && state.selectedId === id) return;
  state.selectedId = id;
  const g = glazes.find((x) => x.id === id);

  showPanel("detail", () => {
    const view = $("#detailTemplate").content.cloneNode(true);
    $("[data-photo]", view).style.background = tileBackground(g) || "var(--tile)";
    $("[data-name]", view).textContent = g.name;
    $("[data-code]", view).textContent = g.code || "";
    // Brand is left out of the search when the name already includes it ("Coyote Cobalt Blue")
    const label = [g.name.toLowerCase().includes((g.brand || "").toLowerCase()) ? "" : g.brand, g.name, g.code]
      .filter(Boolean).join(" ");
    $("[data-web]", view).href = "https://www.google.com/search?q=" + encodeURIComponent(label + " glaze");
    $("[data-images]", view).href = "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(label + " glaze pottery");

    $("[data-attrs]", view).innerHTML = ATTRS.map(([label, key]) => {
      const v = g[key];
      return `<dt>${label}:</dt><dd><span class="chip${v ? "" : " empty-val"}">${v ? escapeHtml(v) : "Unknown"}</span></dd>`;
    }).join("");

    // Clicking a tag searches for it
    $("[data-tags]", view).innerHTML = (g.tags || [])
      .map((t) => `<button class="tag" data-tag="${escapeHtml(t)}" title="Search “${escapeHtml(t)}”">${escapeHtml(t)}</button>`)
      .join("");

    const editable = canEdit(g);
    $("[data-edit]", view).hidden = !editable;
    $("[data-delete]", view).hidden = !editable;
    $("[data-edit]", view).addEventListener("click", async () => {
      const ok = await askPassword({
        title: "Edit this glaze?",
        text: `Enter the studio password to edit <strong>${escapeHtml(g.name)}</strong>.`,
        confirm: "Edit glaze",
      });
      if (ok) openUpload(g.id);
    });
    $("[data-delete]", view).addEventListener("click", async () => {
      const ok = await askPassword({
        title: "Delete this glaze?",
        text: `<strong>${escapeHtml(g.name)}</strong> will be removed from the library. This can’t be undone. Enter the studio password to confirm.`,
        confirm: "Delete glaze",
        danger: true,
      });
      if (ok) deleteGlaze(g);
    });

    const fav = $("[data-fav]", view);
    const favCount = $("[data-count]", view);
    fav.setAttribute("aria-pressed", String(g.favorited));
    favCount.textContent = favoriteCount(g);
    fav.addEventListener("click", () => toggleFavorite(g));
    return view;
  });
}

panelEl.addEventListener("click", (e) => {
  const tag = e.target.closest("[data-tag]");
  if (!tag) return;
  $("#search").value = tag.dataset.tag;
  state.query = tag.dataset.tag;
  updateGrid();
});

// ---------- Upload panel ----------

const INFO_FIELDS = ["code", "firingRange", "application", "finish", "opacity", "foodSafe", "fluidity"];
let upload = null; // what the person has entered so far

$("#uploadBtn").addEventListener("click", () => openUpload());

// Opens the glaze form. With an id, it edits that glaze instead of adding a new one.
function openUpload(editId) {
  if (!state.user) return openLogin(editId ? "Log in to edit glazes." : "Log in to upload a glaze.");
  const g = editId ? glazes.find((x) => x.id === editId) : null;
  state.selectedId = null;
  upload = { editId: g ? g.id : null, photo: g ? g.photo : "", tags: g ? [...(g.tags || [])] : [], brand: g ? g.brand : "" };
  showPanel("upload", () => {
    const view = $("#uploadTemplate").content.cloneNode(true);
    wireUpload(view);
    if (g) fillForm(view, g);
    return view;
  });
  setTimeout(() => $("#f-name")?.focus({ preventScroll: true }), 350);
}

function fillForm(view, g) {
  $("#f-name", view).value = g.name;
  for (const key of INFO_FIELDS) $("#f-" + key, view).value = g[key] || "";
  $("#saveBtn", view).firstChild.textContent = "Save changes ";
  $("#uploadTags", view).innerHTML = tagChips();
  const square = $("#dropSquare", view);
  if (g.photo) {
    $("#photoPreview", view).src = g.photo;
    $("#photoPreview", view).hidden = false;
    $("#dropzone", view).classList.add("has-photo");
  } else if (g.color) {
    square.style.background = tileBackground(g); // show the current swatch until a photo replaces it
    $("#dropzone", view).classList.add("has-photo");
  }
}

function wireUpload(view) {
  // Photo: click or drop
  const zone = $("#dropzone", view);
  const input = $("#photoInput", view);
  const preview = $("#photoPreview", view);
  const usePhoto = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    upload.file = file;
    upload.photo = URL.createObjectURL(file);
    averageColor(upload.photo).then((hex) => { if (upload) upload.sortColor = hex; });
    preview.src = upload.photo;
    $("#dropSquare", zone).style.background = "";
    preview.hidden = false;
    zone.classList.add("has-photo");
  };
  input.addEventListener("change", () => usePhoto(input.files[0]));
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragging"); });
  zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("dragging"); });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragging");
    usePhoto(e.dataTransfer.files[0]);
  });

  // Tags
  const tagInput = $("#tagInput", view);
  const tagAdd = $("#tagAdd", view);
  // + opens the tag box (and adds whatever is typed in it). Enter, a comma, or clicking
  // away also adds the tag; the box stays open after Enter so you can keep typing tags.
  // Pressing + keeps focus in the tag box, so the box doesn't close and shift + out from under the click
  tagAdd.addEventListener("mousedown", (e) => { if (!tagInput.hidden) e.preventDefault(); });
  tagAdd.addEventListener("click", () => {
    commitTag();
    tagInput.hidden = false;
    tagInput.focus();
  });
  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag();
    }
    if (e.key === "Backspace" && !tagInput.value && upload.tags.length) {
      upload.tags.pop(); // backspace in an empty box removes the last tag
      renderUploadTags();
    }
    if (e.key === "Escape") {
      e.stopPropagation(); // close just the tag box, not the whole panel
      tagInput.value = "";
      tagInput.hidden = true;
    }
  });
  tagInput.addEventListener("blur", () => {
    commitTag();
    tagInput.hidden = true;
  });

  $("#uploadForm", view).addEventListener("submit", (e) => { e.preventDefault(); saveUpload(); });
  $("#f-name", view).addEventListener("input", (e) => e.target.classList.remove("invalid"));

  wireNameSearch(view);
}

function tagChips() {
  return upload.tags
    .map((t, i) => `<button type="button" class="tag removable" data-remove="${i}" title="Remove “${escapeHtml(t)}”" aria-label="Remove tag ${escapeHtml(t)}">${escapeHtml(t)} <span class="x" aria-hidden="true">×</span></button>`)
    .join("");
}
// Adds the typed tag(s); commas split several at once
function commitTag() {
  const input = $("#tagInput");
  if (!input || !upload) return;
  const added = input.value.split(",").map((t) => t.trim()).filter(Boolean);
  input.value = "";
  let changed = false;
  for (const t of added) {
    if (!upload.tags.some((x) => x.toLowerCase() === t.toLowerCase())) { upload.tags.push(t); changed = true; }
  }
  if (changed) renderUploadTags();
}

function renderUploadTags() {
  $("#uploadTags").innerHTML = tagChips();
}

panelEl.addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove]");
  if (!rm || !upload) return;
  upload.tags.splice(Number(rm.dataset.remove), 1);
  renderUploadTags();
});

async function saveUpload() {
  commitTag(); // a tag still being typed counts
  const nameInput = $("#f-name");
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.classList.remove("invalid");
    void nameInput.offsetWidth;
    nameInput.classList.add("invalid");
    nameInput.focus();
    return;
  }

  const existing = upload.editId ? glazes.find((x) => x.id === upload.editId) : null;
  const g = existing ? { ...existing } : { favorites: 0, favorited: false, addedBy: state.user.id };
  g.name = name;
  g.brand = upload.brand;
  g.tags = [...upload.tags];
  for (const key of INFO_FIELDS) g[key] = $("#f-" + key).value.trim();
  if (upload.file) g.sortColor = upload.sortColor || "";

  const saveBtn = $("#saveBtn");
  const label = saveBtn.firstChild.textContent;
  const msg = $("#formMsg");
  saveBtn.disabled = true;
  saveBtn.firstChild.textContent = "Saving… ";
  msg.textContent = "";

  let saved;
  try {
    if (usingDatabase) {
      if (upload.file) g.photo = await GlazeStore.uploadPhoto(upload.file);
      saved = existing ? await GlazeStore.update(g) : await GlazeStore.create(g, state.user.id);
      saved.favorited = g.favorited;
    } else {
      if (upload.file) g.photo = upload.photo;
      saved = existing ? g : { ...g, id: nextId++, added: new Date().toISOString() };
    }
  } catch (err) {
    msg.textContent = err.message;
    saveBtn.disabled = false;
    saveBtn.firstChild.textContent = label;
    return;
  }

  if (existing) {
    Object.assign(existing, saved);
    openDetail(existing.id, { force: true });
    return;
  }
  glazes.push(saved);
  state.sort = "newest";
  syncSortPanel();
  openDetail(saved.id); // shows the new glaze and slides it into the grid
}

// ---------- Password check + delete ----------

const authDialog = $("#authDialog");
const authInput = $("#f-confirm-password");
let authDone = null; // resolves the open askPassword() call

// Asks for the studio password. Resolves true once it matches.
function askPassword({ title, text, confirm, danger = false }) {
  $("#authTitle").textContent = title;
  $("#authText").innerHTML = text;
  const ok = $("#authOk");
  ok.textContent = confirm;
  ok.classList.toggle("btn-danger", danger);
  ok.classList.toggle("btn-solid", !danger);
  ok.disabled = false;
  authInput.value = "";
  authInput.classList.remove("invalid");
  setAuthMsg("");
  authDialog.showModal();
  authInput.focus();
  return new Promise((resolve) => { authDone = resolve; });
}

function setAuthMsg(text, isError) {
  const msg = $("#authMsg");
  msg.textContent = text;
  msg.classList.toggle("error", !!isError);
}

function finishAuth(result) {
  if (authDialog.open) authDialog.close();
  const done = authDone;
  authDone = null;
  if (done) done(result);
}

// The shared studio password for editing and deleting, stored as a SHA-256 hash
// so it isn't readable in the page source.
const EDIT_PASSWORD_HASH = "339a9884b824c770d4d71ec07013e8dc27bb22f55f0e793879df81491dc9e418";

async function matchesEditPassword(password) {
  const bytes = new TextEncoder().encode(password.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === EDIT_PASSWORD_HASH;
}

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = authInput.value;
  if (!password) {
    setAuthMsg("Enter your password.", true);
    return;
  }
  if (!(await matchesEditPassword(password))) {
    setAuthMsg("That password isn’t right. Try again.", true);
    authInput.select();
    restartClass(authInput, "invalid");
    return;
  }
  finishAuth(true);
});

$("#authCancel").addEventListener("click", () => finishAuth(false));
authDialog.addEventListener("cancel", (e) => { e.preventDefault(); finishAuth(false); }); // Esc
authDialog.addEventListener("click", (e) => { if (e.target === authDialog) finishAuth(false); }); // outside

async function deleteGlaze(g) {
  if (usingDatabase) {
    try {
      await GlazeStore.remove(g);
    } catch (err) {
      showToast(escapeHtml(err.message), { ms: 6000 });
      return;
    }
  }
  const index = glazes.indexOf(g);
  glazes.splice(index, 1);
  const card = cards.get(g.id);
  cards.delete(g.id);
  // The card fades out where it stood, then the others glide in to close the gap
  if (card && !reduceMotion.matches) {
    card.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.92)" }], { duration: 220, easing: "ease-in", fill: "forwards" });
  }
  closePanel(() => card && card.remove());

  showToast(`Deleted <strong>${escapeHtml(g.name)}</strong>`, {
    undo: async () => {
      let back = g;
      if (usingDatabase) {
        try {
          back = await GlazeStore.restore(g);
        } catch (err) {
          showToast(escapeHtml(err.message), { ms: 6000 });
          return;
        }
        back.favorited = g.favorited;
      }
      glazes.splice(Math.min(index, glazes.length), 0, back); // back where it was
      updateGrid(); // the tile fades back in as the others make room
    },
  });
}

// ---------- Messages ("Deleted … Undo", errors) ----------

const toast = $("#toast");
let toastTimer = null;
let onUndo = null; // what Undo does while the message is showing

function showToast(html, { undo = null, ms = 7000 } = {}) {
  onUndo = undo;
  $("#toastText").innerHTML = html;
  $("#toastUndo").hidden = !undo;
  toast.hidden = false;
  toast.classList.remove("hiding");
  restartClass(toast, "showing");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  onUndo = null;
  if (toast.hidden) return;
  toast.classList.add("hiding");
  setTimeout(() => { if (toast.classList.contains("hiding")) toast.hidden = true; }, 220);
}

// Pauses the countdown while the pointer is on the message
toast.addEventListener("mouseenter", () => clearTimeout(toastTimer));
toast.addEventListener("mouseleave", () => { if (!toast.hidden) toastTimer = setTimeout(hideToast, 3000); });

$("#toastClose").addEventListener("click", hideToast);
$("#toastUndo").addEventListener("click", () => {
  const undo = onUndo;
  hideToast();
  if (undo) undo();
});

// ---------- Name search: looks the glaze up on the web as you type ----------

const SEARCH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>`;

function wireNameSearch(view) {
  const input = $("#f-name", view);
  const list = $("#suggestions", view);
  const cache = new Map();
  let timer = null;
  let controller = null;
  let results = [];
  let active = -1;

  const open = (html) => {
    list.innerHTML = html;
    if (list.hidden) { list.hidden = false; restartClass(list, "suggestions"); }
    input.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };

  const showResults = (q) => {
    if (input.value.trim() !== q) return; // the person kept typing
    if (!results.length) {
      open(`<div class="sugg-status">No matches found online. Fill in the details yourself.</div>`);
      return;
    }
    open(results.map((r, i) => `
      <button type="button" class="sugg" role="option" data-i="${i}" id="sugg-${i}">
        ${SEARCH_ICON}
        <span>${escapeHtml(r.name)} <span class="sugg-brand">· ${escapeHtml(r.brand)}</span></span>
        <span class="sugg-meta">${escapeHtml(r.code)}</span>
      </button>`).join(""));
  };

  const run = async (q) => {
    if (cache.has(q)) { results = cache.get(q); return showResults(q); }
    controller?.abort();
    controller = new AbortController();
    open(`<div class="sugg-status"><span class="spinner"></span>Searching the web…</div>`);
    try {
      results = await GlazeLookup.search(q, controller.signal);
      cache.set(q, results);
      showResults(q);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.warn("Glaze lookup failed:", err);
      results = [];
      if (input.value.trim() === q) open(`<div class="sugg-status">Couldn’t reach the web right now. Fill in the details yourself.</div>`);
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { controller?.abort(); close(); return; }
    timer = setTimeout(() => run(q), 320);
  });

  input.addEventListener("keydown", (e) => {
    const opts = $$(".sugg", list);
    if (e.key === "Escape" && !list.hidden) { e.stopPropagation(); close(); return; }
    if (!opts.length || list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.classList.toggle("active", i === active));
      input.setAttribute("aria-activedescendant", opts[active].id);
    }
    if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(results[active]); close(); }
  });

  // mousedown so the pick happens before the input loses focus
  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".sugg");
    if (!opt) return;
    e.preventDefault();
    pick(results[Number(opt.dataset.i)]);
    close();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2 && results.length) showResults(input.value.trim()); });
}

// Fills the form with exactly what the source says. Anything it doesn't state is left blank.
function pick(result) {
  if (!result) return;
  $("#f-name").value = result.name;
  for (const key of INFO_FIELDS) {
    const el = $("#f-" + key);
    el.value = result[key] || "";
    el.placeholder = result[key] ? "" : "Not listed by " + result.source;
    el.classList.remove("autofilled");
    if (result[key]) { void el.offsetWidth; el.classList.add("autofilled"); }
  }
  upload.brand = result.brand || "";
  upload.tags = [...new Set([result.brand, ...(result.tags || [])].filter(Boolean))];
  renderUploadTags();

  const note = $("#sourceNote");
  note.hidden = false;
  note.innerHTML = `Details from <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${escapeHtml(result.source)} ↗</a>`;
}

// ---------- Log in / account ----------
// Uses the same Supabase accounts as before (db comes from config.js).

const profileBtn = $("#profileBtn");
profileBtn.addEventListener("click", () => {
  if (state.panel === "login" || state.panel === "account") return closePanel();
  state.user ? openAccount() : openLogin();
});

function syncProfile() {
  const label = state.user ? displayName() || "Your account" : "Log in";
  profileBtn.setAttribute("aria-pressed", String(!!state.user));
  profileBtn.title = label;
  $("#profileLabel").textContent = label;
}

function openLogin(note) {
  state.selectedId = null;
  let creating = false;
  showPanel("login", () => {
    const view = $("#loginTemplate").content.cloneNode(true);
    const form = $("#loginForm", view);
    const msg = $("#accountMsg", view);
    const submit = $("#loginSubmit", view);
    if (note) $("#accountNote", view).textContent = note;

    const setMode = (create) => {
      creating = create;
      $("#accountTitle", form).textContent = create ? "Create an account" : "Log in";
      submit.firstChild.textContent = create ? "Create account " : "Log in ";
      $("#modeSwitch", form).textContent = create ? "Have an account? Log in" : "New here? Create an account";
      $("#f-password", form).autocomplete = create ? "new-password" : "current-password";
      $("#nameRow", form).hidden = !create;
      say("");
    };
    const say = (text, isError) => { msg.textContent = text; msg.classList.toggle("error", !!isError); };

    $("#modeSwitch", view).addEventListener("click", () => setMode(!creating));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#f-email", form).value.trim();
      const password = $("#f-password", form).value;
      const name = $("#f-account-name", form).value.trim();
      if (creating && !name) return say("Enter a name for your account.", true);
      if (!email || !password) return say("Enter your email and password.", true);
      if (typeof db === "undefined") return say("Can’t reach the account service. Check your connection and reload.", true);

      submit.disabled = true;
      say(creating ? "Creating your account…" : "Logging in…");
      const result = creating
        ? await db.auth.signUp({ email, password, options: { data: { name } } })
        : await db.auth.signInWithPassword({ email, password });
      submit.disabled = false;

      if (result.error) return say(result.error.message, true);
      if (creating && !result.data.session) return say("Check your email to confirm your account, then log in.");
      setUser(result.data.session.user);
      openAccount();
    });
    return view;
  });
  setTimeout(() => $("#f-email")?.focus({ preventScroll: true }), 400);
}

function openAccount() {
  state.selectedId = null;
  showPanel("account", () => {
    const view = $("#accountTemplate").content.cloneNode(true);
    $("#accountEmail", view).textContent = state.user.email;
    $("#accountName", view).textContent = displayName() || "Your account";

    // Rename: saves when you press Enter or leave the field
    const rename = $("#f-rename", view);
    const msg = $("#renameMsg", view);
    rename.value = displayName();
    rename.placeholder = "Add your name";
    const save = async () => {
      const name = rename.value.trim();
      if (!name || name === displayName()) return;
      msg.textContent = "Saving…";
      const { data, error } = await db.auth.updateUser({ data: { name } });
      if (error) { msg.textContent = error.message; msg.classList.add("error"); return; }
      setUser(data.user);
      $("#accountName").textContent = name;
      msg.classList.remove("error");
      msg.textContent = "Name saved.";
    };
    $("#renameForm", view).addEventListener("submit", (e) => { e.preventDefault(); save(); });
    rename.addEventListener("blur", save);
    $("#accountUpload", view).addEventListener("click", openUpload);
    $("#logoutBtn", view).addEventListener("click", async () => {
      await db.auth.signOut();
      setUser(null);
      closePanel();
    });
    return view;
  });
}

function displayName() {
  return (state.user && state.user.user_metadata && state.user.user_metadata.name) || "";
}

function setUser(user) {
  const changed = (state.user && state.user.id) !== (user && user.id);
  state.user = user;
  syncProfile();
  // Edit and delete appear or disappear on the open glaze when you log in or out
  if (changed && state.panel === "detail") openDetail(state.selectedId, { force: true });
  applySavedFavorites();
}

async function loadSession() {
  if (typeof db === "undefined") return; // Supabase script didn't load (offline)
  const { data } = await db.auth.getSession();
  setUser(data.session ? data.session.user : null);
  db.auth.onAuthStateChange((_event, session) => setUser(session ? session.user : null));
}

// ---------- Keyboard ----------

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || authDialog.open) return;
  if (state.panel) closePanel();
});

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- Start ----------

// Loads glazes from Supabase, or falls back to the samples if the database isn't set up yet
async function loadGlazes() {
  const notice = $("#notice");
  notice.textContent = "Loading glazes…";
  notice.hidden = false;
  const result = await GlazeStore.load();
  if (result.glazes) {
    usingDatabase = true;
    glazes.push(...result.glazes);
    notice.hidden = true;
  } else {
    glazes.push(...MOCK_GLAZES.map((g) => ({ ...g, id: nextId++, favorited: false, photo: "", added: g.added })));
    notice.textContent = result.needsSetup
      ? "Showing sample glazes: the database isn’t set up yet, so changes won’t be saved. Run supabase/migrations/20261007_glaze_library.sql in Supabase to fix this."
      : "Showing sample glazes: couldn’t reach the database, so changes won’t be saved.";
    console.warn("Glaze database:", result.error);
  }
  updateGrid();
  applySavedFavorites();
}

buildSortPanel();
syncProfile();
loadSession();
loadGlazes();
