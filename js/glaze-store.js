// Reads and writes glazes in the Supabase "glazes" table, and photos in the "glaze-images" bucket.
// The table's original columns are reused: title = name, image_url = photo, user_id = who added it.
// Run supabase/migrations/20261007_glaze_library.sql once to add the other columns.
const GlazeStore = (function () {
  const BUCKET = "glaze-images";
  const COLUMNS = "id, title, image_url, user_id, created_at, code, brand, firing_range, application, finish, " +
    "opacity, food_safe, fluidity, tags, color, accent, speckled, color_family, sort_color, base_favorites";

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
      fluidity: r.fluidity || "",
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
      fluidity: g.fluidity || "",
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
    if (error) throw new Error("Couldn’t save your changes: " + error.message);
    return fromRow(data);
  }

  async function remove(g) {
    // .select() returns the deleted row, so we can tell "deleted" apart from "not allowed"
    const { data, error } = await db.from("glazes").delete().eq("id", g.id).select("id");
    if (error) throw new Error("Couldn’t delete the glaze: " + error.message);
    if (!data.length) throw new Error("You can only delete glazes you added.");
  }

  // Undo: puts a deleted glaze back with its original owner and date, so it returns to the same spot
  async function restore(g) {
    const row = { ...toRow(g), user_id: g.addedBy, created_at: g.added };
    const { data, error } = await db.from("glazes").insert(row).select(COLUMNS).single();
    if (error) throw new Error("Couldn’t undo: " + error.message);
    return fromRow(data);
  }

  return { load, uploadPhoto, create, update, remove, restore };
})();
