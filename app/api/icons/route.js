import { NextResponse } from "next/server";
import { readdir, copyFile, mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  try {
    const localIconDir = path.join(process.cwd(), "icon");
    const destDir = path.join(process.cwd(), "public", "icons");
    let files = [];
    try {
      const allFiles = await readdir(localIconDir);
      files = allFiles.filter((file) =>
        /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file)
      );

      // Ensure public/icons directory exists
      await mkdir(destDir, { recursive: true });

      // Copy all icons to public/icons so they are accessible via /icons/[filename]
      for (const file of files) {
        const srcPath = path.join(localIconDir, file);
        const destPath = path.join(destDir, file);
        await copyFile(srcPath, destPath);
      }
    } catch (e) {
      console.warn("Local icon folder not readable or copy failed:", e.message);
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
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) {
        return NextResponse.json({ success: false, error: "No file uploaded" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      // Sanitize filename: replace spaces and weird characters
      const originalName = file.name || "uploaded_icon.svg";
      const sanitizedFilename = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");

      const localDir = path.join(process.cwd(), "icon");
      const destDir = path.join(process.cwd(), "public", "icons");

      // Ensure directories exist
      await mkdir(localDir, { recursive: true });
      await mkdir(destDir, { recursive: true });

      // Save to both /icon (source folder) and /public/icons (accessible folder)
      await writeFile(path.join(localDir, sanitizedFilename), buffer);
      await writeFile(path.join(destDir, sanitizedFilename), buffer);

      const url = `/icons/${sanitizedFilename}`;
      return NextResponse.json({ success: true, url, filename: sanitizedFilename });
    } else {
      // Original copy logic from JSON payload
      const { filename } = await request.json();
      if (!filename) {
        return NextResponse.json({ success: false, error: "Filename required" }, { status: 400 });
      }

      const sourcePath = path.join(process.cwd(), "icon", filename);
      const destDir = path.join(process.cwd(), "public", "icons");
      const destPath = path.join(destDir, filename);

      // Ensure public/icons directory exists
      await mkdir(destDir, { recursive: true });

      // Copy file
      await copyFile(sourcePath, destPath);

      // Return the web-accessible URL
      const url = `/icons/${filename}`;
      return NextResponse.json({ success: true, url });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { filename } = await request.json();
    if (!filename) {
      return NextResponse.json({ success: false, error: "Filename required" }, { status: 400 });
    }

    // Do not allow deleting the default bridge.svg
    if (filename === "bridge.svg") {
      return NextResponse.json({ success: false, error: "Cannot delete default icon" }, { status: 400 });
    }

    const localIconPath = path.join(process.cwd(), "icon", filename);
    const publicIconPath = path.join(process.cwd(), "public", "icons", filename);

    try {
      await unlink(localIconPath);
    } catch (e) {
      console.warn("Could not delete from icon folder:", e.message);
    }

    try {
      await unlink(publicIconPath);
    } catch (e) {
      console.warn("Could not delete from public/icons folder:", e.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

