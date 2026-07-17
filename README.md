# Messenger (+ Discord)

Ứng dụng desktop Windows (Electron/Chromium): **nhiều tài khoản Messenger** và **nhiều tài khoản Discord** (web + cookie/session theo partition).

## Tính năng chính

- Multi-account Messenger: session/cookie tách theo profile.
- Multi-account Discord: đăng nhập web chính thức, không dùng token paste.
- Nút **M / D** trên thanh phải để đổi dịch vụ; list tài khoản lọc theo dịch vụ.
- Mặc định **chỉ chạy 1 dịch vụ** (đóng view service kia → tiết kiệm RAM; session vẫn giữ).
- Cài đặt: tắt “Chỉ chạy 1 dịch vụ” nếu máy khỏe, muốn giữ service kia nền.
- Privacy chặn “Đã xem” / “Đang nhập” **chỉ Messenger** (không áp Discord).
- Khóa app PIN, tray, theme, download manager, auto-update (Windows).

## Người dùng

1. [Releases](https://github.com/Baor-05/Messenger-reup/releases) → tải `MessengerSetup-<version>.exe`.
2. Cài và mở app.
3. **Messenger:** dùng sidebar trái như trước.
4. **Discord:** bấm **D** → **+** thêm nick → đăng nhập Discord trên web trong app.
5. Đổi **M ↔ D** bất cứ lúc nào; session từng nick được giữ sau restart.

## Dev

```bash
npm install
npm start
```

### Test

```bash
npm test                 # privacy + service model
npm run test:privacy
npm run test:service
```

### Build / pack (Windows)

```bash
npm run build            # electron-builder NSIS
npm run pack             # pipeline local (không publish)
npm run pack -- --phase 5
npm run pack -- --phase 7 --bump patch
npm run pack:portable
```

Artifact: `dist/MessengerSetup-<version>.exe` · meta: `dist/build-meta.json`.

Publish GitHub (cẩn thận): `npm run release`.

## Multi-service — ghi nhớ

| Chủ đề | Hành vi |
|---|---|
| Auth Discord | Cookie/session partition (`persist:discord_<id>`), login web |
| Auth Messenger | `persist:nick_<id>` như trước |
| Exclusive (default ON) | Đổi service → destroy BrowserView service kia; **không** xóa cookie |
| Exclusive OFF | Có thể warm 2 service; tốn RAM hơn |
| Privacy | Chỉ Mess; preload gắn `--mp-service=` |

Chi tiết task/plan: `docs/DISCORD_MULTI_MVP_TASKS.md` · Harness: `AGENTS.md`, `.agents/`.

## Lưu ý

- Dữ liệu đăng nhập lưu cục bộ trên máy (userData Electron).
- Đây là wrapper web không chính thức; multi-client có thể vi phạm ToS bên thứ ba — dùng có trách nhiệm.
