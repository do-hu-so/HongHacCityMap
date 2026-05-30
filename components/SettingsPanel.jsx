"use client";

import { useState, useEffect, useCallback } from "react";

export default function SettingsPanel({
  info,
  overlays,
  onSave,
  onPreview,
  onClose,
  onDeleteTextLabel,
}) {
  // --- GeoJSON feature editing ---
  if (info.type === "geojson") {
    return (
      <GeoJsonEditor
        info={info}
        overlays={overlays}
        onSave={onSave}
        onClose={onClose}
      />
    );
  }

  // --- Text label editing ---
  if (info.type === "textLabel") {
    return (
      <TextLabelEditor
        label={info.data}
        overlays={overlays}
        onSave={onSave}
        onPreview={onPreview}
        onClose={onClose}
        onDelete={onDeleteTextLabel}
      />
    );
  }

  return null;
}

/* ============================
   GeoJSON Feature Editor
   ============================ */
function convertGoogleDriveLink(url) {
  if (!url) return "";
  if (url.includes("drive.google.com")) {
    let fileId = "";
    const fileDMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileDMatch && fileDMatch[1]) {
      fileId = fileDMatch[1];
    } else {
      const idMatch = url.match(/id=([a-zA-Z0-9_-]+)/);
      if (idMatch && idMatch[1]) {
        fileId = idMatch[1];
      }
    }
    if (fileId) {
      return `https://lh3.googleusercontent.com/d/${fileId}`;
    }
  }
  return url;
}

function GeoJsonEditor({ info, overlays, onSave, onClose }) {
  const featureId = info.id;
  const geomType = info.geometryType;
  const isLine =
    geomType === "LineString" || geomType === "MultiLineString";
  const isPolygon =
    geomType === "Polygon" || geomType === "MultiPolygon";

  // Object info state
  const objInfo = overlays.objectInfo?.[featureId] || {};
  const [title, setTitle] = useState(objInfo.title || info.title || "");
  const [description, setDescription] = useState(objInfo.description || "");
  const [images, setImages] = useState(objInfo.images || []);

  // Style state
  const customStyle = overlays.myMapsStyles?.[featureId] || {};
  const origProps = info.originalProps || {};

  const [stroke, setStroke] = useState(
    customStyle.stroke || origProps.stroke || "#3388ff"
  );
  const [strokeWidth, setStrokeWidth] = useState(
    customStyle.strokeWidth ?? origProps["stroke-width"] ?? 1.2
  );
  const [fill, setFill] = useState(
    customStyle.fill || origProps.fill || "#3388ff"
  );
  const [fillOpacity, setFillOpacity] = useState(
    customStyle.fillOpacity ?? origProps["fill-opacity"] ?? 0.5
  );
  const [isDashed, setIsDashed] = useState(!!customStyle.dashArray);
  const [dashLength, setDashLength] = useState(10);
  const [dashGap, setDashGap] = useState(5);

  // Parse existing dashArray
  useEffect(() => {
    if (customStyle.dashArray) {
      const parts = customStyle.dashArray.split(" ").map(Number);
      if (parts.length >= 2) {
        setDashLength(parts[0]);
        setDashGap(parts[1]);
      }
    }
  }, [customStyle.dashArray]);

  // Image adding
  const [newImageUrl, setNewImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [localImages, setLocalImages] = useState([]);
  const [imageSourceMode, setImageSourceMode] = useState("local"); // "local" | "url"

  // Fetch local images when input is shown
  useEffect(() => {
    if (showImageInput) {
      fetch("/api/images")
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            setLocalImages(data.files || []);
          }
        })
        .catch((err) => console.error("Error loading local images:", err));
    }
  }, [showImageInput]);

  // Sync when switching features
  useEffect(() => {
    const obj = overlays.objectInfo?.[featureId] || {};
    const style = overlays.myMapsStyles?.[featureId] || {};
    const orig = info.originalProps || {};

    setTitle(obj.title || info.title || "");
    setDescription(obj.description || "");
    setImages(obj.images || []);
    setStroke(style.stroke || orig.stroke || "#3388ff");
    setStrokeWidth(style.strokeWidth ?? orig["stroke-width"] ?? 1.2);
    setFill(style.fill || orig.fill || "#3388ff");
    setFillOpacity(style.fillOpacity ?? orig["fill-opacity"] ?? 0.5);
    setIsDashed(!!style.dashArray);
    if (style.dashArray) {
      const parts = style.dashArray.split(" ").map(Number);
      if (parts.length >= 2) {
        setDashLength(parts[0]);
        setDashGap(parts[1]);
      }
    } else {
      setDashLength(10);
      setDashGap(5);
    }
  }, [featureId, overlays, info]);

  const handleSave = useCallback(() => {
    const newOverlays = { ...overlays };

    // Save object info
    newOverlays.objectInfo = { ...newOverlays.objectInfo };
    newOverlays.objectInfo[featureId] = {
      title,
      description,
      images,
    };

    // Save style
    newOverlays.myMapsStyles = { ...newOverlays.myMapsStyles };
    const styleObj = { stroke, strokeWidth: Number(strokeWidth) };
    if (isPolygon) {
      styleObj.fill = fill;
      styleObj.fillOpacity = Number(fillOpacity);
    }
    if (isDashed) {
      styleObj.dashArray = `${dashLength} ${dashGap}`;
    }
    newOverlays.myMapsStyles[featureId] = styleObj;

    onSave(newOverlays);
  }, [
    overlays, featureId, title, description, images,
    stroke, strokeWidth, fill, fillOpacity, isDashed,
    dashLength, dashGap, isPolygon, onSave,
  ]);

  const addImage = useCallback(() => {
    if (!newImageUrl.trim()) return;
    const finalUrl = convertGoogleDriveLink(newImageUrl.trim());
    setImages((prev) => [...prev, { src: finalUrl, caption: "" }]);
    setNewImageUrl("");
    setShowImageInput(false);
  }, [newImageUrl]);

  const addLocalImage = useCallback(async (filename) => {
    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const data = await res.json();
      if (data.success) {
        setImages((prev) => [...prev, { src: data.url, caption: filename }]);
        setShowImageInput(false);
      } else {
        alert("Lỗi copy ảnh: " + data.error);
      }
    } catch (e) {
      alert("Lỗi kết nối API: " + e.message);
    }
  }, []);

  const removeImage = useCallback((idx) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateImageCaption = useCallback((idx, caption) => {
    setImages((prev) =>
      prev.map((img, i) => (i === idx ? { ...img, caption } : img))
    );
  }, []);

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h3>Chỉnh sửa đối tượng</h3>
        <button className="info-box-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="settings-panel-body">
        {/* === Info Section === */}
        <div className="settings-section">
          <div className="settings-section-title">Thông tin</div>

          <div className="settings-field">
            <label>Tiêu đề</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tên đối tượng"
            />
          </div>

          <div className="settings-field">
            <label>Chú thích (Enter để xuống dòng)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Thêm chú thích..."
              rows={4}
            />
          </div>
        </div>

        {/* === Style Section === */}
        {(isLine || isPolygon) && (
          <div className="settings-section">
            <div className="settings-section-title">
              {isLine ? "Đường (Line)" : "Đa giác (Polygon)"}
            </div>

            {/* Stroke color */}
            <div className="settings-field">
              <label>{isPolygon ? "Màu đường viền" : "Màu đường"}</label>
              <div className="color-field">
                <input
                  type="color"
                  value={stroke}
                  onChange={(e) => setStroke(e.target.value)}
                />
                <input
                  type="text"
                  value={stroke}
                  onChange={(e) => setStroke(e.target.value)}
                />
              </div>
            </div>

            {/* Stroke width */}
            <div className="settings-field">
              <label>
                {isPolygon ? "Độ dày viền" : "Độ dày đường"}: {strokeWidth}px
              </label>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(e.target.value)}
              />
            </div>

            {/* Polygon fill */}
            {isPolygon && (
              <>
                <div className="settings-field">
                  <label>Màu nền đa giác</label>
                  <div className="color-field">
                    <input
                      type="color"
                      value={fill}
                      onChange={(e) => setFill(e.target.value)}
                    />
                    <input
                      type="text"
                      value={fill}
                      onChange={(e) => setFill(e.target.value)}
                    />
                  </div>
                </div>
                <div className="settings-field">
                  <label>Độ trong suốt: {Math.round(fillOpacity * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={fillOpacity}
                    onChange={(e) => setFillOpacity(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Dash toggle */}
            <div className="toggle-row">
              <label style={{ fontSize: "13px", fontWeight: 500 }}>
                Nét đứt
              </label>
              <button
                className={`toggle-switch${isDashed ? " active" : ""}`}
                onClick={() => setIsDashed(!isDashed)}
              />
            </div>

            {isDashed && (
              <>
                <div className="settings-field">
                  <label>Độ dài nét đứt: {dashLength}px</label>
                  <input
                    type="range"
                    min="2"
                    max="30"
                    step="1"
                    value={dashLength}
                    onChange={(e) => setDashLength(Number(e.target.value))}
                  />
                </div>
                <div className="settings-field">
                  <label>Khoảng cách nét đứt: {dashGap}px</label>
                  <input
                    type="range"
                    min="2"
                    max="30"
                    step="1"
                    value={dashGap}
                    onChange={(e) => setDashGap(Number(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* === Images Section === */}
        <div className="settings-section">
          <div className="settings-section-title">Hình ảnh</div>

          {images.length > 0 && (
            <div className="image-list">
              {images.map((img, idx) => (
                <div key={idx} className="image-item">
                  <img
                    src={img.src}
                    alt={img.caption || ""}
                    onError={(e) => {
                      e.target.src =
                        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect fill='%23f1f3f5' width='60' height='60'/%3E%3Ctext x='30' y='35' text-anchor='middle' fill='%23adb5bd' font-size='10'%3ELỗi%3C/text%3E%3C/svg%3E";
                    }}
                  />
                  <div className="image-item-info">
                    <input
                      type="text"
                      value={img.caption}
                      onChange={(e) => updateImageCaption(idx, e.target.value)}
                      placeholder="Tiêu đề ảnh..."
                    />
                    <div className="image-item-actions">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => removeImage(idx)}
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showImageInput ? (
            <div style={{ marginTop: 12, padding: "12px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              {/* Tab selector */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button
                  type="button"
                  className={`btn btn-sm ${imageSourceMode === "local" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setImageSourceMode("local")}
                  style={{ flex: 1 }}
                >
                  📁 Chọn trong folder image
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${imageSourceMode === "url" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setImageSourceMode("url")}
                  style={{ flex: 1 }}
                >
                  🔗 Link ảnh (URL)
                </button>
              </div>

              {imageSourceMode === "local" ? (
                <div className="settings-field">
                  <label>Danh sách ảnh trong folder `image`:</label>
                  {localImages.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontStyle: "italic", marginBottom: "8px" }}>
                      Chưa có ảnh nào trong thư mục `G:\HONGHAC\map\new_project\image` hoặc folder trống.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "4px", padding: "6px", background: "var(--bg-primary)" }}>
                      {localImages.map((file) => (
                        <button
                          key={file}
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => addLocalImage(file)}
                          style={{ justifyContent: "flex-start", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        >
                          🖼️ {file}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="settings-field">
                  <label>Đường dẫn hình ảnh (URL)</label>
                  <input
                    type="url"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="https://... hoặc /images/ten-anh.jpg"
                    autoFocus
                  />
                  <button
                    className="btn btn-primary btn-sm btn-block"
                    onClick={addImage}
                    style={{ marginTop: "8px" }}
                  >
                    Thêm link
                  </button>
                </div>
              )}

              <button
                className="btn btn-secondary btn-sm btn-block"
                onClick={() => {
                  setShowImageInput(false);
                  setNewImageUrl("");
                }}
                style={{ marginTop: "8px" }}
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowImageInput(true)}
              style={{ marginTop: 8 }}
            >
              + Thêm ảnh
            </button>
          )}
        </div>

        {/* === Save Button === */}
        <button
          className="btn btn-primary btn-block"
          onClick={handleSave}
          style={{ marginTop: 8 }}
        >
          💾 Lưu thay đổi
        </button>
      </div>
    </div>
  );
}

/* ============================
   Text Label Editor
   ============================ */
function TextLabelEditor({ label, overlays, onSave, onPreview, onClose, onDelete }) {
  const [text, setText] = useState(label.text || "");
  const [color, setColor] = useState(label.color || "#1f2937");
  const [fontSize, setFontSize] = useState(label.fontSize || 14);
  const [zoomBase, setZoomBase] = useState(label.zoomBase || 16);
  const [rotation, setRotation] = useState(label.rotation || 0);

  useEffect(() => {
    setText(label.text || "");
    setColor(label.color || "#1f2937");
    setFontSize(label.fontSize || 14);
    setZoomBase(label.zoomBase || 16);
    setRotation(label.rotation || 0);
  }, [label]);

  // Real-time preview: update map DOM on every change
  useEffect(() => {
    if (onPreview) {
      onPreview(label.id, {
        text,
        color,
        fontSize: Number(fontSize),
        rotation: Number(rotation),
        zoomBase: Number(zoomBase),
      });
    }
  }, [text, color, fontSize, rotation, zoomBase, label.id, onPreview]);

  const handleSave = useCallback(() => {
    const newLabels = (overlays.textLabels || []).map((l) =>
      l.id === label.id
        ? {
            ...l,
            text,
            color,
            fontSize: Number(fontSize),
            zoomBase: Number(zoomBase),
            rotation: Number(rotation),
          }
        : l
    );
    onSave({ ...overlays, textLabels: newLabels });
  }, [overlays, label.id, text, color, fontSize, zoomBase, rotation, onSave]);

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h3>Chỉnh sửa chữ</h3>
        <button className="info-box-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="settings-panel-body">
        <div className="settings-section">
          <div className="settings-field">
            <label>Nội dung chữ</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nhập chữ..."
            />
          </div>

          <div className="settings-field">
            <label>Màu chữ</label>
            <div className="color-field">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>

          <div className="settings-field">
            <label>Kích thước chữ: {fontSize}px</label>
            <input
              type="range"
              min="8"
              max="150"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
          </div>

          <div className="settings-field">
            <label>Góc xoay: {rotation}°</label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRotation(0)}
                type="button"
              >
                0°
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRotation(45)}
                type="button"
              >
                45°
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRotation(90)}
                type="button"
              >
                90°
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRotation(-45)}
                type="button"
              >
                -45°
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRotation(-90)}
                type="button"
              >
                -90°
              </button>
            </div>
          </div>

          <div className="settings-field">
            <label>Mức zoom chuẩn: {zoomBase}</label>
            <input
              type="range"
              min="10"
              max="19"
              step="1"
              value={zoomBase}
              onChange={(e) => setZoomBase(Number(e.target.value))}
            />
            <div className="range-value">
              Chữ hiển thị đúng kích thước ở zoom {zoomBase}, co giãn ở các zoom khác
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            style={{ flex: 1 }}
          >
            💾 Lưu
          </button>
          <button
            className="btn btn-danger"
            onClick={() => onDelete(label.id)}
          >
            🗑 Xóa
          </button>
        </div>
      </div>
    </div>
  );
}
