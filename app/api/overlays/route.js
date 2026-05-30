import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { put, list, del } from "@vercel/blob";

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
        const res = await fetch(newestBlob.url, { cache: "no-store" });
        if (res.ok) {
          data = await res.json();
        }
      }

      // If no blob exists yet on Vercel Blob, initialize it using local overlays.json
      if (!data) {
        console.log("Overlays blob not found. Initializing Vercel Blob storage with static overlays.json...");
        const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
        const localContent = await readFile(localPath, "utf8");
        data = JSON.parse(localContent);

        await put("overlays.json", JSON.stringify(data, null, 2), {
          access: "public",
        });
      }
    } else {
      // Development Mode: Use local overlays.json
      console.log("Vercel Blob token not set. Reading overlays from local filesystem...");
      const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
      const localContent = await readFile(localPath, "utf8");
      data = JSON.parse(localContent);
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
      const newBlob = await put("overlays.json", JSON.stringify(data, null, 2), {
        access: "public",
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
