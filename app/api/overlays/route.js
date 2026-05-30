import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Conditional import to prevent failure during build if BLOB token is not set
// but `@vercel/blob` is in dependencies.
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
      // 1. Production Mode: Fetch from Vercel Blob
      console.log("Vercel Blob detected. Fetching overlays from blob storage...");
      const { list } = blobLib;
      const { blobs } = await list();
      const overlaysBlob = blobs.find(b => b.pathname === "overlays.json");

      if (overlaysBlob) {
        // Fetch blob content
        const res = await fetch(overlaysBlob.url, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          return NextResponse.json(data);
        }
      }

      // If blob does not exist yet, initialize it using the local backup static file
      console.log("Overlays blob not found. Initializing overlays.json in Blob storage...");
      const localPath = path.join(process.cwd(), "public", "data", "overlays.json");
      const localContent = await readFile(localPath, "utf8");
      const localData = JSON.parse(localContent);

      const { put } = blobLib;
      await put("overlays.json", JSON.stringify(localData, null, 2), {
        access: "public",
        addRandomSuffix: false
      });

      return NextResponse.json(localData);
    } else {
      // 2. Development Mode: Fetch from local filesystem
      console.log("Vercel Blob token not set. Fetching overlays from local filesystem...");
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
      // 1. Production Mode: Save to Vercel Blob
      console.log("Saving overlays to Vercel Blob...");
      const { put } = blobLib;
      await put("overlays.json", JSON.stringify(data, null, 2), {
        access: "public",
        addRandomSuffix: false
      });
      return NextResponse.json({ success: true });
    } else {
      // 2. Development Mode: Save to local filesystem
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
