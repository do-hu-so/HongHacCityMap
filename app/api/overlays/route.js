import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { put, list, del } from "@vercel/blob";
import initialData from "./initial-overlays.json";

// Force Next.js to run this route dynamically (never cache GET requests on Edge CDN)
export const dynamic = "force-dynamic";

// Helper to check if Vercel Blob is configured
function isBlobConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// GET method
export async function GET() {
  try {
    const blobConfigured = isBlobConfigured();
    let data;

    if (blobConfigured) {
      console.log("Vercel Blob detected. Fetching overlays from blob storage...");
      const { blobs } = await list({ token: process.env.BLOB_READ_WRITE_TOKEN });
      
      // Filter all blobs starting with "overlays" and ending with ".json" (robust to random suffixes)
      const overlaysBlobs = blobs.filter(b => b.pathname.startsWith("overlays") && b.pathname.endsWith(".json"));

      if (overlaysBlobs.length > 0) {
        // Sort by uploadedAt descending to get the absolute newest version
        overlaysBlobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        const newestBlob = overlaysBlobs[0];
        
        console.log(`Fetching newest blob: ${newestBlob.url} (Uploaded at: ${newestBlob.uploadedAt})`);
        
        // Fetch public blob directly
        const res = await fetch(newestBlob.url, { 
          cache: "no-store" 
        });
        
        if (res.ok) {
          data = await res.json();
        } else {
          // Instead of silently overwriting the blob, throw an error so we know why it failed
          throw new Error(
            `Failed to fetch overlays.json from Vercel Blob (Status: ${res.status}). ` +
            `This usually happens if the Vercel Blob store is set to Private. ` +
            `Please change the Blob Store file access settings on Vercel Dashboard to 'Public' so files can be fetched directly.`
          );
        }
      }

      // Check if a newer KML convert was deployed (bundled initial-overlays.json is newer)
      if (data && initialData._convertedAt) {
        const blobTime = data._convertedAt ? new Date(data._convertedAt).getTime() : 0;
        const initialTime = new Date(initialData._convertedAt).getTime();

        if (initialTime > blobTime) {
          console.log(`Newer KML convert detected (${initialData._convertedAt} > ${data._convertedAt || 'none'}). Syncing blob...`);
          data = initialData;

          try {
            // Delete all old overlay blobs
            if (overlaysBlobs.length > 0) {
              await del(overlaysBlobs.map(b => b.url), { token: process.env.BLOB_READ_WRITE_TOKEN });
            }
            // Upload new merged data
            await put("overlays.json", JSON.stringify(data, null, 2), {
              access: "public",
              addRandomSuffix: true,
              token: process.env.BLOB_READ_WRITE_TOKEN,
            });
            console.log("Blob storage updated with converted data.");
          } catch (syncError) {
            console.warn("Failed to sync blob with converted data:", syncError.message);
          }
        }
      }

      // If no blob exists yet on Vercel Blob, initialize it using our bundled initialData
      if (!data) {
        console.log("Overlays blob not found in store. Initializing Vercel Blob storage with static initial-overlays.json...");
        data = initialData;

        // Use access: "public" for the user's public Vercel Blob store
        await put("overlays.json", JSON.stringify(data, null, 2), {
          access: "public",
          addRandomSuffix: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      }
    } else {
      // Development Mode: Read from local filesystem to allow live changes from convert script
      console.log("Vercel Blob token not set. Reading overlays from local filesystem...");
      try {
        const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
        const localContent = await readFile(localPath, "utf8");
        data = JSON.parse(localContent);
      } catch (err) {
        console.warn("Local overlays.json not found, using bundled initialData instead.");
        data = initialData;
      }
    }

    const response = NextResponse.json(data);
    
    // Add debug headers to help the user diagnose token configuration
    response.headers.set("x-storage-mode", blobConfigured ? "vercel-blob" : "local");
    response.headers.set("x-blob-token-present", process.env.BLOB_READ_WRITE_TOKEN ? "yes" : "no");
    response.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
    
    return response;
  } catch (error) {
    console.error("Error in GET /api/overlays:", error);
    const token = process.env.BLOB_READ_WRITE_TOKEN || "";
    const tokenDebug = token ? `${token.substring(0, 30)}... (len: ${token.length})` : "none";
    return NextResponse.json(
      { success: false, error: error.message, debug: { token: tokenDebug } },
      { status: 500 }
    );
  }
}

// POST method
export async function POST(request) {
  try {
    const data = await request.json();
    const blobConfigured = isBlobConfigured();

    if (blobConfigured) {
      console.log("Saving overlays to Vercel Blob...");
      
      // 1. Upload new overlays.json. Using random suffix (default) is critical to bust Edge and browser cache.
      // Use access: "private" to remain compatible with private stores.
      // Explicitly set addRandomSuffix: true to prevent "This blob already exists" error.
      const newBlob = await put("overlays.json", JSON.stringify(data, null, 2), {
        access: "public",
        addRandomSuffix: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      console.log(`Saved new overlays blob at: ${newBlob.url}`);

      // 2. Clean up old overlays.json blobs asynchronously to free up Vercel storage space
      try {
        const { blobs } = await list({ token: process.env.BLOB_READ_WRITE_TOKEN });
        const oldBlobs = blobs.filter(b => b.pathname.endsWith("overlays.json") && b.url !== newBlob.url);
        if (oldBlobs.length > 0) {
          console.log(`Deleting ${oldBlobs.length} stale overlays blobs...`);
          await del(oldBlobs.map(b => b.url), { token: process.env.BLOB_READ_WRITE_TOKEN });
        }
      } catch (delError) {
        console.warn("Failed to delete stale overlays blobs (non-fatal):", delError.message);
      }
    } else {
      // If we are on Vercel, we cannot write to the read-only filesystem.
      // Throw a helpful error instead of letting it fail with EROFS.
      if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") {
        throw new Error(
          "Vercel Blob token (BLOB_READ_WRITE_TOKEN) is not detected in your Vercel deployment. " +
          "This deployment was likely built before the database was connected. " +
          "Please trigger a 'Redeploy' of your latest deployment on the Vercel Dashboard to apply the database token."
        );
      }

      // Development Mode: Save directly to local filesystem overlays.json
      console.log("Saving overlays to local filesystem...");
      const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
      await writeFile(localPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }

    const response = NextResponse.json({ success: true });
    response.headers.set("x-storage-mode", blobConfigured ? "vercel-blob" : "local");
    response.headers.set("x-blob-token-present", process.env.BLOB_READ_WRITE_TOKEN ? "yes" : "no");
    return response;
  } catch (error) {
    console.error("Error in POST /api/overlays:", error);
    const token = process.env.BLOB_READ_WRITE_TOKEN || "";
    const tokenDebug = token ? `${token.substring(0, 30)}... (len: ${token.length})` : "none";
    return NextResponse.json(
      { success: false, error: error.message, debug: { token: tokenDebug } },
      { status: 500 }
    );
  }
}
