# Multi Discord + Switch Mess/Discord — Work Breakdown (MVP)

> Phạm vi đã chốt: web Discord + cookie/partition, không clone privacy Mess, default chỉ 1 service mở, nút switch thanh phải, setting giữ nền cho máy khỏe.
>
> Engine: Chromium/`BrowserView` như Messenger (không nhúng app Discord official).  
> Auth: cookie/session qua login web (không token kiểu Discord Lyric làm path product).

## Harness Engineering V2

Làm việc theo harness của repo (bắt buộc cho agent / khuyến nghị cho dev):

1. Đọc `AGENTS.md` + `.agents/index.md`
2. Loop: **Orient → Route → Lookup → Execute → Verify → Distill → Record**
3. Discord phase: runbook `.agents/runbooks/discord-mvp-phase.md`
4. Cuối phase: `.agents/checklists/phase-pack.md` + `npm run pack -- --phase <N>`
5. Ghi kết quả: `.agents/plans/phase-<N>-verification.md`

Guardrails liên quan: `discord.md`, `multi-profile.md`, `electron-main.md`, `renderer-ui.md`, `privacy.md`, `release.md`, `security.md`.

---

## Out of MVP (cố ý chưa làm)

| Hạng mục | Ghi chú |
|---|---|
| Privacy Discord (block seen/typing…) | Reverse riêng, không port FB |
| Badge unread Discord | DOM/title riêng |
| Token login / inject token | Ngoài scope product; rủi ro ToS/ban cao |
| Nhúng binary Discord official | Lệch kiến trúc, multi/process phức tạp |
| macOS build | Epic tách |
| Chạy đồng thời 2 service **mặc định** | Chỉ opt-in setting “giữ nền” |

---

## Phase 0 — Chuẩn bị

| ID | Task | Làm gì | Done khi |
|---|---|---|---|
| **0.1** | Chốt URL & host Discord | `https://discord.com/app` (login tự redirect); host: `discord.com`, `discordapp.com`, `cdn.discordapp.com`, `media.discordapp.net`, `gateway.discord.gg`, `*.discord.gg` (bổ sung khi test) | Có hằng số `DISCORD_URL` + `DISCORD_HOSTS` |
| **0.2** | Chốt model dữ liệu | Profile: `service: 'messenger' \| 'discord'`; settings: `activeService`, `lastProfileByService`, `exclusiveService` (default `true`) | Schema + migrate rule rõ |
| **0.3** | Ranh giới MVP | Discord: multi / login / logout / xóa session / switch. **Không:** block seen, badge Discord, token auth | Checklist in/out thống nhất team |

---

## Phase 1 — Data model & migrate

| ID | Task | File gợi ý | Done khi |
|---|---|---|---|
| **1.1** | Mở rộng profile object | `renderer.js` | Mỗi profile có `service`; partition Mess giữ `persist:nick_*` (hoặc sau này `persist:mess_*` — không bắt buộc rename cũ) |
| **1.2** | Migrate localStorage | `renderer.js` | Acc cũ không có `service` → `messenger`; mở lại không mất nick |
| **1.3** | Settings mới | `main.js` `DEFAULT_SETTINGS` + load/save | `activeService`, `lastProfileByService`, `exclusiveService` persist sau restart |
| **1.4** | IPC settings | `main.js`, `settings-renderer.js` | Đọc/ghi `exclusiveService` (và nếu cần `activeService`) qua IPC hiện có |

### Schema tham chiếu

```js
// profile
{
  id: string,
  name: string,
  avatar?: string,
  service: 'messenger' | 'discord',
  partition: string // persist:nick_* | persist:discord_*
}

// settings (bổ sung)
{
  activeService: 'messenger' | 'discord',
  lastProfileByService: {
    messenger: string | null,
    discord: string | null,
  },
  exclusiveService: true, // default: chỉ 1 service mở (tiết kiệm RAM)
  // sleepBackgroundProfiles — đã có: sleep acc nền trong cùng service
}
```

---

## Phase 2 — Main process: service-aware load

| ID | Task | File gợi ý | Done khi |
|---|---|---|---|
| **2.1** | URL / UA theo service | `main.js` | Mess → FB messages + UA hiện tại; Discord → Discord app URL (+ UA ổn định) |
| **2.2** | `switch-profile` mang `service` | `main.js` | Tạo/gắn `BrowserView` đúng partition; `loadURL` đúng service |
| **2.3** | Skip privacy cho Discord | `main.js` (+ chỗ gọi `privacy.js`) | Profile Discord **không** inject block seen/typing / FB WS patch |
| **2.4** | Permission & request allowlist theo service | `main.js` | Mess: host FB như cũ. Discord: mic/cam theo host Discord; không chặn nhầm CDN/gateway |
| **2.5** | Popup / external link theo service | `main.js` | Link Discord mở đúng; OAuth/login popup giữ partition |
| **2.6** | Logout / xóa / clear session Discord | `main.js` | Clear partition Discord giống Mess; login lại sạch |
| **2.7** | Avatar/unread Mess không đụng Discord | `main.js` | Script badge/avatar FB chỉ chạy khi `service === 'messenger'` |

---

## Phase 3 — Exclusive service (RAM)

| ID | Task | File gợi ý | Done khi |
|---|---|---|---|
| **3.1** | API destroy theo service | `main.js` | `destroyViewsByService('messenger' \| 'discord')` |
| **3.2** | On switch service + `exclusiveService === true` | `main.js` | Đổi sang Discord → destroy hết view Mess (và ngược lại); **cookie partition còn** |
| **3.3** | On switch + `exclusiveService === false` | `main.js` | Không destroy service kia; chỉ ẩn / bỏ `setBrowserView` |
| **3.4** | Remember last profile / service | `main.js` + `renderer.js` | Mở lại app: service + nick đúng lần trước |
| **3.5** | Tương thích sleep profile hiện có | `main.js` | `sleepBackgroundProfiles` vẫn sleep acc **trong** service đang mở; không xung đột exclusive |

### Hành vi RAM (default)

| Hành vi | Mặc định (máy yếu) |
|---|---|
| Đang Mess | Mọi `BrowserView` Discord **destroy** |
| Đang Discord | Mọi view Mess **destroy** |
| Đổi service | Save last profile id từng service → mở lại đúng acc |
| Cookie/session | **Không mất** khi destroy view (nằm trong `persist:`) |

---

## Phase 4 — UI shell

| ID | Task | File gợi ý | Done khi |
|---|---|---|---|
| **4.1** | Nút switch Mess/Discord thanh phải | `index.html`, `renderer.js`, CSS trong `index.html` | 1 toggle hoặc 2 nút; active state rõ (sidebar tools ~42px) |
| **4.2** | Filter list acc theo `activeService` | `renderer.js` | Mess: chỉ nick Mess; Discord: chỉ nick Discord |
| **4.3** | Thêm acc theo service đang chọn | `renderer.js` | `+` tạo profile `service` đúng + partition `persist:discord_*` / mess |
| **4.4** | Modal copy theo service | `index.html` / modal | Title “Thêm tài khoản Discord” vs Mess |
| **4.5** | Empty state Discord | `renderer.js` | Chưa có nick Discord → gợi ý bấm `+` / login |
| **4.6** | (Optional) Icon M/D | SVG/text nhỏ | Phân biệt được, không vỡ layout |

---

## Phase 5 — Settings UI

| ID | Task | File gợi ý | Done khi |
|---|---|---|---|
| **5.1** | Toggle “Chỉ chạy 1 dịch vụ” | `settings.html`, `settings-renderer.js`, `settings.css` | Default **bật**; mô tả: đổi Mess↔Discord đóng service kia để tiết kiệm RAM |
| **5.2** | (Optional) Copy khi tắt | same | “Giữ service kia nền — tốn RAM, đổi nhanh hơn” |
| **5.3** | Privacy | `settings.html` | Privacy Mess giữ nguyên; **không** thêm setting privacy Discord |
| **5.4** | Wire IPC | `main.js` | Đổi setting → hành vi destroy/keep (chốt: áp dụng ngay lần switch sau hoặc ngay lập tức — document 1 behavior) |

### Copy gợi ý setting

- **Bật (default):** Chỉ chạy 1 dịch vụ — khi chuyển Messenger ↔ Discord, dịch vụ kia sẽ đóng để tiết kiệm RAM. Đăng nhập vẫn được giữ.
- **Tắt:** Giữ dịch vụ kia chạy nền — đổi nhanh hơn, tốn RAM hơn (máy khỏe).

---

## Phase 6 — Test checklist (bắt buộc)

Checklist tay: `.agents/checklists/manual-smoke-discord.md`

| ID | Scenario | Pass |
|---|---|---|
| **6.1** | 2+ nick Discord, switch qua lại | *user* |
| **6.2** | Login Discord (pass/QR/2FA nếu có) | *user* |
| **6.3** | Logout 1 nick Discord | *user* |
| **6.4** | Mess ↔ Discord, exclusive ON | *user* |
| **6.5** | Exclusive OFF | *user* |
| **6.6** | Acc Mess cũ sau migrate | *user* |
| **6.7** | Call/mic Discord (smoke) | *user* |
| **6.8** | Sleep profile trong 1 service | *user* |
| **6.9** | Xóa profile Discord | *user* |
| **6.10** | Unit: service model + privacy | `npm test` |

---

## Phase 7 — Ship nhỏ (nếu release)

| ID | Task | Done khi |
|---|---|---|
| **7.1** | Version bump + `CHANGELOG.md` | [x] v1.2.0 + changelog multi-service |
| **7.2** | Đóng gói Windows | `npm run pack -- --phase 7` sau smoke user |
| **7.3** | `README.md` | [x] Discord multi + exclusive + pack commands |

### Đóng gói sau mỗi phase (kiểm thử)

Script: `scripts/release-build.js` · npm: `npm run pack`

```bash
# Sau Phase 1 (cùng version hiện tại)
npm run pack -- --phase 1

# Sau Phase 2 + tăng patch
npm run pack -- --phase 2 --bump patch

# Có thêm portable + dọn dist trước
npm run pack -- --phase 3 --clean --portable

# Đặt version prerelease thủ công
npm run pack -- --phase 4 --version 1.2.0-discord.phase4

# Release công khai GitHub (cẩn thận)
npm run release
```

| Lệnh | Ý nghĩa |
|---|---|
| `npm run pack` | Build NSIS installer → `dist/MessengerSetup-<ver>.exe` (`--publish never`) |
| `npm run pack -- --phase N` | Build + copy artifact vào `dist/phases/phase-N/v<ver>/` |
| `npm run pack:portable` | NSIS + portable |
| `npm run pack:clean` | Xóa `dist/` rồi build |
| `npm run release` | Build + publish GitHub Releases |

Artifact chính: `dist/MessengerSetup-<version>.exe` · meta: `dist/build-meta.json`

---

## Thứ tự phụ thuộc

```text
0.x chốt scope
  → 1.x model + migrate
    → 2.x main load / privacy / host
      → 3.x exclusive RAM
        → 4.x UI switch + list
          → 5.x settings
            → 6.x test
              → 7.x release (optional)
```

**Không** làm Phase 4 trước Phase 2: UI switch mà main chưa service-aware sẽ half-broken.

**Thứ tự implement gợi ý:** `1.1 → 1.3 → 2.1–2.3 → 3.1–3.2 → 4.1–4.3 → 5.1 → 6.x`

---

## Ước lượng thô (1 dev quen repo)

| Phase | Effort |
|---|---|
| 0–1 | ~0.5 ngày |
| 2 | ~1–1.5 ngày |
| 3 | ~0.5 ngày |
| 4 | ~0.5–1 ngày |
| 5 | ~0.25–0.5 ngày |
| 6 | ~0.5–1 ngày |
| **Tổng MVP** | **~3.5–5 ngày** (chưa tính edge Discord web update) |

---

## Definition of Done (MVP)

- [x] Multi nick Discord bằng partition + login web (cookie) — *code ready; cần smoke login user*
- [x] Nút đổi Mess/Discord trên thanh phải
- [x] List acc chỉ hiện service đang chọn
- [x] Default: service kia **đóng view** (tiết kiệm RAM)
- [x] Setting: cho phép giữ nền service kia
- [ ] Mess cũ + privacy Mess **không regress** — *cần test tay*
- [x] Discord **không** gắn privacy FB
- [x] Không token auth trong product path

---

## Backlog sau MVP

| Hạng mục | Ghi chú |
|---|---|
| Badge unread Discord | DOM/title riêng |
| Privacy Discord | Reverse riêng |
| Token login | Tool cá nhân / ngoài product |
| macOS | Epic build/sign/notarize riêng |
| Branding shell “Messenger + Discord” | Đổi tên app/copy nếu ship công khai |

---

## File chạm chính (tham chiếu)

| File | Vai trò |
|---|---|
| `main.js` | BrowserView, partition, loadURL, privacy gate, exclusive destroy, permissions |
| `renderer.js` | Profiles localStorage, switch UI, filter theo service |
| `index.html` | Sidebar trái (acc) + thanh phải (nút M/D) |
| `privacy.js` | Chỉ Mess — không apply Discord |
| `settings.html` / `settings-renderer.js` | Toggle exclusive service |
| `package.json` | Version khi ship |

---

*Tài liệu này mô tả plan MVP đã thống nhất; cập nhật checkbox DoD khi implement xong từng phần.*
