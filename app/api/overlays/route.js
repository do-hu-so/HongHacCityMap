import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import initialData from "./initial-overlays.json";

// Force Next.js to run this route dynamically (never cache GET requests)
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Helper to check if Supabase is configured
function isSupabaseConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

// GET method
export async function GET(request) {
  try {
    const dbConfigured = isSupabaseConfigured();
    let data;

    // Load the bundled data (either from public/data/overlays.json or fallback to initial-overlays.json)
    let bundledData;
    try {
      const bundledPath = path.join(process.cwd(), "public", "data", "overlays.json");
      const bundledContent = await readFile(bundledPath, "utf8");
      bundledData = JSON.parse(bundledContent);
    } catch (err) {
      bundledData = initialData;
    }

    if (dbConfigured) {
      console.log("Supabase detected. Fetching overlays from database...");
      
      const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
      const supabaseKey = process.env.SUPABASE_ANON_KEY;

      const fetchUrl = `${supabaseUrl}/rest/v1/map_settings?id=eq.1&select=data`;
      const res = await fetch(fetchUrl, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        cache: "no-store",
      });

      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0) {
          data = rows[0].data;
        }
      } else {
        console.warn(`Failed to fetch from Supabase (Status: ${res.status}). Falling back to bundled.`);
      }

      // Check if the bundled version is newer than the database version (for local edit deployment sync)
      if (data) {
        const dbTime = Math.max(
          data._updatedAt ? new Date(data._updatedAt).getTime() : 0,
          data._convertedAt ? new Date(data._convertedAt).getTime() : 0
        );
        const bundledTime = Math.max(
          bundledData._updatedAt ? new Date(bundledData._updatedAt).getTime() : 0,
          bundledData._convertedAt ? new Date(bundledData._convertedAt).getTime() : 0
        );

        if (bundledTime > dbTime) {
          console.log(`Newer bundled overlays detected (${bundledTime} > ${dbTime}). Syncing to Supabase...`);
          data = bundledData;

          try {
            const syncRes = await fetch(`${supabaseUrl}/rest/v1/map_settings?on_conflict=id`, {
              method: "POST",
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                Prefer: "resolution=merge-duplicates",
              },
              body: JSON.stringify({
                id: 1,
                data: data,
                updated_at: new Date().toISOString(),
              }),
            });
            if (!syncRes.ok) {
              const syncErrText = await syncRes.text();
              throw new Error(`HTTP ${syncRes.status} - ${syncErrText}`);
            }
            console.log("Supabase updated with newer bundled data.");
          } catch (syncError) {
            console.warn("Failed to sync database with newer bundled data:", syncError.message);
          }
        }
      }

      // If no data exists on Supabase yet, initialize it using our bundled data
      if (!data) {
        console.log("No data found on Supabase. Initializing database with bundled data...");
        data = bundledData;

        try {
          const initRes = await fetch(`${supabaseUrl}/rest/v1/map_settings?on_conflict=id`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates",
            },
            body: JSON.stringify({
              id: 1,
              data: data,
              updated_at: new Date().toISOString(),
            }),
          });
          if (!initRes.ok) {
            const initErrText = await initRes.text();
            throw new Error(`HTTP ${initRes.status} - ${initErrText}`);
          }
          console.log("Supabase database successfully initialized.");
        } catch (initError) {
          console.error("Failed to initialize database:", initError.message);
        }
      }
    } else {
      // Development Mode or no Supabase: Read from local filesystem to allow live changes from convert script
      console.log("Supabase not configured. Reading overlays from local filesystem...");
      data = bundledData;
    }

    const response = NextResponse.json(data);
    
    // Add debug headers to help user diagnose connection
    response.headers.set("x-storage-mode", dbConfigured ? "supabase" : "local");
    response.headers.set("x-db-configured", dbConfigured ? "yes" : "no");
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    
    return response;
  } catch (error) {
    console.error("Error in GET /api/overlays:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST method
export async function POST(request) {
  try {
    const data = await request.json();
    
    // Set timestamp of update to enable deployment-syncing
    data._updatedAt = new Date().toISOString();
    
    // Ensure _convertedAt is preserved from initialData if missing, preventing false-positive overwrites
    if (!data._convertedAt && initialData._convertedAt) {
      data._convertedAt = initialData._convertedAt;
    }
    
    const dbConfigured = isSupabaseConfigured();

    if (dbConfigured) {
      console.log("Saving overlays to Supabase...");
      
      const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
      const supabaseKey = process.env.SUPABASE_ANON_KEY;

      const res = await fetch(`${supabaseUrl}/rest/v1/map_settings?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          id: 1,
          data: data,
          updated_at: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to save to Supabase: ${res.status} - ${errText}`);
      }
      console.log("Successfully saved overlays to Supabase.");
    } else {
      // Development Mode: Save directly to local filesystem overlays.json
      console.log("Saving overlays to local filesystem...");
      const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
      await writeFile(localPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }

    const response = NextResponse.json({ success: true });
    response.headers.set("x-storage-mode", dbConfigured ? "supabase" : "local");
    return response;
  } catch (error) {
    console.error("Error in POST /api/overlays:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
