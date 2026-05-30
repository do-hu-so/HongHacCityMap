"use client";

import { useState } from "react";

export default function LoginModal({ onLogin, onClose }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password }),
      });
      const data = await res.json();
      if (data.success) {
        onLogin(true);
      } else {
        setError(data.error || "Sai tài khoản hoặc mật khẩu");
      }
    } catch {
      setError("Lỗi kết nối");
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>🔐 Đăng nhập</h2>
        <p>Nhập tài khoản để vào chế độ cài đặt</p>
        <form onSubmit={handleSubmit}>
          <div className="settings-field">
            <label>Tài khoản</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="Nhập ID"
              autoFocus
            />
          </div>
          <div className="settings-field">
            <label>Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu"
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading}
          >
            {loading ? "Đang xác thực..." : "Đăng nhập"}
          </button>
        </form>
      </div>
    </div>
  );
}
