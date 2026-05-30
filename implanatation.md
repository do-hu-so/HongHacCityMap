# Tài Liệu Kỹ Thuật & Cấu Trúc Các Module Dự Án Bản Đồ HongHacCiTY-DOSON

Tài liệu này mô tả chi tiết toàn bộ các module tính năng đã được hiện thực hóa và tối ưu trong dự án bản đồ tương tác KMZ **HongHacCiTY-DOSON**.

---

## 1. Module 1: Bản Đồ Nền & Cơ Chế Hiển Thị (MapView & Leaflet)
- **Bản đồ nền (Basemap)**: Sử dụng tile sáng/nhạt hiện đại từ **CARTO Positron** (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`) để làm nổi bật các đối tượng màu sắc của dự án.
- **Tự động dịch chuyển tâm bản đồ (Auto-centering panTo)**:
  * Khi người dùng click vào bất kỳ đối tượng nào trên bản đồ, Leaflet sẽ kích hoạt hàm `map.panTo(e.latlng, { animate: true })` để đưa tọa độ click về chính giữa màn hình.
  * Tính năng này giúp giải phóng khoảng không phía trên đối tượng để hiển thị hộp thông tin đầy đủ, tránh việc hộp bị đẩy sát lên mép trên trình duyệt và bị khuất tiêu đề hay nút đóng.

---

## 2. Module 2: Hệ Thống Tăng Độ Nhạy Bắt Điểm (Click Hitbox)
Giải quyết triệt để phản hồi về việc click chuột vào đường mảnh hoặc điểm tròn nhỏ trên bản đồ rất khó khăn:
- **Hitbox của Đường thẳng (LineString/MultiLineString)**:
  * Bên cạnh đường line gốc có màu sắc và độ dày nguyên bản (chỉ 1.2px), hệ thống tự động tạo một đường Polyline phụ **vô hình (opacity: 0)** đè lên trên với độ dày nét lên tới **16px**.
  * Toàn bộ sự kiện click và hover được gán vào đường vô hình dày 16px này. Người dùng chỉ cần click lân cận đường thẳng là chuột sẽ tự động "bắt" trúng đối tượng.
- **Hitbox của Điểm tròn (Point/CircleMarker)**:
  * Điểm tròn hiển thị có bán kính hiển thị là `6px`.
  * Hệ thống gán thêm một vòng viền **trong suốt (transparent) dày 12px** xung quanh đóng vai trò làm vùng đệm tương tác. Click chuột gần điểm tròn sẽ ngay lập tức được hệ thống nhận diện chính xác.

---

## 3. Module 3: Hộp Thông Tin Tương Tác Độc Lập (MapInfoBox)
Hộp thông tin được tích hợp trực tiếp vào Marker của Leaflet dưới dạng `L.divIcon`, kết nối hiển thị bằng `createRoot` của React, sở hữu khả năng tương tác độc lập như các cửa sổ Windows:
- **Đa hộp thông tin (Multi-InfoBox)**: Cho phép mở nhiều hộp thông tin của nhiều đối tượng cùng một lúc trên bản đồ (mỗi đối tượng chỉ mở tối đa 1 hộp).
- **Đường nối động (SVG Connector Line)**: Một đường line mảnh (`strokeWidth: 1.5`) nối từ điểm neo của đối tượng đến hộp thông tin. Màu sắc của đường nối và điểm neo chấm tròn tự động đồng bộ theo màu sắc thuộc tính của đối tượng.
- **Kéo thả di chuyển (Drag & Drop)**: 
  * Giữ và kéo phần Header của hộp thông tin để di chuyển hộp đến vị trí bất kỳ trên bản đồ.
  * Tách biệt sự kiện kéo hộp với thao tác kéo bản đồ (ngăn bản đồ bị pan khi kéo hộp). Đường nối SVG tự động kéo dãn và thay đổi góc độ theo vị trí mới của hộp.
- **Thay đổi kích thước thủ công (Manual Resize)**: 
  * Hộp thông tin hỗ trợ kéo góc dưới bên phải để thay đổi kích thước thủ công (`resize: both` và `overflow: hidden`).
  * Loại bỏ các ràng buộc `bottom/right` tuyệt đối trong CSS để tránh hộp bị tự động giãn/co lại khi kéo thả.
- **Chế độ tự động tối ưu hóa chiều cao**:
  * Khi có hình ảnh: Hộp thông tin hiển thị chiều cao mặc định ban đầu là **220px**.
  * Khi không có hình ảnh: Hộp thông tin tự động co nhỏ chiều cao (**auto**) để vừa khít với đoạn văn mô tả ngắn, tránh dư thừa khoảng trắng.
- **Dải trượt ảnh ngang (Horizontal Image Slider)**:
  * **Cố định văn bản**: Toàn bộ hộp thông tin tắt cuộn dọc (`overflow-y: hidden`). Văn bản mô tả ở trên luôn đứng yên cố định giúp người dùng luôn đọc được thông tin chính.
  * **Xếp ảnh sát nhau**: Các ảnh thu nhỏ được xếp sát nhau trên một hàng ngang liên tục (gap 8px, `flex: 0 0 auto`) độc lập dưới chân hộp.
  * **Co giãn ảnh thông minh (Responsive Height)**: Khi người dùng kéo dãn/phóng to hộp thông tin, cỡ chữ của văn bản vẫn giữ nguyên để đảm bảo thẩm mỹ, nhưng chiều cao của ảnh thu nhỏ sẽ tự động mở rộng theo khung hộp để hiển thị to rõ hơn (`flex: 1 1 auto`, `object-fit: contain`).
  * **Không cắt chữ chú thích**: Thanh trượt ngang chừa khoảng trống hợp lý phía dưới, đảm bảo dòng chữ chú thích của ảnh hiển thị trọn vẹn 100%, không bị cắt mất chữ ở chân hộp.

---

## 4. Module 4: Trình Xem Ảnh Toàn Màn Hình Cao Cấp (ImageLightbox)
Khi bấm vào bất kỳ ảnh thu nhỏ nào trong hộp thông tin, một bộ xem ảnh toàn màn hình cao cấp sẽ mở ra:
- **Giao diện tối sang trọng**: Phông nền overlay đen mờ (`rgba(10, 10, 10, 0.95)`), hiển thị ảnh lớn ở chính giữa màn hình với hiệu ứng chuyển động phóng to nhẹ nhàng.
- **Điều khiển phong phú**:
  * Bấm nút mũi tên **‹** và **›** nổi ở hai bên mép màn hình.
  * Hoặc dùng phím mũi tên trái/phải (**ArrowLeft / ArrowRight**) trên bàn phím.
  * Đóng nhanh bằng phím **Escape** hoặc nút **✕** ở góc trên cùng bên phải.
- **Thanh trượt Thumbnail (Dưới chân màn hình)**:
  * Hiển thị danh sách toàn bộ ảnh thu nhỏ xếp nằm ngang. Người dùng có thể cuộn/trượt dải thumbnail này để duyệt ảnh.
  * Bấm vào ảnh nhỏ sẽ nhảy thẳng đến ảnh lớn tương ứng. Ảnh thumbnail đang xem được làm sáng viền nổi bật và tự động cuộn mượt mà vào chính giữa màn hình.

---

## 5. Module 5: Panel Cài Đặt & Chuyển Đổi URL Google Drive (SettingsPanel)
- **Đăng nhập quản trị**: Bảo mật chế độ Cài đặt bằng tài khoản:
  * **ID**: `admin`
  * **Password**: `123admin@123`
- **Tự động chuyển đổi link Google Drive**:
  * Khi người quản trị dán liên kết chia sẻ ảnh Google Drive (dạng `drive.google.com/file/d/FILE_ID/view?usp=sharing` hoặc có tham số `id=FILE_ID`), hệ thống sẽ tự động lọc, trích xuất `FILE_ID` bằng Regex.
  * Chuyển đổi link đó thành địa chỉ stream ảnh trực tiếp chất lượng cao: `https://lh3.googleusercontent.com/d/FILE_ID`. Nhờ đó, ảnh Drive được hiển thị mượt mà trên bản đồ mà không bị lỗi.
- **Quản lý dữ liệu lưu trữ**:
  * Mọi thông tin chỉnh sửa (tiêu đề, ghi chú hỗ trợ xuống dòng, danh sách ảnh, tùy chỉnh nét liền/đứt, màu sắc và độ dày của đối tượng) được gửi qua API `POST /api/save-overlays` và lưu trực tiếp vào file `public/data/overlays.json` trong dự án để deploy lên Vercel.

---

## 6. Module 6: Đối Tượng Chữ Bản Đồ (Text Label)
- Hiển thị trực tiếp các text label trên bản đồ nền bằng `L.divIcon`.
- **Co giãn tỉ lệ theo zoom**: Text tự động tính toán scale bằng CSS transform dựa trên mức zoom hiện tại so với zoom gốc (`zoomBase`). Đảm bảo zoom gần chữ to ra rõ nét, zoom xa chữ nhỏ lại gọn gàng, tâm chữ luôn cố định đúng vị trí địa lý.
- Hỗ trợ di chuyển kéo thả chữ sang tọa độ mới và chỉnh sửa trực tiếp màu sắc, nội dung chữ trong chế độ Cài đặt.
