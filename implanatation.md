# Tài Liệu Kỹ Thuật — Dự Án Bản Đồ HongHacCityMap

Dự án bản đồ tương tác xây dựng bằng **Next.js + Leaflet**, deploy trên **Vercel**, dữ liệu bản đồ lấy từ **Google My Maps** (file KML). Người dùng xem bản đồ và click vào đối tượng để xem thông tin. Quản trị viên đăng nhập để chỉnh sửa chú thích, ảnh, style và text label trực tiếp trên web.

---

## Cấu trúc thư mục

```
HongHacCityMap/
├── app/
│   ├── layout.js              # Layout gốc, load font Inter + Leaflet CSS
│   ├── page.js                # Trang chính, quản lý state toàn bộ app
│   ├── globals.css            # Toàn bộ CSS (design system, responsive, lightbox...)
│   └── api/
│       ├── auth/route.js      # API đăng nhập (POST, hardcoded credentials)
│       ├── images/route.js    # API danh sách + copy ảnh local vào public/
│       └── overlays/
│           ├── route.js               # API GET/POST overlays (Vercel Blob + local fallback)
│           └── initial-overlays.json  # Dữ liệu overlay đóng gói khi deploy (được tạo bởi convert script)
├── components/
│   ├── MapView.jsx            # Component bản đồ chính (Leaflet, GeoJSON, text labels, info boxes)
│   ├── SettingsPanel.jsx      # Panel chỉnh sửa đối tượng + text label (chế độ cài đặt)
│   ├── ImageLightbox.jsx      # Trình xem ảnh toàn màn hình (gallery)
│   ├── LoginModal.jsx         # Modal đăng nhập quản trị
│   └── InfoBox.jsx            # (Component phụ)
├── scripts/
│   ├── convert-kml.mjs        # Script chuyển KML → GeoJSON + merge overlays
│   └── convert-config.json    # Cấu hình đường dẫn + URL deploy Vercel
├── map/
│   └── HongHacCiTY.kml        # File KML gốc từ Google My Maps
├── public/
│   ├── data/
│   │   ├── map-cache.geojson  # GeoJSON đã convert (được tạo bởi convert script)
│   │   ├── overlays.json      # Overlay data local (text labels, object info, styles)
│   │   └── backup/            # Backup tự động khi chạy convert
│   └── images/                # Ảnh local đã copy vào public
└── image/                     # Thư mục ảnh gốc (dùng trong chế độ cài đặt)
```

---

## Luồng dữ liệu (Data Flow)

### 1. Từ Google My Maps đến bản đồ web

```
Google My Maps → Export KML → map/HongHacCiTY.kml
                                    ↓
                            npm run convert
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
        public/data/          public/data/     app/api/overlays/
       map-cache.geojson     overlays.json    initial-overlays.json
                    ↓               ↓               ↓
                    └───────── git push ────────────┘
                                    ↓
                            Vercel Redeploy
                                    ↓
                    GET /api/overlays phát hiện
                    _convertedAt mới → đồng bộ
                    vào Vercel Blob
```

### 2. Khi người dùng chỉnh sửa trên web

```
Người dùng chỉnh sửa trên web (cài đặt)
            ↓
    POST /api/overlays
            ↓
    Lưu vào Vercel Blob (production)
    hoặc local file (development)
```

### 3. Khi chạy npm run convert (merge thông minh)

```
1. Đọc KML mới → parse thành GeoJSON features
2. Tải dữ liệu overlay LIVE từ Vercel (deployUrl/api/overlays)
   → Nếu không có deployUrl → dùng file local
3. Đọc GeoJSON cũ (local) để lấy mapping ID → tọa độ
4. So khớp tọa độ (geometry fingerprint):
   - Feature cũ có cùng tọa độ → giữ nguyên objectInfo + myMapsStyles
   - Feature mới không khớp → tạo mới, không có overlay
   - Feature cũ bị xóa → cảnh báo, overlay không migrate
5. Text labels → giữ nguyên 100% (không phụ thuộc feature ID)
6. Ghi _convertedAt timestamp để Vercel biết cần đồng bộ
7. Lưu vào: overlays.json + initial-overlays.json + map-cache.geojson
```

---

## Các Module Chi Tiết

### Module 1: Trang chính (`app/page.js`)

**Vai trò:** Quản lý toàn bộ state của ứng dụng và render các component con.

**State chính:**
- `mode` — `"view"` (xem) hoặc `"settings"` (cài đặt, cần đăng nhập)
- `geojson` — dữ liệu GeoJSON bản đồ (load từ `public/data/map-cache.geojson`)
- `overlays` — dữ liệu overlay (load từ API `/api/overlays`)
- `selectedFeature` — đối tượng đang được chọn (dùng trong chế độ cài đặt)
- `openBoxes` — danh sách hộp thông tin đang mở (dùng trong chế độ xem)
- `addingTextLabel` — đang ở chế độ thêm chữ mới (click vào bản đồ để đặt chữ)
- `isFullscreen` — trạng thái toàn màn hình

**Thanh công cụ trên cùng (Mode Toggle):**
- Nút `👁 Xem` — chuyển chế độ xem
- Nút `⚙ Cài đặt` — chuyển chế độ cài đặt (cần đăng nhập)
- Nút `🔄 Làm mới` — fetch lại dữ liệu mới nhất từ server (bypass cache)
- Nút `⛶ Toàn màn hình` — bật/tắt fullscreen (Fullscreen API, hỗ trợ iPad)

**Toolbar cài đặt (dưới bản đồ):**
- Nút `✏️ Thêm chữ` — bật chế độ thêm text label, click vào bản đồ để đặt

---

### Module 2: Bản đồ (`components/MapView.jsx`)

**Vai trò:** Render bản đồ Leaflet, hiển thị GeoJSON, text labels, info boxes.

**Bản đồ nền:** CARTO Positron (tile sáng nhạt hiện đại).

**Hiển thị GeoJSON:**
- Render tất cả features từ `map-cache.geojson`
- Style mỗi feature bằng cách merge: style gốc từ KML + style tùy chỉnh từ `overlays.myMapsStyles`
- Click feature → chế độ xem: mở/đóng info box; chế độ cài đặt: chọn feature để chỉnh sửa
- Hover feature → highlight tạm thời (tăng weight + fillOpacity)
- Auto panTo khi click vào đối tượng

**Hệ thống Hitbox (tăng độ nhạy click):**
- LineString/MultiLineString: tạo polyline vô hình dày 24px đè lên đường gốc
- Point/CircleMarker: viền trong suốt dày 16px quanh điểm radius 6px

**Text Labels:**
- Render bằng `L.divIcon` + `L.marker`
- Co giãn theo zoom: `scale = 2^(currentZoom - zoomBase)`
- Xoay: CSS `rotate(Xdeg)`
- Transform origin: `0 0` (góc trên trái)
- Chế độ cài đặt: có thể kéo thả di chuyển (draggable marker)
- Real-time preview: khi chỉnh sửa trong SettingsPanel, chữ trên bản đồ cập nhật ngay lập tức qua hàm `handleTextLabelPreview` (thao tác trực tiếp DOM, không re-render)
- `textLabelsDataRef` — lưu dữ liệu label mới nhất (bao gồm preview chưa save) để dragend handler không bị reset về giá trị cũ

**Info Boxes (chế độ xem):**
- Render bằng `L.divIcon` + React `createRoot`
- Mỗi feature mở tối đa 1 info box, có thể mở nhiều feature cùng lúc
- Đường nối SVG từ điểm neo đến info box (màu đồng bộ theo feature)
- Kéo thả di chuyển info box (Pointer Events, tách biệt khỏi pan bản đồ)
- Kéo góc dưới phải để resize
- Có ảnh → chiều cao mặc định 220px; không ảnh → auto height
- Ảnh xếp ngang (horizontal slider), co giãn thông minh khi resize box

**Highlight feature đang chọn:**
- Vẽ lớp GeoJSON phụ màu `#4361ee`, nét đứt, opacity thấp

---

### Module 3: Panel cài đặt (`components/SettingsPanel.jsx`)

**Vai trò:** Form chỉnh sửa thuộc tính đối tượng GeoJSON và text label.

**GeoJsonEditor (chỉnh sửa đường/đa giác):**
- Tiêu đề, mô tả (textarea, hỗ trợ xuống dòng)
- Màu đường viền (color picker + text input hex)
- Độ dày đường (range slider 0.5–10px)
- Polygon: thêm màu nền + độ trong suốt
- Nét đứt: toggle on/off + chỉnh độ dài nét + khoảng cách
- Quản lý ảnh:
  - Thêm ảnh từ folder `image/` (local, qua API `/api/images`)
  - Thêm ảnh từ URL (tự động convert Google Drive link → lh3.googleusercontent.com)
  - Xóa ảnh, chỉnh caption
- Nút `💾 Lưu thay đổi` → gọi `onSave` → POST `/api/overlays`

**TextLabelEditor (chỉnh sửa chữ):**
- Nội dung chữ (text input)
- Màu chữ (color picker)
- Kích thước chữ (range slider 8–150px)
- Góc xoay (range slider -180° → 180°, có preset 0°/45°/90°/-45°/-90°)
- Mức zoom chuẩn (range slider 10–19)
- Real-time preview: mọi thay đổi tức thì hiển thị trên bản đồ (qua `onPreview` callback)
- Nút `💾 Lưu` + nút `🗑 Xóa`

**Sync khi chuyển feature:** useEffect theo `featureId` reset toàn bộ state local từ overlays mới nhất.

---

### Module 4: Trình xem ảnh toàn màn hình (`components/ImageLightbox.jsx`)

**Vai trò:** Gallery ảnh fullscreen khi click vào ảnh trong info box.

- Overlay đen mờ (0.95 opacity)
- Ảnh lớn chính giữa, animation zoom-in
- Nút mũi tên ‹ › hai bên + phím ArrowLeft/ArrowRight
- Đóng: phím Escape hoặc nút ✕
- Thanh thumbnail ngang phía dưới, auto-scroll vào ảnh đang xem
- Hỗ trợ vuốt (swipe) trên touch devices

---

### Module 5: Đăng nhập (`components/LoginModal.jsx` + `app/api/auth/route.js`)

**Vai trò:** Bảo vệ chế độ cài đặt bằng mật khẩu.

- Modal overlay blur, form ID + password
- API `POST /api/auth`: so sánh với credentials hardcoded (`admin` / `123admin@123`)
- Đăng nhập thành công → chuyển sang chế độ cài đặt

---

### Module 6: API Overlays (`app/api/overlays/route.js`)

**Vai trò:** Đọc/ghi dữ liệu overlay (text labels, object info, custom styles).

**Cấu trúc dữ liệu `overlays.json`:**
```json
{
  "objectInfo": {
    "mymaps-3459": {
      "title": "Cầu Nhật Tân",
      "description": "Dài: .... km",
      "images": [{ "src": "https://...", "caption": "ảnh 1" }]
    }
  },
  "myMapsStyles": {
    "mymaps-3459": {
      "stroke": "#e65100",
      "strokeWidth": 7.2,
      "fill": "#ff0000",
      "fillOpacity": 0.5,
      "dashArray": "10 5"
    }
  },
  "textLabels": [
    {
      "id": "label-1780068829537",
      "text": "Đường Vành Đai 1",
      "position": [21.030, 105.816],
      "fontSize": 137,
      "zoomBase": 16,
      "color": "#1f2937",
      "rotation": 32
    }
  ],
  "_convertedAt": "2026-05-31T..."
}
```

**GET /api/overlays:**
1. Nếu có `BLOB_READ_WRITE_TOKEN` → đọc từ Vercel Blob (production)
2. Kiểm tra `_convertedAt`: nếu `initial-overlays.json` mới hơn blob → thay thế blob bằng dữ liệu convert mới (đồng bộ sau redeploy)
3. Nếu không có blob → khởi tạo từ `initial-overlays.json`
4. Nếu không có token → đọc file local `public/data/overlays.json` (development)

**POST /api/overlays:**
1. Production: upload lên Vercel Blob (random suffix) → xóa blob cũ
2. Development: ghi file local `public/data/overlays.json`

---

### Module 7: Script Convert KML (`scripts/convert-kml.mjs`)

**Vai trò:** Chuyển đổi file KML từ Google My Maps thành GeoJSON + merge overlay data.

**Chạy:** `npm run convert`

**Cấu hình:** `scripts/convert-config.json`
```json
{
  "kmlInputPath": "map/HongHacCiTY.kml",
  "geojsonOutputPath": "public/data/map-cache.geojson",
  "overlaysPath": "public/data/overlays.json",
  "backupDir": "public/data/backup",
  "featureIdPrefix": "mymaps",
  "deployUrl": "https://hong-hac-city-map.vercel.app/"
}
```

**Quy trình:**
1. Parse KML: đọc Style/StyleMap definitions, parse Placemarks (Polygon, LineString, MultiGeometry)
2. Gán feature ID tuần tự: `mymaps-1`, `mymaps-2`, ...
3. Parse style KML (color aabbggrr → hex #rrggbb, width, fill, opacity)
4. Fetch overlay data live từ `deployUrl/api/overlays` (ưu tiên) hoặc fallback file local
5. Backup file cũ vào `public/data/backup/`
6. Geometry fingerprint matching: `type:lng1,lat1;lng2,lat2;...` (6 chữ số thập phân)
7. Migrate: objectInfo + myMapsStyles từ old ID → new ID cho features cùng tọa độ
8. TextLabels: giữ nguyên 100%
9. Ghi `_convertedAt` timestamp
10. Lưu ra: `map-cache.geojson` + `overlays.json` + `initial-overlays.json`

---

### Module 8: API Images (`app/api/images/route.js`)

**Vai trò:** Quản lý ảnh local trong folder `image/`.

- `GET /api/images` — liệt kê file ảnh (jpg/png/gif/webp/svg) trong folder `image/`
- `POST /api/images` — copy ảnh từ `image/` vào `public/images/` và trả URL web

---

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Framework | Next.js 15 (App Router) |
| Bản đồ | Leaflet 1.9 |
| Font | Inter (Google Fonts) |
| Tile | CARTO Positron |
| Lưu trữ (production) | Vercel Blob (`@vercel/blob`) |
| Lưu trữ (development) | File system (`public/data/`) |
| Deploy | Vercel (auto-deploy từ GitHub) |
| Ngôn ngữ | JavaScript (JSX), CSS thuần |

---

## Thông tin xác thực

- **ID:** `admin`
- **Password:** `123admin@123`
- Hardcoded trong `app/api/auth/route.js`
