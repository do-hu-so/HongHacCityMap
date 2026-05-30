"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export default function ImageLightbox({ images = [], startIndex = 0, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const thumbnailTrackRef = useRef(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  const handleTouchStart = (e) => {
    touchStartX.current = e.targetTouches[0].clientX;
    touchEndX.current = e.targetTouches[0].clientX; // Initialize touchEnd to avoid accidental swipe triggers
  };

  const handleTouchMove = (e) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    const threshold = 50; // Minimum swipe distance in px
    const distance = touchStartX.current - touchEndX.current;

    if (distance > threshold) {
      handleNext();
    } else if (distance < -threshold) {
      handlePrev();
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "ArrowLeft") handlePrev();
      else if (e.key === "ArrowRight") handleNext();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePrev, handleNext, onClose]);

  // Center active thumbnail in the track
  useEffect(() => {
    if (!thumbnailTrackRef.current) return;
    const activeThumb = thumbnailTrackRef.current.children[currentIndex];
    if (activeThumb) {
      activeThumb.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [currentIndex]);

  if (!images.length) return null;

  const currentImage = images[currentIndex];

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      {/* Lightbox Main Container */}
      <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
        {/* Header: Title and Close button */}
        <div className="lightbox-header">
          <div className="lightbox-counter">
            {currentIndex + 1} / {images.length}
          </div>
          {currentImage.caption && (
            <div className="lightbox-caption">{currentImage.caption}</div>
          )}
          <button className="lightbox-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Navigation Arrows */}
        <button className="lightbox-arrow lightbox-arrow-left" onClick={handlePrev}>
          ‹
        </button>
        <button className="lightbox-arrow lightbox-arrow-right" onClick={handleNext}>
          ›
        </button>

        {/* Active Image */}
        <div
          className="lightbox-content"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ touchAction: "none" }}
        >
          <img
            key={currentIndex}
            src={currentImage.src}
            alt={currentImage.caption || "Image"}
            className="lightbox-image"
          />
        </div>

        {/* Thumbnail Scroll Track / Carousel (Thanh trượt qua lại) */}
        <div className="lightbox-footer">
          <div className="lightbox-thumbnail-track" ref={thumbnailTrackRef}>
            {images.map((img, idx) => (
              <div
                key={idx}
                className={`lightbox-thumbnail-item${idx === currentIndex ? " active" : ""}`}
                onClick={() => setCurrentIndex(idx)}
              >
                <img src={img.src} alt={img.caption || ""} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
