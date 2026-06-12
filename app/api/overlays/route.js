import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { put, list, del } from "@vercel/blob";
import initialData from "./initial-overlays.json";

// Force Next.js to run this route dynamically (never cache GET requests on Edge CDN)
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Global in-memory cache for the blob URL to minimize list operations
let cachedBlobUrl = null;

// Helper to check if Vercel Blob is configured
function isBlobConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// GET method
export async function GET(request) {
  try {
    const blobConfigured = isBlobConfigured();
    let data;

    if (blobConfigured) {
      console.log("Vercel Blob detected. Fetching overlays from blob storage...");
      
      // If BLOB_STORE_URL environment variable is provided, construct the URL directly.
      // This completely avoids calling the expensive list() operation (Advanced Operation),
      // which is critical if the monthly 2,000 Advanced Operations limit is reached.
      if (process.env.BLOB_STORE_URL) {
        cachedBlobUrl = `${process.env.BLOB_STORE_URL.replace(/\/$/, "")}/overlays.json`;
      } else if (!cachedBlobUrl) {
        console.log("Blob URL cache miss. Listing blobs to find overlays.json...");
        try {
          const { blobs } = await list({ prefix: "overlays", token: process.env.BLOB_READ_WRITE_TOKEN });
          const overlaysBlobs = blobs.filter(b => b.pathname.startsWith("overlays") && b.pathname.endsWith(".json"));

          if (overlaysBlobs.length > 0) {
            // Sort by uploadedAt descending to find the newest existing one (for transition)
            overlaysBlobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
            cachedBlobUrl = overlaysBlobs[0].url;
          }
        } catch (listError) {
          console.error("Failed to list Vercel blobs (likely Advanced Operations limit reached 2k/2k):", listError.message);
          throw new Error(
            "Vercel Blob Advanced Operations limit reached (2,000/2,000). " +
            "Please configure the 'BLOB_STORE_URL' environment variable in your Vercel Project Settings " +
            "with the value of your Blob store domain (e.g. 'https://xxxx.public.blob.vercel-storage.com') to bypass this limit."
          );
        }
      }

      if (cachedBlobUrl) {
        // Fetch public blob directly using a query parameter cache buster
        const fetchUrl = `${cachedBlobUrl}${cachedBlobUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
        console.log(`Fetching newest blob: ${fetchUrl}`);
        const res = await fetch(fetchUrl, { 
          cache: "no-store" 
        });
        
        if (res.ok) {
          data = await res.json();
        } else {
          // Reset cache if fetching fails so we attempt listing again on next request
          cachedBlobUrl = null;
          throw new Error(
            `Failed to fetch overlays.json from Vercel Blob (Status: ${res.status}). ` +
            `This usually happens if the Vercel Blob store is set to Private. ` +
            `Please change the Blob Store file access settings on Vercel Dashboard to 'Public' so files can be fetched directly.`
          );
        }
      }

      // Load the bundled data (either from public/data/overlays.json or fallback to initial-overlays.json)
      let bundledData;
      try {
        const bundledPath = path.join(process.cwd(), "public", "data", "overlays.json");
        const bundledContent = await readFile(bundledPath, "utf8");
        bundledData = JSON.parse(bundledContent);
      } catch (err) {
        bundledData = initialData;
      }

      // Check if the bundled version is newer than the one in Vercel Blob
      if (data) {
        const blobTime = Math.max(
          data._updatedAt ? new Date(data._updatedAt).getTime() : 0,
          data._convertedAt ? new Date(data._convertedAt).getTime() : 0
        );
        const bundledTime = Math.max(
          bundledData._updatedAt ? new Date(bundledData._updatedAt).getTime() : 0,
          bundledData._convertedAt ? new Date(bundledData._convertedAt).getTime() : 0
        );

        if (bundledTime > blobTime) {
          console.log(`Newer bundled overlays detected (${bundledTime} > ${blobTime}). Syncing blob...`);
          data = bundledData;

          try {
            // Upload new merged data directly (without random suffix to overwrite overlays.json)
            const newBlob = await put("overlays.json", JSON.stringify(data, null, 2), {
              access: "public",
              addRandomSuffix: false,
              allowOverwrite: true,
              token: process.env.BLOB_READ_WRITE_TOKEN,
            });
            cachedBlobUrl = newBlob.url;
            console.log("Blob storage updated with newer bundled data.");

            // Clean up any old suffix-based blobs that might be left in storage
            try {
              const { blobs } = await list({ prefix: "overlays", token: process.env.BLOB_READ_WRITE_TOKEN });
              const oldSuffixBlobs = blobs.filter(b => b.pathname.startsWith("overlays") && b.pathname.endsWith(".json") && b.url !== newBlob.url);
              if (oldSuffixBlobs.length > 0) {
                console.log(`Cleaning up ${oldSuffixBlobs.length} older suffix-based blobs...`);
                await del(oldSuffixBlobs.map(b => b.url), { token: process.env.BLOB_READ_WRITE_TOKEN });
              }
            } catch (listError) {
              console.warn("Failed to list/delete old suffix blobs during sync (non-fatal):", listError.message);
            }
          } catch (syncError) {
            console.warn("Failed to sync blob with newer bundled data:", syncError.message);
          }
        }
      }

      // If no blob exists yet on Vercel Blob, initialize it using our bundled data
      if (!data) {
        console.log("Overlays blob not found in store. Initializing Vercel Blob storage with bundled data...");
        data = bundledData;

        // Use addRandomSuffix: false to maintain a single overlays.json file
        const newBlob = await put("overlays.json", JSON.stringify(data, null, 2), {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        cachedBlobUrl = newBlob.url;
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
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    
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
    
    // Set timestamp of update to enable deployment-syncing
    data._updatedAt = new Date().toISOString();
    
    // Ensure _convertedAt is preserved from initialData if missing, preventing false-positive overwrites
    if (!data._convertedAt && initialData._convertedAt) {
      data._convertedAt = initialData._convertedAt;
    }
    
    const blobConfigured = isBlobConfigured();

    if (blobConfigured) {
      console.log("Saving overlays to Vercel Blob...");
      
      // Upload directly overwriting the same overlays.json file
      const newBlob = await put("overlays.json", JSON.stringify(data, null, 2), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      cachedBlobUrl = newBlob.url;
      console.log(`Saved new overlays blob at: ${newBlob.url}`);

      // We do not need to list and delete old files on every save since addRandomSuffix: false overwrites overlays.json.
      // This saves 2 Vercel Blob API operations per write request!
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
