"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useMemo } from "react";
import LoginModal from "../components/LoginModal";
import { getFeatureCenter, buildRoadGraph } from "../components/routing-utils";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

export default function Home() {
  const [mode, setMode] = useState("view"); // "view" | "settings"
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [geojson, setGeojson] = useState(null);
  const [overlays, setOverlays] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [openBoxes, setOpenBoxes] = useState({}); // { [featureId]: { feature, latlng } }
  const [saveMsg, setSaveMsg] = useState("");
  const [addingTextLabel, setAddingTextLabel] = useState(false);
  const [addingPoiLabel, setAddingPoiLabel] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Routing and Navigation States
  const [activeRouteEdit, setActiveRouteEdit] = useState(null);
  const [activeDestinationIds, setActiveDestinationIds] = useState([]);
  const [checkedRouteIds, setCheckedRouteIds] = useState({});
  const [selectingFeatureFor, setSelectingFeatureFor] = useState(null); // "start" | "dest-[ID]"

  // Build road graph once from geojson (expensive computation)
  const roadGraph = useMemo(() => {
    if (!geojson) return null;
    return buildRoadGraph(geojson);
  }, [geojson]);

  // Sync fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsElement =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;
      setIsFullscreen(!!fsElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const fsElement =
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement;

    if (!fsElement) {
      const element = document.documentElement;
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
      } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }, []);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setSaveMsg("Đang làm mới dữ liệu...");
    }
    try {
      const t = Date.now();
      const [geo, ovl] = await Promise.all([
        fetch(`/data/map-cache.geojson?t=${t}`).then((r) => r.json()),
        fetch(`/api/overlays?t=${t}`).then((r) => r.json()),
      ]);
      setGeojson(geo);
      setOverlays(ovl);
      if (isRefresh) {
        setSaveMsg("Đã cập nhật dữ liệu mới nhất!");
        setTimeout(() => setSaveMsg(""), 2000);
      }
    } catch (err) {
      console.error(err);
      if (isRefresh) {
        setSaveMsg("Lỗi tải dữ liệu");
        setTimeout(() => setSaveMsg(""), 3000);
      }
    }
  }, []);

  // Load data
  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefreshData = useCallback(() => {
    loadData(true);
  }, [loadData]);

  const handleModeSwitch = useCallback(
    (newMode) => {
      if (newMode === "settings" && !isAuthenticated) {
        setShowLogin(true);
        return;
      }
      setMode(newMode);
      setSelectedFeature(null);
      setOpenBoxes({});
      setAddingTextLabel(false);
      setAddingPoiLabel(false);
      
      // Clear routing states
      setActiveRouteEdit(null);
      setSelectingFeatureFor(null);
      setActiveDestinationIds([]);
      setCheckedRouteIds({});
    },
    [isAuthenticated]
  );

  const handleLogin = useCallback((success) => {
    if (success) {
      setIsAuthenticated(true);
      setShowLogin(false);
      setMode("settings");
    }
  }, []);

  const handleSaveOverlays = useCallback(
    async (newOverlays) => {
      setOverlays(newOverlays);
      try {
        const res = await fetch("/api/overlays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newOverlays),
        });
        if (res.ok) {
          setSaveMsg("Đã lưu!");
          setTimeout(() => setSaveMsg(""), 2000);
        } else {
          setSaveMsg("Lỗi lưu dữ liệu");
          setTimeout(() => setSaveMsg(""), 3000);
        }
      } catch {
        setSaveMsg("Lỗi kết nối");
        setTimeout(() => setSaveMsg(""), 3000);
      }
    },
    []
  );

  const handleFeatureClick = useCallback((feature) => {
    if (selectingFeatureFor) {
      if (selectingFeatureFor === "alwaysVisible") {
        return; // Handled internally by MapView
      }
      const fid = feature.data.id;
      const newConfig = { ...(overlays?.routingConfig || { startFeatureId: "", destinations: [] }) };
      
      if (selectingFeatureFor === "start") {
        newConfig.startFeatureId = fid;
      } else if (selectingFeatureFor.startsWith("dest-")) {
        const destId = selectingFeatureFor.substring(5);
        newConfig.destinations = (newConfig.destinations || []).map(d =>
          d.id === destId ? { ...d, featureId: fid } : d
        );
      }
      
      handleSaveOverlays({ ...overlays, routingConfig: newConfig });
      setSelectingFeatureFor(null);
      return;
    }

    if (mode === "settings") {
      setSelectedFeature(feature);
    } else {
      if (feature.type === "geojson" || feature.type === "routeSegment" || feature.type === "poiLabel") {
        const fid = feature.data.id;
        setOpenBoxes((prev) => {
          const next = { ...prev };
          if (next[fid]) {
            delete next[fid];
          } else {
            next[fid] = {
              feature: feature.data,
              latlng: feature.latlng,
            };
          }
          return next;
        });
      }
    }
  }, [mode, selectingFeatureFor, overlays, handleSaveOverlays]);

  const handleAddTextLabel = useCallback(
    (latlng) => {
      if (!overlays) return;
      const newLabel = {
        id: `label-${Date.now()}`,
        text: "Nhập chữ...",
        position: [latlng.lat, latlng.lng],
        fontSize: 14,
        zoomBase: 16,
        color: "#1f2937",
        scaleWithZoom: true,
      };
      const newOverlays = {
        ...overlays,
        textLabels: [...(overlays.textLabels || []), newLabel],
      };
      handleSaveOverlays(newOverlays);
      setAddingTextLabel(false);
      setSelectedFeature({ type: "textLabel", data: newLabel });
    },
    [overlays, handleSaveOverlays]
  );

  const handleAddPoiLabel = useCallback(
    async (latlng, associatedRouteId = "", visibilityMode = "always") => {
      if (!overlays) return;
      // Copy default icon to public/icons/ via POST API
      let defaultIconUrl = "/icons/bridge.svg";
      try {
        const res = await fetch("/api/icons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: "bridge.svg" }),
        });
        const data = await res.json();
        if (data.success) {
          defaultIconUrl = data.url;
        }
      } catch (e) {
        console.error("Failed to copy default icon:", e);
      }

      const newPoi = {
        id: `poi-${Date.now()}`,
        name: "Địa điểm mới",
        address: "Mô tả địa chỉ...",
        position: [latlng.lat, latlng.lng],
        poiType: "bridge.svg",
        iconUrl: defaultIconUrl,
        visibilityMode,
        associatedRouteId,
        labelMinZoom: 11,
        labelMaxZoom: 45,
        labelFontSize: 12,
        iconSize: 40,
      };
      const newOverlays = {
        ...overlays,
        poiLabels: [...(overlays.poiLabels || []), newPoi],
      };
      handleSaveOverlays(newOverlays);
      setAddingPoiLabel(false);
      setSelectedFeature({ type: "poiLabel", data: newPoi });
    },
    [overlays, handleSaveOverlays]
  );

  const handleCloseBox = useCallback((fid) => {
    setOpenBoxes((prev) => {
      if (!prev[fid]) return prev;
      const next = { ...prev };
      delete next[fid];
      return next;
    });
  }, []);

  const handleTriggerInfoBox = useCallback((fid, latlng) => {
    setOpenBoxes((prev) => {
      const lat = typeof latlng.lat === "number" ? latlng.lat : latlng[0];
      const lng = typeof latlng.lng === "number" ? latlng.lng : latlng[1];
      
      if (prev[fid]) {
        const prevLat = typeof prev[fid].latlng.lat === "number" ? prev[fid].latlng.lat : prev[fid].latlng[0];
        const prevLng = typeof prev[fid].latlng.lng === "number" ? prev[fid].latlng.lng : prev[fid].latlng[1];
        if (Math.abs(prevLat - lat) < 1e-9 && Math.abs(prevLng - lng) < 1e-9) {
          return prev;
        }
      }
      return {
        ...prev,
        [fid]: {
          feature: geojson.features.find((f) => f.id === fid),
          latlng,
        },
      };
    });
  }, [geojson]);

  const handleDestinationToggle = useCallback((destId, isChecked) => {
    const dest = overlays?.routingConfig?.destinations?.find((d) => d.id === destId);
    if (!dest) return;

    setActiveDestinationIds((prev) => {
      if (isChecked) {
        if (!prev.includes(destId)) return [...prev, destId];
      } else {
        return prev.filter((id) => id !== destId);
      }
      return prev;
    });

    // Toggle routes
    const routeIds = dest.routes?.map((r) => r.id) || [];
    setCheckedRouteIds((prev) => {
      const next = { ...prev };
      routeIds.forEach((rid) => {
        if (isChecked) {
          next[rid] = true;
        } else {
          delete next[rid];
        }
      });
      return next;
    });

    // Handle InfoBox popup cleanup when deselected
    if (!isChecked && dest.featureId) {
      setOpenBoxes((prev) => {
        const next = { ...prev };
        delete next[dest.featureId];
        return next;
      });
    }
  }, [overlays]);

  const handleRouteToggle = useCallback((routeId, isChecked) => {
    setCheckedRouteIds((prev) => {
      const next = { ...prev };
      if (isChecked) {
        next[routeId] = true;
      } else {
        next[routeId] = false;
      }
      return next;
    });
  }, []);

  if (!geojson || !overlays) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6c757d",
          fontSize: "14px",
        }}
      >
        Đang tải bản đồ...
      </div>
    );
  }

  return (
    <div className={`map-wrapper${addingTextLabel ? " adding-text-label" : ""}${selectingFeatureFor ? " selecting-location" : ""}`}>
      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button
          className={mode === "view" ? "active" : ""}
          onClick={() => handleModeSwitch("view")}
        >
          👁 Xem
        </button>
        <button
          className={mode === "settings" ? "active" : ""}
          onClick={() => handleModeSwitch("settings")}
        >
          ⚙ Cài đặt
        </button>
        <button
          className="refresh-btn"
          onClick={handleRefreshData}
          title="Làm mới dữ liệu từ máy chủ (bỏ qua cache)"
        >
          🔄 Làm mới
        </button>
        <button
          className="fullscreen-btn"
          onClick={toggleFullscreen}
          title="Bật/Tắt chế độ toàn màn hình"
        >
          {isFullscreen ? "🗗 Thu nhỏ" : "⛶ Toàn màn hình"}
        </button>
      </div>

      {/* Map */}
      <MapView
        geojson={geojson}
        overlays={overlays}
        mode={mode}
        selectedFeature={selectedFeature}
        onFeatureClick={handleFeatureClick}
        onOverlaysChange={handleSaveOverlays}
        addingTextLabel={addingTextLabel}
        onAddTextLabel={handleAddTextLabel}
        addingPoiLabel={addingPoiLabel}
        onAddPoiLabel={handleAddPoiLabel}
        openBoxes={openBoxes}
        onCloseBox={handleCloseBox}
        activeRouteEdit={activeRouteEdit}
        onActiveRouteEditChange={setActiveRouteEdit}
        activeDestinationIds={activeDestinationIds}
        checkedRouteIds={checkedRouteIds}
        onTriggerInfoBox={handleTriggerInfoBox}
        selectingFeatureFor={selectingFeatureFor}
        onSelectingFeatureForChange={setSelectingFeatureFor}
        roadGraph={roadGraph}
      />

      {/* Floating Glassmorphism Navigation UI (View Mode Only) */}
      {mode === "view" && overlays?.routingConfig?.destinations && overlays.routingConfig.destinations.length > 0 && (
        <div className="glass-navigation-panel">
          <div className="glass-nav-header">
            <h3>🧭 Dẫn đường đến</h3>
          </div>
          <div className="glass-nav-body">
            <div className="glass-nav-destinations-list" style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "280px", overflowY: "auto", paddingRight: "4px" }}>
              {overlays.routingConfig.destinations.map((d) => {
                const isChecked = activeDestinationIds.includes(d.id);
                const routes = d.routes || [];
                return (
                  <div key={d.id} className="glass-nav-destination-item" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label className="glass-checkbox-label" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", fontWeight: "600", cursor: "pointer", color: "var(--text-primary)" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => handleDestinationToggle(d.id, e.target.checked)}
                      />
                      <span>{d.name}</span>
                    </label>
                    
                    {isChecked && routes.length > 0 && (
                      <div className="glass-nav-routes-list" style={{ paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px", borderLeft: "1.5px dashed var(--border)", marginLeft: "6px" }}>
                        {routes.map((r) => {
                          const isRouteChecked = !!checkedRouteIds[r.id];
                          return (
                            <label key={r.id} className="glass-checkbox-label" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", cursor: "pointer", opacity: isRouteChecked ? 1 : 0.6 }}>
                              <input
                                type="checkbox"
                                checked={isRouteChecked}
                                onChange={(e) => handleRouteToggle(r.id, e.target.checked)}
                              />
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: r.color || "#4f46e5", display: "inline-block" }}></span>
                                {r.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Settings Toolbar */}
      {mode === "settings" && (
        <div className="settings-toolbar">
          <button
            className={`toolbar-btn${addingTextLabel ? " active" : ""}`}
            onClick={() => {
              setAddingTextLabel(!addingTextLabel);
              setAddingPoiLabel(false);
              setSelectedFeature(null);
            }}
          >
            ✏️ Thêm chữ
          </button>

          <button
            className={`toolbar-btn${addingPoiLabel ? " active" : ""}`}
            onClick={() => {
              setAddingPoiLabel(!addingPoiLabel);
              setAddingTextLabel(false);
              setSelectedFeature(null);
            }}
          >
            📍 Thêm icon
          </button>
          
          <button
            className={`toolbar-btn${selectedFeature?.type === "routing" ? " active" : ""}`}
            onClick={() => {
              setAddingTextLabel(false);
              setAddingPoiLabel(false);
              setSelectedFeature({ type: "routing" });
            }}
          >
            🛣️ Quản lý Tuyến đường
          </button>
        </div>
      )}

      {/* Save indicator */}
      {saveMsg && <div className="save-indicator">{saveMsg}</div>}

      {/* Login Modal */}
      {showLogin && (
        <LoginModal
          onLogin={handleLogin}
          onClose={() => setShowLogin(false)}
        />
      )}
    </div>
  );
}
