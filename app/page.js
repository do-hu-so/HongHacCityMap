"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import LoginModal from "../components/LoginModal";

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
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const handleFeatureClick = useCallback((feature) => {
    if (mode === "settings") {
      setSelectedFeature(feature);
    } else {
      if (feature.type === "geojson") {
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
      } else if (feature.type === "textLabel") {
        // Text labels don't show custom info boxes in view mode by default,
        // but we can toggle them if they have info or just ignore.
      }
    }
  }, [mode]);

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
    <div className={`map-wrapper${addingTextLabel ? " adding-text-label" : ""}`}>
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
        openBoxes={openBoxes}
        onCloseBox={(fid) =>
          setOpenBoxes((prev) => {
            const next = { ...prev };
            delete next[fid];
            return next;
          })
        }
      />

      {/* Settings Toolbar */}
      {mode === "settings" && (
        <div className="settings-toolbar">
          <button
            className={`toolbar-btn${addingTextLabel ? " active" : ""}`}
            onClick={() => setAddingTextLabel(!addingTextLabel)}
          >
            ✏️ Thêm chữ
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
