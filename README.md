# Hướng dẫn Cập nhật Bản đồ

Khi bạn vẽ thêm đường/đa giác trên Google My Maps và muốn cập nhật lên web, làm 3 bước sau:

## Bước 1 — Tải KML và ghi đè

1. Vào [Google My Maps](https://www.google.com/maps/d/), nhấn **⋮ → Export to KML/KMZ**.
2. **Tích chọn** `Export as KML instead of KMZ`.
3. **KHÔNG tích** `Keep data updated with a network link...`.
4. Tải về, copy đè vào: `map/HongHacCiTY.kml`.

## Bước 2 — Chạy convert

```bash
npm run convert
```

Script sẽ tự động tải dữ liệu chỉnh sửa mới nhất từ Vercel, merge với KML mới, và giữ nguyên text/chú thích/ảnh cho các đối tượng cùng tọa độ.

## Bước 3 — Push lên GitHub

```bash
git add .
git commit -m "Update map data"
git push
```

Vercel tự động redeploy. Xong.

---

**Lưu ý:** Nếu bạn **sửa tọa độ** của đường/đa giác cũ trên MyMaps (kéo điểm, thêm/xóa điểm), chú thích/ảnh của đối tượng đó sẽ bị mất. Chỉ **vẽ thêm mới** thì không ảnh hưởng.
