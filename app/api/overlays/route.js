import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Force Next.js to run this route dynamically (never cache GET requests on Edge CDN)
export const dynamic = "force-dynamic";

// Conditional import to prevent failure during build if BLOB token is not set
let blobLib = null;
try {
  blobLib = await import("@vercel/blob");
} catch (e) {
  console.warn("Failed to load @vercel/blob package: ", e.message);
}

// Helper to check if Vercel Blob is configured
function isBlobConfigured() {
  return !!(process.env.BLOB_READ_WRITE_TOKEN && blobLib);
}

// GET method
export async function GET() {
  try {
    if (isBlobConfigured()) {
      console.log("Vercel Blob detected. Fetching overlays from blob storage...");
      const { list } = blobLib;
      const { blobs } = await list();
      
      // Filter all blobs matching "overlays.json"
      const overlaysBlobs = blobs.filter(b => b.pathname === "overlays.json");

      if (overlaysBlobs.length > 0) {
        // Sort by uploadedAt descending to get the absolute newest version
        overlaysBlobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        const newestBlob = overlaysBlobs[0];
        
        console.log(`Fetching newest blob: ${newestBlob.url} (Uploaded at: ${newestBlob.uploadedAt})`);
        const res = await fetch(newestBlob.url, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          return NextResponse.json(data);
        }
      }

      // If no blob exists yet on Vercel Blob, initialize it using local overlays.json
      console.log("Overlays blob not found. Initializing Vercel Blob storage with static overlays.json...");
      const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
      const localContent = await readFile(localPath, "utf8");
      const localData = JSON.parse(localContent);

      const { put } = blobLib;
      await put("overlays.json", JSON.stringify(localData, null, 2), {
        access: "public",
      });

      return NextResponse.json(localData);
    } else {
      // Development Mode: Use local overlays.json
      console.log("Vercel Blob token not set. Reading overlays from local filesystem...");
      const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
      const localContent = await readFile(localPath, "utf8");
      const localData = JSON.parse(localContent);
      return NextResponse.json(localData);
    }
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

    if (isBlobConfigured()) {
      console.log("Saving overlays to Vercel Blob...");
      const { put, list, del } = blobLib;
      
      // 1. Upload new overlays.json. Using random suffix (default) is critical to bust Edge and browser cache.
      const newBlob = await put("overlays.json", JSON.stringify(data, null, 2), {
        access: "public",
      });
      console.log(`Saved new overlays blob at: ${newBlob.url}`);

      // 2. Clean up old overlays.json blobs asynchronously to free up Vercel storage space
      try {
        const { blobs } = await list();
        const oldBlobs = blobs.filter(b => b.pathname === "overlays.json" && b.url !== newBlob.url);
        if (oldBlobs.length > 0) {
          console.log(`Deleting ${oldBlobs.length} stale overlays blobs...`);
          await del(oldBlobs.map(b => b.url));
        }
      } catch (delError) {
        console.warn("Failed to delete stale overlays blobs (non-fatal):", delError.message);
      }

      return NextResponse.json({ success: true });
    } else {
      // Development Mode: Save directly to local filesystem overlays.json
      console.log("Saving overlays to local filesystem...");
      const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
      await writeFile(localPath, JSON.stringify(data, null, 2) + "\n", "utf8");
      return NextResponse.json({ success: true });
    }
  } catch (error) {
    console.error("Error in POST /api/overlays:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
