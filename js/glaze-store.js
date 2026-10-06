// Reads and writes glazes in the Supabase "glazes" table, and photos in the "glaze-images" bucket.
// The table's original columns are reused: title = name, image_url = photo, user_id = who added it.
// Run supabase/migrations/20261007_glaze_library.sql once to add the other columns.
const GlazeStore = (function () {
  const BUCKET = "glaze-images";
  const COLUMNS = "id, title, image_url, user_id, created_at, code, brand, firing_range, application, finish, " +
    "opacity, food_safe, notes, tags, color, accent, speckled, color_family, sort_color, base_favorites";

  function fromRow(r) {
    return {
      id: r.id,
      name: r.title || "",
      code: r.code || "",
      brand: r.brand || "",
      firingRange: r.firing_range || "",
      application: r.application || "",
      finish: r.finish || "",
      opacity: r.opacity || "",
      foodSafe: r.food_safe || "",
      notes: r.notes || "",
      tags: r.tags || [],
      color: r.color || "",
      accent: r.accent || "",
      speckled: !!r.speckled,
      colorFamily: r.color_family || "",
      sortColor: r.sort_color || "",
      photo: r.image_url || "",
      favorites: r.base_favorites || 0,
      favorited: false,
      added: r.created_at,
      addedBy: r.user_id || null,
    };
  }

  function toRow(g) {
    return {
      title: g.name,
      code: g.code || "",
      brand: g.brand || "",
      firing_range: g.firingRange || "",
      application: g.application || "",
      finish: g.finish || "",
      opacity: g.opacity || "",
      food_safe: g.foodSafe || "",
      notes: g.notes || "",
      tags: g.tags || [],
      color: g.color || "",
      accent: g.accent || "",
      speckled: !!g.speckled,
      color_family: g.colorFamily || "",
      sort_color: g.sortColor || "",
      image_url: g.photo || "",
      base_favorites: g.favorites || 0,
    };
  }

  // Returns { glazes } from the database, or { error, needsSetup } when the table
  // hasn't been set up yet (missing columns) or can't be reached.
  async function load() {
    if (typeof db === "undefined") return { error: "Can’t reach Supabase." };
    // Naming the columns makes Supabase report any that are missing (code 42703 = setup not run yet)
    const { data, error } = await db.from("glazes").select(COLUMNS).order("created_at", { ascending: false });
    if (error) return { error: error.message, needsSetup: error.code === "42703" };
    return { glazes: data.map(fromRow) };
  }

  // Uploads a photo and returns its public web address
  async function uploadPhoto(file) {
    if (file.size > 5 * 1024 * 1024) throw new Error("That photo is over 5 MB. Please choose a smaller one.");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (error) throw new Error("Photo upload failed: " + error.message);
    return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function create(g, userId) {
    const row = { ...toRow(g), user_id: userId };
    const { data, error } = await db.from("glazes").insert(row).select(COLUMNS).single();
    if (error) throw new Error("Couldn’t save the glaze: " + error.message);
    return fromRow(data);
  }

  async function update(g) {
    const { data, error } = await db.from("glazes").update(toRow(g)).eq("id", g.id).select(COLUMNS).single();
    if (error) {
      // No row back means the database's edit rule said no (the older setup only let owners edit)
      throw new Error(error.code === "PGRST116"
        ? "The database didn’t allow that edit. Run supabase/migrations/20261008_options_and_editing.sql in Supabase."
        : "Couldn’t save your changes: " + error.message);
    }
    return fromRow(data);
  }

  async function remove(g) {
    // .select() returns the deleted row, so we can tell "deleted" apart from "not allowed"
    const { data, error } = await db.from("glazes").delete().eq("id", g.id).select("id");
    if (error) throw new Error("Couldn’t delete the glaze: " + error.message);
    if (!data.length) {
      throw new Error("The database didn’t allow that delete. Run supabase/migrations/20261008_options_and_editing.sql in Supabase.");
    }
  }

  // Undo: puts a deleted glaze back with its original owner and date, so it returns to the same spot
  async function restore(g) {
    const row = { ...toRow(g), user_id: g.addedBy, created_at: g.added };
    const { data, error } = await db.from("glazes").insert(row).select(COLUMNS).single();
    if (error) throw new Error("Couldn’t undo: " + error.message);
    return fromRow(data);
  }

  // ---- Dropdown choices (table "glaze_options") ----
  // Rows are choices people added, plus any choice that's been removed (removed = true),
  // built-in ones included, so a removal can be undone.

  const SETUP_MSG = "Run supabase/migrations/20261009b_remove_any_option.sql in Supabase first.";
  const missingTable = (e) => e && (e.code === "42P01" || e.code === "PGRST205");
  const escapeLike = (text) => text.replace(/[\\%_]/g, "\\$&");

  // Returns { options: [{ category, label, removed }] }, or { error, needsSetup } when the table isn't there yet
  async function loadOptions() {
    if (typeof db === "undefined") return { error: "Can’t reach Supabase." };
    let { data, error } = await db.from("glaze_options").select("category, label, removed").order("created_at");
    if (error && error.code === "42703") { // the "removed" column isn't there yet
      ({ data, error } = await db.from("glaze_options").select("category, label").order("created_at"));
    }
    if (error) return { error: error.message, needsSetup: missingTable(error) };
    return { options: data.map((o) => ({ ...o, removed: !!o.removed })) };
  }

  // The row for a choice, matched however it's capitalized
  async function findOption(category, label) {
    const { data, error } = await db.from("glaze_options").select("id, label")
      .eq("category", category).ilike("label", escapeLike(label)).limit(1);
    if (error) throw error;
    return data[0] || null;
  }

  // Marks a choice as listed (removed = false) or removed (removed = true), creating its row if needed
  async function setOption(category, label, removed) {
    let row;
    try {
      row = await findOption(category, label);
    } catch (error) {
      const e = new Error(missingTable(error) ? "setup" : "Couldn’t reach the options list: " + error.message);
      e.needsSetup = missingTable(error);
      throw e;
    }
    const result = row
      ? await db.from("glaze_options").update({ removed }).eq("id", row.id).select("id")
      : await db.from("glaze_options").insert({ category, label, removed }).select("id");
    if (result.error) {
      if (result.error.code === "42703") throw new Error("Removing options needs one more setup step. " + SETUP_MSG);
      throw new Error("Couldn’t save that change: " + result.error.message);
    }
    if (!result.data.length) throw new Error("The database didn’t allow that change. " + SETUP_MSG);
  }

  // Adding a choice that was removed earlier just brings it back
  async function addOption(category, label) {
    try {
      await setOption(category, label, false);
    } catch (err) {
      // Before the latest setup step, a plain insert still works for brand-new choices
      if (err.needsSetup) throw err;
      const { error } = await db.from("glaze_options").insert({ category, label });
      if (error && error.code !== "23505") throw err;
    }
  }

  const removeOption = (category, label) => setOption(category, label, true);
  const restoreOption = (category, label) => setOption(category, label, false);

  return { load, uploadPhoto, create, update, remove, restore, loadOptions, addOption, removeOption, restoreOption };
})();
