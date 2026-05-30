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
      const { blobs } = await list();
      
      // Filter all blobs ending with "overlays.json" (more robust than exact match)
      const overlaysBlobs = blobs.filter(b => b.pathname.endsWith("overlays.json"));

      if (overlaysBlobs.length > 0) {
        // Sort by uploadedAt descending to get the absolute newest version
        overlaysBlobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        const newestBlob = overlaysBlobs[0];
        
        console.log(`Fetching newest blob: ${newestBlob.url} (Uploaded at: ${newestBlob.uploadedAt})`);
        
        // Fetch private blob using the authorization token
        const headers = {
          Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`
        };
        const res = await fetch(newestBlob.url, { 
          headers,
          cache: "no-store" 
        });
        
        if (res.ok) {
          data = await res.json();
        } else {
          console.warn(`Failed to fetch blob directly (Status: ${res.status}). Trying fallback.`);
        }
      }

      // If no blob exists yet on Vercel Blob, initialize it using our bundled initialData
      if (!data) {
        console.log("Overlays blob not found. Initializing Vercel Blob storage with static initial-overlays.json...");
        data = initialData;

        // Use access: "private" to support both private and public Vercel Blob stores
        await put("overlays.json", JSON.stringify(data, null, 2), {
          access: "private",
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
    const blobConfigured = isBlobConfigured();

    if (blobConfigured) {
      console.log("Saving overlays to Vercel Blob...");
      
      // 1. Upload new overlays.json. Using random suffix (default) is critical to bust Edge and browser cache.
      // Use access: "private" to remain compatible with private stores.
      const newBlob = await put("overlays.json", JSON.stringify(data, null, 2), {
        access: "private",
      });
      console.log(`Saved new overlays blob at: ${newBlob.url}`);

      // 2. Clean up old overlays.json blobs asynchronously to free up Vercel storage space
      try {
        const { blobs } = await list();
        const oldBlobs = blobs.filter(b => b.pathname.endsWith("overlays.json") && b.url !== newBlob.url);
        if (oldBlobs.length > 0) {
          console.log(`Deleting ${oldBlobs.length} stale overlays blobs...`);
          await del(oldBlobs.map(b => b.url));
        }
      } catch (delError) {
        console.warn("Failed to delete stale overlays blobs (non-fatal):", delError.message);
      }
    } else {
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
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
