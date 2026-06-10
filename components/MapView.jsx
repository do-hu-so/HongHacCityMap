"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import L from "leaflet";
import { createRoot } from "react-dom/client";
import SettingsPanel from "./SettingsPanel";
import ImageLightbox from "./ImageLightbox";
import { getFeatureCenter } from "./routing-utils";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// Helper for gentle font scaling (like Google Maps)
const getGentleScale = (zoom, baseZoom = 16) => {
  const base = 1.15; // Much gentler than exponential 2.0
  const rawScale = Math.pow(base, zoom - baseZoom);
  return Math.max(0.65, Math.min(1.8, rawScale)); // Clamp to keep readable
};

const isPoiCloseToRoute = (poiPosition, route, threshold = 0.0015) => {
  if (!poiPosition || !route || !route.segments || route.segments.length === 0) return false;
  for (const seg of route.segments) {
    if (!seg.coords || seg.coords.length === 0) continue;
    for (const coord of seg.coords) {
      const dist = Math.sqrt(
        Math.pow(poiPosition[0] - coord[0], 2) + Math.pow(poiPosition[1] - coord[1], 2)
      );
      if (dist <= threshold) {
        return true;
      }
    }
  }
  return false;
};

const projectPointOnSegment = (p, p1, p2) => {
  const x = p.x, y = p.y;
  const x1 = p1.x, y1 = p1.y;
  const x2 = p2.x, y2 = p2.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return { point: p1, distSq: (x - x1) * (x - x1) + (y - y1) * (y - y1) };

  let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj = {
    x: x1 + t * dx,
    y: y1 + t * dy
  };

  const distSq = (x - proj.x) * (x - proj.x) + (y - proj.y) * (y - proj.y);
  return { point: proj, distSq };
};

export default function MapView({
  geojson,
  overlays,
  mode,
  selectedFeature,
  onFeatureClick,
  onOverlaysChange,
  addingTextLabel,
  onAddTextLabel,
  addingPoiLabel,
  onAddPoiLabel,
  openBoxes = {},
  onCloseBox,
  activeRouteEdit,
  onActiveRouteEditChange,
  activeDestinationIds = [],
  checkedRouteIds = {},
  onTriggerInfoBox,
  selectingFeatureFor,
  onSelectingFeatureForChange,
  roadGraph,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const geoLayerRef = useRef(null);
  const textMarkersRef = useRef([]);
  const highlightLayerRef = useRef(null);
  const infoBoxMarkersRef = useRef({});
  const routeLayersRef = useRef([]);
  const nodeMarkersRef = useRef([]);
  const viewRouteLayersRef = useRef([]);
  const routeLabelLayersRef = useRef([]);
  const viewRouteLabelLayersRef = useRef([]);
  const poiMarkersRef = useRef([]);
  const poiLabelsDataRef = useRef([]);
  const [lightboxData, setLightboxData] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(15);

  // roadGraph is now received as a prop from page.js (computed once)

  const activeDestinationFeatureIds = useMemo(() => {
    if (!overlays?.routingConfig?.destinations || !activeDestinationIds || activeDestinationIds.length === 0) return [];
    return activeDestinationIds
      .map((destId) => {
        const dest = overlays.routingConfig.destinations.find((d) => d.id === destId);
        return dest?.featureId || "";
      })
      .filter(Boolean);
  }, [overlays, activeDestinationIds]);

  // List of segment geometries that form the active routes
  const activeRouteSegments = useMemo(() => {
    if (!overlays?.routingConfig?.destinations || !activeDestinationIds || activeDestinationIds.length === 0) return [];
    
    const allSegs = [];
    const seenKeys = new Set();
    
    activeDestinationIds.forEach((destId) => {
      const dest = overlays.routingConfig.destinations.find((d) => d.id === destId);
      if (!dest) return;
      
      const routes = dest.routes || [];
      if (routes.length === 0 && dest.routeSegments) {
        dest.routeSegments.forEach((seg) => {
          const start = seg.coords[0];
          const end = seg.coords[seg.coords.length - 1];
          const key = `legacy-${destId}-${seg.featureId}-${start[0].toFixed(6)}-${start[1].toFixed(6)}-${end[0].toFixed(6)}-${end[1].toFixed(6)}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allSegs.push({
              ...seg,
              color: "#4f46e5",
              isDashed: false,
              dashLength: 10,
              dashSpace: 10,
              title: "",
              description: "",
              images: [],
              labelShow: false,
              labelText: "",
              labelTextColor: "#1f2937",
              labelBgColor: "#ffffff",
              labelBorderColor: "#4f46e5",
              labelFontSize: 12,
              labelOpacity: 0.9,
              labelSpacing: 300,
            });
          }
        });
      } else {
        routes.forEach((r) => {
          if (checkedRouteIds[r.id] && r.segments) {
            r.segments.forEach((seg) => {
              const start = seg.coords[0];
              const end = seg.coords[seg.coords.length - 1];
              const key = `${r.id}-${seg.featureId}-${start[0].toFixed(6)}-${start[1].toFixed(6)}-${end[0].toFixed(6)}-${end[1].toFixed(6)}`;
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                const usePerSeg = r.editPerSegment;
                allSegs.push({
                  ...seg,
                  routeId: r.id,
                  routeColor: r.color || "#4f46e5",
                  routeIsDashed: r.isDashed || false,
                  routeDashLength: r.dashLength || 10,
                  routeDashSpace: r.dashSpace || 10,
                  routeTitle: r.title || "",
                  routeDescription: r.description || "",
                  routeImages: r.images || [],
                  routeLabelShow: r.labelShow || false,
                  routeLabelText: r.labelText || "",
                  routeLabelTextColor: r.labelTextColor || "#1f2937",
                  routeLabelBgColor: r.labelBgColor || "#ffffff",
                  routeLabelBorderColor: r.labelBorderColor || "#4f46e5",
                  routeLabelFontSize: r.labelFontSize || 12,
                  routeLabelOpacity: r.labelOpacity || 0.9,
                  routeLabelSpacing: r.labelSpacing,
                  editPerSegment: usePerSeg || false,
                  color: (usePerSeg && seg.color) ? seg.color : (r.color || "#4f46e5"),
                  weight: (usePerSeg && seg.weight !== undefined) ? seg.weight : (r.weight !== undefined ? r.weight : 5),
                  isDashed: (usePerSeg && seg.isDashed !== undefined) ? seg.isDashed : (r.isDashed || false),
                  dashLength: (usePerSeg && seg.dashLength) ? seg.dashLength : (r.dashLength || 10),
                  dashSpace: (usePerSeg && seg.dashSpace) ? seg.dashSpace : (r.dashSpace || 10),
                  title: (usePerSeg && seg.title) ? seg.title : (r.title || ""),
                  description: (usePerSeg && seg.description) ? seg.description : (r.description || ""),
                  images: (usePerSeg && seg.images) ? seg.images : (r.images || []),
                  labelShow: (usePerSeg && seg.labelShow !== undefined) ? seg.labelShow : (r.labelShow || false),
                  labelText: (usePerSeg && seg.labelText !== undefined) ? seg.labelText : (r.labelText || ""),
                  labelTextColor: (usePerSeg && seg.labelTextColor) ? seg.labelTextColor : (r.labelTextColor || "#1f2937"),
                  labelBgColor: (usePerSeg && seg.labelBgColor) ? seg.labelBgColor : (r.labelBgColor || "#ffffff"),
                  labelBorderColor: (usePerSeg && seg.labelBorderColor) ? seg.labelBorderColor : (r.labelBorderColor || "#4f46e5"),
                  labelFontSize: (usePerSeg && seg.labelFontSize) ? seg.labelFontSize : (r.labelFontSize || 12),
                  labelOpacity: (usePerSeg && seg.labelOpacity) ? seg.labelOpacity : (r.labelOpacity || 0.9),
                  labelSpacing: (usePerSeg && seg.labelSpacing !== undefined) ? seg.labelSpacing : (r.labelSpacing !== undefined ? r.labelSpacing : 300),
                  labelMinZoom: (usePerSeg && seg.labelMinZoom !== undefined) ? seg.labelMinZoom : (r.labelMinZoom !== undefined ? r.labelMinZoom : 11),
                  labelMaxZoom: (usePerSeg && seg.labelMaxZoom !== undefined) ? seg.labelMaxZoom : (r.labelMaxZoom !== undefined ? r.labelMaxZoom : 45),
                  labelSingleZoom: (usePerSeg && seg.labelSingleZoom !== undefined) ? seg.labelSingleZoom : (r.labelSingleZoom !== undefined ? r.labelSingleZoom : 13),
                });
              }
            });
          }
        });
      }
    });
    return allSegs;
  }, [overlays, activeDestinationIds, checkedRouteIds]);

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
      maxZoom: 45, // Enable zoom up to 45
    });
    L.tileLayer(TILE_URL, { 
      attribution: TILE_ATTR, 
      maxZoom: 45, // Let tile layer support zoom up to 45
      maxNativeZoom: 19 // Server tiles only go up to 19, stretch tiles for 20-45
    }).addTo(map);
    mapInstanceRef.current = map;

    // Track zoom level changes
    setCurrentZoom(map.getZoom());
    const handleZoomEnd = () => {
      setCurrentZoom(map.getZoom());
    };
    map.on("zoomend", handleZoomEnd);

    return () => {
      map.off("zoomend", handleZoomEnd);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [defaultCenter]);



  // Use refs for frequently-changing values so GeoJSON layer doesn't re-render
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const activeRouteEditRef = useRef(activeRouteEdit);
  activeRouteEditRef.current = activeRouteEdit;
  const selectingFeatureForRef = useRef(selectingFeatureFor);
  selectingFeatureForRef.current = selectingFeatureFor;
  const activeDestIdsRef = useRef(activeDestinationIds);
  activeDestIdsRef.current = activeDestinationIds;
  const activeDestFidsRef = useRef(activeDestinationFeatureIds);
  activeDestFidsRef.current = activeDestinationFeatureIds;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const onFeatureClickRef = useRef(onFeatureClick);
  onFeatureClickRef.current = onFeatureClick;
  const onOverlaysChangeRef = useRef(onOverlaysChange);
  onOverlaysChangeRef.current = onOverlaysChange;

  // Handle map click events to add text labels or POI markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const onMapClick = (e) => {
      if (addingTextLabel) {
        onAddTextLabel(e.latlng);
      } else if (addingPoiLabel) {
        const snap = map._currentSnap;
        if (snap) {
          onAddPoiLabel(snap.latlng, snap.routeId, "associated");
        } else {
          onAddPoiLabel(e.latlng, "", "always");
        }
      }
    };

    map.on("click", onMapClick);

    // Apply crosshair cursor to Leaflet container in add mode
    const container = map.getContainer();
    if (addingTextLabel || addingPoiLabel) {
      container.classList.add("adding-poi-label");
    } else {
      container.classList.remove("adding-poi-label");
    }

    return () => {
      map.off("click", onMapClick);
    };
  }, [addingTextLabel, addingPoiLabel, onAddTextLabel, onAddPoiLabel]);

  // Route Snapping Preview logic when adding POI Marker
  const previewMarkerRef = useRef(null);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!addingPoiLabel) {
      if (previewMarkerRef.current) {
        map.removeLayer(previewMarkerRef.current);
        previewMarkerRef.current = null;
      }
      return;
    }

    // Create a preview marker
    const tempMarker = L.marker([0, 0], {
      interactive: false,
      opacity: 0.8,
      zIndexOffset: 2000,
    }).addTo(map);
    previewMarkerRef.current = tempMarker;

    const onMouseMove = (e) => {
      const mouseLatLng = e.latlng;
      const mousePt = map.latLngToLayerPoint(mouseLatLng);

      let closestPt = null;
      let minDistance = Infinity;
      let snappedRoute = null;

      const destinations = overlaysRef.current?.routingConfig?.destinations || [];

      destinations.forEach((dest) => {
        const routes = dest.routes || [];
        routes.forEach((route) => {
          const segments = route.segments || [];
          segments.forEach((seg) => {
            const coords = seg.coords || [];
            for (let i = 0; i < coords.length - 1; i++) {
              const p1 = map.latLngToLayerPoint(L.latLng(coords[i][0], coords[i][1]));
              const p2 = map.latLngToLayerPoint(L.latLng(coords[i+1][0], coords[i+1][1]));

              const { point, distSq } = projectPointOnSegment(mousePt, p1, p2);
              const dist = Math.sqrt(distSq);

              if (dist < minDistance) {
                minDistance = dist;
                closestPt = point;
                snappedRoute = route;
              }
            }
          });
        });
      });

      // Snapping threshold: 30 pixels
      const isSnapped = minDistance < 30 && closestPt;
      const finalLatLng = isSnapped ? map.layerPointToLatLng(closestPt) : mouseLatLng;

      tempMarker.setLatLng(finalLatLng);

      const pinColor = isSnapped ? "#10b981" : "#ef4444";
      const iconSize = 28;
      const markerHtml = `
        <div class="poi-marker-container" style="position: relative; width: 100%; height: 100%;">
          <div class="poi-label-box" style="position: absolute; bottom: 100%; left: 50%; transform: translate(-50%, -6px); background: ${isSnapped ? "#d1fae5" : "#fee2e2"}; border: 1.5px solid ${isSnapped ? "#10b981" : "#ef4444"}; color: ${isSnapped ? "#065f46" : "#991b1b"}; padding: 4px 8px; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); text-align: center; white-space: nowrap; margin-bottom: 0;">
            <div class="poi-label-title" style="font-size: 11px; font-weight: bold; margin: 0; padding: 0; line-height: 1.2;">
              ${isSnapped ? `Gán vào: ${snappedRoute.name}` : "Địa điểm tự do"}
            </div>
            <div style="font-size: 9px; opacity: 0.8; margin-top: 2px;">Click bản đồ để đặt</div>
          </div>
          <div class="poi-pin-wrapper" style="width: 100%; height: 100%; position: relative;">
            <svg class="poi-pin-svg" viewBox="0 0 48 60" width="100%" height="100%">
              <path d="M24 4C14.06 4 6 12.06 6 22c0 12 18 34 18 34s18-22 18-34c0-9.94-8.06-18-18-18z" fill="${pinColor}" stroke="#ffffff" stroke-width="2"/>
              <circle cx="24" cy="20" r="14" fill="#ffffff"/>
            </svg>
          </div>
        </div>
      `;

      tempMarker.setIcon(L.divIcon({
        className: "",
        html: markerHtml,
        iconSize: [iconSize, iconSize * 1.25],
        iconAnchor: [iconSize / 2, iconSize * 1.25],
      }));

      map._currentSnap = isSnapped ? {
        latlng: finalLatLng,
        routeId: snappedRoute.id,
      } : null;
    };

    map.on("mousemove", onMouseMove);

    return () => {
      map.off("mousemove", onMouseMove);
      if (previewMarkerRef.current) {
        map.removeLayer(previewMarkerRef.current);
        previewMarkerRef.current = null;
      }
      map._currentSnap = null;
    };
  }, [addingPoiLabel]);

  // Render GeoJSON layer — only re-renders when geojson or overlays change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !geojson) return;

    if (geoLayerRef.current) {
      map.removeLayer(geoLayerRef.current);
    }

    const getStyleNow = (feature) => {
      const props = feature.properties || {};
      const ov = overlays;
      const customStyle = ov?.myMapsStyles?.[feature.id] || {};
      const geomType = feature.geometry?.type;
      const curMode = mode;

      const isStartFeature = feature.id === ov?.routingConfig?.startFeatureId;
      const isDestFeature = activeDestinationFeatureIds.includes(feature.id);
      const isAlwaysVisible = (ov?.routingConfig?.alwaysVisibleFeatureIds || []).includes(feature.id);

      let isHidden = false;
      if (curMode === "view") {
        if (activeDestinationIds && activeDestinationIds.length > 0) {
          isHidden = !isStartFeature && !isDestFeature && !isAlwaysVisible;
        } else {
          isHidden = !isAlwaysVisible && !isStartFeature;
        }
      }

      const baseStyle = {
        color: isHidden ? "transparent" : (customStyle.stroke || props.stroke || "#3388ff"),
        weight: isHidden ? 0 : (customStyle.strokeWidth ?? props["stroke-width"] ?? 1.2),
        opacity: isHidden ? 0 : (customStyle.strokeOpacity ?? props["stroke-opacity"] ?? 1),
        fillColor: isHidden ? "transparent" : (customStyle.fill || props.fill || "#3388ff"),
        fillOpacity: isHidden ? 0 : (customStyle.fillOpacity ?? props["fill-opacity"] ?? 0.5),
        interactive: (!isHidden || curMode === "settings") && !activeRouteEdit,
      };
      if (customStyle.dashArray && !isHidden) baseStyle.dashArray = customStyle.dashArray;
      if (geomType === "LineString" || geomType === "MultiLineString") baseStyle.fill = false;
      return baseStyle;
    };

    const layer = L.geoJSON(geojson, {
      style: (feature) => getStyleNow(feature),
      pointToLayer: (feature, latlng) => {
        const featStyle = getStyleNow(feature);
        return L.circleMarker(latlng, {
          radius: 6,
          weight: 16,
          color: "transparent",
          fillColor: featStyle.fillColor || featStyle.color || "#3388ff",
          fillOpacity: featStyle.fillOpacity ?? 0.8,
          interactive: featStyle.interactive,
        });
      },
      onEachFeature: (feature, layer) => {
        layer.on("click", (e) => {
          if (selectingFeatureForRef.current === "alwaysVisible") {
            L.DomEvent.stopPropagation(e);
            const fid = feature.id;
            const ov = overlaysRef.current;
            const config = ov?.routingConfig || {};
            const currentIds = config.alwaysVisibleFeatureIds || [];
            const nextIds = currentIds.includes(fid)
              ? currentIds.filter((id) => id !== fid)
              : [...currentIds, fid];
            onOverlaysChangeRef.current({
              ...ov,
              routingConfig: { ...config, alwaysVisibleFeatureIds: nextIds },
            });
            return;
          }
          const style = getStyleNow(feature);
          if (!style.interactive) return;
          L.DomEvent.stopPropagation(e);
          onFeatureClickRef.current({ type: "geojson", data: feature, latlng: e.latlng });
          map.panTo(e.latlng, { animate: true });
        });

        layer.on("mouseover", () => {
          const style = getStyleNow(feature);
          if (!style.interactive) return;
          layer.setStyle({ weight: 3, fillOpacity: 0.7 });
        });
        layer.on("mouseout", () => {
          layer.setStyle(getStyleNow(feature));
        });

        const geomType = feature.geometry?.type;
        if (geomType === "LineString" || geomType === "MultiLineString") {
          const hitLayer = L.polyline(layer.getLatLngs(), {
            color: "#000",
            weight: 24,
            opacity: 0,
            interactive: true,
          });

          hitLayer.on("click", (e) => {
            if (selectingFeatureForRef.current === "alwaysVisible") {
              L.DomEvent.stopPropagation(e);
              const fid = feature.id;
              const ov = overlaysRef.current;
              const config = ov?.routingConfig || {};
              const currentIds = config.alwaysVisibleFeatureIds || [];
              const nextIds = currentIds.includes(fid)
                ? currentIds.filter((id) => id !== fid)
                : [...currentIds, fid];
              onOverlaysChangeRef.current({
                ...ov,
                routingConfig: { ...config, alwaysVisibleFeatureIds: nextIds },
              });
              return;
            }
            const style = getStyleNow(feature);
            if (!style.interactive) return;
            L.DomEvent.stopPropagation(e);
            onFeatureClickRef.current({ type: "geojson", data: feature, latlng: e.latlng });
            map.panTo(e.latlng, { animate: true });
          });

          hitLayer.on("mouseover", () => {
            const style = getStyleNow(feature);
            if (!style.interactive) return;
            layer.setStyle({ weight: 3, fillOpacity: 0.7 });
          });

          hitLayer.on("mouseout", () => {
            layer.setStyle(getStyleNow(feature));
          });

          hitLayer.addTo(map);
          layer.on("remove", () => {
            map.removeLayer(hitLayer);
          });
        }
      },
    });

    layer.addTo(map);
    geoLayerRef.current = layer;
  }, [geojson, overlays, mode, activeDestinationIds, activeRouteEdit]);

  // Handle map interaction for Box Selection when in alwaysVisible selection mode
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (mode === "settings" && selectingFeatureFor === "alwaysVisible") {
      map.dragging.disable();
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.dragging.enable();
      map.getContainer().style.cursor = "";
    }
  }, [mode, selectingFeatureFor]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || mode !== "settings" || selectingFeatureFor !== "alwaysVisible") return;

    let startLatLng = null;
    let startPoint = null;
    let rect = null;
    let isDragging = false;

    const onMouseDown = (e) => {
      startLatLng = e.latlng;
      startPoint = e.containerPoint;
      isDragging = false;
    };

    const onMouseMove = (e) => {
      if (!startLatLng) return;

      if (!isDragging) {
        const p1 = startPoint;
        const p2 = e.containerPoint;
        const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        if (dist > 5) {
          isDragging = true;
          rect = L.rectangle([startLatLng, startLatLng], {
            color: "#ff9f43",
            weight: 2,
            fillColor: "#ff9f43",
            fillOpacity: 0.2,
            dashArray: "5 5",
            interactive: false,
          }).addTo(map);
        }
      } else if (rect) {
        rect.setBounds(L.latLngBounds(startLatLng, e.latlng));
      }
    };

    const onMouseUp = (e) => {
      if (!startLatLng) return;

      if (isDragging && rect) {
        const bounds = rect.getBounds();

        // Find all features where ALL coordinates are inside the bounds
        const newSelectedIds = [];
        if (geojson?.features) {
          geojson.features.forEach((f) => {
            if (!f.id) return;
            
            let allInside = true;
            let hasCoords = false;

            const checkCoords = (coords) => {
              if (typeof coords[0] === "number") {
                hasCoords = true;
                const latlng = L.latLng(coords[1], coords[0]);
                if (!bounds.contains(latlng)) {
                  allInside = false;
                }
                return;
              }
              coords.forEach(checkCoords);
            };

            if (f.geometry?.coordinates) {
              checkCoords(f.geometry.coordinates);
            }

            if (hasCoords && allInside) {
              newSelectedIds.push(f.id);
            }
          });
        }

        const config = overlays?.routingConfig || {};
        const currentIds = config.alwaysVisibleFeatureIds || [];
        const mergedIds = [...currentIds];
        newSelectedIds.forEach((id) => {
          if (!mergedIds.includes(id)) {
            mergedIds.push(id);
          }
        });

        onOverlaysChange({
          ...overlays,
          routingConfig: {
            ...config,
            alwaysVisibleFeatureIds: mergedIds,
          },
        });

        map.removeLayer(rect);
      }

      rect = null;
      startLatLng = null;
      startPoint = null;
      isDragging = false;
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);

    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      if (rect) {
        map.removeLayer(rect);
      }
    };
  }, [mode, selectingFeatureFor, geojson, overlays, onOverlaysChange]);

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
    const zVal = map.getZoom();

    labels.forEach((label, index) => {
      const scale = getGentleScale(zVal, label.zoomBase || 16);
      const rotationDeg = label.rotation || 0;
      const pointerEventsStyle = activeRouteEdit ? "pointer-events: none;" : "";
      const icon = L.divIcon({
        className: "",
        html: `<div class="map-text-label${mode === "settings" ? " editing" : ""}" data-label-id="${label.id}" data-zoom-base="${label.zoomBase || 16}" data-rotation="${rotationDeg}" style="font-size:${label.fontSize || 14}px;color:${label.color || "#1f2937"};transform:scale(${scale}) rotate(${rotationDeg}deg);${pointerEventsStyle}">${label.text}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker(label.position, {
        icon,
        draggable: mode === "settings" && !activeRouteEdit,
        interactive: !activeRouteEdit,
        zIndexOffset: 1000,
      });

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onFeatureClick({ type: "textLabel", data: label });
      });

      if (mode === "settings" && !activeRouteEdit) {
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
        const rotDeg = label.rotation || 0;
        const el = marker.getElement();
        if (el) {
          const div = el.querySelector(".map-text-label");
          if (div) {
            // Re-read rotation from data attribute in case it was updated by preview
            const liveRot = div.dataset.rotation || rotDeg;
            const liveZoomBase = Number(div.dataset.zoomBase) || (label.zoomBase || 16);
            const liveScale = getGentleScale(z, liveZoomBase);
            div.style.transform = `scale(${liveScale}) rotate(${liveRot}deg)`;
          }
        }
      });
    };

    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [overlays, mode, onFeatureClick, onOverlaysChange, activeRouteEdit]);

  // Render POI Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !overlays) return;

    // Remove old POI markers
    poiMarkersRef.current.forEach((m) => map.removeLayer(m));
    poiMarkersRef.current = [];

    const pois = overlays.poiLabels || [];
    poiLabelsDataRef.current = pois;
    const zVal = map.getZoom();

    pois.forEach((poi) => {
      // 1. Check zoom visibility range
      if (zVal < (poi.labelMinZoom ?? 11) || zVal > (poi.labelMaxZoom ?? 45)) {
        return;
      }

      // 2. Check route visibility association (checked route manual mapping OR geographic proximity mapping)
      if (poi.visibilityMode === "associated") {
        let isVisible = false;

        // Check manual associated route first
        if (poi.associatedRouteId && checkedRouteIds[poi.associatedRouteId]) {
          isVisible = true;
        }

        // Also check proximity to any checked route
        if (!isVisible) {
          const checkedRoutes = [];
          (overlays.routingConfig?.destinations || []).forEach((dest) => {
            (dest.routes || []).forEach((route) => {
              if (checkedRouteIds[route.id]) {
                checkedRoutes.push(route);
              }
            });
          });

          for (const route of checkedRoutes) {
            if (isPoiCloseToRoute(poi.position, route, 0.0015)) {
              isVisible = true;
              break;
            }
          }
        }

        if (mode !== "settings" && !isVisible) {
          return;
        }
      }

      // 3. Compute scale factor (gentle scaling)
      const scale = getGentleScale(zVal, 16);
      const fontSize = poi.labelFontSize || 12;
      const iconSize = poi.iconSize || 40;

      const scaledWidth = iconSize * scale;
      const scaledHeight = iconSize * 1.25 * scale;

      // 4. Define pin color
      let pinColor = poi.color;
      if (!pinColor) {
        if (poi.poiType === "hospital.svg") pinColor = "#ef4444";
        else if (poi.poiType === "school.svg") pinColor = "#3b82f6";
        else if (poi.poiType === "bridge.svg") pinColor = "#10b981";
        else if (poi.poiType === "rest_stop.svg") pinColor = "#f59e0b";
        else pinColor = "#4f46e5";
      }

      // 5. HTML content: Inverted teardrop pin shape with visible icon inside
      // Using SVG <image> element directly in the SVG for reliable rendering
      const markerHtml = `
        <div class="poi-marker-container poi-marker-bounce" style="width: 100%; height: 100%;">
          <div class="poi-label-box" style="position: absolute; bottom: 100%; left: 50%; transform: translate(-50%, -6px); margin-bottom: 0;">
            <div class="poi-label-title" style="font-size: ${fontSize}px;">${poi.name}</div>
            ${poi.address ? `<div class="poi-label-address" style="font-size: ${Math.max(8, fontSize - 2)}px;">${poi.address}</div>` : ""}
          </div>
          <div class="poi-pin-wrapper" style="width: 100%; height: 100%; position: relative;">
            <svg class="poi-pin-svg" viewBox="0 0 48 60" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
              <defs>
                <clipPath id="icon-clip-${poi.id}">
                  <circle cx="24" cy="20" r="12"/>
                </clipPath>
              </defs>
              <path d="M24 4C14.06 4 6 12.06 6 22c0 12 18 34 18 34s18-22 18-34c0-9.94-8.06-18-18-18z" fill="${pinColor}" stroke="#ffffff" stroke-width="2.5"/>
              <circle cx="24" cy="20" r="14" fill="#ffffff"/>
              <image href="${poi.iconUrl}" x="10" y="6" width="28" height="28" clip-path="url(#icon-clip-${poi.id})" preserveAspectRatio="xMidYMid meet"/>
            </svg>
          </div>
        </div>
      `;

      const icon = L.divIcon({
        className: "",
        html: markerHtml,
        iconSize: [scaledWidth, scaledHeight],
        iconAnchor: [scaledWidth / 2, scaledHeight],
      });

      const marker = L.marker(poi.position, {
        icon,
        draggable: mode === "settings" && !activeRouteEdit,
        interactive: !activeRouteEdit,
        zIndexOffset: 1200,
      });

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (mode === "settings") {
          onFeatureClick({ type: "poiLabel", data: poi });
        } else {
          onFeatureClick({
            type: "poiLabel",
            data: { ...poi, isPoiLabel: true },
            latlng: L.latLng(poi.position[0], poi.position[1]),
          });
        }
      });

      if (mode === "settings" && !activeRouteEdit) {
        marker.on("dragend", (e) => {
          const pos = e.target.getLatLng();
          const currentPois = poiLabelsDataRef.current || [];
          const currentPoi = currentPois.find((p) => p.id === poi.id) || poi;
          const newPois = currentPois.map((p) =>
            p.id === poi.id ? { ...currentPoi, position: [pos.lat, pos.lng] } : p
          );
          onOverlaysChange({ ...overlays, poiLabels: newPois });
        });
      }

      marker.addTo(map);
      poiMarkersRef.current.push(marker);
    });

    return () => {
      // Clean up markers is done inside effect loop
    };
  }, [overlays, mode, checkedRouteIds, onFeatureClick, onOverlaysChange, activeRouteEdit, currentZoom]);

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
    const scale = getGentleScale(currentZoom, zb);
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

  // Auto-scale route labels on zoom
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const onZoom = () => {
      const z = map.getZoom();
      const scale = getGentleScale(z, 16);
      const elements = mapRef.current?.querySelectorAll(".route-path-label-box");
      if (elements) {
        elements.forEach((el) => {
          const angle = el.dataset.angle || "0";
          el.style.transform = `translate(-50%, -50%) scale(${scale}) rotate(${angle}deg)`;
        });
      }
    };

    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [mode, overlays, activeRouteSegments, activeRouteEdit]);

  // Coordinate helper functions
  const distSq = (a, b) => Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2);
  const coordsMatch = useCallback((c1, c2) => {
    if (!c1 || !c2 || c1.length !== c2.length) return false;
    const p1S = c1[0], p1E = c1[c1.length - 1];
    const p2S = c2[0], p2E = c2[c2.length - 1];
    return (
      (distSq(p1S, p2S) < 1e-10 && distSq(p1E, p2E) < 1e-10) ||
      (distSq(p1S, p2E) < 1e-10 && distSq(p1E, p2S) < 1e-10)
    );
  }, []);

  // Compute all unique segments from the roadGraph
  const allGraphSegments = useMemo(() => {
    if (!roadGraph || !roadGraph.adj) return [];
    const segments = [];
    const seen = new Set();
    for (const fromStr in roadGraph.adj) {
      const fromNode = parseInt(fromStr, 10);
      roadGraph.adj[fromStr].forEach((edge) => {
        const toNode = edge.to;
        const key = `${Math.min(fromNode, toNode)}-${Math.max(fromNode, toNode)}-${edge.featureId}`;
        if (!seen.has(key)) {
          seen.add(key);
          segments.push({
            key,
            from: fromNode,
            to: toNode,
            featureId: edge.featureId,
            coords: edge.coords,
          });
        }
      });
    }
    return segments;
  }, [roadGraph]);

  // Handle clicking a segment to toggle its selection in activeRouteEdit
  const handleSegmentClick = useCallback(
    (edge) => {
      if (!activeRouteEdit) return;

      const currentSegments = [...(activeRouteEdit.segments || [])];
      const existsIdx = currentSegments.findIndex(
        (seg) => seg.featureId === edge.featureId && coordsMatch(seg.coords, edge.coords)
      );

      let newSegments;
      if (existsIdx > -1) {
        // Remove segment
        newSegments = currentSegments.filter((_, idx) => idx !== existsIdx);
      } else {
        // Add segment
        newSegments = [...currentSegments, {
          featureId: edge.featureId,
          coords: edge.coords,
        }];
      }

      // Reconstruct nodes sequence from start/end points of remaining segments
      const activeNodesSet = new Set();
      if (roadGraph?.junctionNodes) {
        newSegments.forEach((seg) => {
          const startPt = seg.coords[0];
          const endPt = seg.coords[seg.coords.length - 1];
          
          const startNode = roadGraph.junctionNodes.find(n => 
            Math.abs(n.position[0] - startPt[0]) < 1e-6 && 
            Math.abs(n.position[1] - startPt[1]) < 1e-6
          );
          const endNode = roadGraph.junctionNodes.find(n => 
            Math.abs(n.position[0] - endPt[0]) < 1e-6 && 
            Math.abs(n.position[1] - endPt[1]) < 1e-6
          );
          if (startNode) activeNodesSet.add(startNode.idx);
          if (endNode) activeNodesSet.add(endNode.idx);
        });
      }

      onActiveRouteEditChange({
        ...activeRouteEdit,
        nodes: Array.from(activeNodesSet),
        segments: newSegments,
      });
    },
    [activeRouteEdit, roadGraph, onActiveRouteEditChange, coordsMatch]
  );

  // Render clickable graph segments and selected route preview in settings mode
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear old layers
    routeLayersRef.current.forEach((l) => map.removeLayer(l));
    routeLayersRef.current = [];
    nodeMarkersRef.current.forEach((m) => map.removeLayer(m));
    nodeMarkersRef.current = [];
    routeLabelLayersRef.current.forEach((l) => map.removeLayer(l));
    routeLabelLayersRef.current = [];

    // Render segments in settings mode
    if (mode === "settings" && activeRouteEdit) {
      allGraphSegments.forEach((edge) => {
        const selectedIdx = activeRouteEdit.segments?.findIndex(
          (seg) => seg.featureId === edge.featureId && coordsMatch(seg.coords, edge.coords)
        );
        const isSelected = selectedIdx !== -1;

        let routeColor = activeRouteEdit.color || "#ff3366";
        let isDashed = activeRouteEdit.isDashed || false;
        let dashLength = activeRouteEdit.dashLength || 10;
        let dashSpace = activeRouteEdit.dashSpace || 10;
        let routeWeight = activeRouteEdit.weight !== undefined ? activeRouteEdit.weight : 5;

        if (isSelected && activeRouteEdit.editPerSegment) {
          const seg = activeRouteEdit.segments[selectedIdx];
          routeColor = seg.color || activeRouteEdit.color || "#ff3366";
          isDashed = seg.isDashed !== undefined ? seg.isDashed : (activeRouteEdit.isDashed || false);
          dashLength = seg.dashLength || activeRouteEdit.dashLength || 10;
          dashSpace = seg.dashSpace || activeRouteEdit.dashSpace || 10;
          routeWeight = seg.weight !== undefined ? seg.weight : (activeRouteEdit.weight !== undefined ? activeRouteEdit.weight : 5);
        }

        const dashArrayString = isDashed ? `${dashLength}, ${dashSpace}` : null;
        const isCurrentlyStyling = isSelected && activeRouteEdit.editPerSegment && activeRouteEdit.selectedSegmentIdx === selectedIdx;

        // Visible line
        const visiblePoly = L.polyline(edge.coords, {
          color: isSelected ? routeColor : "#94a3b8",
          weight: isCurrentlyStyling ? (routeWeight + 3) : (isSelected ? routeWeight : 3.5),
          opacity: isSelected ? 0.95 : 0.6,
          dashArray: isSelected ? dashArrayString : null,
          interactive: false,
        }).addTo(map);
        routeLayersRef.current.push(visiblePoly);

        // Interactive thick line on top
        const interactivePoly = L.polyline(edge.coords, {
          color: "transparent",
          weight: 24,
          interactive: true,
        }).addTo(map);

        interactivePoly.on("mouseover", () => {
          if (!isSelected) {
            visiblePoly.setStyle({ color: "#2563eb", weight: 5, opacity: 0.9 });
          }
        });
        interactivePoly.on("mouseout", () => {
          if (!isSelected) {
            visiblePoly.setStyle({ color: "#94a3b8", weight: 3.5, opacity: 0.6 });
          }
        });
        interactivePoly.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          handleSegmentClick(edge);
        });

        interactivePoly.addTo(map);
        routeLayersRef.current.push(interactivePoly);
      });

      // Render labels for selected segments in settings mode
      if (activeRouteEdit.segments && activeRouteEdit.segments.length > 0) {
        const scale = getGentleScale(currentZoom, 16);
        // Normalize segments list to have proper properties
        const normalizedSegments = activeRouteEdit.segments.map((seg, idx) => {
          if (activeRouteEdit.editPerSegment) {
            return {
              ...seg,
              labelShow: seg.labelShow !== undefined ? seg.labelShow : false,
              labelText: seg.labelText || seg.title || `Đoạn ${idx + 1}`,
              labelFontSize: seg.labelFontSize || 12,
              labelTextColor: seg.labelTextColor || "#1f2937",
              labelBgColor: seg.labelBgColor || "#ffffff",
              labelBorderColor: seg.labelBorderColor || "#4f46e5",
              labelOpacity: seg.labelOpacity || 0.9,
              labelSpacing: seg.labelSpacing !== undefined ? seg.labelSpacing : 300,
              labelMinZoom: seg.labelMinZoom !== undefined ? seg.labelMinZoom : 11,
              labelMaxZoom: seg.labelMaxZoom !== undefined ? seg.labelMaxZoom : 45,
              labelSingleZoom: seg.labelSingleZoom !== undefined ? seg.labelSingleZoom : 13,
            };
          } else {
            return {
              ...seg,
              labelShow: activeRouteEdit.labelShow !== undefined ? activeRouteEdit.labelShow : false,
              labelText: activeRouteEdit.labelText || activeRouteEdit.title || "Tuyến đường",
              labelFontSize: activeRouteEdit.labelFontSize || 12,
              labelTextColor: activeRouteEdit.labelTextColor || "#1f2937",
              labelBgColor: activeRouteEdit.labelBgColor || "#ffffff",
              labelBorderColor: activeRouteEdit.labelBorderColor || "#4f46e5",
              labelOpacity: activeRouteEdit.labelOpacity || 0.9,
              labelSpacing: activeRouteEdit.labelSpacing !== undefined ? activeRouteEdit.labelSpacing : 300,
              labelMinZoom: activeRouteEdit.labelMinZoom !== undefined ? activeRouteEdit.labelMinZoom : 11,
              labelMaxZoom: activeRouteEdit.labelMaxZoom !== undefined ? activeRouteEdit.labelMaxZoom : 45,
              labelSingleZoom: activeRouteEdit.labelSingleZoom !== undefined ? activeRouteEdit.labelSingleZoom : 13,
            };
          }
        });

        const labelMarkers = getRouteLabelMarkers(normalizedSegments, currentZoom);
        const filteredLabels = filterCollidingLabels(map, labelMarkers, scale);
        filteredLabels.forEach((ld) => {
          const labelMarker = L.marker(ld.latlng, {
            icon: L.divIcon({
              html: `<div class="route-path-label-box" data-angle="${ld.angle}" style="
                font-size: ${ld.fontSize}px;
                color: ${ld.textColor};
                background: ${ld.bgColor};
                border: 1.5px solid ${ld.borderColor};
                opacity: ${ld.opacity};
                padding: 3px 6px;
                border-radius: 4px;
                font-weight: 700;
                white-space: nowrap;
                box-shadow: 0 2px 4px rgba(0,0,0,0.15);
                transform: translate(-50%, -50%) scale(${scale}) rotate(${ld.angle}deg);
                pointer-events: none;
                display: inline-block;
                width: max-content;
              ">${ld.text}</div>`,
              className: "route-label-div-icon",
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
            interactive: false,
          }).addTo(map);
          routeLabelLayersRef.current.push(labelMarker);
        });
      }
    }

    return () => {
      routeLayersRef.current.forEach((l) => map.removeLayer(l));
      routeLayersRef.current = [];
      nodeMarkersRef.current.forEach((m) => map.removeLayer(m));
      nodeMarkersRef.current = [];
      routeLabelLayersRef.current.forEach((l) => map.removeLayer(l));
      routeLabelLayersRef.current = [];
    };
  }, [mode, activeRouteEdit, allGraphSegments, handleSegmentClick, coordsMatch, currentZoom]);

  // Render active destination route segments in View Mode
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear old layers
    viewRouteLayersRef.current.forEach((l) => map.removeLayer(l));
    viewRouteLayersRef.current = [];
    viewRouteLabelLayersRef.current.forEach((l) => map.removeLayer(l));
    viewRouteLabelLayersRef.current = [];

    if (mode === "view" && activeRouteSegments && activeRouteSegments.length > 0) {
      activeRouteSegments.forEach((seg, idx) => {
        const routeColor = seg.color || "#4f46e5";
        const isDashed = seg.isDashed || false;
        const dashLength = seg.dashLength || 10;
        const dashSpace = seg.dashSpace || 10;
        const dashArrayString = isDashed ? `${dashLength}, ${dashSpace}` : null;
        const routeWeight = seg.weight !== undefined ? seg.weight : 5;

        // Draw a sharp premium line for the main GPS path (no glow line to make it crisp)
        const polyline = L.polyline(seg.coords, {
          color: routeColor,
          weight: routeWeight,
          opacity: 1.0,
          dashArray: dashArrayString,
          interactive: false,
        }).addTo(map);
        viewRouteLayersRef.current.push(polyline);

        // Draw an invisible thick hit line for easy interaction
        const hitPolyline = L.polyline(seg.coords, {
          color: "transparent",
          weight: Math.max(24, routeWeight + 10),
          interactive: true,
        }).addTo(map);

        hitPolyline.on("click", (e) => {
          L.DomEvent.stopPropagation(e);

          const title = seg.title || "Lộ trình";
          const description = seg.description || "";
          const images = seg.images || [];

          onFeatureClick({
            type: "routeSegment",
            data: {
              id: `route-seg-${idx}`,
              isRouteSegment: true,
              title,
              description,
              images,
              color: routeColor,
            },
            latlng: e.latlng
          });
        });

        viewRouteLayersRef.current.push(hitPolyline);
      });

      // Group activeRouteSegments by routeId for label positioning
      const routesMap = {};
      activeRouteSegments.forEach((seg) => {
        const rId = seg.routeId || "unknown";
        if (!routesMap[rId]) {
          routesMap[rId] = { segments: [] };
        }
        routesMap[rId].segments.push(seg);
      });

      const scale = getGentleScale(currentZoom, 16);

      // Gather all label candidates across all routes
      let allCandidates = [];
      Object.entries(routesMap).forEach(([rId, rData]) => {
        const routeMarkers = getRouteLabelMarkers(rData.segments, currentZoom);
        allCandidates = [...allCandidates, ...routeMarkers];
      });

      // Filter colliding labels globally to prevent overlapping
      const filteredLabels = filterCollidingLabels(map, allCandidates, scale);

      filteredLabels.forEach((ld) => {
        const labelMarker = L.marker(ld.latlng, {
          icon: L.divIcon({
            html: `<div class="route-path-label-box" data-angle="${ld.angle}" style="
              font-size: ${ld.fontSize}px;
              color: ${ld.textColor};
              background: ${ld.bgColor};
              border: 1.5px solid ${ld.borderColor};
              opacity: ${ld.opacity};
              padding: 3px 6px;
              border-radius: 4px;
              font-weight: 700;
              white-space: nowrap;
              box-shadow: 0 2px 4px rgba(0,0,0,0.15);
              transform: translate(-50%, -50%) scale(${scale}) rotate(${ld.angle}deg);
              pointer-events: none;
              display: inline-block;
              width: max-content;
            ">${ld.text}</div>`,
            className: "route-label-div-icon",
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: false,
        }).addTo(map);
        viewRouteLabelLayersRef.current.push(labelMarker);
      });
    }

    return () => {
      viewRouteLayersRef.current.forEach((l) => map.removeLayer(l));
      viewRouteLayersRef.current = [];
      viewRouteLabelLayersRef.current.forEach((l) => map.removeLayer(l));
      viewRouteLabelLayersRef.current = [];
    };
  }, [mode, activeRouteSegments, geojson, overlays, activeDestinationIds, onFeatureClick, currentZoom]);

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
      
      let customColor = "#4361ee";
      if (feature.isRouteSegment) {
        customColor = feature.color || "#4f46e5";
      } else if (feature.isPoiLabel) {
        customColor = "#10b981"; // POI pin custom theme color
      } else {
        customColor = overlays?.myMapsStyles?.[fid]?.stroke || feature.properties?.stroke || "#4361ee";
      }

      if (!infoBoxMarkersRef.current[fid]) {
        const container = document.createElement("div");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        const root = createRoot(container);

        let displayInfo;
        if (feature.isRouteSegment) {
          displayInfo = {
            id: fid,
            title: feature.title || "Lộ trình",
            description: feature.description || "",
            images: feature.images || [],
            originalProps: {},
          };
        } else if (feature.isPoiLabel) {
          displayInfo = {
            id: fid,
            title: feature.name || "Địa điểm",
            description: feature.description || feature.address || "",
            images: feature.images || [],
            originalProps: {},
          };
        } else {
          const props = feature.properties || {};
          const info = overlays?.objectInfo?.[fid] || {};
          displayInfo = {
            id: fid,
            title: info.title || props.name || props.description || fid,
            description: info.description || "",
            images: info.images || [],
            originalProps: props,
          };
        }

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
      routeLayersRef.current.forEach((layer) => {
        map?.removeLayer(layer);
      });
      nodeMarkersRef.current.forEach((marker) => {
        map?.removeLayer(marker);
      });
      viewRouteLayersRef.current.forEach((layer) => {
        map?.removeLayer(layer);
      });
      poiMarkersRef.current.forEach((marker) => {
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

    if (selectedFeature.type === "routing") {
      return {
        id: "routing",
        type: "routing",
      };
    }

    if (selectedFeature.type === "poiLabel") {
      const latestPoi = overlays?.poiLabels?.find(
        (p) => p.id === selectedFeature.data.id
      ) || selectedFeature.data;
      return {
        id: latestPoi.id,
        type: "poiLabel",
        data: latestPoi,
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
          activeRouteEdit={activeRouteEdit}
          onActiveRouteEditChange={onActiveRouteEditChange}
          geojson={geojson}
          selectingFeatureFor={selectingFeatureFor}
          onSelectingFeatureForChange={onSelectingFeatureForChange}
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

/* ============================
   Helper: Calculate Evenly Spaced Coordinates along Path
   ============================ */
function getPointsAlongPath(coords, intervalMeters) {
  if (!coords || coords.length < 2) return [];
  
  // Convert coords [lat, lng] to L.LatLng
  const latLngs = coords.map(c => L.latLng(c[0], c[1]));
  
  const points = [];
  const segDistances = [];
  
  for (let i = 0; i < latLngs.length - 1; i++) {
    const d = latLngs[i].distanceTo(latLngs[i+1]);
    segDistances.push(d);
  }
  
  const totalDistance = segDistances.reduce((a, b) => a + b, 0);
  if (totalDistance === 0) return [];

  // Helper to calculate segment screen angle in degrees (conformal Mercator projection)
  const getAngle = (p1, p2) => {
    const latMid = (p1.lat + p2.lat) / 2;
    const lngScale = Math.cos(latMid * Math.PI / 180);
    const dLat = p2.lat - p1.lat;
    const dLng = (p2.lng - p1.lng) * lngScale;
    let angleRad = Math.atan2(-dLat, dLng); // screen y is downward, so negate dLat
    let deg = angleRad * 180 / Math.PI;
    
    // Readability: keep label upright (between -90 and 90 degrees)
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    return deg;
  };

  // Safe minimum spacing to prevent infinite loops or performance freeze
  const spacing = Math.max(10, intervalMeters);
  
  let numLabels;
  if (intervalMeters <= 0) {
    numLabels = 1;
  } else {
    numLabels = Math.min(200, Math.max(1, Math.floor(totalDistance / spacing)));
  }

  // Calculate symmetric targets
  const targetDistances = [];
  if (numLabels === 1) {
    targetDistances.push(totalDistance / 2);
  } else {
    const startPadding = (totalDistance - (numLabels - 1) * spacing) / 2;
    for (let i = 0; i < numLabels; i++) {
      targetDistances.push(startPadding + i * spacing);
    }
  }

  // Generate points for each target distance
  targetDistances.forEach((targetDist) => {
    let currDist = 0;
    for (let i = 0; i < segDistances.length; i++) {
      const segLen = segDistances[i];
      if (currDist + segLen >= targetDist) {
        const ratio = segLen > 0 ? (targetDist - currDist) / segLen : 0;
        const p1 = latLngs[i];
        const p2 = latLngs[i + 1];
        const lat = p1.lat + (p2.lat - p1.lat) * ratio;
        const lng = p1.lng + (p2.lng - p1.lng) * ratio;
        const angle = getAngle(p1, p2);
        points.push({ latlng: [lat, lng], angle });
        return;
      }
      currDist += segLen;
    }
    // Fallback in case of floating point precision
    const lastIdx = latLngs.length - 1;
    const p1 = latLngs[lastIdx - 1] || latLngs[lastIdx];
    const p2 = latLngs[lastIdx];
    const angle = getAngle(p1, p2);
    points.push({ latlng: [p2.lat, p2.lng], angle });
  });

  return points;
}

/* ============================
   Helper: Merge unordered segments into contiguous paths to avoid jumps
   ============================ */
function mergeSegmentsToPaths(segments) {
  if (!segments || segments.length === 0) return [];
  
  // Make a copy of coordinates of each segment
  const remaining = segments
    .filter(seg => seg.coords && seg.coords.length > 0)
    .map(seg => [...seg.coords]);
    
  if (remaining.length === 0) return [];
  
  const paths = [];
  
  while (remaining.length > 0) {
    let currentPath = remaining.shift();
    let grew = true;
    
    while (grew) {
      grew = false;
      const startPt = currentPath[0];
      const endPt = currentPath[currentPath.length - 1];
      
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const segStart = seg[0];
        const segEnd = seg[seg.length - 1];
        
        const isNear = (p1, p2) => Math.abs(p1[0] - p2[0]) < 1e-6 && Math.abs(p1[1] - p2[1]) < 1e-6;
        
        if (isNear(endPt, segStart)) {
          currentPath.push(...seg.slice(1));
          remaining.splice(i, 1);
          grew = true;
          break;
        } else if (isNear(endPt, segEnd)) {
          const reversedSeg = [...seg].reverse();
          currentPath.push(...reversedSeg.slice(1));
          remaining.splice(i, 1);
          grew = true;
          break;
        } else if (isNear(startPt, segEnd)) {
          currentPath.unshift(...seg.slice(0, -1));
          remaining.splice(i, 1);
          grew = true;
          break;
        } else if (isNear(startPt, segStart)) {
          const reversedSeg = [...seg].reverse();
          currentPath.unshift(...reversedSeg.slice(0, -1));
          remaining.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    
    paths.push(currentPath);
  }
  
  return paths;
}

/* ============================
   Helper: Calculate Evenly Spaced Route Labels with Zoom Rules
   ============================ */
function getRouteLabelMarkers(segments, currentZoom) {
  const markers = [];
  if (!segments || segments.length === 0) return markers;

  // Group by labelText (fallback to title or "Tuyến đường")
  const groups = {};
  segments.forEach((seg) => {
    if (!seg.labelShow) return;
    const text = seg.labelText || seg.title || "Tuyến đường";
    if (!groups[text]) groups[text] = [];
    groups[text].push(seg);
  });

  const zoomFactor = Math.pow(2, Math.max(-2, Math.min(5, 16 - currentZoom)));

  Object.entries(groups).forEach(([text, groupSegs]) => {
    const paths = mergeSegmentsToPaths(groupSegs);
    if (paths.length === 0) return;

    // Use styling from the first segment in the group
    const firstSeg = groupSegs[0];
    const fontSize = firstSeg.labelFontSize || 12;
    const textColor = firstSeg.labelTextColor || "#1f2937";
    const bgColor = firstSeg.labelBgColor || "#ffffff";
    const borderColor = firstSeg.labelBorderColor || "#4f46e5";
    const opacity = firstSeg.labelOpacity || 0.9;
    const spacing = firstSeg.labelSpacing !== undefined ? firstSeg.labelSpacing : 300;

    // Zoom thresholds configured per-route/segment
    const labelMinZoom = firstSeg.labelMinZoom !== undefined ? firstSeg.labelMinZoom : 11;
    const labelMaxZoom = firstSeg.labelMaxZoom !== undefined ? firstSeg.labelMaxZoom : 45;
    const labelSingleZoom = firstSeg.labelSingleZoom !== undefined ? firstSeg.labelSingleZoom : 13;

    // Check visibility within user-configured zoom range
    if (currentZoom < labelMinZoom || currentZoom > labelMaxZoom) return;

    if (currentZoom <= labelSingleZoom) {
      // Zoom <= labelSingleZoom: Show exactly 1 label for the entire route (the longest continuous path)
      let longestPath = paths[0];
      let maxLen = 0;
      paths.forEach((p) => {
        if (p.length > maxLen) {
          maxLen = p.length;
          longestPath = p;
        }
      });
      // spacing = 0 to get exactly 1 point in the center of the longest path
      const points = getPointsAlongPath(longestPath, 0);
      points.forEach((pt) => {
        markers.push({
          latlng: pt.latlng,
          angle: pt.angle,
          text,
          fontSize,
          textColor,
          bgColor,
          borderColor,
          opacity,
        });
      });
    } else {
      // Zoom > labelSingleZoom: Evenly spaced labels
      const dynamicSpacing = spacing * zoomFactor;
      paths.forEach((path) => {
        const points = getPointsAlongPath(path, dynamicSpacing);
        points.forEach((pt) => {
          markers.push({
            latlng: pt.latlng,
            angle: pt.angle,
            text,
            fontSize,
            textColor,
            bgColor,
            borderColor,
            opacity,
          });
        });
      });
    }
  });

  return markers;
}

/* ============================
   Helper: Filter labels that collide in screen space (overlap prevention)
   ============================ */
function filterCollidingLabels(map, candidates, scale) {
  if (!map || !candidates || candidates.length === 0) return [];

  const acceptedBoxes = [];
  const filtered = [];

  const intersects = (b1, b2) => {
    return !(
      b1.right < b2.left ||
      b1.left > b2.right ||
      b1.bottom < b2.top ||
      b1.top > b2.bottom
    );
  };

  candidates.forEach((ld) => {
    // Convert geographic coordinate to container pixel point
    const point = map.latLngToContainerPoint(ld.latlng);
    
    // Approximate size of the label box in pixels
    // Character width is roughly 0.62 * font-size
    const charWidth = ld.fontSize * 0.62;
    const paddingX = 16;
    const paddingY = 8;
    const rawWidth = ld.text.length * charWidth + paddingX;
    const rawHeight = ld.fontSize * 1.4 + paddingY;
    
    const width = rawWidth * scale;
    const height = rawHeight * scale;
    
    // Bounding box with extra safety margin (25px horizontal, 15px vertical)
    const box = {
      left: point.x - width / 2 - 25,
      right: point.x + width / 2 + 25,
      top: point.y - height / 2 - 15,
      bottom: point.y + height / 2 + 15,
    };

    let collision = false;
    for (const accepted of acceptedBoxes) {
      if (intersects(box, accepted)) {
        collision = true;
        break;
      }
    }

    if (!collision) {
      acceptedBoxes.push(box);
      filtered.push(ld);
    }
  });

  return filtered;
}
