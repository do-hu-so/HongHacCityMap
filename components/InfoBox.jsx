"use client";

export default function InfoBox({ info, onClose }) {
  if (!info) return null;

  return (
    <div className="info-box-overlay">
      <div className="info-box">
        <div className="info-box-header">
          <h3>{info.title}</h3>
          <button className="info-box-close" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>
        <div className="info-box-body">
          {/* Description with line breaks preserved */}
          {info.description && (
            <div className="info-box-description">{info.description}</div>
          )}

          {/* Images with captions */}
          {info.images && info.images.length > 0 && (
            <div>
              {info.images.map((img, idx) => (
                <div key={idx} className="info-box-image-item">
                  <img
                    src={img.src}
                    alt={img.caption || `Ảnh ${idx + 1}`}
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                  {img.caption && (
                    <div className="info-box-image-caption">{img.caption}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Show category if no custom description */}
          {!info.description && info.originalProps?.category && (
            <div className="info-box-description" style={{ color: "#adb5bd" }}>
              {info.originalProps.category}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
