// Your Supabase connection info (the publishable key is safe to be public)
const SUPABASE_URL = "https://wdyignhbuymysjawkffk.supabase.co";
const SUPABASE_KEY = "sb_publishable_Rgx9p2xanQc0TN-EW0Ukmg_1-HAdDqx";

// "db" is how every page talks to Supabase
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Log out, then go back to the glazes page
async function logOut() {
  await db.auth.signOut();
  window.location.href = "glazes.html";
}
