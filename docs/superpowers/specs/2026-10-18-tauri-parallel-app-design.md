# Thiết kế ứng dụng Messenger-Win song song bằng Tauri và Rust

**Trạng thái:** Đề xuất chờ duyệt
**Ngày:** 2026-10-18
**Phạm vi phát hành:** Windows

## Mục tiêu

Tạo một ứng dụng Tauri/Rust mới chạy song song với ứng dụng Electron hiện tại. Bản Electron, dữ liệu và cách cài đặt hiện tại phải tiếp tục dùng được. Bản mới chỉ được coi là đạt yêu cầu khi chuyển được các phiên Messenger và Discord đang đăng nhập mà không yêu cầu đăng nhập lại, giữ đủ chức năng đang có, và chứng minh được mức dùng RAM thấp hơn cùng thời gian mở ứng dụng nhanh hơn trong phép đo đối chiếu.

Đây là thiết kế có cổng khả thi. Tài liệu này chưa khẳng định việc chuyển phiên hoặc mức tăng hiệu năng đã làm được.

## Quyết định kiến trúc

Chọn **Tauri + Rust** làm hướng xây bản song song. Giao diện HTML/CSS/JavaScript hiện tại được tái sử dụng có chọn lọc; các lời gọi `ipcRenderer` được thay bằng adapter gọi lệnh và sự kiện Tauri. Backend Rust quản lý cấu hình, hồ sơ, vòng đời cửa sổ và tích hợp Windows.

Messenger và Discord tiếp tục chạy dưới dạng các trang web chính thức trong WebView2, mỗi tài khoản có một profile lưu trữ riêng. Mặc định chỉ duy trì WebView của dịch vụ đang mở; khi đổi dịch vụ, huỷ WebView của dịch vụ cũ nhưng giữ dữ liệu profile để lần sau mở lại.

Phần host WebView2 phải được chốt bằng prototype. Tauri hiện đánh dấu API tạo WebView con trong cùng cửa sổ là không ổn định; Tauri/Wry cũng chưa cung cấp trực tiếp toàn bộ điều khiển profile cần cho nhiều tài khoản. Prototype sẽ so sánh API Tauri hiện có với một host WebView2/COM nhỏ do Rust quản lý. Chỉ chọn cách đáp ứng được bố cục hiện tại, profile riêng, CDP privacy của Messenger và các cổng chuyển phiên.

## Các hướng đã cân nhắc

| Hướng | Ưu điểm | Chi phí và rủi ro |
|---|---|---|
| **Tauri + Rust** — được chọn | Dùng WebView2 có sẵn trên Windows; có thể giữ giao diện hiện tại và đưa quản lý hệ thống vào Rust. | Cần adapter thay Electron IPC; view nhúng cùng cửa sổ, profile WebView2 và CDP có thể cần API không ổn định hoặc COM riêng. Chưa có bằng chứng rằng bản mới nhẹ hơn. |
| Rust + WebView2/Win32 trực tiếp | Kiểm soát profile, controller, CDP và cửa sổ ở cấp thấp. | Phải tự làm nhiều phần khung ứng dụng và tích hợp Windows mà Tauri đã cung cấp. |
| Tối ưu Electron hiện tại | Giữ nguyên engine, phiên và hành vi; ít rủi ro chuyển dữ liệu. | Không tạo bản Rust/Tauri song song theo yêu cầu. Chỉ dùng làm đường cơ sở đo hiệu năng và bản dự phòng. |

## Thành phần

### Giao diện và adapter nền tảng

- Tái sử dụng bố cục, CSS và logic giao diện hiện tại khi không phụ thuộc Electron.
- Đặt các thao tác nền tảng sau một adapter duy nhất: đọc/ghi cài đặt, hồ sơ, chuyển dịch vụ, sự kiện tải tệp, thông báo cập nhật, mở tệp/thư mục và cửa sổ phụ.
- Không cấp API Tauri cho nội dung Messenger hoặc Discord. Các trang dịch vụ chỉ nhận quyền điều hướng, tải xuống và quyền thiết bị đã được cho phép theo chính sách.

### Rust host và WebView2

- Rust quản lý một ứng dụng Windows riêng với `appId`, thư mục dữ liệu và tên sản phẩm riêng; không dùng chung thư mục ghi dữ liệu của Electron.
- Mỗi hồ sơ Messenger/Discord có một profile WebView2 riêng. Profile được tạo trong cùng một WebView2 User Data Folder nếu host API cho phép, để cô lập cookie và dữ liệu tài khoản mà vẫn chia sẻ tài nguyên runtime.
- Chỉ giữ WebView của dịch vụ đang dùng theo mặc định. `sleepBackgroundProfiles` tiếp tục áp dụng cho các hồ sơ không hoạt động trong dịch vụ hiện tại.
- Cấu hình mỗi hồ sơ vẫn lưu `id`, `name`, `avatar`, `service`, thứ tự hồ sơ và ánh xạ tới profile storage riêng. Hỗ trợ thêm/sửa/xóa hồ sơ; không gộp profile giữa hai dịch vụ.

### Privacy Messenger

- Giữ nguyên phạm vi Messenger-only: chặn seen/typing chỉ áp dụng cho Messenger, không áp dụng cho Discord.
- Tái tạo hành vi hiện có cho `fetch`, WebSocket, XHR, `sendBeacon`, worker và shared worker. CDP/WebView2 protocol phải được kiểm chứng cho request interception, worker attach, cập nhật cài đặt khi đang chạy và cleanup khi tắt privacy.
- Nếu WebView2 không thể tái tạo một nhánh privacy đang có mà không làm hỏng Messenger, parity gate thất bại và không được bỏ tính năng để tiếp tục phát hành.

### Tích hợp ứng dụng Windows

Giữ hành vi đang có trong Electron: single-instance lock, system tray và menu, thu nhỏ/ẩn cửa sổ, chạy cùng Windows, phím tắt toàn cục, theme sáng/tối, app lock, always-on-top, zoom/toàn màn hình, reload/home/back, popup và OAuth trong đúng profile, chính sách camera/microphone, quản lý tải xuống gồm tiến độ/mở/hủy, cập nhật ứng dụng gồm tải và cài đặt, xóa cache/session theo từng profile, avatar và thông báo unread Messenger.

Discord tiếp tục dùng đăng nhập web trong profile riêng. Không thêm user-token login, không áp dụng privacy Messenger cho Discord và không thêm badge unread Discord nếu bản hiện tại chưa có.

## Chuyển dữ liệu và phiên đăng nhập

### Nguyên tắc

- Bản Electron và thư mục dữ liệu của nó là nguồn gốc; migration chỉ đọc từ bản sao tách biệt. Không xóa, đổi tên, ghi đè hoặc dùng trực tiếp thư mục profile của Electron làm WebView2 User Data Folder.
- Trước khi migration, sao lưu bản sao kiểm thử của từng profile vào một vị trí tách biệt. Bản sao chứa dữ liệu xác thực nên chỉ tài khoản Windows hiện tại được đọc; xoá bản sao thử sau khi kiểm chứng xong. Không đưa cookie, token, session hoặc dữ liệu cá nhân vào log, báo cáo, file tạm dạng rõ hay dòng lệnh.
- Chỉ chuyển dữ liệu theo domain Messenger/Discord đã cho phép. Không trích xuất hoặc chèn Discord user token; không đổi luồng xác thực web.
- Có thể thử nhập cookie bằng API chính thức nếu cần. Cookie chỉ tồn tại trong bộ nhớ trong lúc chuyển, được lọc theo profile/domain và không được ghi ra file rõ.
- Nhập metadata và cài đặt trong schema có phiên bản, giữ `id`, thứ tự hồ sơ, service, avatar, theme, privacy và các thiết lập hiện có. Không lưu bí mật xác thực trong metadata.

### Cổng khả thi bắt buộc

1. Lập bản sao kiểm thử của dữ liệu Electron; giữ nguyên bản gốc.
2. Thử phương án chuyển profile trên bản sao. Nếu định dạng hoặc phiên bản engine không tương thích, thử nhập cookie bằng API nền tảng trong môi trường tách biệt.
3. Khởi động từng profile Messenger và Discord trong bản Tauri thử nghiệm, kiểm tra trạng thái đăng nhập mà không nhập lại thông tin. Không gửi tin nhắn hoặc thực hiện hành động tài khoản thay người dùng.
4. Kiểm tra các dữ liệu web còn cần cho phiên, như localStorage, IndexedDB và service worker. Không coi việc nhập được cookie là bằng chứng đã chuyển đủ phiên.
5. Ghi kết quả theo từng profile bằng trạng thái thành công/thất bại; báo cáo không chứa giá trị cookie hoặc token.

**Điều kiện dừng:** Nếu bất kỳ profile đang dùng nào yêu cầu đăng nhập lại, hoặc chỉ có thể được phục hồi bằng cách trích xuất/chèn user token, migration gate không đạt. Khi đó giữ nguyên bản Electron và báo rõ giới hạn trước khi triển khai app mới. Không âm thầm hạ yêu cầu “không đăng nhập lại”.

## Hiệu năng

Chưa có số đo RAM hoặc thời gian khởi động làm đường cơ sở. Trước khi đánh giá bản mới, đo Electron và Tauri trên cùng máy, cùng phiên bản Windows, cùng trạng thái dịch vụ và cùng profile:

- Thời gian từ mở app tới khi UI và trang chat dùng được.
- RAM tiến trình của app và các tiến trình WebView2 thuộc User Data Folder của app sau 60 giây idle.
- RAM khi một Messenger profile hoạt động và khi một Discord profile hoạt động.
- Thời gian chuyển profile và chuyển dịch vụ.

Chạy ít nhất năm lượt cho từng tình huống; báo cáo median và p90, tách cold start khỏi warm start. Sau khi baseline có và trước khi bắt đầu xây app đầy đủ, chốt ngưỡng mục tiêu so với Electron. Bản mới chỉ đạt mục tiêu “nhẹ hơn và load nhanh hơn” khi RAM giảm vượt mức dao động đo và thời gian mở app cũng cải thiện; nếu chỉ một chỉ số cải thiện thì phải ghi là đạt một phần, không tuyên bố đạt toàn bộ.

## Xử lý lỗi và kiểm chứng

- Nếu WebView2 Runtime thiếu hoặc không khởi tạo được, hiển thị lỗi có thể xử lý và giữ dữ liệu profile; không xóa dữ liệu để tự phục hồi.
- Nếu một profile không chuyển được, đánh dấu riêng profile đó là chưa chuyển, giữ nguyên bản sao nguồn và cho phép chạy lại migration. Không gộp trạng thái thành công/thất bại của các profile khác.
- Unit checks bao phủ mapping cài đặt, service/profile isolation, quyền điều hướng và việc chỉ Messenger nhận privacy hooks.
- Runtime smoke bao phủ Messenger/Discord đã đăng nhập, đổi hồ sơ/dịch vụ, popup, tải tệp, camera/mic, tray, cập nhật, lock và xóa cache/session đúng profile.
- Kiểm tra đóng gói xác nhận hai app có app ID và data folder riêng, cùng khả năng cài/mở/gỡ riêng mà không chạm dữ liệu bản kia.

## Các cổng parity trước khi thay thế hoặc phát hành

1. **Host:** View được bố trí đúng trong cửa sổ; nhiều tài khoản có storage riêng; đổi profile/dịch vụ không làm mất phiên; mặc định chỉ có một dịch vụ chạy.
2. **Session:** Từng profile Messenger/Discord hiện có mở được mà không yêu cầu đăng nhập lại; bản gốc Electron vẫn khởi động và đăng nhập như trước.
3. **Privacy:** Các kiểm tra unit và CDP hiện có được thay bằng kiểm tra tương đương; thử seen/typing trong Messenger; xác nhận Discord không nhận hook Messenger.
4. **Tính năng:** Kiểm tra UI, hồ sơ, cài đặt, tray, lock, phím tắt, popup/OAuth, camera/mic, tải tệp, cache/session, updater và các thao tác điều hướng.
5. **Hiệu năng:** Đo theo quy trình ở trên và đối chiếu ngưỡng đã chốt.
6. **Đóng gói:** Installer, app ID và data folder tách biệt; cài/mở/gỡ bản Tauri không xóa hoặc ghi đè bản Electron hay dữ liệu của nó.

Không dùng kết quả đọc mã tĩnh để đánh dấu các cổng runtime là đạt.

## Phạm vi và trình tự

Thiết kế này bao phủ kiến trúc tổng thể nhưng không cho phép bắt đầu dựng toàn bộ app ngay. Sau khi duyệt tài liệu, kế hoạch triển khai đầu tiên chỉ xây prototype cho các rủi ro nền tảng: migration session trên bản sao, host view/profile, CDP privacy Messenger và phép đo baseline. Nếu prototype qua các cổng, lập kế hoạch riêng theo từng cụm chức năng để triển khai parity. Nếu không qua, dừng trước khi thay đổi ứng dụng hiện tại.

Ngoài phạm vi: xóa hoặc thay thế bản Electron; phát hành đa nền tảng; thay đổi dịch vụ Messenger/Discord; thêm tính năng Discord chưa có; tối ưu hiệu năng bằng cách giảm chức năng.

## Tài liệu tham khảo

- Electron Session API: https://www.electronjs.org/docs/latest/api/session
- Electron Cookies API: https://www.electronjs.org/docs/latest/api/cookies
- Tauri WebviewBuilder: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html
- Microsoft WebView2 profiles: https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft.web.webview2.core/corewebview2profile
- Microsoft WebView2 Cookie Manager: https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2cookiemanager
- Microsoft WebView2 overview and profile APIs: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/overview-features-apis
