"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

export default function SettingsPanel({
  info,
  overlays,
  onSave,
  onPreview,
  onClose,
  onDeleteTextLabel,
  activeRouteEdit,
  onActiveRouteEditChange,
  geojson,
  selectingFeatureFor,
  onSelectingFeatureForChange,
}) {
  // --- Routing management ---
  if (info.type === "routing") {
    return (
      <RoutingEditor
        overlays={overlays}
        onSave={onSave}
        onClose={onClose}
        activeRouteEdit={activeRouteEdit}
        onActiveRouteEditChange={onActiveRouteEditChange}
        geojson={geojson}
        selectingFeatureFor={selectingFeatureFor}
        onSelectingFeatureForChange={onSelectingFeatureForChange}
      />
    );
  }
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

  // --- POI label editing ---
  if (info.type === "poiLabel") {
    return (
      <PoiLabelEditor
        poi={info.data}
        overlays={overlays}
        onSave={onSave}
        onClose={onClose}
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
                      Chưa có ảnh nào trong thư mục `image` của dự án hoặc folder trống.
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

const getDefaultPoiColor = (type) => {
  if (type === "hospital.svg") return "#ef4444";
  if (type === "school.svg") return "#3b82f6";
  if (type === "bridge.svg") return "#10b981";
  if (type === "rest_stop.svg") return "#f59e0b";
  return "#4f46e5";
};

/* ============================
   POI Label Editor
   ============================ */
function PoiLabelEditor({ poi, overlays, onSave, onClose }) {
  const [name, setName] = useState(poi.name || "");
  const [address, setAddress] = useState(poi.address || "");
  const [description, setDescription] = useState(poi.description || "");
  const [poiType, setPoiType] = useState(poi.poiType || "bridge.svg");
  const [color, setColor] = useState(poi.color || getDefaultPoiColor(poi.poiType || "bridge.svg"));
  const [visibilityMode, setVisibilityMode] = useState(poi.visibilityMode || "always");
  const [associatedRouteId, setAssociatedRouteId] = useState(poi.associatedRouteId || "");
  const [iconSize, setIconSize] = useState(poi.iconSize || 28);
  const [labelFontSize, setLabelFontSize] = useState(poi.labelFontSize || 12);
  const [labelMinZoom, setLabelMinZoom] = useState(poi.labelMinZoom || 11);
  const [labelMaxZoom, setLabelMaxZoom] = useState(poi.labelMaxZoom || 45);

  const [images, setImages] = useState(poi.images || []);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [localImages, setLocalImages] = useState([]);
  const [imageSourceMode, setImageSourceMode] = useState("local"); // "local" | "url"
  const [icons, setIcons] = useState([]);

  const fileInputRef = useRef(null);

  const handleUploadIcon = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/icons", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.filename) {
        // Refresh icons list
        const listRes = await fetch("/api/icons");
        const listData = await listRes.json();
        if (listData.success && listData.files) {
          setIcons(listData.files);
        }
        setPoiType(data.filename);
        alert("Đã tải lên biểu tượng mới!");
      } else {
        alert("Lỗi tải lên: " + (data.error || "Không rõ nguyên nhân"));
      }
    } catch (err) {
      alert("Lỗi kết nối: " + err.message);
    }
  };

  const handleDeleteIconFile = async () => {
    const defaultIcons = ["bridge.svg", "hospital.svg", "school.svg", "rest_stop.svg"];
    if (defaultIcons.includes(poiType)) {
      alert("Không thể xóa các biểu tượng mặc định của hệ thống.");
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn xóa tệp biểu tượng "${poiType}" khỏi hệ thống? Các địa điểm đang dùng biểu tượng này có thể bị lỗi.`)) {
      return;
    }

    try {
      const res = await fetch("/api/icons", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: poiType }),
      });
      const data = await res.json();
      if (data.success) {
        // Refresh icons list
        const listRes = await fetch("/api/icons");
        const listData = await listRes.json();
        if (listData.success && listData.files) {
          setIcons(listData.files);
        }
        setPoiType("bridge.svg");
        alert("Đã xóa biểu tượng thành công.");
      } else {
        alert("Lỗi xóa: " + (data.error || "Không rõ nguyên nhân"));
      }
    } catch (err) {
      alert("Lỗi kết nối: " + err.message);
    }
  };

  // Fetch icons on mount
  useEffect(() => {
    fetch("/api/icons")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.files) {
          setIcons(data.files);
        }
      })
      .catch((err) => console.error("Error fetching icons:", err));
  }, []);

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

  // Sync state with selected POI changes
  useEffect(() => {
    setName(poi.name || "");
    setAddress(poi.address || "");
    setDescription(poi.description || "");
    setPoiType(poi.poiType || "bridge.svg");
    setColor(poi.color || getDefaultPoiColor(poi.poiType || "bridge.svg"));
    setVisibilityMode(poi.visibilityMode || "always");
    setAssociatedRouteId(poi.associatedRouteId || "");
    setIconSize(poi.iconSize || 28);
    setLabelFontSize(poi.labelFontSize || 12);
    setLabelMinZoom(poi.labelMinZoom || 11);
    setLabelMaxZoom(poi.labelMaxZoom || 45);
    setImages(poi.images || []);
  }, [poi]);

  // List all routes in the system to associate with
  const allRoutes = useMemo(() => {
    const list = [];
    const destinations = overlays?.routingConfig?.destinations || [];
    destinations.forEach((dest) => {
      if (dest.routes) {
        dest.routes.forEach((r) => {
          list.push({
            id: r.id,
            name: `${dest.name} - ${r.name || r.id}`,
          });
        });
      }
    });
    return list;
  }, [overlays]);

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

  const handleSave = async () => {
    let finalIconUrl = `/icons/${poiType}`;
    try {
      const res = await fetch("/api/icons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: poiType }),
      });
      const data = await res.json();
      if (data.success && data.url) {
        finalIconUrl = data.url;
      }
    } catch (e) {
      console.error("Failed to copy icon:", e);
    }

    const updatedPoi = {
      ...poi,
      name,
      address,
      poiType,
      iconUrl: finalIconUrl,
      iconSize: Number(iconSize),
      labelFontSize: Number(labelFontSize),
      labelMinZoom: Number(labelMinZoom),
      labelMaxZoom: Number(labelMaxZoom),
      visibilityMode,
      associatedRouteId,
      description,
      images,
      color,
    };

    const newPoiLabels = (overlays.poiLabels || []).map((p) =>
      p.id === poi.id ? updatedPoi : p
    );
    onSave({ ...overlays, poiLabels: newPoiLabels });
    onClose();
  };

  const handleDelete = () => {
    if (confirm("Bạn có chắc chắn muốn xóa địa điểm POI này?")) {
      const newPoiLabels = (overlays.poiLabels || []).filter((p) => p.id !== poi.id);
      onSave({ ...overlays, poiLabels: newPoiLabels });
      onClose();
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h3>Chỉnh sửa địa điểm</h3>
        <button className="info-box-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="settings-panel-body">
        {/* === Info Section === */}
        <div className="settings-section">
          <div className="settings-section-title">Thông tin địa điểm</div>

          <div className="settings-field">
            <label>Tên địa điểm</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nhập tên địa điểm..."
            />
          </div>

          <div className="settings-field">
            <label>Địa chỉ</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Nhập địa chỉ..."
            />
          </div>

          <div className="settings-field">
            <label>Mô tả chi tiết (Enter để xuống dòng)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Thêm mô tả địa điểm..."
              rows={4}
            />
          </div>
        </div>

        {/* === Icon & Label Section === */}
        <div className="settings-section">
          <div className="settings-section-title">Cài đặt biểu thị</div>

          <div className="settings-field">
            <label>Chọn biểu tượng (Icon)</label>
            <div style={{ display: "flex", gap: "8px", flexDirection: "column" }}>
              <select value={poiType} onChange={(e) => {
                const newType = e.target.value;
                setPoiType(newType);
                setColor(getDefaultPoiColor(newType));
              }}>
                {icons.length === 0 ? (
                  <option value="bridge.svg">Đang tải icon...</option>
                ) : (
                  icons.map((file) => (
                    <option key={file} value={file}>
                      {file.replace(".svg", "").replace("_", " ").toUpperCase()}
                    </option>
                  ))
                )}
              </select>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleUploadIcon}
                accept=".svg,.png,.jpg,.jpeg,.webp"
                style={{ display: "none" }}
              />
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  📤 Tải lên Icon (.svg, .png...)
                </button>
                {poiType !== "bridge.svg" &&
                 poiType !== "hospital.svg" &&
                 poiType !== "school.svg" &&
                 poiType !== "rest_stop.svg" && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    style={{ justifyContent: "center" }}
                    onClick={handleDeleteIconFile}
                    title="Xóa tệp icon này khỏi hệ thống"
                  >
                    🗑 Xóa tệp
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="settings-field">
            <label>Màu sắc giọt nước (Teardrop Color)</label>
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
            <label>Kích thước Icon: {iconSize}px</label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="range"
                min="16"
                max="120"
                step="1"
                value={iconSize}
                onChange={(e) => setIconSize(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min="16"
                max="120"
                step="1"
                value={iconSize}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 16 && v <= 120) setIconSize(v);
                }}
                style={{ width: "56px", textAlign: "center", padding: "4px 6px", border: "1px solid var(--border)", borderRadius: "4px", fontSize: "12px" }}
              />
            </div>
          </div>

          <div className="settings-field">
            <label>Cỡ chữ nhãn: {labelFontSize}px</label>
            <input
              type="range"
              min="8"
              max="24"
              step="1"
              value={labelFontSize}
              onChange={(e) => setLabelFontSize(Number(e.target.value))}
            />
          </div>

          <div className="settings-field">
            <label>Mức zoom nhỏ nhất nhìn thấy: {labelMinZoom}</label>
            <input
              type="range"
              min="10"
              max="30"
              step="1"
              value={labelMinZoom}
              onChange={(e) => setLabelMinZoom(Number(e.target.value))}
            />
          </div>

          <div className="settings-field">
            <label>Mức zoom lớn nhất nhìn thấy: {labelMaxZoom}</label>
            <input
              type="range"
              min="10"
              max="45"
              step="1"
              value={labelMaxZoom}
              onChange={(e) => setLabelMaxZoom(Number(e.target.value))}
            />
          </div>
        </div>

        {/* === Visibility Mode === */}
        <div className="settings-section">
          <div className="settings-section-title">Chế độ hiển thị</div>

          <div className="settings-field">
            <label>Hiển thị</label>
            <select
              value={visibilityMode}
              onChange={(e) => setVisibilityMode(e.target.value)}
            >
              <option value="always">Hiển thị luôn từ đầu (Mặc định)</option>
              <option value="associated">Hiển thị cùng tuyến đường đi qua nó</option>
            </select>
          </div>

          {visibilityMode === "associated" && (
            <div className="settings-field">
              <label>Tuyến đường liên kết</label>
              <select
                value={associatedRouteId}
                onChange={(e) => setAssociatedRouteId(e.target.value)}
              >
                <option value="">-- Chọn tuyến đường đi qua --</option>
                {allRoutes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

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
                      Chưa có ảnh nào trong thư mục `image` của dự án hoặc folder trống.
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

        {/* === Action Buttons === */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            style={{ flex: 1 }}
          >
            💾 Lưu thay đổi
          </button>
          <button
            className="btn btn-danger"
            onClick={handleDelete}
          >
            🗑 Xóa
          </button>
        </div>
      </div>
    </div>
  );
}

function RoutingEditor({
  overlays,
  onSave,
  onClose,
  activeRouteEdit,
  onActiveRouteEditChange,
  geojson,
  selectingFeatureFor,
  onSelectingFeatureForChange,
}) {
  const [routingConfig, setRoutingConfig] = useState(
    overlays?.routingConfig || { startFeatureId: "", destinations: [] }
  );
  const [selectedDestId, setSelectedDestId] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");

  useEffect(() => {
    if (overlays?.routingConfig) {
      setRoutingConfig(overlays.routingConfig);
    }
  }, [overlays?.routingConfig]);

  const getFeatureName = (fid) => {
    if (!fid || !geojson) return "Chưa chọn";
    const feat = geojson.features?.find((f) => f.id === fid);
    if (!feat) return "Không tìm thấy";
    return feat.properties?.name || feat.properties?.description || fid;
  };

  const handleSaveConfig = () => {
    onSave({
      ...overlays,
      routingConfig,
    });
  };

  const handleFinishDrawing = () => {
    if (!activeRouteEdit) return;
    const { destId, id, segments, nodes, editPerSegment } = activeRouteEdit;
    setRoutingConfig((prev) => {
      const nextDestinations = (prev.destinations || []).map((d) => {
        if (d.id !== destId) return d;
        const nextRoutes = (d.routes || []).map((r) => {
          if (r.id !== id) return r;
          return { ...r, segments, nodes, editPerSegment };
        });
        return { ...d, routes: nextRoutes };
      });
      return { ...prev, destinations: nextDestinations };
    });
    onActiveRouteEditChange(null);
  };

  const addDestination = () => {
    const newDest = {
      id: `dest-${Date.now()}`,
      name: "Điểm đến mới",
      featureId: "",
      routes: [],
    };
    setRoutingConfig((prev) => ({
      ...prev,
      destinations: [...(prev.destinations || []), newDest],
    }));
    setSelectedDestId(newDest.id);
  };

  const deleteDestination = (destId) => {
    if (!confirm("Bạn có chắc chắn muốn xóa điểm đến này và tất cả các tuyến đường của nó?")) return;
    setRoutingConfig((prev) => ({
      ...prev,
      destinations: (prev.destinations || []).filter((d) => d.id !== destId),
    }));
    if (selectedDestId === destId) {
      setSelectedDestId("");
      setSelectedRouteId("");
    }
  };

  const addRoute = (destId) => {
    const newRoute = {
      id: `route-${Date.now()}`,
      name: "Tuyến đường mới",
      nodes: [],
      segments: [],
      color: "#4f46e5",
      weight: 5,
      isDashed: false,
      dashLength: 10,
      dashSpace: 10,
      labelShow: false,
      labelText: "Tên nhãn tuyến",
      labelTextColor: "#ffffff",
      labelBgColor: "#4f46e5",
      labelBorderColor: "#312e81",
      labelFontSize: 14,
      labelOpacity: 1,
      labelSpacing: 300,
      labelMinZoom: 10,
      labelMaxZoom: 20,
      labelSingleZoom: 15,
      editPerSegment: false,
    };
    setRoutingConfig((prev) => {
      const nextDestinations = (prev.destinations || []).map((d) => {
        if (d.id !== destId) return d;
        return {
          ...d,
          routes: [...(d.routes || []), newRoute],
        };
      });
      return { ...prev, destinations: nextDestinations };
    });
    setSelectedRouteId(newRoute.id);
  };

  const deleteRoute = (destId, routeId) => {
    if (!confirm("Bạn có chắc chắn muốn xóa tuyến đường này?")) return;
    setRoutingConfig((prev) => {
      const nextDestinations = (prev.destinations || []).map((d) => {
        if (d.id !== destId) return d;
        return {
          ...d,
          routes: (d.routes || []).filter((r) => r.id !== routeId),
        };
      });
      return { ...prev, destinations: nextDestinations };
    });
    if (selectedRouteId === routeId) {
      setSelectedRouteId("");
    }
  };

  const updateDestinationField = (destId, field, value) => {
    setRoutingConfig((prev) => {
      const nextDestinations = (prev.destinations || []).map((d) => {
        if (d.id !== destId) return d;
        return { ...d, [field]: value };
      });
      return { ...prev, destinations: nextDestinations };
    });
  };

  const updateRouteField = (destId, routeId, field, value) => {
    setRoutingConfig((prev) => {
      const nextDestinations = (prev.destinations || []).map((d) => {
        if (d.id !== destId) return d;
        const nextRoutes = (d.routes || []).map((r) => {
          if (r.id !== routeId) return r;
          return { ...r, [field]: value };
        });
        return { ...d, routes: nextRoutes };
      });
      return { ...prev, destinations: nextDestinations };
    });
  };

  if (activeRouteEdit) {
    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h3>Đang vẽ tuyến đường</h3>
          <button className="info-box-close" onClick={() => onActiveRouteEditChange(null)}>×</button>
        </div>
        <div className="settings-panel-body">
          <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border-light)" }}>
            <p style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>Tên tuyến: {activeRouteEdit.name || "Chương trình vẽ"}</p>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              Nhấp chuột vào các đoạn đường trên bản đồ để chọn/bỏ chọn đoạn đường cho tuyến.
            </p>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Số đoạn đã chọn: <strong>{activeRouteEdit.segments?.length || 0}</strong>
            </p>
          </div>

          <div className="settings-section">
            <div className="toggle-row">
              <span style={{ fontSize: "13px", fontWeight: "500" }}>Cài đặt kiểu riêng từng đoạn</span>
              <button
                type="button"
                className={`toggle-switch${activeRouteEdit.editPerSegment ? " active" : ""}`}
                onClick={() => onActiveRouteEditChange({
                  ...activeRouteEdit,
                  editPerSegment: !activeRouteEdit.editPerSegment
                })}
              />
            </div>

            {activeRouteEdit.editPerSegment && activeRouteEdit.segments && activeRouteEdit.segments.length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <label style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "6px" }}>
                  Chọn đoạn để chỉnh sửa thuộc tính:
                </label>
                <select
                  value={activeRouteEdit.selectedSegmentIdx !== undefined ? activeRouteEdit.selectedSegmentIdx : ""}
                  onChange={(e) => onActiveRouteEditChange({
                    ...activeRouteEdit,
                    selectedSegmentIdx: e.target.value !== "" ? Number(e.target.value) : undefined
                  })}
                  style={{ width: "100%", padding: "8px", marginBottom: "12px" }}
                >
                  <option value="">-- Chọn đoạn đường --</option>
                  {activeRouteEdit.segments.map((seg, idx) => (
                    <option key={idx} value={idx}>
                      Đoạn {idx + 1} ({seg.coords?.length || 0} điểm)
                    </option>
                  ))}
                </select>

                {activeRouteEdit.selectedSegmentIdx !== undefined && activeRouteEdit.segments[activeRouteEdit.selectedSegmentIdx] && (
                  <div style={{ padding: "12px", background: "var(--bg-secondary)", borderRadius: "6px", border: "1px solid var(--border)" }}>
                    <p style={{ fontWeight: "600", fontSize: "12.5px", marginBottom: "8px" }}>Định dạng cho Đoạn {activeRouteEdit.selectedSegmentIdx + 1}:</p>
                    
                    <div className="settings-field">
                      <label>Màu sắc đoạn</label>
                      <div className="color-field">
                        <input
                          type="color"
                          value={activeRouteEdit.segments[activeRouteEdit.selectedSegmentIdx].color || activeRouteEdit.color || "#4f46e5"}
                          onChange={(e) => {
                            const newSegs = [...activeRouteEdit.segments];
                            newSegs[activeRouteEdit.selectedSegmentIdx] = {
                              ...newSegs[activeRouteEdit.selectedSegmentIdx],
                              color: e.target.value,
                            };
                            onActiveRouteEditChange({ ...activeRouteEdit, segments: newSegs });
                          }}
                        />
                        <input
                          type="text"
                          value={activeRouteEdit.segments[activeRouteEdit.selectedSegmentIdx].color || activeRouteEdit.color || "#4f46e5"}
                          onChange={(e) => {
                            const newSegs = [...activeRouteEdit.segments];
                            newSegs[activeRouteEdit.selectedSegmentIdx] = {
                              ...newSegs[activeRouteEdit.selectedSegmentIdx],
                              color: e.target.value,
                            };
                            onActiveRouteEditChange({ ...activeRouteEdit, segments: newSegs });
                          }}
                        />
                      </div>
                    </div>

                    <div className="settings-field">
                      <label>Độ dày nét vẽ: {activeRouteEdit.segments[activeRouteEdit.selectedSegmentIdx].weight !== undefined ? activeRouteEdit.segments[activeRouteEdit.selectedSegmentIdx].weight : (activeRouteEdit.weight || 5)}px</label>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        value={activeRouteEdit.segments[activeRouteEdit.selectedSegmentIdx].weight !== undefined ? activeRouteEdit.segments[activeRouteEdit.selectedSegmentIdx].weight : (activeRouteEdit.weight || 5)}
                        onChange={(e) => {
                          const newSegs = [...activeRouteEdit.segments];
                          newSegs[activeRouteEdit.selectedSegmentIdx] = {
                            ...newSegs[activeRouteEdit.selectedSegmentIdx],
                            weight: Number(e.target.value),
                          };
                          onActiveRouteEditChange({ ...activeRouteEdit, segments: newSegs });
                        }}
                      />
                    </div>

                    <div className="toggle-row">
                      <span>Vẽ nét đứt</span>
                      <button
                        type="button"
                        className={`toggle-switch${activeRouteEdit.segments[activeRouteEdit.selectedSegmentIdx].isDashed ? " active" : ""}`}
                        onClick={() => {
                          const newSegs = [...activeRouteEdit.segments];
                          newSegs[activeRouteEdit.selectedSegmentIdx] = {
                            ...newSegs[activeRouteEdit.selectedSegmentIdx],
                            isDashed: !newSegs[activeRouteEdit.selectedSegmentIdx].isDashed,
                          };
                          onActiveRouteEditChange({ ...activeRouteEdit, segments: newSegs });
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", marginTop: "24px" }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleFinishDrawing}>
              Hoàn thành vẽ
            </button>
            <button className="btn btn-secondary" onClick={() => onActiveRouteEditChange(null)}>
              Hủy bỏ
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h3>Quản lý Tuyến đường</h3>
        <button className="info-box-close" onClick={onClose}>×</button>
      </div>
      <div className="settings-panel-body">
        {/* --- Start Point Feature Selection --- */}
        <div className="settings-section" style={{ borderBottom: "1px solid var(--border-light)", paddingBottom: "16px" }}>
          <div className="settings-section-title">Điểm xuất phát chung</div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              Vị trí: <strong>{getFeatureName(routingConfig.startFeatureId)}</strong>
            </span>
            {routingConfig.startFeatureId && (
              <button
                className="btn btn-danger btn-sm"
                style={{ padding: "2px 6px" }}
                onClick={() => setRoutingConfig(prev => ({ ...prev, startFeatureId: "" }))}
                title="Xóa điểm xuất phát"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            className={`btn btn-secondary btn-sm btn-block ${selectingFeatureFor === "start" ? "active" : ""}`}
            onClick={() => onSelectingFeatureForChange(selectingFeatureFor === "start" ? null : "start")}
          >
            {selectingFeatureFor === "start" ? "📍 Click chọn đối tượng trên bản đồ..." : "Chọn điểm xuất phát trên bản đồ"}
          </button>
        </div>

        {/* --- Destinations List --- */}
        <div className="settings-section" style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div className="settings-section-title" style={{ margin: 0 }}>Danh sách Điểm đến</div>
            <button className="btn btn-primary btn-sm" onClick={addDestination}>
              + Thêm Điểm đến
            </button>
          </div>

          {(routingConfig.destinations || []).length === 0 ? (
            <div style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic", textAlign: "center", padding: "20px 0" }}>
              Chưa có điểm đến nào. Nhấp "+ Thêm Điểm đến" để bắt đầu.
            </div>
          ) : (
            (routingConfig.destinations || []).map((dest) => {
              const isExpanded = selectedDestId === dest.id;
              return (
                <div
                  key={dest.id}
                  style={{
                    padding: "12px",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    marginBottom: "12px",
                    background: isExpanded ? "var(--bg-primary)" : "var(--bg-secondary)",
                    boxShadow: isExpanded ? "var(--shadow-sm)" : "none",
                  }}
                >
                  {/* Dest Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span
                      style={{ fontWeight: "600", fontSize: "14px", cursor: "pointer", flex: 1 }}
                      onClick={() => setSelectedDestId(isExpanded ? "" : dest.id)}
                    >
                      {dest.name || "Điểm đến mới"} {isExpanded ? "▲" : "▼"}
                    </span>
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ padding: "4px 8px" }}
                      onClick={() => deleteDestination(dest.id)}
                    >
                      Xóa
                    </button>
                  </div>

                  {/* Dest Body */}
                  {isExpanded && (
                    <div style={{ marginTop: "12px", borderTop: "1px solid var(--border-light)", paddingTop: "12px" }}>
                      <div className="settings-field">
                        <label>Tên điểm đến</label>
                        <input
                          type="text"
                          value={dest.name}
                          onChange={(e) => updateDestinationField(dest.id, "name", e.target.value)}
                        />
                      </div>

                      <div className="settings-field">
                        <label>Vị trí địa lý (Polygon): <strong>{getFeatureName(dest.featureId)}</strong></label>
                        <button
                          type="button"
                          className={`btn btn-secondary btn-sm btn-block ${selectingFeatureFor === `dest-${dest.id}` ? "active" : ""}`}
                          onClick={() => onSelectingFeatureForChange(selectingFeatureFor === `dest-${dest.id}` ? null : `dest-${dest.id}`)}
                        >
                          {selectingFeatureFor === `dest-${dest.id}` ? "📍 Click chọn polygon trên bản đồ..." : "Chọn vị trí trên bản đồ"}
                        </button>
                      </div>

                      {/* Routes Section */}
                      <div style={{ marginTop: "16px", borderTop: "1px dashed var(--border)", paddingTop: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                          <span style={{ fontSize: "12px", fontWeight: "600", textTransform: "uppercase", color: "var(--text-secondary)" }}>Tuyến đường ({dest.routes?.length || 0})</span>
                          <button className="btn btn-secondary btn-sm" style={{ padding: "3px 6px", fontSize: "11px" }} onClick={() => addRoute(dest.id)}>
                            + Thêm Tuyến
                          </button>
                        </div>

                        {(dest.routes || []).map((route) => {
                          const isRouteExpanded = selectedRouteId === route.id;
                          return (
                            <div
                              key={route.id}
                              style={{
                                padding: "10px",
                                border: "1px solid var(--border-light)",
                                borderRadius: "6px",
                                marginBottom: "8px",
                                background: "var(--bg-secondary)",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span
                                  style={{ fontSize: "13px", fontWeight: "600", cursor: "pointer", flex: 1 }}
                                  onClick={() => setSelectedRouteId(isRouteExpanded ? "" : route.id)}
                                >
                                  📍 {route.name || "Tuyến mới"} {isRouteExpanded ? "▲" : "▼"}
                                </span>
                                <button
                                  className="btn btn-danger btn-sm"
                                  style={{ padding: "2px 6px", fontSize: "11px" }}
                                  onClick={() => deleteRoute(dest.id, route.id)}
                                >
                                  Xóa
                                </button>
                              </div>

                              {isRouteExpanded && (
                                <div style={{ marginTop: "10px", borderTop: "1px solid var(--border-light)", paddingTop: "10px" }}>
                                  <div className="settings-field">
                                    <label>Tên tuyến đường</label>
                                    <input
                                      type="text"
                                      value={route.name}
                                      onChange={(e) => updateRouteField(dest.id, route.id, "name", e.target.value)}
                                    />
                                  </div>

                                  <div className="settings-field" style={{ marginBottom: "16px" }}>
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm btn-block"
                                      onClick={() => {
                                        onActiveRouteEditChange({
                                          destId: dest.id,
                                          id: route.id,
                                          name: route.name,
                                          color: route.color || "#4f46e5",
                                          weight: route.weight !== undefined ? route.weight : 5,
                                          isDashed: route.isDashed || false,
                                          dashLength: route.dashLength || 10,
                                          dashSpace: route.dashSpace || 10,
                                          labelShow: route.labelShow || false,
                                          labelText: route.labelText || route.name,
                                          labelTextColor: route.labelTextColor || "#ffffff",
                                          labelBgColor: route.labelBgColor || "#4f46e5",
                                          labelBorderColor: route.labelBorderColor || "#312e81",
                                          labelFontSize: route.labelFontSize || 12,
                                          labelOpacity: route.labelOpacity !== undefined ? route.labelOpacity : 1,
                                          labelSpacing: route.labelSpacing || 300,
                                          labelMinZoom: route.labelMinZoom || 10,
                                          labelMaxZoom: route.labelMaxZoom || 20,
                                          labelSingleZoom: route.labelSingleZoom || 15,
                                          segments: route.segments || [],
                                          nodes: route.nodes || [],
                                          editPerSegment: route.editPerSegment || false,
                                        });
                                      }}
                                    >
                                      🛣️ Vẽ đường đi trên bản đồ
                                    </button>
                                  </div>

                                  {/* Route Styling */}
                                  <p style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>Giao diện đường đi</p>
                                  
                                  <div className="settings-field">
                                    <label>Màu sắc</label>
                                    <div className="color-field">
                                      <input
                                        type="color"
                                        value={route.color || "#4f46e5"}
                                        onChange={(e) => updateRouteField(dest.id, route.id, "color", e.target.value)}
                                      />
                                      <input
                                        type="text"
                                        value={route.color || "#4f46e5"}
                                        onChange={(e) => updateRouteField(dest.id, route.id, "color", e.target.value)}
                                      />
                                    </div>
                                  </div>

                                  <div className="settings-field">
                                    <label>Độ dày nét vẽ: {route.weight || 5}px</label>
                                    <input
                                      type="range"
                                      min="1"
                                      max="20"
                                      value={route.weight || 5}
                                      onChange={(e) => updateRouteField(dest.id, route.id, "weight", Number(e.target.value))}
                                    />
                                  </div>

                                  <div className="toggle-row">
                                    <span>Vẽ nét đứt (dashed)</span>
                                    <button
                                      type="button"
                                      className={`toggle-switch${route.isDashed ? " active" : ""}`}
                                      onClick={() => updateRouteField(dest.id, route.id, "isDashed", !route.isDashed)}
                                    />
                                  </div>

                                  {route.isDashed && (
                                    <>
                                      <div className="settings-field">
                                        <label>Chiều dài đoạn đứt: {route.dashLength || 10}px</label>
                                        <input
                                          type="range"
                                          min="1"
                                          max="30"
                                          value={route.dashLength || 10}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "dashLength", Number(e.target.value))}
                                        />
                                      </div>
                                      <div className="settings-field">
                                        <label>Khoảng cách đoạn đứt: {route.dashSpace || 10}px</label>
                                        <input
                                          type="range"
                                          min="1"
                                          max="30"
                                          value={route.dashSpace || 10}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "dashSpace", Number(e.target.value))}
                                        />
                                      </div>
                                    </>
                                  )}

                                  {/* Route Label Config */}
                                  <p style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--text-muted)", marginTop: "14px", marginBottom: "8px" }}>Cấu hình nhãn tuyến</p>
                                  
                                  <div className="toggle-row">
                                    <span>Hiển thị nhãn chữ trên tuyến</span>
                                    <button
                                      type="button"
                                      className={`toggle-switch${route.labelShow ? " active" : ""}`}
                                      onClick={() => updateRouteField(dest.id, route.id, "labelShow", !route.labelShow)}
                                    />
                                  </div>

                                  {route.labelShow && (
                                    <>
                                      <div className="settings-field">
                                        <label>Nội dung nhãn</label>
                                        <input
                                          type="text"
                                          value={route.labelText || ""}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "labelText", e.target.value)}
                                          placeholder={route.name}
                                        />
                                      </div>

                                      <div className="settings-field">
                                        <label>Cỡ chữ nhãn: {route.labelFontSize || 12}px</label>
                                        <input
                                          type="number"
                                          min="8"
                                          max="100"
                                          value={route.labelFontSize || 12}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "labelFontSize", Number(e.target.value))}
                                        />
                                      </div>

                                      <div className="settings-field">
                                        <label>Màu chữ nhãn</label>
                                        <div className="color-field">
                                          <input
                                            type="color"
                                            value={route.labelTextColor || "#ffffff"}
                                            onChange={(e) => updateRouteField(dest.id, route.id, "labelTextColor", e.target.value)}
                                          />
                                          <input
                                            type="text"
                                            value={route.labelTextColor || "#ffffff"}
                                            onChange={(e) => updateRouteField(dest.id, route.id, "labelTextColor", e.target.value)}
                                          />
                                        </div>
                                      </div>

                                      <div className="settings-field">
                                        <label>Màu nền nhãn</label>
                                        <div className="color-field">
                                          <input
                                            type="color"
                                            value={route.labelBgColor || "#4f46e5"}
                                            onChange={(e) => updateRouteField(dest.id, route.id, "labelBgColor", e.target.value)}
                                          />
                                          <input
                                            type="text"
                                            value={route.labelBgColor || "#4f46e5"}
                                            onChange={(e) => updateRouteField(dest.id, route.id, "labelBgColor", e.target.value)}
                                          />
                                        </div>
                                      </div>

                                      <div className="settings-field">
                                        <label>Màu viền nhãn</label>
                                        <div className="color-field">
                                          <input
                                            type="color"
                                            value={route.labelBorderColor || "#312e81"}
                                            onChange={(e) => updateRouteField(dest.id, route.id, "labelBorderColor", e.target.value)}
                                          />
                                          <input
                                            type="text"
                                            value={route.labelBorderColor || "#312e81"}
                                            onChange={(e) => updateRouteField(dest.id, route.id, "labelBorderColor", e.target.value)}
                                          />
                                        </div>
                                      </div>

                                      <div className="settings-field">
                                        <label>Độ mờ nhãn: {route.labelOpacity !== undefined ? route.labelOpacity : 1}</label>
                                        <input
                                          type="range"
                                          min="0"
                                          max="1"
                                          step="0.1"
                                          value={route.labelOpacity !== undefined ? route.labelOpacity : 1}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "labelOpacity", Number(e.target.value))}
                                        />
                                      </div>

                                      <div className="settings-field">
                                        <label>Khoảng cách lặp lại nhãn: {route.labelSpacing || 300}px</label>
                                        <input
                                          type="number"
                                          min="50"
                                          max="2000"
                                          value={route.labelSpacing || 300}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "labelSpacing", Number(e.target.value))}
                                        />
                                      </div>

                                      <div className="settings-field">
                                        <label>Zoom nhỏ nhất hiển thị nhãn: {route.labelMinZoom || 10}</label>
                                        <input
                                          type="number"
                                          min="1"
                                          max="25"
                                          value={route.labelMinZoom || 10}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "labelMinZoom", Number(e.target.value))}
                                        />
                                      </div>

                                      <div className="settings-field">
                                        <label>Zoom lớn nhất hiển thị nhãn: {route.labelMaxZoom || 20}</label>
                                        <input
                                          type="number"
                                          min="1"
                                          max="25"
                                          value={route.labelMaxZoom || 20}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "labelMaxZoom", Number(e.target.value))}
                                        />
                                      </div>

                                      <div className="settings-field">
                                        <label>Zoom bắt đầu hiển thị 1 nhãn duy nhất: {route.labelSingleZoom || 15}</label>
                                        <input
                                          type="number"
                                          min="1"
                                          max="25"
                                          value={route.labelSingleZoom || 15}
                                          onChange={(e) => updateRouteField(dest.id, route.id, "labelSingleZoom", Number(e.target.value))}
                                        />
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* --- Footer Buttons --- */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px" }}>
          <button className="btn btn-primary btn-block" onClick={handleSaveConfig} style={{ flex: 1 }}>
            💾 Lưu cấu hình
          </button>
        </div>
      </div>
    </div>
  );
}
