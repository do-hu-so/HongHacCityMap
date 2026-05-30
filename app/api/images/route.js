import { NextResponse } from "next/server";
import { readdir, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  try {
    const localImageDir = "g:\\HONGHAC\\map\\new_project\\image";
    // Check files in G:\HONGHAC\map\new_project\image
    let files = [];
    try {
      const allFiles = await readdir(localImageDir);
      files = allFiles.filter((file) =>
        /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file)
      );
    } catch (e) {
      console.warn("Local image folder not readable, returning empty list:", e.message);
    }

    return NextResponse.json({ success: true, files });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { filename } = await request.json();
    if (!filename) {
      return NextResponse.json({ success: false, error: "Filename required" }, { status: 400 });
    }

    const sourcePath = path.join("g:\\HONGHAC\\map\\new_project\\image", filename);
    const destDir = path.join(process.cwd(), "public", "images");
    const destPath = path.join(destDir, filename);

    // Ensure public/images directory exists
    await mkdir(destDir, { recursive: true });

    // Copy file
    await copyFile(sourcePath, destPath);

    // Return the web-accessible URL
    const url = `/images/${filename}`;
    return NextResponse.json({ success: true, url });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
