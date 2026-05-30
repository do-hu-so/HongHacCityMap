"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import L from "leaflet";
import { createRoot } from "react-dom/client";
import SettingsPanel from "./SettingsPanel";
import ImageLightbox from "./ImageLightbox";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

export default function MapView({
  geojson,
  overlays,
  mode,
  selectedFeature,
  onFeatureClick,
  onOverlaysChange,
  addingTextLabel,
  onAddTextLabel,
  openBoxes = {},
  onCloseBox,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const geoLayerRef = useRef(null);
  const textMarkersRef = useRef([]);
  const highlightLayerRef = useRef(null);
  const infoBoxMarkersRef = useRef({});
  const [lightboxData, setLightboxData] = useState(null);

  // Calculate bounds from geojson
  const defaultCenter = useMemo(() => {
    if (!geojson?.features?.length) return [21.015, 106.015];
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    const processCoords = (coords) => {
      if (typeof coords[0] === "number") {
        const [lng, lat] = coords;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        return;
      }
      coords.forEach(processCoords);
    };
    geojson.features.slice(0, 200).forEach((f) => {
      if (f.geometry?.coordinates) processCoords(f.geometry.coordinates);
    });
    return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  }, [geojson]);

  // Init map
  useEffect(() => {
    if (mapInstanceRef.current) return;
    const map = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [defaultCenter]);

  // Get style for a feature (merged with overlay customizations)
  const getFeatureStyle = useCallback(
    (feature) => {
      const props = feature.properties || {};
      const customStyle = overlays?.myMapsStyles?.[feature.id] || {};
      const geomType = feature.geometry?.type;

      const baseStyle = {
        color: customStyle.stroke || props.stroke || "#3388ff",
        weight: customStyle.strokeWidth ?? props["stroke-width"] ?? 1.2,
        opacity: customStyle.strokeOpacity ?? props["stroke-opacity"] ?? 1,
        fillColor: customStyle.fill || props.fill || "#3388ff",
        fillOpacity: customStyle.fillOpacity ?? props["fill-opacity"] ?? 0.5,
      };

      if (customStyle.dashArray) {
        baseStyle.dashArray = customStyle.dashArray;
      }

      // Lines: no fill
      if (geomType === "LineString" || geomType === "MultiLineString") {
        baseStyle.fill = false;
      }

      return baseStyle;
    },
    [overlays]
  );

  // Render GeoJSON layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !geojson) return;

    if (geoLayerRef.current) {
      map.removeLayer(geoLayerRef.current);
    }

    const layer = L.geoJSON(geojson, {
      style: (feature) => getFeatureStyle(feature),
      pointToLayer: (feature, latlng) => {
        const featStyle = getFeatureStyle(feature);
        return L.circleMarker(latlng, {
          radius: 6,
          weight: 16, // Thick transparent border for touch hit box (total diameter ~44px)
          color: "transparent",
          fillColor: featStyle.fillColor || featStyle.color || "#3388ff",
          fillOpacity: featStyle.fillOpacity ?? 0.8,
        });
      },
      onEachFeature: (feature, layer) => {
        layer.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onFeatureClick({ type: "geojson", data: feature, latlng: e.latlng });
          map.panTo(e.latlng, { animate: true });
        });
        layer.on("mouseover", () => {
          layer.setStyle({ weight: 3, fillOpacity: 0.7 });
        });
        layer.on("mouseout", () => {
          layer.setStyle(getFeatureStyle(feature));
        });

        // Add an invisible thick polyline hit target for LineStrings
        const geomType = feature.geometry?.type;
        if (geomType === "LineString" || geomType === "MultiLineString") {
          const hitLayer = L.polyline(layer.getLatLngs(), {
            color: "#000",
            weight: 24, // thick clickable hit box for fingers (24px)
            opacity: 0,
            interactive: true,
          });

          hitLayer.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            onFeatureClick({ type: "geojson", data: feature, latlng: e.latlng });
            map.panTo(e.latlng, { animate: true });
          });

          hitLayer.on("mouseover", () => {
            layer.setStyle({ weight: 3, fillOpacity: 0.7 });
          });

          hitLayer.on("mouseout", () => {
            layer.setStyle(getFeatureStyle(feature));
          });

          // Add to map immediately and bind to parent lifecycle
          hitLayer.addTo(map);
          layer.on("remove", () => {
            map.removeLayer(hitLayer);
          });
        }
      },
    });

    layer.addTo(map);
    geoLayerRef.current = layer;
  }, [geojson, overlays, getFeatureStyle, onFeatureClick]);

  // Highlight selected feature
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (highlightLayerRef.current) {
      map.removeLayer(highlightLayerRef.current);
      highlightLayerRef.current = null;
    }

    if (selectedFeature?.type === "geojson" && selectedFeature.data?.geometry) {
      const highlight = L.geoJSON(selectedFeature.data, {
        style: {
          color: "#4361ee",
          weight: 4,
          opacity: 0.8,
          fillColor: "#4361ee",
          fillOpacity: 0.15,
          dashArray: "6 4",
        },
        pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, {
            radius: 10,
            color: "#4361ee",
            weight: 3,
            fillColor: "#4361ee",
            fillOpacity: 0.2,
          }),
        interactive: false,
      });
      highlight.addTo(map);
      highlightLayerRef.current = highlight;
    }
  }, [selectedFeature]);

  // Store label-id to marker-index mapping for real-time preview
  const textLabelMapRef = useRef({});
  // Store latest labels ref for zoom handler
  const textLabelsDataRef = useRef([]);

  // Render text labels
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !overlays) return;

    // Remove old text markers
    textMarkersRef.current.forEach((m) => map.removeLayer(m));
    textMarkersRef.current = [];
    textLabelMapRef.current = {};

    const labels = overlays.textLabels || [];
    textLabelsDataRef.current = labels;
    const currentZoom = map.getZoom();

    labels.forEach((label, index) => {
      const scale = Math.pow(2, currentZoom - (label.zoomBase || 16));
      const rotationDeg = label.rotation || 0;
      const icon = L.divIcon({
        className: "",
        html: `<div class="map-text-label${mode === "settings" ? " editing" : ""}" data-label-id="${label.id}" data-zoom-base="${label.zoomBase || 16}" data-rotation="${rotationDeg}" style="font-size:${label.fontSize || 14}px;color:${label.color || "#1f2937"};transform:scale(${scale}) rotate(${rotationDeg}deg)">${label.text}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker(label.position, {
        icon,
        draggable: mode === "settings",
        interactive: true,
        zIndexOffset: 1000,
      });

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onFeatureClick({ type: "textLabel", data: label });
      });

      if (mode === "settings") {
        marker.on("dragend", (e) => {
          const pos = e.target.getLatLng();
          const currentLabels = textLabelsDataRef.current || [];
          const currentLabel = currentLabels.find((l) => l.id === label.id) || label;
          const newLabels = currentLabels.map((l) =>
            l.id === label.id ? { ...currentLabel, position: [pos.lat, pos.lng] } : l
          );
          onOverlaysChange({ ...overlays, textLabels: newLabels });
        });
      }

      marker.addTo(map);
      textMarkersRef.current.push(marker);
      textLabelMapRef.current[label.id] = index;
    });

    // Update scale on zoom
    const onZoom = () => {
      const z = map.getZoom();
      const currentLabels = textLabelsDataRef.current;
      textMarkersRef.current.forEach((marker, i) => {
        const label = currentLabels[i];
        if (!label) return;
        const s = Math.pow(2, z - (label.zoomBase || 16));
        const rotDeg = label.rotation || 0;
        const el = marker.getElement();
        if (el) {
          const div = el.querySelector(".map-text-label");
          if (div) {
            // Re-read rotation from data attribute in case it was updated by preview
            const liveRot = div.dataset.rotation || rotDeg;
            const liveZoomBase = Number(div.dataset.zoomBase) || (label.zoomBase || 16);
            const liveScale = Math.pow(2, z - liveZoomBase);
            div.style.transform = `scale(${liveScale}) rotate(${liveRot}deg)`;
          }
        }
      });
    };

    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [overlays, mode, onFeatureClick, onOverlaysChange]);

  // Real-time preview handler for text label editing
  const handleTextLabelPreview = useCallback((labelId, { text, color, fontSize, rotation, zoomBase }) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const idx = textLabelMapRef.current[labelId];
    if (idx === undefined) return;
    const marker = textMarkersRef.current[idx];
    if (!marker) return;
    const el = marker.getElement();
    if (!el) return;
    const div = el.querySelector(".map-text-label");
    if (!div) return;

    const currentZoom = map.getZoom();
    const zb = zoomBase || 16;
    const scale = Math.pow(2, currentZoom - zb);
    const rot = rotation || 0;

    if (text !== undefined) div.textContent = text;
    if (color !== undefined) div.style.color = color;
    if (fontSize !== undefined) div.style.fontSize = `${fontSize}px`;
    div.style.transform = `scale(${scale}) rotate(${rot}deg)`;
    div.dataset.rotation = rot;
    div.dataset.zoomBase = zb;

    // Also update the labels data ref so zoom handler uses latest values
    textLabelsDataRef.current = textLabelsDataRef.current.map((l, i) =>
      i === idx ? { ...l, text, color, fontSize, rotation: rot, zoomBase: zb } : l
    );
  }, []);

  // Handle adding text label click
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const onClick = (e) => {
      if (addingTextLabel) {
        onAddTextLabel(e.latlng);
      }
    };

    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [addingTextLabel, onAddTextLabel]);

  // Deselect when clicking empty map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const onClick = (e) => {
      if (!addingTextLabel && e.originalEvent?.target === mapRef.current?.querySelector(".leaflet-container canvas") || e.originalEvent?.target?.classList?.contains("leaflet-tile")) {
        // Click on empty map area - only deselect if not clicking a feature
      }
    };

    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [addingTextLabel]);

  // Sync openBoxes with Leaflet markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (mode !== "view") {
      // Clear all markers if not in view mode
      Object.values(infoBoxMarkersRef.current).forEach((marker) => {
        map.removeLayer(marker);
      });
      infoBoxMarkersRef.current = {};
      return;
    }

    const currentFids = Object.keys(openBoxes);
    const renderedFids = Object.keys(infoBoxMarkersRef.current);

    // 1. Remove markers no longer in openBoxes
    renderedFids.forEach((fid) => {
      if (!openBoxes[fid]) {
        map.removeLayer(infoBoxMarkersRef.current[fid]);
        delete infoBoxMarkersRef.current[fid];
      }
    });

    // 2. Render new/updated markers
    currentFids.forEach((fid) => {
      const boxData = openBoxes[fid];
      if (!boxData) return;

      const { feature, latlng } = boxData;
      const customColor = overlays?.myMapsStyles?.[fid]?.stroke || feature.properties?.stroke || "#4361ee";

      if (!infoBoxMarkersRef.current[fid]) {
        const container = document.createElement("div");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        const root = createRoot(container);

        const props = feature.properties || {};
        const info = overlays?.objectInfo?.[fid] || {};
        const displayInfo = {
          id: fid,
          title: info.title || props.name || props.description || fid,
          description: info.description || "",
          images: info.images || [],
          originalProps: props,
        };

        root.render(
          <MapInfoBox
            info={displayInfo}
            color={customColor}
            onClose={() => onCloseBox(fid)}
            onImageClick={(imagesArray, idx) => {
              setLightboxData({ images: imagesArray, index: idx });
            }}
          />
        );

        const icon = L.divIcon({
          className: "leaflet-custom-infobox-icon",
          html: container,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });

        const marker = L.marker(latlng, {
          icon,
          zIndexOffset: 2000,
        }).addTo(map);

        infoBoxMarkersRef.current[fid] = marker;
      }
    });
  }, [openBoxes, mode, overlays, onCloseBox]);

  // Clean up all markers on unmount
  useEffect(() => {
    return () => {
      const map = mapInstanceRef.current;
      Object.values(infoBoxMarkersRef.current).forEach((marker) => {
        map?.removeLayer(marker);
      });
    };
  }, []);

  // Build info for the selected feature
  const selectedInfo = useMemo(() => {
    if (!selectedFeature) return null;

    if (selectedFeature.type === "geojson") {
      const f = selectedFeature.data;
      const props = f.properties || {};
      const info = overlays?.objectInfo?.[f.id] || {};
      return {
        id: f.id,
        type: "geojson",
        geometryType: f.geometry?.type,
        title: info.title || props.name || props.description || f.id,
        description: info.description || "",
        images: info.images || [],
        originalProps: props,
      };
    }

    if (selectedFeature.type === "textLabel") {
      const latestLabel = overlays?.textLabels?.find(
        (l) => l.id === selectedFeature.data.id
      ) || selectedFeature.data;
      return {
        id: latestLabel.id,
        type: "textLabel",
        data: latestLabel,
      };
    }

    return null;
  }, [selectedFeature, overlays]);

  return (
    <>
      <div ref={mapRef} className="map-container" />

      {/* Settings Mode: SettingsPanel */}
      {mode === "settings" && selectedInfo && (
        <SettingsPanel
          info={selectedInfo}
          overlays={overlays}
          onSave={onOverlaysChange}
          onPreview={handleTextLabelPreview}
          onClose={() => onFeatureClick(null)}
          onDeleteTextLabel={(labelId) => {
            const newLabels = (overlays.textLabels || []).filter(
              (l) => l.id !== labelId
            );
            onOverlaysChange({ ...overlays, textLabels: newLabels });
            onFeatureClick(null);
          }}
        />
      )}

      {/* Premium Fullscreen Photo Gallery Lightbox */}
      {lightboxData && (
        <ImageLightbox
          images={lightboxData.images}
          startIndex={lightboxData.index}
          onClose={() => setLightboxData(null)}
        />
      )}
    </>
  );
}

/* ============================
   In-Map Custom Info Box Component
   ============================ */
function MapInfoBox({ info, color, onClose, onImageClick }) {
  const [offset, setOffset] = useState({ x: 50, y: -50 });
  const [isDragging, setIsDragging] = useState(false);
  const [size, setSize] = useState({
    width: 290,
    height: info.images && info.images.length > 0 ? 220 : 150,
  });

  const handlePointerDown = useCallback((e) => {
    // Only drag with left click of mouse or any touch/pen pointer
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (
      e.target.tagName === "BUTTON" ||
      e.target.tagName === "INPUT" ||
      e.target.closest("button")
    ) {
      return;
    }

    e.stopPropagation();
    setIsDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = offset.x;
    const initialY = offset.y;

    const handlePointerMove = (moveEvent) => {
      moveEvent.stopPropagation();
      if (moveEvent.cancelable) {
        moveEvent.preventDefault();
      }
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setOffset({
        x: initialX + dx,
        y: initialY + dy,
      });
    };

    const handlePointerUp = (upEvent) => {
      upEvent.stopPropagation();
      if (upEvent.cancelable) {
        upEvent.preventDefault();
      }
      setIsDragging(false);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerUp, { passive: false });
    document.addEventListener("pointercancel", handlePointerUp, { passive: false });
  }, [offset]);

  const handleResizePointerDown = useCallback((e) => {
    e.stopPropagation();
    if (e.cancelable) {
      e.preventDefault();
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = size.width;
    const startHeight = size.height;

    const handlePointerMove = (moveEvent) => {
      moveEvent.stopPropagation();
      if (moveEvent.cancelable) {
        moveEvent.preventDefault();
      }
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setSize({
        width: Math.max(200, startWidth + dx),
        height: Math.max(120, startHeight + dy),
      });
    };

    const handlePointerUp = (upEvent) => {
      upEvent.stopPropagation();
      if (upEvent.cancelable) {
        upEvent.preventDefault();
      }
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerUp, { passive: false });
    document.addEventListener("pointercancel", handlePointerUp, { passive: false });
  }, [size]);

  return (
    <div style={{ position: "relative" }}>
      {/* SVG Connector Line */}
      <svg className="map-info-box-line" style={{ overflow: "visible" }}>
        <line
          x1="0"
          y1="0"
          x2={offset.x}
          y2={offset.y}
          stroke={color || "#4361ee"}
          strokeWidth="1.5"
        />
        <circle cx="0" cy="0" r="3.5" fill={color || "#4361ee"} />
      </svg>

      {/* Info Box Card */}
      <div
        className={`map-info-box-container${info.images && info.images.length > 0 ? "" : " no-images"}`}
        style={{
          left: `${offset.x}px`,
          top: `${offset.y}px`,
          transform: "translate(-50%, -100%)", // bottom-center anchor
          width: `${size.width}px`,
          height: info.images && info.images.length > 0 ? `${size.height}px` : "auto",
        }}
      >
        <div
          className="info-box-header"
          onPointerDown={handlePointerDown}
          style={{
            padding: "8px 12px",
            background: "var(--bg-secondary)",
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          <h3 style={{ fontSize: "15px", margin: 0, fontWeight: 600 }}>{info.title}</h3>
          <button
            className="info-box-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ width: "22px", height: "22px", fontSize: "10px" }}
          >
            ✕
          </button>
        </div>
        <div className="info-box-body" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px", overflow: "hidden", flex: "1 1 auto", minHeight: 0 }}>
          {info.description && (
            <div
              className="info-box-description"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              style={{
                fontSize: "13.5px",
                lineHeight: "1.5",
                maxHeight: "80px",
                overflowY: "auto",
                paddingRight: "4px",
                flex: "0 0 auto",
              }}
            >
              {info.description}
            </div>
          )}
          {info.images && info.images.length > 0 && (
            <div
              className="info-box-image-slider"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              style={{
                display: "flex",
                flexDirection: "row",
                overflowX: "auto",
                overflowY: "hidden",
                gap: "8px",
                width: "100%",
                flex: "1 1 auto",
                minHeight: "85px",
                paddingBottom: "4px",
              }}
            >
              {info.images.map((img, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: "0 0 auto",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    position: "relative",
                    height: "100%",
                    minHeight: 0,
                  }}
                >
                  <img
                    src={img.src}
                    alt={img.caption || ""}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onImageClick) {
                        onImageClick(info.images, idx);
                      }
                    }}
                    style={{
                      flex: "1 1 auto",
                      minHeight: 0,
                      height: "100%",
                      maxHeight: "100%",
                      maxWidth: "100%",
                      width: "auto",
                      objectFit: "contain",
                      borderRadius: "4px",
                      cursor: "pointer",
                      display: "block",
                    }}
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                  {img.caption && (
                    <div className="info-box-image-caption" style={{ fontSize: "11px", marginTop: "2px", color: "var(--text-muted)", fontStyle: "italic", textAlign: "center" }}>
                      {img.caption}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!info.description && info.originalProps?.category && (
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              {info.originalProps.category}
            </div>
          )}
        </div>
        {/* Resize handle for touch and mouse */}
        <div
          onPointerDown={handleResizePointerDown}
          className="info-box-resize-handle"
        />
      </div>
    </div>
  );
}
