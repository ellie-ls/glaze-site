# glaze-lookup (Supabase edge function)

Adds **Coyote** glazes (with tile photos) to the "Name" search in the upload form, and gives
**Mayco** results more detail (food safety, product code). Mayco, Spectrum and Laguna are
searched straight from the browser and work without this function.

## Deploy from the Supabase dashboard

1. Open your project's **Edge Functions** page:
   https://supabase.com/dashboard/project/wdyignhbuymysjawkffk/functions
2. Click **Deploy a new function**, then choose **Via Editor**.
3. Name the function exactly **`glaze-lookup`**.
4. Delete the sample code in the editor, then paste the whole contents of
   **`paste-into-dashboard.js`** (this folder).
5. Click **Deploy function** and wait for it to finish.
6. Open the function's **Details** (or settings) tab and turn **off** "Enforce JWT verification"
   (it may be called "Verify JWT with legacy secret"). Save.
   The site calls the function with its publishable key, which isn't a JWT, so the function
   would refuse every request with this switched on. The function only reads public web pages,
   so nothing private is exposed.
7. Reload the glaze site and search for a Coyote glaze, e.g. "cobalt blue". Results marked
   "Coyote" mean it's working.

## Check that it's running

Open this in a browser; it should show a list of results:

    https://wdyignhbuymysjawkffk.supabase.co/functions/v1/glaze-lookup?q=cobalt

A `401` error means step 6 (JWT verification) is still on.

## After changing the search code

`paste-into-dashboard.js` is generated. If `supabase/functions/_shared/glaze-parse.js` or this
function changes, rebuild it and paste it into the dashboard again:

    python3 scripts/build-dashboard-function.py

(With the Supabase command-line tool installed you can instead run
`supabase functions deploy glaze-lookup --no-verify-jwt --project-ref wdyignhbuymysjawkffk`,
which deploys `index.ts` directly.)
