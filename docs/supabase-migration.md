# Chuyển sang Supabase (thay `localStorage` bằng database thật)

> Tài liệu này là hướng dẫn triển khai cho mục **"Trước khi dùng thật (bắt buộc)"** trong README —
> bước đầu tiên trong đó: *"Thay lớp lưu trữ `js/state.js` bằng kết nối tới database + backend thật (vd: Supabase)"*.
> "Supdata" trong yêu cầu ban đầu là tên gọi khác của **Supabase**.

## 1. Supabase là gì

Supabase = Postgres (database thật, có thật trên server) + Auth (đăng nhập) + API tự sinh + Storage,
có gói miễn phí đủ dùng cho quỹ tín dụng cỡ nhỏ/vừa. Nó thay thế đúng phần `localStorage` hiện tại —
dữ liệu nằm trên server, đồng bộ giữa mọi thiết bị/trình duyệt, thay vì mỗi máy 1 kho riêng như bây giờ.

## 2. Tạo project

1. Vào [supabase.com](https://supabase.com) → **Sign up** (dùng GitHub cho nhanh).
2. **New project** → chọn tổ chức (org) → đặt tên project (VD: `qtd-binh-nguyen`) → đặt **Database
   Password** (lưu lại chỗ an toàn, không phải thứ commit lên git) → chọn **Region** gần Việt Nam nhất
   (Singapore) → **Create new project**. Đợi ~2 phút để khởi tạo.
3. Vào **Project Settings → API**, lấy 2 giá trị:
   - **Project URL** (dạng `https://xxxx.supabase.co`)
   - **anon public key** (chuỗi JWT dài) — key này **được phép** để lộ ở phía trình duyệt/commit vào
     repo, vì Supabase thiết kế để bảo vệ dữ liệu bằng **Row Level Security (RLS)** chứ không phải
     bằng cách giấu key này.
   - **TUYỆT ĐỐI không** dùng `service_role key` ở phía trình duyệt — key đó bỏ qua toàn bộ RLS, chỉ
     dùng trong môi trường server tin cậy (Edge Function, backend riêng).

## 3. Thiết kế bảng (schema)

Mở **SQL Editor** trong Supabase, chạy đoạn sau — ánh xạ trực tiếp từ cấu trúc `state.js` hiện tại
(`org`, `admins`, `customers`, `contracts`, `requests`):

```sql
create extension if not exists pgcrypto;

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  hotline text,
  address text,
  banner_enabled boolean default true,
  banner_title text,
  banner_text text,
  bank_bin text,
  bank_name text,
  bank_account_no text,
  bank_account_name text
);

create table admins (
  id text primary key,
  username text unique not null,
  name text not null,
  role text not null check (role in ('super', 'staff')),
  allowed_thon text[] default '{}',
  allowed_xom text[] default '{}',
  salt text,
  hash text,
  auth_user_id uuid unique default gen_random_uuid(), -- xem mục 5 — KHÔNG phải auth.users thật
  created_at timestamptz default now()
);

create table customers (
  id text primary key,
  cccd text unique not null,
  name text not null,
  phone text,
  address text,
  thon text,
  xom text,
  xa text,
  tinh text,
  salt text,
  hash text,
  must_change_password boolean default true,
  failed_attempts int default 0,
  locked_until timestamptz,
  auth_user_id uuid unique default gen_random_uuid(), -- xem mục 5 — KHÔNG phải auth.users thật
  created_at timestamptz default now()
);
-- KHÔNG có cột temp_password: mật khẩu tạm chỉ nên trả về 1 LẦN DUY NHẤT lúc tạo
-- tài khoản (qua kênh riêng: hiện trên màn hình admin, không lưu lại trong DB).

create table contracts (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  code text not null,
  principal numeric not null,
  disbursed_date date not null,
  due_date date not null,
  interest_rate numeric not null,
  balance numeric not null,
  interest_paid_until date,
  created_at timestamptz default now()
);
-- Bỏ cột "status" lưu sẵn — giữ đúng cách app đang làm: effectiveContractStatus()
-- luôn TỰ TÍNH từ balance + due_date, không dựa vào cột trạng thái tĩnh.

create table requests (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  type text not null,
  amount numeric,
  purpose text,
  term_months int,
  note text,
  status text not null default 'moi',
  created_at timestamptz default now()
);

create index on contracts (customer_id);
create index on requests (customer_id);
create index on customers (thon, xom);
```

## 4. Row Level Security (RLS) — bắt buộc, đây là lớp bảo mật chính

Mặc định Supabase để trống bảng qua API là **chặn hết** cho tới khi bật RLS + viết policy.

```sql
alter table orgs enable row level security;
alter table admins enable row level security;
alter table customers enable row level security;
alter table contracts enable row level security;
alter table requests enable row level security;
```

Policy cụ thể phụ thuộc vào việc bạn chọn **phương án xác thực** ở mục 5 bên dưới — vì RLS trong
Supabase dựa vào `auth.uid()` (người dùng đã đăng nhập qua Supabase Auth), nên cần map được
`auth_user_id` → đúng customer/admin tương ứng trước khi viết policy chi tiết.

> Nếu lúc tạo project bạn đã **bỏ tick "Automatically expose new tables"** (khuyến nghị, an toàn
> hơn) thì cần chạy thêm đoạn cấp quyền sau — thiếu bước này thì dù RLS/policy đúng, API vẫn không
> gọi được vào bảng (không có quyền ở tầng bảng, chưa tới lượt RLS xét từng dòng). **Lưu ý đã xác
> nhận qua thực tế**: `service_role` (Edge Function dùng) KHÔNG tự có quyền — chỉ tự động bỏ qua
> RLS, vẫn cần GRANT như bình thường, nên phải cấp quyền cho cả 3 vai trò:

```sql
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on orgs, admins, customers, contracts, requests
  to anon, authenticated, service_role;
```

*(Cấp quyền ở tầng bảng cho phép API "được thử" truy vấn; RLS + policy phía trên mới là lớp quyết
định thật sự lọc được đúng dòng nào — 2 lớp này bổ sung cho nhau, không lớp nào thay được lớp kia.)*

## 5. Xác thực (Auth) — đã chốt: đăng nhập tự chế + Edge Function, không tốn phí OTP

Quyết định thực tế (đã trao đổi trực tiếp): **hoãn OTP/SMS** (tốn phí thật, chưa cần ngay) nhưng
**vẫn phải an toàn** dù chưa có OTP — không chấp nhận để lộ toàn bộ dữ liệu qua "anon key" như 1
app bình thường không có gì canh gác. Giải pháp: **giữ nguyên logic kiểm tra mật khẩu hiện tại**
(CCCD/username + băm SHA-256 có muối, y hệt `js/state.js`), chỉ chuyển chỗ chạy nó ra
**Supabase Edge Function** (code chạy trên server của Supabase, không phải trong trình duyệt).

> **Cập nhật**: ban đầu tách 3 Edge Function riêng (login/create-account/import-data), sau đó **gộp
> lại thành 1 function duy nhất** (`supabase/functions/create-account/index.ts`, phân biệt bằng field
> `type` trong body — `type: 'login'` không cần JWT sẵn có, mọi `type` khác cần JWT admin role=super)
> để đỡ phải deploy nhiều nơi mỗi lần sửa. Chỉ cần 1 chỗ deploy từ giờ trở đi.

### Cách hoạt động
1. Khách/admin gõ CCCD (hoặc SĐT/tên đăng nhập) + mật khẩu trong app như bình thường.
2. Trình duyệt gọi Edge Function (file `supabase/functions/create-account/index.ts` trong repo này)
   — gửi kèm `{ type: 'login', role, identifier, password }`.
3. Edge Function dùng `service_role key` (chỉ tồn tại phía server, không lộ ra trình duyệt) tra
   đúng dòng trong `customers`/`admins`, so mật khẩu bằng đúng thuật toán cũ, xử lý khóa tài khoản
   sau nhiều lần sai y hệt logic hiện tại.
4. Đúng mật khẩu → Edge Function **tự ký 1 JWT** (không qua Supabase Auth/GoTrue) chứa:
   - `sub`: giá trị cột `auth_user_id` (uuid tự sinh sẵn khi tạo tài khoản, KHÔNG phải user thật
     trong `auth.users` — chỉ mượn định dạng để PostgREST hiểu).
   - `role: "authenticated"` — bắt buộc, để PostgREST cấp đúng quyền Postgres tương ứng.
   - `app_role`: `"customer"` hoặc `"admin"` — RLS dùng để phân biệt.
   - `row_id`: đúng `id` của dòng đó — RLS dùng để khớp chính xác không cần join qua `auth_user_id`.
5. Trình duyệt cầm JWT này gọi thẳng Supabase (`Authorization: Bearer <token>`) cho mọi thao tác
   sau đó — RLS ở bên dưới tự lọc đúng phần dữ liệu của người đó.

**Vì sao an toàn dù không có OTP**: bước băm/so mật khẩu CHỈ chạy trong Edge Function (server), dùng
`service_role key` không ai lấy được ngoài bạn — trình duyệt/`anon key` không tự tạo được JWT hợp lệ
nếu không đi qua đúng bước xác minh mật khẩu này trước.

### RLS policy (dùng JWT ở trên, không cần `auth.uid()`/`auth.users` thật)
```sql
-- Khách hàng chỉ thấy đúng hồ sơ + hợp đồng của chính mình
create policy "customer sees own profile" on customers
  for select using (
    (auth.jwt() ->> 'app_role') = 'customer'
    and id = (auth.jwt() ->> 'row_id')
  );

create policy "customer sees own contracts" on contracts
  for select using (
    (auth.jwt() ->> 'app_role') = 'customer'
    and customer_id = (auth.jwt() ->> 'row_id')
  );

-- Admin toàn quyền (role='super') thấy tất cả khách hàng
create policy "super admin sees all customers" on customers
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a where a.id = (auth.jwt() ->> 'row_id') and a.role = 'super'
    )
  );

-- Nhân viên (role='staff') chỉ thấy khách trong Thôn/Xóm được gán. LƯU Ý:
-- so khớp Xóm phải ghép CHUNG với Thôn (dạng "Thôn||Xóm", xem xomKey() ở
-- js/state.js) — KHÔNG được so khớp riêng mỗi tên Xóm, vì tên Xóm (VD:
-- "Xóm 8") có thể trùng nhau giữa nhiều Thôn khác nhau; so khớp riêng lẻ sẽ
-- cấp NHẦM quyền xem Xóm cùng tên ở Thôn khác (lỗi thật đã gặp — xem mục
-- "Sửa lỗi trùng tên Xóm" bên dưới nếu policy trên project đang là bản cũ).
create policy "staff sees scoped customers" on customers
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id') and a.role = 'staff'
        and (thon = any(a.allowed_thon) or (thon || '||' || xom) = any(a.allowed_xom))
    )
  );

-- Admin xem hợp đồng: super thấy tất cả, staff chỉ thấy hợp đồng của khách trong phạm vi được gán
create policy "admin sees contracts in scope" on contracts
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from customers c
      join admins a on a.id = (auth.jwt() ->> 'row_id')
      where c.id = contracts.customer_id
        and (a.role = 'super' or c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
    )
  );

-- Admin/nhân viên xem được danh sách quản trị viên (VD: trang Quản lý User)
create policy "admin sees admins" on admins
  for select using ((auth.jwt() ->> 'app_role') = 'admin');

-- Yêu cầu tư vấn/vay mới: khách tự tạo + tự xem của chính mình, KHÔNG qua
-- Edge Function nào (không nhạy cảm — chỉ cần RLS chặn đúng customer_id là
-- của chính người gọi, không tin trình duyệt tự khai customer_id khác).
-- NGOẠI LỆ: yêu cầu type='quen_mat_khau' (khách quên mật khẩu, bấm ở màn
-- đăng nhập lúc CHƯA có JWT) được Edge Function "forgot-password" ghi thẳng
-- bằng service_role (bỏ qua RLS) SAU KHI đã tự xác minh CCCD+SĐT khớp đúng
-- 1 khách hàng có thật — xem code trong supabase/functions/create-account/index.ts.
create policy "customer creates own request" on requests
  for insert with check (
    (auth.jwt() ->> 'app_role') = 'customer'
    and customer_id = (auth.jwt() ->> 'row_id')
  );
create policy "customer sees own requests" on requests
  for select using (
    (auth.jwt() ->> 'app_role') = 'customer'
    and customer_id = (auth.jwt() ->> 'row_id')
  );
create policy "admin sees requests in scope" on requests
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from customers c
      join admins a on a.id = (auth.jwt() ->> 'row_id')
      where c.id = requests.customer_id
        and (a.role = 'super' or c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
    )
  );
create policy "admin updates requests" on requests
  for update using ((auth.jwt() ->> 'app_role') = 'admin');
```

**Nếu gặp lỗi "Không thể gửi yêu cầu tư vấn" (khách bấm Gửi mà báo lỗi) hoặc
"admin bấm Cập nhật trạng thái mà không có gì xảy ra"**: nhiều khả năng dự án
đang thiếu đúng 3 policy ở trên (`customer creates own request`,
`customer sees own requests`, `admin updates requests`) — có thể vì được thêm
vào tài liệu SAU lúc bạn đã chạy SQL ban đầu nên chưa chạy riêng đoạn này.
Chạy lại đoạn idempotent sau trong SQL Editor (an toàn chạy lại nhiều lần):
```sql
drop policy if exists "customer creates own request" on requests;
create policy "customer creates own request" on requests
  for insert with check (
    (auth.jwt() ->> 'app_role') = 'customer'
    and customer_id = (auth.jwt() ->> 'row_id')
  );
drop policy if exists "customer sees own requests" on requests;
create policy "customer sees own requests" on requests
  for select using (
    (auth.jwt() ->> 'app_role') = 'customer'
    and customer_id = (auth.jwt() ->> 'row_id')
  );
drop policy if exists "admin sees requests in scope" on requests;
create policy "admin sees requests in scope" on requests
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from customers c
      join admins a on a.id = (auth.jwt() ->> 'row_id')
      where c.id = requests.customer_id
        and (a.role = 'super' or c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
    )
  );
drop policy if exists "admin updates requests" on requests;
create policy "admin updates requests" on requests
  for update using ((auth.jwt() ->> 'app_role') = 'admin');
```

-- orgs (banner + thông tin ngân hàng): ai cũng xem được (kể cả chưa đăng
-- nhập — màn đăng nhập cần hiện tên quỹ), không nhạy cảm vì số tài khoản
-- ngân hàng vốn phải công khai để khách chuyển khoản. CHỈ super admin sửa.
create policy "anyone sees org" on orgs for select using (true);
create policy "super admin updates org" on orgs
  for update using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (select 1 from admins a where a.id = (auth.jwt() ->> 'row_id') and a.role = 'super')
  );

## 5b. Sửa lỗi trùng tên Xóm giữa nhiều Thôn (BẮT BUỘC chạy nếu project đã tạo trước đoạn này)

**Lỗi thật đã gặp**: cấp quyền staff xem "Xóm 8" của "Thôn Bình Nguyên" thì staff đó lại xem được
CẢ "Xóm 8" của mọi Thôn khác — vì code cũ (cả policy RLS lẫn code app) so khớp CHỈ riêng tên Xóm,
không ghép kèm Thôn, mà tên Xóm hoàn toàn có thể trùng nhau giữa các Thôn khác nhau. Đây là lỗi lộ
dữ liệu THẬT ở tầng RLS (server), không chỉ hiển thị sai trên giao diện — **cần chạy SQL bên dưới
trên project Supabase thật của bạn** (không tự động áp dụng — sửa trong file này chỉ là cập nhật tài
liệu tham khảo cho project TẠO MỚI):

```sql
drop policy if exists "staff sees scoped customers" on customers;
create policy "staff sees scoped customers" on customers
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id') and a.role = 'staff'
        and (thon = any(a.allowed_thon) or (thon || '||' || xom) = any(a.allowed_xom))
    )
  );

drop policy if exists "admin sees contracts in scope" on contracts;
create policy "admin sees contracts in scope" on contracts
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from customers c
      join admins a on a.id = (auth.jwt() ->> 'row_id')
      where c.id = contracts.customer_id
        and (a.role = 'super' or c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
    )
  );

drop policy if exists "admin sees requests in scope" on requests;
create policy "admin sees requests in scope" on requests
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from customers c
      join admins a on a.id = (auth.jwt() ->> 'row_id')
      where c.id = requests.customer_id
        and (a.role = 'super' or c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
    )
  );
```

**Sau khi chạy SQL trên**, dữ liệu `allowed_xom` cũ đã lưu trong bảng `admins` (dạng tên Xóm trần,
VD: `"Xóm 8"`) sẽ KHÔNG còn khớp với policy mới nữa (policy mới cần dạng `"Thôn||Xóm"`, xem `xomKey()`
ở `js/state.js`) — coi như quyền xem theo Xóm riêng lẻ (không phải "cả Thôn") của các staff đã cấu
hình trước đó bị reset về rỗng. **Việc cần làm thêm**: vào **Quản lý User → mở từng quản trị viên
"chỉ xem" đang có gán quyền theo Xóm riêng lẻ → tích lại đúng Xóm cần thiết → Lưu quyền** — chỉ ảnh
hưởng staff được gán theo TỪNG XÓM riêng, staff được gán theo CẢ THÔN (allowed_thon) không bị ảnh
hưởng gì (Thôn không có vấn đề trùng tên tương tự).

## 5c. Bắt buộc đổi mật khẩu lần đầu cho quản trị viên/nhân viên (BẮT BUỘC chạy nếu project đã tạo trước đoạn này)

Trước đây bảng `admins` thiếu hẳn 3 cột `must_change_password`/`failed_attempts`/`locked_until` mà
`customers` đã có — nên quản trị viên/nhân viên mới tạo (hoặc bị admin cấp lại mật khẩu) đăng nhập
lần đầu KHÔNG bị bắt đổi mật khẩu như khách hàng, và cơ chế khóa tạm sau nhiều lần sai mật khẩu
(code đã viết sẵn cho cả 2 vai trò, xem type: 'login' trong Edge Function) thực ra ÂM THẦM không có
tác dụng gì với admin (lệnh `update` nhắm vào cột không tồn tại, PostgREST báo lỗi ở tầng gọi nhưng
kết quả lỗi đó không được kiểm tra nên không ai biết). Chạy SQL sau (idempotent, chạy lại không sao):

```sql
alter table admins add column if not exists must_change_password boolean default true;
alter table admins add column if not exists failed_attempts int default 0;
alter table admins add column if not exists locked_until timestamptz;
```

**Lưu ý**: `default true` áp dụng cho CẢ những dòng đã có sẵn (Postgres tự điền `true` cho toàn bộ
admin/staff hiện tại, không chỉ dòng tạo mới sau này) — nghĩa là **mọi quản trị viên/nhân viên đang
có sẽ bị bắt đổi mật khẩu ở lần đăng nhập kế tiếp**, kể cả tài khoản đã dùng lâu. Đây là chủ đích (đồng
bộ với khách hàng, tăng bảo mật), nhưng cần báo trước cho các quản trị viên/nhân viên khác biết để
khỏi bất ngờ. Nếu muốn CHỈ áp dụng cho tài khoản tạo mới từ giờ trở đi (giữ nguyên tài khoản cũ không
bị bắt đổi), chạy thêm dòng này NGAY SAU đoạn trên để đặt lại `false` cho các dòng đã có từ trước:

```sql
update admins set must_change_password = false where created_at < now();
```

### Việc cần bạn làm để deploy Edge Function
1. Vào Supabase Dashboard → menu ☰ → **Edge Functions** → tạo/mở function (tên gì cũng được, URL
   thật mới là thứ quan trọng — báo lại cho Claude biết URL thật để cập nhật code app).
2. Copy toàn bộ nội dung file `supabase/functions/create-account/index.ts` trong repo này, dán vào
   — **Deploy**.
3. Vào **Project Settings → API → JWT Settings**, tìm dòng **"JWT Secret"** (hoặc "Legacy JWT
   Secret" nếu project mới hiển thị khác — nếu không thấy chữ nào giống vậy, chụp màn hình gửi tôi,
   Supabase hay đổi giao diện phần này).
4. Copy giá trị đó → vào **Edge Functions → Secrets** (dùng chung cho mọi function trong project,
   không cần thêm lại từng function) → thêm secret mới, đặt tên
   **`CUSTOM_JWT_SECRET`**, dán giá trị vừa copy vào → Save. **Không dán giá trị này vào chat** —
   đây là bí mật thật, khác hẳn URL/anon key.
5. Chạy đoạn SQL ở mục "RLS policy" trên (SQL Editor như bước tạo bảng) — nhớ **bỏ dòng
   `references auth.users(id)`** nếu bạn đã chạy schema cũ trước đó (chạy `alter table customers
   drop constraint if exists customers_auth_user_id_fkey;` và tương tự cho `admins` trước khi thêm
   lại default `gen_random_uuid()` nếu cần).

## 5d. Cho phép nhân viên "chỉ xem" được cấp thêm quyền Quản lý User (BẮT BUỘC chạy nếu project đã tạo trước đoạn này)

Trước đây trang "Quản lý User" (tạo/sửa/xóa Use + nhân viên khác, đổi vai trò) chỉ quản trị viên
**toàn quyền** vào được. Giờ thêm 1 cột `can_manage_users` trên bảng `admins` — tích cờ này cho 1 nhân
viên "chỉ xem" thì họ vào được hẳn trang Quản lý User, nhưng **CHỈ quản lý được Use KHÁCH HÀNG**
(tạo/cấp lại mật khẩu/khóa/xóa) — KHÔNG được tạo/sửa/xóa/xem chi tiết bất kỳ tài khoản Quản trị
viên/nhân viên nào khác (kể cả 1 nhân viên chỉ xem khác), server tự chặn 403 nếu cố gọi, UI cũng tự ẩn
hết nút liên quan. Chạy SQL sau (idempotent, chạy lại không sao):

```sql
alter table admins add column if not exists can_manage_users boolean default false;
```

Sau khi chạy xong, **deploy lại Edge Function `create-account`** (đã sửa thêm 2 type mới
`update-staff-role` và mở rộng `update-staff-permissions`/`staff` để hỗ trợ cờ này) — xem hướng dẫn
deploy ở mục 5 phía trên (copy code mới dán đè, Deploy).

## 5e. Ghi lại "lần đăng nhập" thật cho khách hàng (BẮT BUỘC chạy nếu project đã tạo trước đoạn này)

Cho 2 chấm trạng thái (đăng nhập/bật thông báo) ở trang Khách hàng & Hợp đồng / Quản lý User: trước
đây suy ra "đã đăng nhập" từ cờ `must_change_password` (sai — khách đăng nhập thành công rồi thoát
ngang khi CHƯA đổi xong mật khẩu bắt buộc lần đầu vẫn bị tính nhầm là "chưa đăng nhập"). Giờ thêm cột
`last_login_at`, ghi lại NGAY khi khách xác minh mật khẩu đúng (Edge Function `create-account`, type
`login`). Chạy SQL sau (idempotent, chạy lại không sao):

```sql
alter table customers add column if not exists last_login_at timestamptz;
```

Sau khi chạy xong, **deploy lại Edge Function `create-account`** (bản mới nhất, xem cuối tin nhắn có
đoạn code) rồi báo khách hàng nào đăng nhập lại 1 lần thì chấm mới đúng — các khách đã đăng nhập từ
TRƯỚC lúc chạy đoạn này vẫn hiện "chưa đăng nhập" cho tới khi họ đăng nhập lại lần kế tiếp (dữ liệu cũ
không có cách nào suy ngược lại được vì DB trước đó không lưu mốc này).

## 5f. Chấm "đã đăng nhập" chuyển thành "đang đăng nhập" (BẮT BUỘC chạy nếu project đã tạo trước đoạn này)

Mục 5e ở trên cho chấm "đã đăng nhập" (lịch sử, không đổi khi khách đăng xuất). Giờ đổi sang nghĩa
"ĐANG đăng nhập" (còn phiên hoạt động) — bật NGAY lúc đăng nhập, tắt NGAY lúc khách bấm "Đăng xuất".
Thêm cột `is_online` trên bảng `customers`. Chạy SQL sau (idempotent, chạy lại không sao):

```sql
alter table customers add column if not exists is_online boolean default false;
```

Sau khi chạy xong, **deploy lại Edge Function `create-account`** (bản mới nhất — thêm type
`customer-logout`, mở rộng type `login`) — xem hướng dẫn deploy ở mục 5 phía trên. Khách nào đang có
phiên đăng nhập TỪ TRƯỚC lúc chạy đoạn này (chưa đăng nhập lại) sẽ hiện "chưa đăng nhập" cho tới khi
họ đăng nhập lại 1 lần nữa — không có cách nào suy ngược lại được.

Lưu ý: nếu khách tắt app/đóng trình duyệt/rớt mạng mà KHÔNG bấm nút "Đăng xuất", server không có cách
nào chủ động biết để tắt `is_online` ngay — trường hợp này chấm vẫn hiện xanh cho tới khi qua mốc hiển
thị 1 năm (thuần túy để chấm không kẹt xanh mãi trên màn hình admin — xem `CUSTOMER_SESSION_HOURS` trong
`js/state.js`; **không phải hạn phiên đăng nhập thật**, xem mục 5g bên dưới — phiên đăng nhập thật giờ
không tự hết hạn nữa). Đây là giới hạn tự nhiên của cách đăng nhập bằng JWT (không có kết nối trực
tiếp/thường trực tới server để biết khách còn mở app hay không), không phải lỗi.

## 5g. Bỏ hẳn tự động đăng xuất theo thời gian — duy trì đăng nhập vĩnh viễn

Trước đây phiên đăng nhập (JWT) có hiệu lực 8 tiếng, sau đó tăng lên 1 năm — khách/nhân viên vẫn có thể
bị bắt đăng nhập lại sau 1 khoảng thời gian dài. Giờ **bỏ hẳn** mốc thời gian này: JWT cấp ra không còn
field `exp` (hết hạn) nữa — đăng nhập 1 lần là **duy trì vĩnh viễn**, không bao giờ tự bắt đăng nhập lại
chỉ vì thời gian trôi qua. Chỉ hết khi khách/nhân viên **tự bấm "Đăng xuất"**, hoặc tự xóa dữ liệu trình
duyệt (localStorage) trên máy đó.

Không cần đổi gì trong CSDL — chỉ cần **deploy lại Edge Function `create-account`** (bản mới nhất, xem
cuối tin nhắn có đoạn code) là áp dụng ngay cho các lượt đăng nhập MỚI (JWT đã cấp từ trước lúc deploy
vẫn giữ nguyên hạn cũ đã ký — 8 tiếng hoặc 1 năm tùy lúc đăng nhập — không tự gỡ hạn ngược; khách/nhân
viên cần đăng nhập lại 1 lần mới nhận được JWT không hạn).

Đánh đổi cần biết: JWT bị lộ (máy bị mất/lộ) thì kẻ xấu dùng được **vĩnh viễn**, không tự hết hạn —
chấp nhận được với quy mô app này (khách hàng quen biết, không phải app tài chính công khai quy mô
lớn). Đổi mật khẩu KHÔNG tự vô hiệu hóa JWT cũ đang có sẵn (không có cơ chế thu hồi token) — muốn thật
sự "đăng xuất mọi nơi" cho 1 tài khoản thì hiện tại chưa hỗ trợ, cần đổi `CUSTOM_JWT_SECRET` (sẽ làm
MỌI JWT đang có của TẤT CẢ tài khoản hết hiệu lực cùng lúc, không riêng 1 người) — chỉ nên làm khi thật
sự cần thiết (nghi lộ khóa bí mật).

## 6. Gắn Supabase JS client vào code (giữ đúng kiến trúc "0 dependency, ES Module thuần")

Dự án hiện không dùng bundler/npm — vẫn giữ được điều đó bằng import map trỏ tới CDN ESM:

`index.html` — thêm trước script chính:
```html
<script type="importmap">
{ "imports": { "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2" } }
</script>
```

`js/lib/supabaseClient.js` (file mới):
```js
import { createClient } from '@supabase/supabase-js';

// URL + anon key được phép public — bảo mật thật nằm ở RLS (mục 4), không phải ở đây.
const SUPABASE_URL = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

## 7. Chiến lược thay thế trong `state.js`

Không cần viết lại toàn bộ UI — `state.js` đang có sẵn pattern `notify()`/`subscribe()` (pub-sub),
các view chỉ gọi hàm public (`S.listCustomers()`, `S.upsertContract()`...) chứ không đụng trực tiếp
vào `localStorage`. Vì vậy chỉ cần thay **bên trong** các hàm đó:

- `persist()` (hiện đang `localStorage.setItem(...)`) → xóa hẳn, vì giờ Postgres tự lưu.
- Các hàm đọc (`listCustomers`, `getContract`...) → giữ nguyên chữ ký, nhưng lấy dữ liệu từ 1 cache
  trong bộ nhớ được nạp sẵn lúc khởi động (`await supabase.from('customers').select('*')`), thay vì
  đọc trực tiếp `state.customers`.
- Các hàm ghi (`upsertCustomer`, `upsertContract`, `deleteContract`...) → gọi
  `supabase.from(...).upsert(...)` / `.delete()`, đợi kết quả thành công rồi mới cập nhật cache +
  gọi `notify()` như cũ (để UI tự vẽ lại, không đổi gì ở tầng view).
- Import Excel (`importFromPastedTable`) → vẫn đọc file ở trình duyệt như hiện tại (không đổi), chỉ
  đổi bước cuối: thay vì gộp vào `state` rồi `persist()`, gọi 1 loạt `upsert` lên Supabase.
- Nên làm dần từng bảng một (VD: `requests` trước — ít rủi ro nhất), test kỹ, rồi mới sang
  `customers`/`contracts` (có PII, rủi ro cao hơn).

## 8. Việc còn lại sau khi chuyển xong

- [ ] OTP thật cho đăng nhập khách hàng (nếu chọn Hướng A ở mục 5, coi như xong luôn).
- [ ] Rà soát tuân thủ **Nghị định 13/2023/NĐ-CP** trước khi lưu CCCD khách hàng thật.
- [ ] Bật **Point-in-time Recovery** / backup định kỳ trong Supabase (gói trả phí).
- [ ] Security review độc lập trước khi cho khách hàng thật dùng (đã ghi trong README).

## 9. Thông báo đẩy (Push) — nhắc lịch đến hạn

Đăng nhập xong tự xin quyền thông báo NGAY (không cần tự vào trang Đổi mật khẩu bấm nút bật nữa) →
nhận thông báo thẳng trên điện thoại theo đúng lịch — **kể cả khi không mở app**, miễn đã "Thêm vào
Màn hình chính" (bắt buộc với iPhone, xem `docs/dong-goi-android.md`). Trình duyệt vẫn bắt buộc tự
người dùng bấm "Cho phép" ở đúng hộp thoại xin quyền thật — không có cách nào bỏ qua bước này (quy
định bảo mật chung của mọi trình duyệt, không phải giới hạn riêng của app); từ chối 1 lần thì trình
duyệt tự nhớ, không hỏi lại nữa (vào cài đặt trình duyệt tự bật lại nếu đổi ý). Nút bật/tắt thủ công ở
trang Đổi mật khẩu vẫn còn, dùng khi cần tắt hẳn hoặc bật lại sau khi đổi ý. Kiến trúc dùng chuẩn **Web
Push** (không phụ thuộc Firebase/dịch vụ ngoài trả phí nào khác). Lịch nhắc
(`supabase/functions/send-due-reminders/index.ts`), quét lại **mỗi ngày** qua Supabase Cron:

1. **Lãi**: nhắc lại đúng **ngày trong tháng** của "Đã trả lãi đến ngày", bắt đầu từ **tháng sau** — VD:
   trả lãi đến ngày 17/08 thì 17/09 nhắc, rồi 17/10, 17/11... nhắc liên tục mỗi tháng cho tới khi khách
   đóng lãi (ngày "Đã trả lãi đến" đổi mới thì chu kỳ tự tính lại từ ngày mới). Riêng hợp đồng **mới giải
   ngân** — hệ thống tự set "Đã trả lãi đến ngày" = ngày giải ngân + 1 (quy ước tính lãi, không phải
   khách đã đóng lãi thật) — thì lấy **ngày giải ngân** làm mốc thay vì ngày bị lệch +1 đó.
2. **Gần đến hạn / quá hạn**: bắt đầu từ đúng **10 ngày trước** ngày đến hạn, nhắc lại mỗi **3 ngày** 1
   lần (10, 7, 4, 1 ngày trước hạn, rồi tiếp tục mỗi 3 ngày sau khi quá hạn) **liên tục cho tới khi tất
   toán** — không dừng lại như phiên bản trước. Trước ngày đến hạn: nhắc số tiền **gốc** sắp đến hạn +
   hạn chót thanh toán. Từ đúng ngày đến hạn trở đi: nhắc cả **gốc lẫn lãi**, lời lẽ mạnh hơn hẳn (khách
   đã trễ hạn thật).

Ngoài lịch tự động trên, **admin có thể tự soạn + gửi ngay 1 thông báo** cho 1 khách hàng bất kỳ — mở
chi tiết khách hàng (trang Khách hàng & Hợp đồng hoặc Quản lý User) → nút **"Gửi thông báo"** → nhập
tiêu đề + nội dung → Gửi ngay. Khách phải đã bật thông báo trên ít nhất 1 thiết bị thì mới gửi được
(báo lỗi rõ nếu chưa bật). Dùng chung y hệt 4 secret VAPID đã đặt ở mục 9.3 bên dưới, không cần thêm
secret nào khác.

```
Trình duyệt --(xin quyền + subscribe)--> Trình duyệt tự tạo "địa chỉ nhận"
  --(gửi lên)--> Edge Function "create-account" (type: save-push-subscription)
  --(lưu)--> bảng push_subscriptions
                                                                    |
Supabase Cron (chạy định kỳ, VD: mỗi ngày 8h sáng) ------------------
  --> gọi Edge Function "send-due-reminders" --> quét contracts + push_subscriptions
  --> gửi Web Push thật (ký bằng khóa VAPID) --> Service Worker (sw.js) nhận & hiện thông báo
```

### 9.1. Schema (SQL Editor)

```sql
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('customer', 'admin')),
  owner_id text not null,
  endpoint text not null unique, -- 1 thiết bị/trình duyệt = 1 endpoint riêng, unique tự chống đăng ký trùng
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
create index on push_subscriptions (owner_type, owner_id);

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  kind text not null, -- 'gan_den_han' | 'qua_han' | 'monthly'
  contract_id text references contracts(id) on delete cascade, -- null với kind='monthly' (nhắc chung, không gắn 1 hợp đồng)
  sent_at timestamptz not null default now()
);
create index on notification_log (owner_id, kind, contract_id, sent_at);

alter table push_subscriptions enable row level security;
alter table notification_log enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on push_subscriptions, notification_log to anon, authenticated, service_role;

-- Chỉ chính chủ (qua JWT tự ký, xem mục 5) mới thấy/sửa được subscription của
-- mình — thực tế app luôn gọi qua Edge Function (service_role, bỏ qua RLS)
-- nên policy này là lớp phòng thủ thêm, không phải đường đi chính.
create policy "owner manages own push subscription" on push_subscriptions
  for all using (owner_id = (auth.jwt() ->> 'row_id'))
  with check (owner_id = (auth.jwt() ->> 'row_id'));

-- (Thêm mới) Cho phép admin/nhân viên XEM (chỉ select) ai đã bật thông báo —
-- dùng cho "2 chấm trạng thái" (đăng nhập/bật thông báo) ở trang Khách hàng &
-- Hợp đồng và Quản lý User. Nhân viên "chỉ xem" chỉ thấy trong đúng Thôn/Xóm
-- được gán, giống hệt cách "staff sees scoped customers" ở mục 5 lọc phạm vi.
create policy "admin sees push subscriptions in scope" on push_subscriptions
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and owner_type = 'customer'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (
          a.role = 'super'
          or exists (
            select 1 from customers c
            where c.id = push_subscriptions.owner_id
              and (c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
          )
        )
    )
  );

-- notification_log KHÔNG có policy nào cho anon/authenticated — RLS bật mà
-- không có policy = chặn hết với 2 vai trò đó, CHỦ ĐÍCH: bảng này chỉ
-- Edge Function "send-due-reminders" (dùng service_role, tự bỏ qua RLS) được
-- đọc/ghi, không ai qua trình duyệt cần đụng tới.
```

### 9.2. Tạo khóa VAPID (chữ ký cho Web Push — làm 1 lần duy nhất)

Đã tự sinh sẵn 1 cặp khóa thật cho bạn (không phải để trống chờ bạn tự tạo) — **Claude đã gửi riêng
2 giá trị `VAPID_PRIVATE_KEY` và `CRON_SECRET` trong tin nhắn chat**, không lưu trong file này/repo vì
đây là bí mật thật. Khóa CÔNG KHAI đã có sẵn trong code (`js/lib/push.js`), không cần làm gì thêm với
khóa đó.

*(Nếu muốn tự tạo cặp khóa khác về sau — VD: đổi sang project Supabase khác — chạy `npx web-push
generate-vapid-keys` bằng Node, rồi thay khóa công khai mới vào `js/lib/push.js` + khóa riêng mới vào
secret `VAPID_PRIVATE_KEY` bên dưới.)*

### 9.3. Việc cần bạn làm để deploy

1. Chạy SQL ở mục 9.1 trên Supabase Dashboard → SQL Editor.
2. Deploy Edge Function **`send-due-reminders`** (function MỚI, khác với `create-account`):
   Supabase Dashboard → Edge Functions → **Create a new function**, đặt tên `send-due-reminders` →
   copy toàn bộ nội dung `supabase/functions/send-due-reminders/index.ts` trong repo → **Deploy**.
   (Function `create-account` cũng có thay đổi nhỏ — nhớ deploy lại function đó nữa, xem mục 5
   "Việc cần bạn làm để deploy Edge Function".)
3. Vào **Edge Functions → Secrets**, thêm các secret sau (dùng chung cho mọi function trong project):
   - `VAPID_PUBLIC_KEY` — dán giá trị Claude gửi (khớp đúng khóa công khai đã có sẵn trong
     `js/lib/push.js`).
   - `VAPID_PRIVATE_KEY` — dán giá trị Claude gửi riêng trong chat. **Không dán vào đây bất kỳ đâu
     khác, không commit lên git.**
   - `VAPID_SUBJECT` — 1 email liên hệ thật dạng `mailto:ten@email.com` (dịch vụ push dùng liên hệ
     nếu key có vấn đề, không hiện ra cho khách hàng thấy).
   - `CRON_SECRET` — dán giá trị Claude gửi riêng trong chat (chuỗi ngẫu nhiên, dùng để Cron Job xác
     thực với `send-due-reminders`, chặn người ngoài gọi tràn lan gửi thông báo giả).
4. Đặt lịch chạy định kỳ — **Supabase Dashboard → Database → Cron Jobs** (hoặc chạy SQL sau trong SQL
   Editor nếu bản Dashboard chưa có mục này, cần bật extension `pg_cron` + `pg_net` trước — Dashboard
   thường tự bật sẵn 2 extension này):

```sql
select cron.schedule(
  'send-due-reminders-daily',
  '0 1 * * *', -- 1h sáng UTC = 8h sáng giờ Việt Nam
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-due-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET_giống_hệt_secret_đã_đặt_ở_bước_3>'
    )
  );
  $$
);
```

Thay `<project-ref>` bằng đúng project ref của bạn (xem trong URL Supabase Dashboard), và
`<CRON_SECRET_...>` bằng đúng giá trị Claude đã gửi. Chạy xong, mỗi ngày 8h sáng hệ thống tự quét và
gửi thông báo — không cần làm gì thêm.

### 9.4. Giới hạn hiện tại (v1)

- Chỉ gửi cho **khách hàng** (nhắc lịch hợp đồng của chính họ) — quản trị viên/nhân viên đã có sẵn hạ
  tầng đăng ký (bảng `push_subscriptions` hỗ trợ `owner_type='admin'`) nhưng CHƯA có nội dung nhắc
  riêng cho vai trò này (VD: "X hợp đồng quá hạn trong phạm vi bạn quản lý") — có thể bổ sung sau nếu
  cần, chỉ cần thêm đoạn quét tương ứng trong `send-due-reminders`.
- iOS (iPhone) cần iOS 16.4 trở lên VÀ đã "Thêm vào Màn hình chính" trước mới nhận được thông báo —
  mở bằng Safari thường (chưa cài) sẽ không xin được quyền thông báo trên iPhone. Máy tính và Android
  (Chrome) thì nhận được bình thường, không bắt buộc phải cài.
- Cron BẮT BUỘC chạy đúng **mỗi ngày** (không được thưa hơn) — các mốc "sắp đến hạn" (5 ngày trước)
  và "đến hạn" (đúng ngày) chỉ khớp ĐÚNG 1 ngày duy nhất; cron bỏ lỡ ngày đó (VD: chạy cách ngày) thì
  mốc đó coi như trôi qua, không tự bù lại. Mốc "trễ hạn" (nhắc mỗi ngày) không bị ảnh hưởng vì luôn
  đúng miễn ngày đến hạn đã qua.
- Đổi số ngày (chu kỳ lãi 30 ngày, nhắc trước 5 ngày...) → sửa 2 hằng số `INTEREST_CYCLE_DAYS` và
  `NOTIFY_BEFORE_DUE_DAYS` ở đầu file `send-due-reminders/index.ts`.

## 10. Gửi thông báo qua Zalo OA (ZBS Template Message) — nhắc nợ khi ĐẾN HẠN/QUÁ HẠN

Gửi song song với thông báo đẩy (Web Push) ở mục 9 — KHÔNG thay thế, mà thêm 1 kênh nữa, riêng cho
tình huống hợp đồng đến/quá hạn (dùng mẫu tin đã đăng ký và được Zalo duyệt, xem trang "Quản lý OA"
trong app để chọn mẫu). Nếu chưa cấu hình Template ID nào thì hệ thống tự bỏ qua bước gửi Zalo, không
ảnh hưởng gì đến thông báo đẩy.

### 10.1. Schema (SQL Editor)

```sql
-- Lưu Template ID (không nhạy cảm) — quản lý qua trang "Quản lý OA" trong app,
-- admin toàn quyền chỉnh được (đúng policy "super admin updates org" đã có sẵn ở mục 3/4).
alter table orgs add column if not exists zalo_template_due_id text;

-- Access Token/Refresh Token của Zalo OA — KHÔNG lưu vào bảng orgs (bảng đó
-- cho SELECT công khai, kể cả chưa đăng nhập — lộ token thật ra ngoài). Bảng
-- riêng này bật RLS nhưng KHÔNG tạo policy nào cho anon/authenticated =>
-- hoàn toàn không ai qua trình duyệt (kể cả admin) đọc/sửa được — chỉ Edge
-- Function "send-due-reminders" (dùng service_role, tự bỏ qua RLS) đụng tới.
create table if not exists zalo_oa_tokens (
  id text primary key,
  refresh_token text not null,
  access_token text,
  updated_at timestamptz default now()
);
alter table zalo_oa_tokens enable row level security;
grant usage on schema public to service_role;
grant select, insert, update on zalo_oa_tokens to service_role;

-- Nạp Refresh Token BAN ĐẦU (lấy từ API Explorer bên Zalo for Developers) —
-- THAY ĐÚNG GIÁ TRỊ REFRESH TOKEN THẬT của bạn vào chỗ '<REFRESH_TOKEN_CỦA_BẠN>'
-- trước khi chạy (không dán chuỗi ví dụ này nguyên văn, và KHÔNG commit giá
-- trị thật lên GitHub ở bất kỳ đâu — chỉ chạy 1 lần ngay trong SQL Editor).
insert into zalo_oa_tokens (id, refresh_token) values ('default', '<REFRESH_TOKEN_CỦA_BẠN>')
on conflict (id) do update set refresh_token = excluded.refresh_token;
```

### 10.2. Việc cần bạn làm để deploy

1. Chạy SQL ở mục 10.1 trên Supabase Dashboard → SQL Editor (nhớ thay đúng Refresh Token thật vào
   trước khi chạy dòng `insert`).
2. Deploy lại Edge Function **`send-due-reminders`** (đã sửa thêm phần gửi Zalo) — Supabase Dashboard
   → Edge Functions → chọn function này → dán đè toàn bộ nội dung file `supabase/functions/send-due-reminders/index.ts`
   trong repo → **Deploy**.
3. Vào **Edge Functions → Secrets**, thêm 2 secret mới:
   - `ZALO_APP_ID` — App ID lấy từ Zalo for Developers (App đã tạo, liên kết với OA).
   - `ZALO_SECRET_KEY` — Khóa bí mật của App đó (mục Cài đặt của App). **Không dán vào đây bất kỳ đâu
     khác, không commit lên git.**
4. Vào app → **Quản lý OA** (menu chỉ quản trị viên toàn quyền thấy) → điền **Template ID** của mẫu
   tin dùng cho tình huống "Đến hạn/Quá hạn" (mẫu phải ở trạng thái "Đã duyệt" bên Zalo) → Lưu.

Xong cả 4 bước, lần chạy cron kế tiếp (xem mục 9.3) sẽ tự gửi Zalo cho khách hàng đến/quá hạn có số
điện thoại, song song với thông báo đẩy — không cần làm gì thêm định kỳ. Access Token tự làm mới bằng
Refresh Token mỗi lần chạy; Refresh Token do Zalo trả về mới hơn cũng tự ghi đè lại vào bảng
`zalo_oa_tokens`, không cần bạn tự lấy lại trừ khi Zalo báo Refresh Token hết hạn hẳn (thường sau vài
tháng không dùng).

### 10.3. Giới hạn hiện tại (v1)

- Mới chỉ có mẫu tin cho tình huống **"Đến hạn/Quá hạn"** (Template ID lưu ở `orgs.zalo_template_due_id`).
  "Gần đến hạn" và "Lãi hàng tháng" chưa gửi Zalo (chỉ còn thông báo đẩy) — cần tạo thêm mẫu bên Zalo
  rồi báo lại để bổ sung code + thêm ô nhập Template ID tương ứng trong trang "Quản lý OA".
- Chỉ gửi cho khách hàng **có số điện thoại** trong hồ sơ — thiếu SĐT thì tự bỏ qua khách đó, không lỗi.
- Không tự kiểm tra hạn mức gửi/ngày (`dailyQuota`) trước khi gửi — nếu vượt hạn mức, Zalo sẽ trả lỗi
  và tin đó được ghi log lỗi (xem Supabase → Edge Functions → Logs), không tự động thử lại trong ngày
  đó (sẽ tự gửi lại vào lần nhắc kế tiếp theo lịch — mỗi 3 ngày — như bình thường).

### 10.4. Danh sách gửi tự động (opt-in) + phân quyền riêng + log gửi tin (BẮT BUỘC chạy nếu project đã tạo trước đoạn này)

Đổi hành vi so với 10.1-10.3: Zalo KHÔNG còn tự động gửi cho MỌI hợp đồng đến/quá hạn có SĐT nữa — chỉ
gửi cho hợp đồng đã được admin **chủ động thêm vào danh sách** (do Zalo không có cách xác minh trước
SĐT có đúng chủ hay không — xem trang "Quản lý OA" trong app). Đồng thời quyền quản lý gửi tin OA giờ
là 1 cờ RIÊNG (`can_manage_zalo_oa`) có thể cấp cho từng nhân viên, tách biệt hẳn với `can_manage_users`.

```sql
-- Cờ RIÊNG cho quyền quản lý gửi tin Zalo OA (không dùng chung can_manage_users).
alter table admins add column if not exists can_manage_zalo_oa boolean default false;

-- Danh sách hợp đồng đã được thêm để gửi Zalo tự động.
create table if not exists zalo_auto_send_list (
  id text primary key,
  contract_id text not null references contracts(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  kind text not null default 'den_han',
  created_by text,
  created_at timestamptz default now(),
  unique (contract_id, kind)
);
create index if not exists zalo_auto_send_list_customer_idx on zalo_auto_send_list (customer_id);

-- Log mọi lần gửi Zalo (tự động lẫn gửi tay) — thành công/lỗi, kèm nội dung lỗi.
create table if not exists zalo_send_log (
  id uuid primary key default gen_random_uuid(),
  contract_id text references contracts(id) on delete cascade,
  customer_id text not null,
  kind text not null,
  template_id text,
  phone text,
  status text not null check (status in ('success', 'error')),
  error_message text,
  triggered_by text not null check (triggered_by in ('auto', 'manual')),
  triggered_by_admin_id text,
  sent_at timestamptz not null default now()
);
create index if not exists zalo_send_log_contract_idx on zalo_send_log (contract_id, sent_at desc);
create index if not exists zalo_send_log_customer_idx on zalo_send_log (customer_id, sent_at desc);

alter table zalo_auto_send_list enable row level security;
alter table zalo_send_log enable row level security;
grant usage on schema public to anon, authenticated, service_role;
-- Chỉ cấp SELECT cho anon/authenticated (đọc để hiện lên trang "Quản lý OA")
-- — mọi thao tác thêm/xóa/ghi log đều đi qua Edge Function (service_role,
-- tự bỏ qua RLS), KHÔNG cho client ghi thẳng, xem type 'add-zalo-auto-send'/
-- 'remove-zalo-auto-send'/'send-zalo-manual' trong create-account/index.ts.
grant select on zalo_auto_send_list, zalo_send_log to anon, authenticated, service_role;
grant insert, update, delete on zalo_auto_send_list, zalo_send_log to service_role;

-- Chỉ admin có can_manage_zalo_oa=true (hoặc role='super') xem được, và
-- nhân viên "chỉ xem" CHỈ thấy đúng phạm vi Thôn/Xóm được gán — y hệt kiểu
-- "admin sees push subscriptions in scope" ở mục 9.
create policy "admin sees zalo auto send list in scope" on zalo_auto_send_list
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_manage_zalo_oa = true)
        and (
          a.role = 'super'
          or exists (
            select 1 from customers c
            where c.id = zalo_auto_send_list.customer_id
              and (c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
          )
        )
    )
  );

create policy "admin sees zalo send log in scope" on zalo_send_log
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_manage_zalo_oa = true)
        and (
          a.role = 'super'
          or exists (
            select 1 from customers c
            where c.id = zalo_send_log.customer_id
              and (c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
          )
        )
    )
  );
```

**Việc cần bạn làm**:
1. Chạy SQL ở trên trong SQL Editor.
2. Deploy lại **CẢ 2** Edge Function `create-account` và `send-due-reminders` (cả 2 đều có sửa) — dán
   đè toàn bộ nội dung file tương ứng trong repo, Deploy từng cái.
3. Không cần thêm secret mới cho phần này (dùng lại `ZALO_APP_ID`/`ZALO_SECRET_KEY` đã đặt ở mục 10.2).
4. Cấp quyền `can_manage_zalo_oa` cho nhân viên nào cần quản lý gửi tin OA — vào **Quản lý User** →
   chọn nhân viên → tích "Cho phép quản lý gửi tin Zalo OA" → Lưu quyền.
5. Vào chi tiết từng hợp đồng muốn gửi Zalo tự động (mục Khách hàng & Hợp đồng) → tích "Thêm vào danh
   sách gửi Zalo tự động" — hợp đồng nào KHÔNG tích thì cron sẽ KHÔNG gửi Zalo cho hợp đồng đó nữa (kể
   cả đã đến/quá hạn), chỉ còn thông báo đẩy như cũ.

### 10.5. 2 tầng danh sách OA (BẮT BUỘC chạy nếu project đã tạo trước đoạn này)

Đổi thêm so với 10.4, theo đúng yêu cầu:
- **Tầng 1 — "Danh sách đã thêm vào OA"** (bảng `zalo_customers`): theo KHÁCH HÀNG (không theo hợp
  đồng) — giống Use, KHÔNG tự xóa khi khách hết hợp đồng/dư nợ. Danh sách CHUNG — ai có quyền
  `canManageZaloOA` cũng xem/thêm được (trong đúng phạm vi Thôn/Xóm).
- **Tầng 2 — "Danh sách gửi tự động"** (bảng `zalo_auto_send_list` cũ): giờ RIÊNG TƯ theo từng nhân
  viên (chỉ người tự thêm mới thấy/xóa được lựa chọn của mình) — nhưng có ràng buộc DUY NHẤT 1 người
  được chọn 1 (hợp đồng, tình huống) tại 1 thời điểm; người khác cố chọn trùng bị chặn, báo rõ ai đã
  chọn. Bắt buộc khách phải có trong Tầng 1 trước mới thêm được vào Tầng 2 (ép bằng khóa ngoại).

```sql
create table if not exists zalo_customers (
  customer_id text primary key references customers(id) on delete cascade,
  added_by text,
  added_at timestamptz default now()
);
alter table zalo_customers enable row level security;
grant usage on schema public to anon, authenticated, service_role;
grant select on zalo_customers to anon, authenticated, service_role;
grant insert, update, delete on zalo_customers to service_role;
create policy "admin sees zalo customers in scope" on zalo_customers
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_manage_zalo_oa = true)
        and (
          a.role = 'super'
          or exists (
            select 1 from customers c
            where c.id = zalo_customers.customer_id
              and (c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
          )
        )
    )
  );

-- Nạp sẵn vào Tầng 1 những khách đã có trong Tầng 2 từ trước (mục 10.4) —
-- BẮT BUỘC chạy trước bước thêm khóa ngoại bên dưới, không thì bước đó lỗi
-- vì có dòng "treo" (customer_id chưa có trong zalo_customers).
insert into zalo_customers (customer_id, added_by, added_at)
select distinct customer_id, created_by, now() from zalo_auto_send_list
on conflict (customer_id) do nothing;

alter table zalo_auto_send_list add column if not exists custom_day int;
alter table zalo_auto_send_list drop constraint if exists zalo_auto_send_list_customer_id_fkey;
alter table zalo_auto_send_list add constraint zalo_auto_send_list_customer_id_fkey
  foreign key (customer_id) references zalo_customers(customer_id) on delete cascade;

-- Đổi policy xem Tầng 2: TỪ "cả nhóm cùng Thôn/Xóm đều thấy" SANG "chỉ
-- người tự chọn mới thấy" (super vẫn thấy hết).
drop policy if exists "admin sees zalo auto send list in scope" on zalo_auto_send_list;
create policy "admin sees own zalo auto send selections" on zalo_auto_send_list
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and (
      (auth.jwt() ->> 'row_id') = zalo_auto_send_list.created_by
      or exists (select 1 from admins a where a.id = (auth.jwt() ->> 'row_id') and a.role = 'super')
    )
  );
```

**Việc cần bạn làm**: chạy SQL trên (SQL Editor), rồi deploy lại `create-account` (có sửa thêm) —
`send-due-reminders` KHÔNG đổi ở bước này, không cần deploy lại.

### 10.6. "Đến hạn" tự động cho cả Danh sách OA + thêm mẫu "Báo lãi" (BẮT BUỘC nếu project đã tạo trước đoạn này)

Đổi thêm theo đúng yêu cầu:
- **"Đến hạn/Quá hạn" không cần chọn riêng từng hợp đồng nữa** — tự động áp dụng cho **MỌI hợp đồng**
  của khách đã có trong "Danh sách OA" (Tầng 1) — bỏ hẳn khỏi Tầng 2 "Gửi tin tự động".
- **Tầng 2 giờ chỉ còn đúng 2 mục** (loại trừ nhau — 1 hợp đồng chỉ ở 1 trong 2): **"Báo lãi tự động
  hàng tháng"** và **"Gửi theo ngày cụ thể"**.
- Thêm **Template ID thứ 2** (`zalo_template_interest_id`) cho mẫu **"Báo lãi"** (dùng chung cho cả 2
  mục Tầng 2 + cho gửi tay khi hợp đồng CHƯA đến hạn).
- Gửi tay ở chi tiết hợp đồng giờ **tự chọn mẫu**: chưa đến hạn → mẫu Báo lãi; gần đến hạn/quá hạn →
  mẫu Đến hạn — không cần tự chọn mẫu tay nữa.

```sql
alter table orgs add column if not exists zalo_template_interest_id text;

-- "Đến hạn" không còn cần chọn riêng từng hợp đồng — dọn các dòng kind
-- 'den_han' cũ (nếu có) khỏi Tầng 2, giờ vô nghĩa.
delete from zalo_auto_send_list where kind = 'den_han';

-- 1 hợp đồng chỉ được ở ĐÚNG 1 trong 2 mục còn lại — đổi ràng buộc duy nhất
-- từ (contract_id, kind) sang chỉ (contract_id) — PostgreSQL tự đặt tên
-- constraint dạng zalo_auto_send_list_contract_id_kind_key, dùng "if
-- exists" để an toàn dù tên có khác đôi chút.
alter table zalo_auto_send_list drop constraint if exists zalo_auto_send_list_contract_id_kind_key;
alter table zalo_auto_send_list add constraint zalo_auto_send_list_contract_id_key unique (contract_id);
```

**Việc cần bạn làm**: chạy SQL trên, deploy lại **CẢ 2** Edge Function (`create-account` và
`send-due-reminders` — cả 2 đều có sửa lần này), rồi vào **Quản lý OA → Cấu hình** điền thêm Template
ID cho "Mẫu Báo lãi" khi bạn tạo xong mẫu đó bên Zalo (để trống trước cũng được, không lỗi gì — chỉ là
lúc đó hợp đồng chưa đến hạn sẽ không gửi được Zalo cho tới khi điền).

### 10.7. Bỏ tự động gửi "Đến hạn", thêm giới hạn 5 ngày/lần cho gửi tay + điều kiện 20 ngày cho "Gửi theo ngày cụ thể" (KHÔNG cần chạy SQL — chỉ đổi hành vi trong code)

Đổi tiếp theo yêu cầu, không cần schema mới:

- **Bỏ hẳn tự động gửi Zalo mẫu "Đến hạn/Quá hạn"** — trước đây (mục 10.6) tự động gửi cho mọi hợp
  đồng đến/quá hạn của khách trong Danh sách OA; giờ mẫu này **CHỈ gửi được qua nút gửi tay** ở chi
  tiết hợp đồng. Thông báo đẩy (push) cho gần/đến hạn vẫn tự động như cũ, không đổi.
- **Gửi tay bắt buộc khách đã có sẵn trong Danh sách OA** (Tầng 1) — trước đây gửi tay sẽ TỰ ĐỘNG thêm
  khách vào OA luôn; giờ nếu chưa có sẽ báo lỗi "Khách hàng chưa có trong Danh sách OA", phải tự thêm
  trước (nút "Thêm vào OA"/"Bỏ khỏi OA" ở chi tiết khách hàng — mục Khách hàng & Hợp đồng lẫn Quản lý
  User).
- **Giới hạn gửi tay 5 ngày/lần cho mỗi hợp đồng** — tính theo lần gửi Zalo THÀNH CÔNG gần nhất (bất kể
  tự động hay gửi tay), báo rõ đã gửi ngày nào + còn bao nhiêu ngày nữa mới gửi lại được. Giao diện chi
  tiết hợp đồng cũng tự hiện cảnh báo này (và disable nút) TRƯỚC khi bấm, đỡ bấm hụt.
- **"Gửi theo ngày cụ thể"**: chỉ gửi nếu hợp đồng đã tính lãi > 20 ngày kể từ lần đóng lãi gần nhất —
  mới đóng lãi gần đây (≤ 20 ngày) thì bỏ qua đợt này, dồn qua đúng ngày đó tháng sau.
- **"Quản lý gửi tin"**: thêm bộ lọc theo trạng thái (Tất cả/Thành công/Lỗi) + khoảng thời gian (Từ
  ngày/Đến ngày).

**Việc cần bạn làm**: chỉ cần deploy lại **CẢ 2** Edge Function (`create-account` và
`send-due-reminders`) — không có SQL nào cần chạy thêm.

### 10.8. Thêm tham số NGAY_KE_HOACH, thêm "đ" sau số tiền trong mẫu OA + sửa lỗi bộ lọc/tìm kiếm còn sót lại sau khi đổi tài khoản (KHÔNG cần chạy SQL)

- **Mẫu Zalo OA**: thêm tham số `NGAY_KE_HOACH` = ngày GỬI tin (hôm nay) — khác với `NGAY_DAO_HAN` (ngày
  đến hạn thật của hợp đồng). Các tham số tiền (`SO_DU`, `GOC_PHAI_TRA`, `LAI_PHAI_TRA`,
  `SO_TIEN_CHUYEN_KHOAN`) giờ có thêm chữ **"đ"** ngay sau số (VD: `500000đ`).
- **Sửa lỗi**: bộ lọc/ô tìm kiếm ở trang Khách hàng & Hợp đồng, Quản lý OA, Yêu cầu tư vấn cố tình
  KHÔNG tự reset khi chuyển qua trang khác rồi quay lại (để tiện cho CÙNG 1 người) — nhưng biến lưu bộ
  lọc đó sống suốt vòng đời trang web (không phải theo phiên đăng nhập), nên đăng xuất xong đăng nhập
  tài khoản khác vẫn thấy nguyên bộ lọc/kết quả tìm kiếm của người trước để lại. Giờ `js/app.js` tự phát
  hiện đúng lúc ĐỔI người đăng nhập (so khớp "role:id") để reset các trang này — hoàn toàn ở phía trình
  duyệt (file .js tĩnh), không đụng gì tới Edge Function/Supabase.

**Việc cần bạn làm**: chỉ cần deploy lại **CẢ 2** Edge Function (`create-account` và
`send-due-reminders`) — phần sửa lỗi bộ lọc tự lên khi GitHub Pages deploy lại (không cần làm gì thêm
trên Supabase).

### 10.9. "Quản lý gửi tin" xem được TOÀN BỘ (bỏ giới hạn theo Thôn/Xóm) + thêm/bỏ OA không phụ thuộc chế độ chỉ xem (BẮT BUỘC chạy SQL nếu muốn có ngay)

- **"Quản lý gửi tin"**: trước đây nhân viên "chỉ xem" có quyền `can_manage_zalo_oa` chỉ thấy log gửi
  tin của khách trong đúng Thôn/Xóm được gán (giống các mục Zalo khác) — giờ đổi thành **bất kỳ ai có
  quyền `can_manage_zalo_oa` (hoặc super) đều xem được TOÀN BỘ log**, không giới hạn theo Thôn/Xóm nữa.
  Chỉ áp dụng cho `zalo_send_log` — "Danh sách OA" (`zalo_customers`) và "Gửi tin tự động"
  (`zalo_auto_send_list`, riêng tư theo từng người) vẫn giữ nguyên như cũ.
- **Thêm/bỏ OA ở chi tiết khách hàng**: sửa lỗi nút "Thêm vào OA"/"Bỏ khỏi OA" bị ẩn mất với nhân viên
  "chỉ xem" dù có quyền `can_manage_zalo_oa` — do màn chi tiết khách hàng mở ở chế độ chỉ xem (không sửa
  được hồ sơ) nên vô tình ẩn LUÔN cả 2 nút này. Giờ 2 nút này hiện độc lập với chế độ chỉ xem, chỉ cần
  có quyền `can_manage_zalo_oa` là thêm/bỏ được ngay từ trang Khách hàng & Hợp đồng.

```sql
drop policy if exists "admin sees zalo send log in scope" on zalo_send_log;
create policy "admin sees zalo send log" on zalo_send_log
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_manage_zalo_oa = true)
    )
  );
```

**Việc cần bạn làm**: chạy SQL trên trong SQL Editor — **không cần deploy Edge Function nào** (chỉ đổi
policy đọc dữ liệu + sửa file .js tĩnh, GitHub Pages tự deploy khi push `main`).

### 10.10. Sửa lỗi tự nhảy về trang chủ sau khi lưu form + sửa lỗi định dạng chuyển khoản trong mẫu OA (KHÔNG cần chạy SQL)

- **Sửa lỗi tự nhảy về trang chủ**: các thao tác kiểu "đóng modal này, mở ngay modal khác" (VD: xem chi
  tiết khách hàng → Sửa → Lưu) trước đây có thể làm lệch con trỏ lịch sử trình duyệt (do
  `history.back()` của modal cũ chạy BẤT ĐỒNG BỘ trong khi `history.pushState()` của modal mới chạy
  NGAY — 2 việc đua nhau) — dồn qua vài lượt trong 1 phiên có thể lùi quá xa tới 1 trang CŨ khác (VD:
  Tổng quan lúc mới đăng nhập), trông y hệt "tự nhảy về trang chủ" dù chỉ vừa lưu xong 1 form. Sửa tận
  gốc trong `js/components/modal.js` (hoãn `history.back()` sang tick sau, hủy đi + tái dùng đúng mục
  lịch sử nếu có modal khác mở ra ngay sau đó) — áp dụng cho MỌI modal trong app, không riêng gì sửa
  khách hàng.
- **Sửa lỗi định dạng chuyển khoản trong mẫu OA**: tham số `SO_TIEN_CHUYEN_KHOAN` gắn với nút chuyển
  khoản có sẵn của Zalo — validate rất nghiêm ngặt, thử cả "80.000.000 đ" lẫn "80.000.000" (có dấu chấm)
  đều báo lỗi định dạng, CHỈ nhận đúng chuỗi chữ số thuần (VD: `80000000`, không chấm không đ) — xem cập
  nhật tiếp ở mục 10.11. Giữ nguyên "đ" ở 3 trường còn lại (`SO_DU`, `GOC_PHAI_TRA`, `LAI_PHAI_TRA` —
  chỉ hiển thị trong nội dung tin, không gắn nút chuyển khoản nên không bị giới hạn định dạng).

**Việc cần bạn làm**: deploy lại **CẢ 2** Edge Function (`create-account` và `send-due-reminders`) cho
phần sửa định dạng chuyển khoản — phần sửa lỗi tự nhảy về trang chủ tự lên khi GitHub Pages deploy lại,
không cần làm gì thêm trên Supabase.

### 10.11. SO_TIEN_CHUYEN_KHOAN chỉ còn số thuần + thêm ô tìm kiếm Danh sách OA + Danh sách OA cho TOÀN BỘ admin có quyền xem (BẮT BUỘC chạy SQL cho phần cuối)

- **SO_TIEN_CHUYEN_KHOAN**: bỏ luôn dấu chấm ngăn hàng nghìn (mục 10.10 vẫn còn báo lỗi) — giờ chỉ còn
  đúng chuỗi chữ số, không chấm không đ.
- **"Danh sách OA"**: thêm ô tìm kiếm theo tên/SĐT (kết hợp được với bộ lọc Thôn/Xóm sẵn có).
- **"Danh sách OA" cho TOÀN BỘ admin có quyền xem** — trước đây vẫn giới hạn theo Thôn/Xóm như "Gửi tin
  tự động"; giờ đổi giống `zalo_send_log` ở mục 10.9: bất kỳ ai có quyền `can_manage_zalo_oa` (hoặc
  super) đều xem được **toàn bộ** Danh sách OA, không giới hạn theo Thôn/Xóm. Ngược lại, **"Gửi tin tự
  động" (Tầng 2) vẫn RIÊNG TƯ theo từng người như cũ, KHÔNG đổi** — đã đúng theo yêu cầu từ trước
  (`created_by = chính người đó`, super mới thấy hết).

```sql
drop policy if exists "admin sees zalo customers in scope" on zalo_customers;
create policy "admin sees zalo customers" on zalo_customers
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_manage_zalo_oa = true)
    )
  );
```

**Việc cần bạn làm**: chạy SQL trên (SQL Editor) cho phần Danh sách OA xem toàn bộ, và deploy lại **CẢ
2** Edge Function (`create-account` và `send-due-reminders`) cho phần sửa `SO_TIEN_CHUYEN_KHOAN` — ô tìm
kiếm tự lên khi GitHub Pages deploy lại, không cần làm gì thêm.

### 10.12. Định dạng số tiền Zalo OA về chuẩn ban đầu (số thuần) + thêm/bỏ OA nhanh hơn (KHÔNG cần chạy SQL)

- **Định dạng tiền trong mẫu Zalo OA**: `LAI_PHAI_TRA` tiếp tục báo lỗi định dạng dù đã bỏ "đ" + dấu
  chấm riêng cho `SO_TIEN_CHUYEN_KHOAN` ở mục 10.11 — hóa ra Zalo validate NGHIÊM NGẶT cho **mọi** tham
  số tiền, không chỉ riêng trường gắn nút chuyển khoản. Quay lại đúng định dạng CHUẨN ban đầu cho **cả 4
  trường** (`SO_DU`, `GOC_PHAI_TRA`, `LAI_PHAI_TRA`, `SO_TIEN_CHUYEN_KHOAN`): chuỗi chữ số thuần, không
  chấm không đ (VD: `80000000`).
- **Thêm/bỏ khỏi Danh sách OA nhanh hơn**: trước đây mỗi lần thêm/bỏ 1 khách đều gọi lại
  `refreshSessionData()` — tải lại TOÀN BỘ dữ liệu phiên (8 bảng cùng lúc), rất nặng cho 1 thao tác đơn
  giản, đặc biệt rõ khi thêm HÀNG LOẠT nhiều khách 1 lúc ở modal "Thêm khách hàng vào OA" (mỗi khách một
  lượt tải lại đầy đủ, trông như khung bị tải lại liên tục). Giờ vá thẳng vào cache cục bộ + `notify()`
  thay vì tải lại toàn bộ — nhanh hơn hẳn, đặc biệt khi chọn thêm nhiều khách cùng lúc. Trang "Quản lý
  OA" cũng chỉ vẽ lại đúng tab đang mở thay vì dựng lại cả khung (thanh tab + bộ lọc) mỗi lần có cập
  nhật, đỡ giật hơn.
- **Import Excel tự cập nhật SĐT/địa chỉ đổi**: đã có sẵn từ trước, không đổi gì — dòng nào trong file
  có SĐT/địa chỉ khác với hồ sơ hiện tại thì tự cập nhật đè lên (ô trống trong file thì GIỮ NGUYÊN dữ
  liệu cũ, không xóa mất).

**Việc cần bạn làm**: deploy lại **CẢ 2** Edge Function (`create-account` và `send-due-reminders`) cho
phần định dạng tiền — phần tốc độ tự lên khi GitHub Pages deploy lại, không cần làm gì thêm trên
Supabase.

### 10.13. Nhân viên có can_manage_users/can_manage_zalo_oa xem TOÀN BỘ khách hàng+hợp đồng (không riêng gì zalo_customers/zalo_send_log) + bỏ hỏi lại khi xóa khỏi "Gửi tin tự động" (BẮT BUỘC chạy SQL)

Mục 10.9/10.11 mới chỉ nới lỏng đúng 2 bảng `zalo_send_log`/`zalo_customers` — nhưng bảng gốc
`customers`/`contracts` VẪN giới hạn theo Thôn/Xóm cho staff (kể cả có `can_manage_users`/
`can_manage_zalo_oa`), nên khi trang "Quản lý OA"/"Quản lý User" join sang lấy tên/SĐT/hợp đồng của
khách NGOÀI Thôn/Xóm được gán thì dữ liệu vẫn rỗng — kết quả nhìn như vẫn còn bị giới hạn. Sửa tận gốc:
nới lỏng luôn 2 bảng `customers`/`contracts` — staff có `can_manage_users` HOẶC `can_manage_zalo_oa`
xem được TOÀN BỘ khách hàng + hợp đồng (không riêng theo Thôn/Xóm nữa). Trang "Khách hàng & Hợp đồng"/
"Tổng quan"/"Yêu cầu tư vấn" đều tự lọc lại theo đúng Thôn/Xóm ở phía code (dùng `listCustomers({adminId})`)
nên KHÔNG bị ảnh hưởng — chỉ có "Quản lý User" và "Quản lý OA" (đọc thẳng dữ liệu gốc, không tự lọc lại)
là thấy được toàn bộ, đúng ý muốn.

```sql
drop policy if exists "staff sees scoped customers" on customers;
create policy "staff sees scoped customers" on customers
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id') and a.role = 'staff'
        and (
          a.can_manage_users = true or a.can_manage_zalo_oa = true
          or thon = any(a.allowed_thon) or (thon || '||' || xom) = any(a.allowed_xom)
        )
    )
  );

drop policy if exists "admin sees contracts in scope" on contracts;
create policy "admin sees contracts in scope" on contracts
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from customers c
      join admins a on a.id = (auth.jwt() ->> 'row_id')
      where c.id = contracts.customer_id
        and (
          a.role = 'super' or a.can_manage_users = true or a.can_manage_zalo_oa = true
          or c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom)
        )
    )
  );
```

Lưu ý: chỉ đổi quyền XEM. Việc THÊM/BỎ khách vào Danh sách OA hay tạo Use vẫn giữ nguyên giới hạn đúng
Thôn/Xóm được gán như cũ (không đổi) — nới lỏng RLS trên KHÔNG cho phép staff ghi/sửa dữ liệu ngoài
phạm vi, chỉ cho XEM.

Đồng thời (không cần SQL, chỉ sửa code JS): bỏ hộp thoại hỏi lại khi bấm "Bỏ khỏi danh sách" ở mục "Gửi
tin tự động" — bấm là xóa luôn, không cần xác nhận thêm bước nữa (chỉ là gỡ khỏi danh sách gửi tự động,
không xóa dữ liệu hợp đồng/khách hàng, thêm lại được ngay bất cứ lúc nào) — bỏ nhiều hợp đồng liên tiếp
giờ nhanh hơn hẳn.

**Việc cần bạn làm**: chạy SQL trên (SQL Editor) — **không cần deploy Edge Function nào** (chỉ đổi
policy đọc dữ liệu + sửa file .js tĩnh, GitHub Pages tự deploy khi push `main`).

### 10.14. Báo lãi tự động (hàng tháng/theo ngày) tự chuyển sang mẫu "Đến hạn/Quá hạn" khi gần đến hạn (KHÔNG cần chạy SQL)

Trước đây 2 mục Tầng 2 ("Báo lãi tự động hàng tháng"/"Gửi theo ngày cụ thể") LUÔN dùng mẫu "Báo lãi" bất
kể hợp đồng còn xa hạn hay đã sắp/tới hạn — dẫn tới tình huống báo lãi suông ngay lúc khách sắp phải trả
cả gốc lẫn lãi. Giờ CẢ 2 mục tự kiểm tra độ gần hạn mỗi lần tới lượt gửi, **báo trước khách hàng đúng 10
ngày** (ngưỡng RIÊNG cho 2 mục Tầng 2 này — KHÁC với ngưỡng 15 ngày của nút gửi tay ở create-account,
cố tình để khác nhau): còn xa hạn (> 10 ngày) → vẫn dùng mẫu "Báo lãi" như cũ; gần/tới/qua hạn (≤ 10
ngày) → tự đổi sang mẫu "Đến hạn/Quá hạn" (đủ cả Gốc lẫn Lãi). CHỈ áp dụng cho hợp đồng ĐÃ được thêm vào
1 trong 2 mục Tầng 2 — hợp đồng nào chưa thêm thì không gửi gì (như cũ). Lịch gửi (đúng ngày này tháng
sau/ngày tự chọn, điều kiện >20 ngày đã tính lãi...) không đổi gì — chỉ đổi ĐÚNG việc chọn mẫu nào để gửi.

**Việc cần bạn làm**: deploy lại **`send-due-reminders`** (file duy nhất có sửa lần này — `create-account`
không đổi, không cần deploy lại) — Supabase Dashboard → Edge Functions → chọn `send-due-reminders` →
dán đè toàn bộ → Deploy. Không có SQL nào cần chạy thêm.

### 10.15. "Use đã đăng nhập"/"Use đã bật thông báo" ở Quản lý User đúng cho cả nhân viên có can_manage_users (BẮT BUỘC chạy SQL)

Mục 10.13 mới nới lỏng `customers`/`contracts` — nhưng "Use đã bật thông báo" còn phải tra thêm bảng
`push_subscriptions`, bảng này VẪN giới hạn theo Thôn/Xóm cho staff (không có ngoại lệ can_manage_users/
can_manage_zalo_oa), nên số liệu "Use đã bật thông báo" ở trang "Quản lý User" vẫn sai/thiếu với nhân
viên có quyền này (không khớp số admin toàn quyền xem được) dù danh sách khách hàng đã đúng. Sửa tận
gốc bảng này giống hệt cách đã làm ở mục 10.13:

```sql
drop policy if exists "admin sees push subscriptions in scope" on push_subscriptions;
create policy "admin sees push subscriptions in scope" on push_subscriptions
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and owner_type = 'customer'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (
          a.role = 'super' or a.can_manage_users = true or a.can_manage_zalo_oa = true
          or exists (
            select 1 from customers c
            where c.id = push_subscriptions.owner_id
              and (c.thon = any(a.allowed_thon) or (c.thon || '||' || c.xom) = any(a.allowed_xom))
          )
        )
    )
  );
```

Lưu ý: nếu bạn CHƯA chạy SQL ở mục 10.13 (nới lỏng `customers`/`contracts`) thì "Use đã đăng nhập" cũng
sẽ sai/thiếu — chạy CẢ 2 đoạn SQL (10.13 và đoạn trên) thì cả 2 số liệu mới đúng đầy đủ.

**Việc cần bạn làm**: chạy SQL trên (SQL Editor) — **không cần deploy Edge Function nào**.

### 10.16. Tự chuyển "Gửi tin tự động" sang hợp đồng mới khi khách còn vay (KHÔNG cần chạy SQL)

Trước đây, nhập file Excel kiểu "đồng bộ đầy đủ" (fullSync): hợp đồng nào không còn trong file bị XÓA
hẳn — nếu hợp đồng đó đang ở trong "Gửi tin tự động" (Tầng 2) thì lựa chọn đó cũng mất theo (khóa ngoại
tự xóa cascade), dù khách hàng thực ra CHỈ đổi số hợp đồng (tất toán hợp đồng cũ, mở hợp đồng mới) chứ
chưa hề trả hết nợ — phải vào thêm lại tay. Giờ trước khi xóa, hệ thống tự kiểm tra: nếu khách đó CHỈ
CÒN ĐÚNG 1 hợp đồng khác (còn dư nợ, chưa có sẵn trong Tầng 2) sau lượt đồng bộ này, thì tự CHUYỂN lựa
chọn "Gửi tin tự động" sang hợp đồng đó luôn — không cần thêm lại tay. Nếu khách hàng tất toán thật
(không còn hợp đồng nào khác) hoặc có NHIỀU hơn 1 khả năng cùng lúc (mơ hồ, không chắc hợp đồng nào mới
là hợp đồng tiếp diễn) thì vẫn xóa như cũ, không đoán mò. Kết quả nhập file sẽ hiện thêm dòng "Đã tự
chuyển N lựa chọn..." nếu có chuyển.

**Việc cần bạn làm**: deploy lại **`create-account`** (file duy nhất có sửa lần này) — `send-due-reminders`
không đổi, không cần deploy lại. Không có SQL nào cần chạy thêm.

---

### 10.17. Định kỳ báo 1/2/3/4 tháng cho cả 2 mục "Gửi tin tự động" (BẮT BUỘC chạy SQL)

Trước đây "Báo lãi tự động hàng tháng" và "Gửi theo ngày cụ thể" LUÔN báo hàng tháng (mỗi tháng 1 lần).
Giờ thêm cột `interval_months` (1-4, mặc định 1) cho mỗi lựa chọn ở Tầng 2 — chọn 2/3/4 thì báo thưa
hơn (2/3/4 tháng mới báo 1 lần), lặp lại đều đặn theo đúng NGÀY đã neo (đúng ngày này N tháng sau, tính
từ ngày lãi đã trả đến/ngày tạo lựa chọn tùy mục). Ô chọn "1/2/3/4 tháng" hiện ngay sau mã hợp đồng
trong từng dòng ở cả 2 mục — đổi là áp dụng luôn, không cần lưu riêng; lúc thêm mới hợp đồng vào 1 trong
2 mục cũng chọn được định kỳ ngay từ đầu (mặc định "Mỗi tháng" nếu không đổi).

```sql
alter table zalo_auto_send_list add column if not exists interval_months integer not null default 1;

alter table zalo_auto_send_list drop constraint if exists zalo_auto_send_list_interval_months_check;
alter table zalo_auto_send_list add constraint zalo_auto_send_list_interval_months_check
  check (interval_months in (1, 2, 3, 4));
```

**Việc cần bạn làm**:
1. Chạy SQL trên (SQL Editor).
2. Deploy lại CẢ 2 Edge Function: **`create-account`** (thêm/sửa định kỳ) và **`send-due-reminders`**
   (áp dụng định kỳ khi tính ngày báo hàng ngày lúc 8h sáng).

---

### 10.18. Nhúng cứng thông tin nhận thanh toán (ngân hàng/số TK) vào code (KHÔNG cần chạy SQL)

**Lý do**: trước đây 4 thông tin ngân hàng (tên NH, mã BIN, số tài khoản, tên chủ TK — dùng tạo mã QR
chuyển khoản cho khách) sửa được ngay trong "Cài đặt", chỉ cần đăng nhập tài khoản quản trị viên toàn
quyền (`role='super'`). Rủi ro: điện thoại đã đăng nhập sẵn tài khoản này mà bị mất/bị kẻ gian chiếm
được (không cần biết mật khẩu, chỉ cần điện thoại đang mở khóa + app còn đăng nhập, vì phiên đăng nhập
không tự hết hạn) thì đổi được số tài khoản nhận tiền ngay lập tức, không có bước xác nhận nào thêm.

Nhân viên thường (role='staff') thì KHÔNG có rủi ro này — RLS ở Supabase đã chặn cứng phía server (chỉ
`role='super'` mới UPDATE được bảng `orgs`), không phải chỉ ẩn nút trên giao diện.

**Đã sửa**: 4 giá trị này giờ NHÚNG CỨNG thành hằng số `BANK_INFO` trong `js/state.js` — ứng dụng
KHÔNG còn đọc 4 cột `bank_bin/bank_name/bank_account_no/bank_account_name` từ bảng `orgs` nữa (luôn
dùng đúng hằng số, bất kể trong bảng `orgs` đang có gì), và `updateOrg()` cũng bỏ hẳn 4 field này khỏi
danh sách được phép sửa — có patch cũng bị bỏ qua, im lặng không lỗi. Mục "Thông tin nhận thanh toán
(QR)" bỏ HẲN khỏi màn "Cài đặt" (không hiển thị nữa, kể cả dạng chỉ xem) — 4 giá trị này giờ chỉ còn
hiện ra đúng chỗ khách hàng cần thấy để chuyển khoản (mã QR ở trang hợp đồng). Muốn đổi ngân hàng/số
tài khoản thật (hiếm khi xảy ra) thì phải sửa trực tiếp hằng số `BANK_INFO` trong code + deploy lại qua
GitHub Pages (nhắn lại yêu cầu đổi, kèm 4 giá trị mới) — kẻ gian có điện thoại tuyệt đối không tự đổi
được nữa, vì không có quyền truy cập repo GitHub.

4 cột `bank_*` trong bảng `orgs` vẫn còn tồn tại (không xóa, tránh phải sửa schema) nhưng từ nay không
còn được ứng dụng đọc/ghi tới nữa — coi như đã "nghỉ hưu".

**Việc cần bạn làm**: KHÔNG cần chạy SQL, KHÔNG cần deploy Edge Function nào — chỉ là sửa file JS tĩnh,
GitHub Pages tự deploy khi push `main`.

---

### 10.19. Thử nút "Mở app ngân hàng" (VietQR deep link) rồi GỠ BỎ — API bắt buộc biết trước ngân hàng của khách

Từng thêm thử 1 nút "Mở app ngân hàng để thanh toán" dùng dịch vụ `dl.vietqr.io/pay` (deep link chuẩn
NAPAS). Bạn test thực tế báo lỗi `{"message":"Missing parameter app"}` — hóa ra dịch vụ này BẮT BUỘC
phải biết trước khách dùng đúng ngân hàng nào (tham số `app`, VD `app=vcb`/`app=mbbank`...) mới mở đúng
app được, KHÔNG có chế độ "để trống thì tự hiện bảng chọn mọi app" như tài liệu công khai gợi ý lúc đầu
(môi trường code không gọi thẳng được vietqr.io để tự kiểm thử trước, nên chỉ phát hiện được lỗi này khi
bạn bấm thử thật). Vì quỹ không biết trước khách dùng ngân hàng nào nên đã **GỠ BỎ nút này** — quay lại
đúng như cũ: chỉ còn mã QR để khách tự mở app ngân hàng rồi quét (+ nút tải ảnh/chia sẻ ảnh QR sẵn có).

Muốn làm lại đúng cách sau này thì cần thêm 1 bước "chọn ngân hàng của bạn" cho khách chọn trước (danh
sách icon các ngân hàng), rồi mới ghép đúng mã `app` tương ứng để mở — cần bảng mã `app` chính xác cho
từng ngân hàng (tra từ `https://api.vietqr.io/v2/android-app-deeplinks`/`ios-app-deeplinks`) và test kỹ
trên điện thoại thật trước khi dùng, vì đoán sai mã có thể mở nhầm app hoặc báo lỗi như lần này.

**Việc cần bạn làm**: KHÔNG cần chạy SQL, KHÔNG cần deploy Edge Function nào — chỉ là gỡ code JS tĩnh,
GitHub Pages tự deploy khi push `main`.

---

### 10.20. Làm lại đúng cách: popup "Chọn ngân hàng của bạn" trước khi mở app (KHÔNG cần chạy SQL)

Thay vì tự đoán/gõ tay bảng mã `app` cho từng ngân hàng (rủi ro sai như mục 10.19), giờ nút "Mở app ngân
hàng để thanh toán" (popup Thanh toán, `js/views/contractDetail.js`) mở ra 1 popup nhỏ **"Chọn ngân hàng
của bạn"** — danh sách logo + tên các app ngân hàng được **TẢI TRỰC TIẾP TỪ VIETQR lúc khách bấm** (API
công khai `https://api.vietqr.io/v2/android-app-deeplinks` hoặc `ios-app-deeplinks` tùy hệ điều hành máy
khách — cùng hệ thống Zalo dùng khi thanh toán VietQR), không hề gõ tay/đoán mã ngân hàng nào trong code
— luôn đúng, luôn cập nhật theo đúng danh sách thật của VietQR. Khách bấm đúng ngân hàng mình dùng → mở
app đó kèm sẵn số tài khoản Quỹ/số tiền/nội dung, khách chỉ cần xác nhận chuyển.

Lưu ý: môi trường code (Claude Code) vẫn bị chặn mạng ra vietqr.io nên **không tự bấm thử trực tiếp
được** — chỉ dựa trên cấu trúc JSON tra cứu được qua tìm kiếm công khai. Vẫn giữ nguyên **BỔ SUNG THÊM**
như trước: mã QR/nút tải ảnh/chia sẻ ảnh QR còn nguyên bên dưới làm phương án dự phòng nếu 1 ngân hàng
nào đó không mở đúng/không tự điền được thông tin. Fetch lỗi mạng (hoặc danh sách rỗng) thì popup tự báo
"Không tải được danh sách ngân hàng — dùng mã QR bên dưới", không chặn luồng thanh toán chính.

**Việc cần bạn làm**: KHÔNG cần chạy SQL, KHÔNG cần deploy Edge Function nào — chỉ là sửa file JS tĩnh,
GitHub Pages tự deploy khi push `main`. **Nhờ bạn tự bấm thử với vài tài khoản ngân hàng thật (Agribank,
Vietcombank, BIDV, VietinBank...) sau khi deploy** để xác nhận mở đúng app + điền đúng thông tin.

---

### 10.20b. Sửa lỗi mở app nhưng KHÔNG tự điền thông tin — dùng thẻ `<a>` thật thay vì `window.open()`

Bạn test mục 10.20: mở đúng app ngân hàng nhưng KHÔNG tự điền được số tiền/nội dung (phải tự nhập tay).
Nguyên nhân: code lúc đó tạo danh sách bằng `<button>` + gọi `window.open(url)` bằng JavaScript khi bấm —
cách này TRÊN NHIỀU ĐIỆN THOẠI (đặc biệt iPhone/Safari) vẫn mở được app nhưng KHÔNG chuyển được đầy đủ dữ
liệu kèm theo link qua cho app (app mở lên trống). Máy/trình duyệt chỉ nhận diện đúng để chuyển hẳn dữ
liệu qua app khi đó là 1 cú bấm vào 1 thẻ `<a href="...">` THẬT (giống bấm 1 chữ có gạch dưới màu xanh),
không phải mở bằng lệnh JS.

**Đã sửa**: mỗi dòng ngân hàng trong popup "Chọn ngân hàng của bạn" giờ là 1 thẻ `<a href="...">` thật —
link đầy đủ (kèm sẵn số tài khoản/số tiền/nội dung) được dựng sẵn ngay khi vẽ danh sách, không còn qua
`window.open()` bằng JS nữa.

**Việc cần bạn làm**: KHÔNG cần chạy SQL, KHÔNG cần deploy Edge Function nào — chỉ là sửa file JS tĩnh,
GitHub Pages tự deploy khi push `main`. **Nhờ bạn test lại đúng ngân hàng lúc nãy bị lỗi** để xác nhận
giờ đã tự điền được thông tin chưa.

---

### 10.20c. Sửa tiếp: `ba=` phải dùng mã VIẾT TẮT VietQR, không dùng mã số/BIN

Đổi sang thẻ `<a>` thật (10.20b) vẫn KHÔNG tự điền được thông tin. Xem lại toàn bộ ví dụ thực tế tra cứu
được thì phát hiện: tham số `ba=<số_TK>@<mã_ngân_hàng>` đòi hỏi **mã VIẾT TẮT VietQR** của ngân hàng
NHẬN tiền (VD: `icb`, `ocb`, `bidv`...), KHÔNG chấp nhận mã số/BIN (`970446`) như code đang dùng — đây là
2 hệ mã KHÁC NHAU của VietQR (mã số/BIN dùng cho ảnh QR ở `img.vietqr.io`, mã viết tắt dùng riêng cho
deep link `dl.vietqr.io/pay`). Dùng nhầm mã số khiến dịch vụ mở đúng app (vì tham số `app` đúng) nhưng
không nhận diện được ngân hàng nhận tiền nên bỏ qua luôn phần điền thông tin, y hệt triệu chứng đã gặp.

**Đã sửa**: thêm hằng số `bankShortCode: 'coopbank'` (mã viết tắt VietQR của Ngân hàng Hợp tác xã Việt
Nam) vào `BANK_INFO` (`js/state.js`), dùng riêng cho tham số `ba=` ở link "Mở app ngân hàng"
(`js/views/contractDetail.js`) — mã số/BIN (`970446`) vẫn giữ nguyên dùng cho ảnh QR như cũ, không đổi.

**Việc cần bạn làm**: KHÔNG cần chạy SQL, KHÔNG cần deploy Edge Function nào — chỉ là sửa file JS tĩnh,
GitHub Pages tự deploy khi push `main`. **Nhờ bạn test lại lần nữa** để xác nhận đã tự điền được thông
tin chưa — nếu vẫn chưa được, khả năng cao tính năng tự điền đầy đủ chỉ dành cho đối tác đã đăng ký
merchant với VietQR (không mở công khai), cần cân nhắc hướng đăng ký cổng thanh toán riêng.

---

### 10.20d. KẾT LUẬN: gỡ hẳn nút "Mở app ngân hàng" — VietQR public deep link chưa hỗ trợ tự điền

Sau khi sửa lại lần nữa (10.20c) vẫn không tự điền được — tra thêm tài liệu công khai từ VietQR/payOS/
SePay thì xác nhận chắc chắn: đây là **giới hạn hiện tại của chính dịch vụ `dl.vietqr.io/pay` (bản công
khai, miễn phí)** — dịch vụ này hiện CHỈ mở được đúng app, CHƯA hỗ trợ chuyển tiếp số tiền/nội dung cho
app ngân hàng đọc (VietQR ghi rõ đây là tính năng dành cho tương lai). Không phải lỗi code, không có
cách nào sửa được từ phía Quỹ với dịch vụ miễn phí công khai này.

**Cách THẬT SỰ tự điền được** (khách đã tự tay xác nhận thành công, KHÔNG tốn phí gì): dùng chính app
Zalo — bấm "Chia sẻ ảnh QR" → chọn Zalo → gửi cho chính mình → bấm vào ảnh QR trong Zalo → Zalo tự nhận
diện, hiện màn xác nhận Ngân hàng/Số tiền/Nội dung + chọn app ngân hàng → bấm "Chuyển khoản" → app ngân
hàng tự điền đầy đủ. Đây là khả năng có sẵn TRONG APP ZALO của khách (nhận diện bất kỳ mã QR VietQR hợp
lệ nào), không liên quan gì đến SePay/payOS hay bất kỳ đăng ký merchant nào — hoàn toàn miễn phí.

**Đã gỡ**: nút "Mở app ngân hàng để thanh toán" + popup "Chọn ngân hàng của bạn" (gây hiểu lầm vì không
tự điền được như hứa). Thay bằng dòng chữ **in đậm màu xanh** phía trên nút "Tải ảnh mã QR": *"Tải mã QR
này để thực hiện thanh toán"* — bỏ luôn dòng chữ "Quét mã QR này để thanh toán" cũ ở dưới ảnh QR (không
cần thiết nữa, dòng mới ở trên đã đủ rõ). Xóa `bankShortCode`/`openBankChooserModal`/`fetchBankApps` khỏi
code (không còn dùng).

**Việc cần bạn làm**: KHÔNG cần chạy SQL, KHÔNG cần deploy Edge Function nào — chỉ là sửa file JS tĩnh,
GitHub Pages tự deploy khi push `main`.

---

### 10.21. Thử tách "Đến khách hàng"/"Đến trung tâm Zalo" rồi GỠ — trùng Webhook URL với phần mềm đang dùng thật

Từng làm thử (Edge Function mới `zalo-webhook` + cột `tracking_id`/`delivered_at` ở `zalo_send_log` + 3
trạng thái ở "Quản lý gửi tin") để phân biệt tin Zalo mới gửi thành công (tới "trung tâm" Zalo) với tin
đã THỰC SỰ tới máy khách — dựa trên webhook Zalo báo lại. Khi ra thực tế thì phát hiện: ứng dụng Zalo của
Quỹ (App ID `506937899189567646`) **ĐÃ CÓ SẴN 1 Webhook URL đang chạy thật**, trỏ về
`https://epas.qtd.vn/api-zalo/webhook` — đây là **phần mềm đang được Quỹ sử dụng thật** (không phải hệ
thống cũ/bỏ), và Zalo chỉ cho phép **1 Webhook URL duy nhất** cho mỗi ứng dụng — không đổi được sang
webhook mới của mình mà không làm `epas.qtd.vn` ngừng nhận sự kiện Zalo.

**Đã GỠ HẲN** toàn bộ thay đổi (revert đúng 1 commit) — quay lại y như cũ: "Quản lý gửi tin" chỉ còn 2
trạng thái "Thành công"/"Lỗi" (đúng nghĩa "đã gửi thành công tới Zalo", không phân biệt đã tới máy khách
hay chưa). **KHÔNG cần chạy SQL đã nêu ở lần thử trước, KHÔNG có Edge Function `zalo-webhook` nào cần
deploy** — coi như bỏ qua mục 10.21 (giữ lại đoạn này để nhớ đã thử và vì sao dừng).

**Muốn làm lại đúng cách sau này** thì cần 1 trong 2 hướng: (1) hỏi bên quản lý/phát triển `epas.qtd.vn`
xem có thể để chính hệ thống đó CHUYỂN TIẾP lại sự kiện cần thiết sang hệ thống mới không, hoặc (2) đổi
Webhook URL sang hệ thống mới nhưng hệ thống mới đó phải TỰ CHUYỂN TIẾP y nguyên mọi dữ liệu nhận được
sang `epas.qtd.vn/api-zalo/webhook` như cũ (rủi ro nhỏ: có sự cố mạng đúng lúc chuyển tiếp thì
`epas.qtd.vn` có thể trễ/mất 1 sự kiện) — CẦN người quản lý `epas.qtd.vn` xác nhận đồng ý trước khi đổi
Webhook URL, tránh làm gián đoạn phần mềm đang dùng thật.

---

### 10.22. Cấp lại mật khẩu cho use → TỰ ĐĂNG XUẤT NGAY phiên cũ (không cần tải lại trang)

Trước đây admin cấp lại mật khẩu cho ai đó (nhân viên/khách hàng) chỉ đổi được mật khẩu ở server — nếu
người đó ĐANG mở sẵn phiên đăng nhập cũ ở máy khác thì phiên đó vẫn dùng bình thường, chỉ khi nào họ tự
tải lại trang mới bị bắt đặt mật khẩu mới.

**Lần đầu thử bằng Supabase Realtime (WebSocket)** — đã chạy SQL bật Realtime cho 2 bảng, test thực tế
thì kênh kết nối được (`SUBSCRIBED`) nhưng KHÔNG nhận được bất kỳ sự kiện nào cả — nhiều khả năng do RLS
chặn Realtime nhận diện đúng JWT tùy biến của app (khác REST bình thường, vốn đã hoạt động tốt), cần cấu
hình thêm "Third-Party Auth" khá phức tạp trên Supabase Dashboard mà không chắc giải quyết được (đã bỏ,
xem mục 10.22b để biết chi tiết SQL nào không còn cần thiết nữa).

**Lần 2 — tự thêm 1 bộ hẹn giờ riêng (setInterval)** — chạy được nhưng RACE với 1 cơ chế CÓ SẴN từ trước
trong app (`refreshSessionData()`, tự tải lại dữ liệu phiên khi quay lại tab/chuyển trang — xem
`startAutoRefresh()`/`hashchange` ở `js/app.js`): cơ chế có sẵn đó cũng tự phát hiện
`must_change_password=true` nhưng lại rẽ vào đúng nhánh cũ (hiện màn "nhập mật khẩu mới" ngay trong phiên
cũ) TRƯỚC KHI bộ hẹn giờ mới kịp chạy — 2 cơ chế giẫm chân nhau, kết quả không ổn định. Codebase này vốn
đã CHỦ ĐÍCH bỏ hẳn `setInterval` cho việc tự làm mới dữ liệu từ trước (xem ghi chú trong `js/app.js`) vì
gây khó chịu (mất bộ lọc/chữ đang gõ dở) — thêm 1 bộ hẹn giờ riêng ở đây là đi ngược lại chủ đích đó.

**Đã sửa lại đúng cách — không thêm cơ chế mới nào cả**: tận dụng LUÔN đúng `refreshSessionData()` có sẵn
(gọi khi quay lại tab/chuyển trang, không phải hẹn giờ riêng) — so `must_change_password` của CHÍNH mình
TRƯỚC/SAU mỗi lần hàm này tải dữ liệu mới: chuyển từ `false` sang `true` nghĩa là VỪA BỊ NGƯỜI KHÁC cấp
lại ngay trong lúc đang dùng phiên này (mới đăng nhập bằng mật khẩu tạm thì cờ này đã `true` SẴN từ đầu
phiên, không tính) → **đăng xuất ngay, không cần tải lại trang** — về thẳng màn đăng nhập, phải đăng nhập
lại bằng mật khẩu mới, không còn hiện màn "nhập mật khẩu mới" trong phiên cũ nữa. Áp dụng cho CẢ quản trị
viên/nhân viên lẫn khách hàng — gọn hơn hẳn (không thêm bảng/hẹn giờ/kết nối nào mới), không còn race.

**Việc cần bạn làm**: KHÔNG cần chạy SQL, KHÔNG cần deploy Edge Function nào — chỉ là sửa file JS tĩnh,
GitHub Pages tự deploy khi push `main`. Nhờ bạn test lại (2 trình duyệt/2 máy, cấp lại mật khẩu ở máy A,
rồi chuyển qua lại tab hoặc bấm sang trang khác ở máy B) để xác nhận hoạt động đúng và ổn định.

---

### 10.22b. Không còn cần bật Realtime cho admins/customers nữa (KHÔNG bắt buộc, có thể để nguyên)

Sau khi đổi sang cách kiểm tra định kỳ (10.22), SQL đã chạy trước đó ở lần thử Realtime không còn được
dùng tới nữa:
```sql
alter publication supabase_realtime add table admins, customers;
```
Không cần gỡ lại (`alter publication supabase_realtime drop table admins, customers;`) — để nguyên không
ảnh hưởng/không tốn phí gì thêm, chỉ đơn giản là không dùng tới. Bỏ qua mục này nếu bạn không quan tâm
tới việc dọn dẹp.

---

### 10.23. Nút "Đăng xuất" CHỈ cho Use/khách hàng, CHỈ khi đã đăng nhập — dùng lại đúng cơ chế của mục 10.22 (BẮT BUỘC chạy SQL + deploy Edge Function)

Thêm nút **"Đăng xuất"** cạnh nút "Cấp lại mật khẩu" — bấm là buộc tài khoản đó thoát khỏi mọi phiên đang
đăng nhập ngay, **KHÔNG** đặt mật khẩu tạm/không bắt đổi mật khẩu (khác hẳn "Cấp lại mật khẩu"). Dùng
đúng cơ chế tự phát hiện đã làm cho mục 10.22 (`refreshSessionData()` so sánh trước/sau mỗi lần tự làm
mới dữ liệu) — tự "bung ra" đăng xuất y hệt, không cần tải lại trang: thêm cột mới `force_logout_at`,
admin bấm "Đăng xuất" chỉ ghi lại đúng thời điểm bấm vào cột này, phiên đang mở của use đó phát hiện mốc
thời gian vừa đổi khác lần trước đã biết thì tự đăng xuất.

**Phạm vi**: cho CẢ khách hàng (Use) lẫn quản trị viên/nhân viên, quyền hạn giống hệt "Cấp lại mật khẩu"
tương ứng của từng loại:
- **Use (khách hàng)**: nút chỉ hiện ở chi tiết khách hàng mở TỪ "Quản lý User" (`context === 'use'`) —
  không hiện khi mở từ "Khách hàng & Hợp đồng"; và CHỈ hiện khi Use đó **đang đăng nhập**
  (`S.hasCustomerLoggedIn(c)`, đúng cờ dùng cho 2 chấm trạng thái/ô thống kê "Use đã đăng nhập" có sẵn) —
  chưa từng đăng nhập/đã đăng xuất từ trước thì ẩn nút (không có gì để đăng xuất). Quyền: toàn quyền HOẶC
  nhân viên có quyền "Quản lý User".
- **Quản trị viên/nhân viên**: nút hiện ở chi tiết 1 tài khoản Quản trị viên/nhân viên KHÁC (không tự
  đăng xuất chính mình) — bảng `admins` KHÔNG có cờ "đang đăng nhập" như `customers` nên nút LUÔN hiện
  (không lọc theo trạng thái online). Quyền: CHỈ quản trị viên toàn quyền (khớp đúng quyền của "Cấp lại
  mật khẩu" cho quản trị viên/nhân viên).

```sql
alter table admins add column if not exists force_logout_at timestamptz;
alter table customers add column if not exists force_logout_at timestamptz;
```

**Việc cần bạn làm**:
1. Chạy SQL trên (SQL Editor).
2. Deploy lại **`create-account`** (file duy nhất có sửa lần này).
3. Tự test lại cho cả 2 loại tài khoản (đăng nhập ở máy B, thao tác ở máy A, chuyển tab/bấm sang trang
   khác ở máy B để thấy tự đăng xuất — đúng như cơ chế mục 10.22).

---

### 10.23b. Sửa lỗi "báo thiếu hoặc sai type" khi đăng xuất quản trị viên/nhân viên

Ở lần sửa trước (10.23) đã gỡ nhầm hẳn tính năng "Đăng xuất" khỏi tài khoản Quản trị viên/nhân viên (hiểu
lầm "Use" chỉ có nghĩa khách hàng) — bấm đăng xuất 1 tài khoản Quản trị viên/nhân viên báo lỗi "thiếu
hoặc sai type" vì nút vẫn còn ở giao diện cũ nhưng server đã bỏ hẳn `type: 'force-logout-staff'`. Đã khôi
phục lại đầy đủ cho cả 2 loại tài khoản như mô tả ở mục 10.23 — nếu bạn đã chạy SQL/deploy Edge Function
ở lần 10.23 trước, chạy lại đúng 2 dòng SQL + deploy lại `create-account` 1 lần nữa cho chắc.

---

### 10.24. Chat hỗ trợ — khách hàng hỏi, quản trị viên/nhân viên trả lời (BẮT BUỘC chạy SQL, KHÔNG cần deploy Edge Function)

Thêm 1 kênh hỏi-đáp trực tiếp trong app, tách riêng với "Yêu cầu tư vấn" (mục kia vẫn giữ nguyên, dùng cho
yêu cầu vay/tư vấn có cấu trúc — chat này dùng cho hỏi nhanh, qua lại nhiều lượt):

- **Khách hàng**: 1 nút tròn nổi góc màn hình (mọi trang, sau khi đăng nhập), có chấm đỏ số tin quản trị
  viên/nhân viên vừa trả lời mà khách CHƯA xem — bấm vào mở khung chat của chính mình.
- **Quản trị viên/nhân viên**: mục **"Hỗ trợ"** mới trong menu (đi CHUNG quyền với "Quản lý User" — toàn
  quyền HOẶC nhân viên được cấp `can_manage_users`, xem đúng người của mục 10.13) — liệt kê TOÀN BỘ hội
  thoại (không giới hạn theo Thôn/Xóm, khớp đúng ý muốn: ai quản lý được Use thì cũng trả lời chat được),
  sắp theo tin mới nhất, kèm chấm đỏ số tin khách CHƯA đọc ở mỗi hội thoại. Bấm vào 1 hội thoại mở đúng
  khung chat của khách đó, gõ trả lời như nhắn tin thường.

Tin nhắn mới cập nhật bằng **tự tải lại mỗi 7 giây, CHỈ khi khung chat đang mở** (đóng khung chat là tắt
ngay, không có bộ đếm nào chạy ngầm ở nền) — tách hẳn khỏi cơ chế `refreshSessionData()` chung của toàn
app (mục 9/10.22, chỉ chạy khi đổi tab/chuyển trang) vì chat cần thấy tin mới nhanh hơn hẳn trong lúc đang
thật sự đứng nhìn màn hình đó, nhưng không được phép biến thành 1 bộ đếm chạy khắp nơi trong app như đã
từng bị lỗi ở mục 10.22 (làm mất bộ lọc/chữ đang gõ dở ở các trang khác).

Ghi tin nhắn **thẳng qua Row Level Security**, giống hệt cách bảng `requests` (Yêu cầu tư vấn) đang làm —
KHÔNG qua Edge Function `create-account` nào cả, nên lần này **không cần deploy lại Edge Function**, chỉ
cần chạy SQL bên dưới.

```sql
create table if not exists chat_messages (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'admin')),
  sender_admin_id text references admins(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists chat_messages_customer_idx on chat_messages (customer_id, created_at);

alter table chat_messages enable row level security;
grant select, insert, update on chat_messages to anon, authenticated, service_role;

-- Khách hàng: chỉ thấy/gửi/đánh dấu-đã-đọc đúng hội thoại của CHÍNH MÌNH.
create policy "customer sees own chat" on chat_messages
  for select using (
    (auth.jwt() ->> 'app_role') = 'customer'
    and customer_id = (auth.jwt() ->> 'row_id')
  );
create policy "customer sends own chat" on chat_messages
  for insert with check (
    (auth.jwt() ->> 'app_role') = 'customer'
    and customer_id = (auth.jwt() ->> 'row_id')
    and sender_role = 'customer'
  );
create policy "customer marks admin messages read" on chat_messages
  for update using (
    (auth.jwt() ->> 'app_role') = 'customer'
    and customer_id = (auth.jwt() ->> 'row_id')
    and sender_role = 'admin'
  );

-- Quản trị viên toàn quyền HOẶC nhân viên có can_manage_users: xem/trả lời TOÀN BỘ hội thoại (không giới
-- hạn Thôn/Xóm — khớp đúng phạm vi "Quản lý User" hiện có, xem mục 10.13).
create policy "admin sees chat" on chat_messages
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_manage_users = true)
    )
  );
create policy "admin sends chat" on chat_messages
  for insert with check (
    (auth.jwt() ->> 'app_role') = 'admin'
    and sender_role = 'admin'
    and sender_admin_id = (auth.jwt() ->> 'row_id')
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_manage_users = true)
    )
  );
create policy "admin marks customer messages read" on chat_messages
  for update using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_manage_users = true)
    )
  );
```

**Việc cần bạn làm**:
1. Chạy SQL trên (SQL Editor) — xong là dùng được ngay, **không cần deploy Edge Function nào** (chỉ sửa
   file `.js`/`.css` tĩnh, GitHub Pages tự deploy khi push `main`).
2. Tự test: đăng nhập 1 tài khoản khách hàng ở 1 máy, bấm nút chat nổi gửi thử 1 câu hỏi; đăng nhập quản
   trị viên toàn quyền (hoặc nhân viên có quyền "Quản lý User") ở máy khác, vào menu "Hỗ trợ" để trả lời.

---

### 10.25. Cấp lại mật khẩu/"Đăng xuất" cho use → bung ra NGAY, không cần đợi quay lại tab (KHÔNG cần chạy SQL)

Cơ chế ở mục 10.22/10.23 (so `must_change_password`/`force_logout_at` trước/sau mỗi lần `refreshSessionData()`
chạy) chỉ tự phát hiện được lúc người đó **quay lại tab hoặc chuyển trang** — đứng yên 1 màn hình không
làm gì thì phải đợi tới lúc đó mới bung. Giờ thêm 1 bộ đếm giờ (`setInterval`) RIÊNG, chạy mỗi **5 giây**,
gọi 1 hàm kiểm tra CỰC NHẸ (`checkForceLogout()` — chỉ đọc đúng 2 cột `must_change_password`/
`force_logout_at` của CHÍNH mình, không tải lại cả phiên như `refreshSessionData()`) — phát hiện là đăng
xuất ngay, không cần chờ tín hiệu quay lại tab/chuyển trang nữa.

**Vì sao trước đây từng bỏ hẳn `setInterval` mà giờ lại thêm lại** (xem ghi chú trong `js/app.js`): lần
trước (mục 10.22) bộ đếm giờ **tải lại TOÀN BỘ dữ liệu phiên** mỗi vài chục giây — làm mất bộ lọc/chữ
đang gõ dở khắp nơi trong app, nên đã bỏ. Lần này khác hẳn: `checkForceLogout()` **không bao giờ đụng tới
màn hình đang xem** (không gọi `persist()`/`notify()`) trừ phi THẬT SỰ cần đăng xuất ngay — nên chạy định
kỳ hoàn toàn an toàn, không lặp lại vấn đề cũ.

**Việc cần bạn làm**: KHÔNG cần chạy SQL, KHÔNG cần deploy Edge Function nào — chỉ sửa file JS tĩnh,
GitHub Pages tự deploy khi push `main`. Nhờ bạn test lại (2 trình duyệt/2 máy, cấp lại mật khẩu hoặc bấm
"Đăng xuất" ở máy A, để yên máy B không chạm gì) — trong vòng khoảng 5 giây, máy B tự bung đăng xuất, không
cần bấm hay chuyển tab gì cả.

---

### 10.25b. Sửa lỗi nhân viên tự bị đăng xuất OAN dù không ai đụng gì đến tài khoản (KHÔNG cần chạy SQL)

Sau khi triển khai mục 10.25, ghi nhận tình trạng 1 tài khoản **nhân viên** (không phải toàn quyền) đang
dùng bình thường thì tự nhiên bị đăng xuất, dù xác nhận KHÔNG ai cấp lại mật khẩu/bấm "Đăng xuất" cho tài
khoản đó. Nghi ngờ 1 lượt đọc dữ liệu hiếm khi bị "xui" — trùng đúng thời điểm với 1 tick khác
(`refreshSessionData()`) đang thay hẳn `state.admins` bằng dữ liệu mới — khiến `checkForceLogout()` so
sánh nhầm ra "khác nhau" dù thực ra không có gì đổi thật trên máy chủ.

**2 lớp phòng hờ đã thêm** (không đổi gì ở phần "Việc cần bạn làm" của mục 10.25, chỉ sửa code JS):
1. So mốc thời gian `force_logout_at` bằng `Date`/`getTime()` thay vì so chuỗi trực tiếp — tránh báo
   "khác nhau" giả nếu 2 lần đọc format chuỗi hơi khác nhau dù cùng 1 giá trị thật.
2. **CHỈ đăng xuất khi thấy dấu hiệu bất thường ở 2 lượt kiểm tra LIÊN TIẾP** (~5 giây/lượt) — 1 lượt đọc
   lệch thoáng qua rồi tự đúng lại ngay lượt sau sẽ KHÔNG còn bị coi là "bị cấp lại mật khẩu/đăng xuất"
   nữa. Trường hợp bị cấp lại mật khẩu/"Đăng xuất" THẬT thì dấu hiệu vẫn giữ nguyên qua 2 lượt liền — chỉ
   chậm thêm tối đa khoảng 5 giây so với trước, không ảnh hưởng gì đến trải nghiệm "gần như tức thì".

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy gì thêm — chỉ sửa file JS tĩnh. Nhờ bạn theo dõi thêm vài
ngày xem tài khoản nhân viên còn tự bị đăng xuất oan nữa không; nếu vẫn còn thì báo lại kèm càng nhiều chi
tiết càng tốt (đang làm gì lúc đó, có mở nhiều tab/nhiều thiết bị cùng lúc không) để tìm tiếp.

---

### 10.26. Gộp menu "Yêu cầu tư vấn" + "Hỗ trợ" thành 1 mục "Hỗ trợ" (2 tab: Tư vấn/Hỗ trợ) — chấm đỏ chưa đọc cho cả 2 (BẮT BUỘC chạy SQL, KHÔNG cần deploy Edge Function)

Gộp 2 mục menu quản trị trước đây thành 1 mục **"Hỗ trợ"** duy nhất, bên trong chia 2 tab:

- **Tư vấn** — nội dung y hệt trang "Yêu cầu tư vấn" cũ (danh sách yêu cầu tư vấn/vay mới, lọc theo trạng
  thái, cập nhật trạng thái...). Luôn hiện cho MỌI quản trị viên/nhân viên — giữ đúng phạm vi cũ, không
  đổi gì về quyền truy cập.
- **Hỗ trợ** — nội dung y hệt trang "Hỗ trợ" (chat) cũ. CHỈ hiện tab này cho ai có quyền xem chat (toàn
  quyền hoặc `can_manage_users`, khớp đúng RLS mục 10.24) — nhân viên "chỉ xem" không có quyền này sẽ
  không thấy tab "Hỗ trợ" đâu cả, chỉ còn đúng nội dung "Tư vấn" như trước (không có thanh chuyển tab).

Cả 2 tab đều có **chấm đỏ số CHƯA ĐỌC**, tự tắt ngay khi admin xem xong — tab "Hỗ trợ" dùng lại đúng cơ
chế đã có (mục 10.24); tab "Tư vấn" là MỚI, cần thêm 1 cột `read_at` cho bảng `requests`:

```sql
alter table requests add column if not exists read_at timestamptz;
```

Không cần thêm policy RLS nào — policy `admin updates requests` sẵn có (mục 3) đã cho phép admin ghi mọi
cột của bảng `requests`, tự áp dụng luôn cho cột mới này.

**"Đã đọc" của tab Tư vấn được tính khác tab Hỗ trợ 1 chút** — danh sách "Tư vấn" đã hiện TRỌN VẸN nội
dung từng yêu cầu ngay tại đó (không như "Hỗ trợ", chỉ hiện xem trước 1 dòng) — nên **CHỈ CẦN MỞ TAB "Tư
vấn" ra xem là tự tính là đã đọc hết** (không cần bấm thêm gì), tự tắt chấm đỏ ngay.

Mục menu **"Hỗ trợ"** (cấp cao nhất) hiện chấm đỏ **gộp chung cả 2 tab** (chat + tư vấn cộng lại) — vào
xem đúng tab nào thì đúng phần đó tự hết, số ở mục menu giảm theo tương ứng.

**Việc cần bạn làm**:
1. Chạy SQL trên (SQL Editor) — **không cần deploy Edge Function nào** (chỉ sửa file `.js`/`.css` tĩnh).
2. Kiểm tra lại: mục "Yêu cầu tư vấn" ở menu cũ đã biến mất, thay bằng "Hỗ trợ" (đã gộp) — bấm vào thấy 2
   tab "Tư vấn"/"Hỗ trợ" (nếu có quyền xem chat) hoặc thẳng nội dung "Tư vấn" (nếu không có quyền).

---

### 10.27. Đảo tên 2 tab trang Hỗ trợ, ẩn thông báo yêu cầu đã xử lý xong, dời Quản lý OA lên nhóm menu chính, lọc Nợ quá hạn/Gần đến hạn chỉ chọn 1 (KHÔNG cần chạy SQL)

Gộp 4 chỉnh sửa nhỏ cùng đợt, đều CHỈ sửa file `.js`/`.css` tĩnh, không đụng gì tới database:

1. **Đảo tên 2 tab ở trang "Hỗ trợ"** (mục 10.26) cho hợp lý hơn: tab yêu cầu tư vấn/vay mới đổi tên
   hiển thị thành **"Hỗ trợ"** (mỗi yêu cầu là 1 việc cần hỗ trợ xử lý), tab chat đổi tên hiển thị thành
   **"Tư vấn"** (trò chuyện trực tiếp = tư vấn ngay cho khách). Tên mục menu cấp cao nhất ("Hỗ trợ") và
   toàn bộ chức năng/quyền hạn bên trong KHÔNG đổi gì — chỉ đổi đúng 2 chữ hiển thị trên 2 tab.
2. **Yêu cầu tư vấn đã chuyển "Đã liên hệ" (xử lý xong) không tính vào chấm đỏ chưa đọc nữa** — dù trước
   đó chưa từng mở ra xem, đã xử lý xong thì thôi báo, khớp đúng cách "Yêu cầu mới nhất" ở Tổng quan cũng
   tự ẩn các yêu cầu đã xử lý xong.
3. **"Quản lý OA" dời lên đi cùng nhóm 3 mục chính** (Tổng quan/Khách hàng & Hợp đồng/Hỗ trợ) thay vì xếp
   sau "Quản lý User" như trước — vẫn giữ nguyên điều kiện hiển thị (toàn quyền hoặc được cấp
   `can_manage_zalo_oa`), chỉ đổi vị trí trong danh sách menu.
4. **Lọc "Nợ quá hạn"/"Gần đến hạn" ở trang Khách hàng & Hợp đồng giờ CHỈ chọn được 1 trong 2** (giống nút
   radio, bấm mục này tự bỏ chọn mục kia) — trước đây chọn được cả 2 cùng lúc. Đồng thời **"Gần đến hạn"
   mở rộng ngưỡng lên 45 ngày** (trước chỉ đúng 15 ngày) và **hiển thị y hệt popup "Gần đến hạn" ở Tổng
   quan**: hợp đồng còn trong đúng 15 ngày mới tô khung vàng cảnh báo, còn xa hơn (16-45 ngày) chỉ hiện
   chữ nhỏ bình thường kèm số ngày, không khung — áp dụng cho cả badge ở đầu thẻ khách hàng lẫn dòng hợp
   đồng gọn khi khách có nhiều hợp đồng.

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ cần đợi GitHub Pages tự deploy sau
khi push `main` (thường vài phút), rồi tải lại trang để thấy thay đổi.

---

### 10.27b. Sửa 2 thiếu sót của mục 10.27: sắp xếp theo số ngày + "Quản lý OA" chưa thật sự hiện trên thanh menu điện thoại (KHÔNG cần chạy SQL)

1. **Danh sách "Nợ quá hạn"/"Gần đến hạn" (trang Khách hàng & Hợp đồng) giờ tự sắp theo số ngày tăng dần
   (0, 1, 2, 3...)** — đúng số ngày đáng chú ý nhất của từng khách hàng — khi đang chọn đúng 1 trong 2
   bộ lọc đó (thay hẳn cho lựa chọn ở nút "Sắp xếp" trong lúc đó, vì Gốc/Lãi không còn ý nghĩa ưu tiên
   bằng số ngày khi đang xem đúng 1 nhóm cần chú ý này).
2. **"Quản lý OA" nay THẬT SỰ hiện trực tiếp trên thanh menu dưới điện thoại** — mục 10.27 mới dời được
   vị trí trong danh sách menu (ảnh hưởng sidebar máy tính + bảng "Thêm"), nhưng thanh menu dưới điện
   thoại vẫn giới hạn cứng đúng 3 mục đầu tiên nên chưa thấy gì đổi — đã nâng giới hạn đó lên 4 mục, tài
   khoản có quyền xem OA giờ thấy đủ 4 icon trực tiếp (Tổng quan/Khách hàng/Hỗ trợ/Quản lý OA) thay vì
   phải mở "Thêm". Tài khoản không có quyền OA không bị ảnh hưởng gì (vẫn đúng 3 mục như cũ).

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy gì — chỉ cần đợi GitHub Pages deploy xong rồi tải lại
trang (trên điện thoại có thể cần đóng hẳn app/xóa cache trình duyệt nếu vẫn thấy giao diện cũ).

---

### 10.28. Ngưỡng đổi mẫu "Đến hạn" của 2 mục "Gửi tin tự động" (Tầng 2) đổi từ 10 → 15 ngày, khớp với gửi tay (BẮT BUỘC deploy lại `send-due-reminders`)

Trước đây "Báo lãi tự động hàng tháng" và "Gửi theo ngày cụ thể" (Tầng 2) tự chuyển sang mẫu "Đến hạn/
Quá hạn" khi hợp đồng còn ≤ **10 ngày** nữa tới hạn (mục 10.14) — CỐ TÌNH khác với ngưỡng **15 ngày** của
nút gửi tay (mục create-account). Theo yêu cầu, đổi ngưỡng của 2 mục Tầng 2 này thành **15 ngày**, khớp
đúng ngưỡng gửi tay — hợp đồng còn ≤ 15 ngày là tự động dùng mẫu "Đến hạn/Quá hạn" (gồm cả gốc lẫn lãi)
thay vì tiếp tục dùng mẫu "Báo lãi" (chỉ lãi), dù đang tới lượt gửi tự động hàng tháng hay theo ngày cụ
thể đã chọn. Không đổi gì khác — lịch gửi (đúng ngày này tháng sau/ngày tự chọn, điều kiện > 20 ngày đã
tính lãi cho "Gửi theo ngày cụ thể"...) và ngưỡng riêng của thông báo đẩy (Web Push, vẫn 10 ngày,
`NEAR_DUE_START_DAYS`, không liên quan tới mẫu Zalo) giữ nguyên như cũ.

**Việc cần bạn làm**: deploy lại **`send-due-reminders`** (file duy nhất có sửa lần này — `create-account`
không đổi, không cần deploy lại) — Supabase Dashboard → Edge Functions → chọn `send-due-reminders` → dán
đè toàn bộ nội dung file mới → Deploy. Không có SQL nào cần chạy thêm.

---

### 10.29. Vẫn hiện ngày gửi Zalo gần nhất kể cả khi đã hết 5 ngày chờ (KHÔNG cần chạy SQL)

Ở popup chi tiết hợp đồng (nút "Gửi tin Zalo OA ngay"), dòng "Đã gửi Zalo gần nhất ngày X — còn N ngày
nữa mới gửi lại được" trước đây CHỈ hiện trong lúc còn đang chờ đủ 5 ngày — hết hạn chờ (gửi lại được rồi)
thì dòng này biến mất hẳn, thay bằng gợi ý chung "Muốn gửi tự động hàng tháng thì vào mục Quản lý OA",
không còn thấy lần gửi gần nhất là ngày nào nữa. Giờ dù đã hết hạn chờ vẫn giữ lại đúng ngày gửi gần nhất
("Đã gửi Zalo gần nhất ngày X — đã đủ 5 ngày, gửi lại được rồi"), kèm thêm gợi ý cũ ngay sau đó.

Ngày gửi gần nhất này vốn đã tính đúng cho **cả gửi tay lẫn gửi tự động** (2 luồng đều ghi vào cùng bảng
`zalo_send_log` — gửi tay ghi `triggered_by = 'manual'`, tự động ghi `triggered_by = 'auto'` — hàm phía
client `lastSuccessfulZaloSend()` không lọc theo cột này nên luôn lấy đúng lần gửi thành công gần nhất bất
kể nguồn nào) — không có gì cần sửa ở phần này, chỉ là màn hình trước đây có lúc không CHO XEM đúng ngày
đó thôi.

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ sửa file JS tĩnh, GitHub Pages tự
deploy khi push `main`.

---

### 10.30. Gửi tay Zalo OA nhanh hơn (BẮT BUỘC deploy lại CẢ 2 Edge Function)

"Bấm Gửi tin Zalo OA ngay" thấy lâu mới báo kết quả — do 2 nguyên nhân, đã sửa cả 2:

1. **Client đợi thừa**: sau khi gửi xong, code cũ còn đợi thêm 1 lượt tải lại TOÀN BỘ dữ liệu phiên (8
   bảng) rồi mới báo kết quả cho người bấm — trong khi việc tải lại đó chỉ để cập nhật số ngày chờ cho
   LẦN SAU, không cần thiết phải có ngay mới báo được kết quả lần gửi này. Giờ báo kết quả (thành công/lỗi)
   NGAY khi server trả lời, việc tải lại dữ liệu chạy ngầm phía sau — không ảnh hưởng gì đến việc cập nhật
   đúng số liệu, chỉ là không còn bắt người bấm phải đợi thêm nữa. Nút cũng đổi thành "Đang gửi..." ngay
   lúc bấm để biết chắc đã bấm trúng, không phải app bị đứng.
2. **Máy chủ tự làm mới Access Token Zalo THỪA**: mỗi lần gửi (kể cả gửi tay lẫn 1 hợp đồng trong lượt
   gửi tự động hàng ngày) đều gọi thêm 1 lượt xin Access Token mới từ Zalo — dù Access Token cũ (được lưu
   sẵn) vẫn còn dùng tốt (Access Token của Zalo sống được ~1 tiếng). Mỗi lượt xin mới này là 1 lượt gọi
   mạng ra ngoài, cộng dồn thêm thời gian chờ ngoài lượt gửi tin thật sự. Giờ chỉ xin mới khi Access Token
   đã lưu quá 50 phút (an toàn hơn hạn thật ~60 phút) — còn mới thì dùng lại luôn.

**Không ảnh hưởng gì tới cơ chế Refresh Token tự xoay vòng của Zalo** (đã có ghi chú kỹ trong code) — xoay
vòng chỉ xảy ra ĐÚNG lúc gọi API xin Access Token mới, không liên quan gì tới việc dùng lại Access Token
đã có sẵn để gửi tin — gọi xin mới ít lại còn giảm rủi ro đá nhau giữa nhiều lượt gửi cùng lúc.

**Việc cần bạn làm**: KHÔNG cần chạy SQL — deploy lại **CẢ 2** Edge Function (cả 2 đều có sửa lần này):
Supabase Dashboard → Edge Functions → chọn từng function (`create-account`, rồi `send-due-reminders`) →
dán đè toàn bộ nội dung file mới → Deploy.

---

### 10.31. Nút "Gửi tin Zalo OA ngay" tự chìm xuống ngay khi gửi thành công (KHÔNG cần chạy SQL)

Trước đây gửi Zalo tay thành công xong, nút "Gửi tin Zalo OA ngay" vẫn hiện sáng lại (bấm được tiếp) dù
thật ra đang trong 5 ngày chờ — phải đóng popup rồi mở lại mới thấy nút chìm xuống đúng. Giờ gửi thành
công là nút tự đổi thành "Đã gửi" (chìm xuống, không bấm tiếp được) NGAY LẬP TỨC, không cần đóng/mở lại
popup — dòng chú thích ngay dưới nút cũng tự cập nhật theo (hiện đúng ngày vừa gửi + còn bao nhiêu ngày
nữa mới gửi lại được), khớp với đúng những gì sẽ thấy nếu đóng rồi mở lại popup ngay sau đó.

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ sửa file JS tĩnh, GitHub Pages tự
deploy khi push `main`.

---

### 10.32. Gửi tay Zalo OA nhanh hơn NỮA (BẮT BUỘC deploy lại `create-account`)

Đã bỏ bớt token thừa + đợi tải lại toàn bộ dữ liệu ở mục 10.30 rồi nhưng vẫn còn chậm — do lúc gửi tay,
server còn tra cứu dữ liệu LẦN LƯỢT từng bước một (tra hợp đồng, rồi tra khách hàng, rồi tra đã có trong
Danh sách OA chưa, rồi tra lần gửi gần nhất để tính hạn chờ 5 ngày, rồi tra cấu hình mẫu Zalo, rồi lấy
Access Token...) — mỗi bước là 1 lượt hỏi máy chủ riêng, cộng dồn lại thành thời gian chờ khá dài dù
từng bước chỉ mất chút ít. Đã dồn lại thành 2 "đợt" chạy song song (đợt nào không cần chờ kết quả đợt
kia thì cho chạy cùng lúc luôn) thay vì 6 bước nối đuôi nhau — xem chi tiết code trong file vừa gửi.
Không đổi bất kỳ điều kiện/logic nào (vẫn đủ các bước kiểm tra quyền, Danh sách OA, hạn chờ 5 ngày, chọn
đúng mẫu Zalo... y hệt như cũ) — chỉ đổi CÁCH sắp xếp thứ tự gọi cho nhanh hơn.

**Đến đây gần như đã tối ưu hết phần server có thể tối ưu được** — phần thời gian còn lại (thường là
phần LỚN NHẤT trong lúc chờ) là lượt gọi thật sự sang máy chủ của Zalo để gửi tin (`business.openapi.
zalo.me`) — đây là mạng ra NGOÀI hệ thống, tốc độ phụ thuộc vào chính máy chủ Zalo lúc đó, không có
cách nào rút ngắn thêm được từ phía mình. Nếu sau khi deploy bản này vẫn thấy chậm rõ rệt (nhiều giây),
nhiều khả năng là do Zalo đang phản hồi chậm hơn bình thường vào thời điểm đó, không phải do code.

**Việc cần bạn làm**: deploy lại **`create-account`** (file vừa gửi) — Supabase Dashboard → Edge
Functions → chọn `create-account` → dán đè toàn bộ nội dung file mới → Deploy. Không có SQL nào cần
chạy thêm.

---

### 10.33. Nhật ký sử dụng — chỉ quản trị viên toàn quyền xem được (BẮT BUỘC chạy SQL + deploy lại `create-account`)

Trang **"Nhật ký"** mới (menu riêng, chỉ hiện cho tài khoản **toàn quyền** — `role='super'`) ghi lại
**hầu như mọi** thao tác của quản trị viên/nhân viên: đăng nhập, tạo/xóa/sửa tài khoản (cả nhân viên lẫn
khách hàng), cấp lại mật khẩu, đăng xuất ngay 1 tài khoản, xóa hợp đồng, nhập dữ liệu Excel, gửi thông
báo đẩy thủ công, thêm/bỏ khách khỏi Danh sách OA, thêm/bỏ/sửa gửi Zalo tự động, gửi tay Zalo OA, trả lời
chat với khách hàng, cập nhật trạng thái yêu cầu tư vấn, **xem chi tiết khách hàng, xem chi tiết hợp
đồng, đổi bộ lọc "Tất cả/Nợ quá hạn/Gần đến hạn" ở trang Khách hàng**... Mỗi dòng nhật ký ghi rõ **ai** đã
làm, làm **gì**, và **lúc nào**. Có ô tìm theo tên/nội dung và nút "Tải thêm" để xem các dòng cũ hơn.

**Lưu ý 3 điều nhỏ**:
- Gửi tin Zalo OA vẫn có trang riêng "Quản lý gửi tin" trong "Quản lý OA" ghi chi tiết đầy đủ hơn (kể cả
  lượt gửi lỗi) — Nhật ký chỉ ghi thêm 1 dòng NGẮN cho lượt gửi THÀNH CÔNG để không phải qua lại 2 trang.
- Trả lời chat ghi **MỖI TIN NHẮN 1 dòng** — hội thoại qua lại nhiều lượt sẽ ra nhiều dòng nhật ký tương
  ứng (đúng nghĩa "bất kể thao tác gì"), không gộp lại thành 1 dòng. Xem chi tiết khách hàng/hợp đồng
  cũng vậy — MỖI LẦN bấm vào là 1 dòng, kể cả xem lại đúng khách/hợp đồng vừa xem xong.
- Với các thao tác gắn với 1 khách hàng/hợp đồng/yêu cầu cụ thể, server LUÔN tự tra cứu tên thật trong
  database để soạn nội dung (không tin bất kỳ mô tả nào client tự gửi lên) — tránh 1 quản trị viên tự ghi
  sai sự thật vào nhật ký của chính mình. Riêng dòng "đổi bộ lọc" (không gắn với 1 bản ghi cụ thể nào,
  cũng không có gì nhạy cảm) mới cho phép mô tả ngắn từ client.

**Chặn 2 lớp — chỉ tài khoản toàn quyền xem được**:
1. Giao diện: mục menu "Nhật ký" chỉ hiện cho `role='super'`, nhân viên (kể cả có quyền "Quản lý User"
   hay "Quản lý OA") không thấy mục này, cố vào thẳng đường link cũng bị tự chuyển hướng ra khỏi trang.
2. **Database (lớp chặn THẬT SỰ, không chỉ ẩn giao diện)**: Row Level Security trên bảng `activity_log`
   chỉ cho phép `role='super'` đọc — nhân viên dù có cố tình gọi thẳng API cũng không lấy được dữ liệu.
   Việc GHI vào bảng này chỉ làm được qua Edge Function `create-account` (bằng service role, bỏ qua RLS)
   — không ai (kể cả tài khoản toàn quyền) sửa/xóa được nhật ký từ phía trình duyệt, đảm bảo nhật ký
   không bị chỉnh sửa lại.

```sql
create table if not exists activity_log (
  id text primary key,
  admin_id text references admins(id) on delete set null,
  admin_name text not null,
  action text not null,
  description text not null,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_created_idx on activity_log (created_at desc);

alter table activity_log enable row level security;
-- CHỈ cấp select cho anon/authenticated (không cấp insert/update/delete) —
-- ghi nhật ký CHỈ làm được qua Edge Function bằng service_role (tự bỏ qua
-- RLS, không cần cấp quyền insert cho vai trò nào ở đây).
grant select on activity_log to anon, authenticated;
grant select, insert on activity_log to service_role;

-- CHỈ quản trị viên toàn quyền (role='super') mới xem được nhật ký — đúng
-- yêu cầu "chỉ một mình tài khoản admin mới xem được".
create policy "super sees activity log" on activity_log
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from admins a where a.id = (auth.jwt() ->> 'row_id') and a.role = 'super'
    )
  );
```

**Việc cần bạn làm**:
1. Chạy đoạn SQL trên trong Supabase Dashboard → SQL Editor (bảng `activity_log` KHÔNG đổi gì thêm so
   với lần trước — nếu đã chạy rồi thì bỏ qua bước này, `create table if not exists` tự bỏ qua nếu bảng
   đã có sẵn).
2. Deploy lại **`create-account`** (file MỚI NHẤT vừa gửi — bản này có thêm phần ghi log cho xem chi
   tiết khách hàng/hợp đồng + đổi bộ lọc, ngoài phần Zalo OA/chat/yêu cầu tư vấn đã có ở lần gửi trước) —
   Supabase Dashboard → Edge Functions → chọn `create-account` → dán đè toàn bộ nội dung file mới → Deploy.

Thiếu bước 1 (chưa có bảng) là nguyên nhân phổ biến nhất khiến trang "Nhật ký" báo **"Không tải được"** —
kiểm tra lại đã chạy đúng đoạn SQL trên trong SQL Editor chưa (không phải chỉ đọc qua, phải bấm Run).
Thiếu bước 2 thì trang tải được nhưng không có dòng nào mới (thao tác vẫn làm thẳng bằng code cũ, chưa
biết ghi log).

---

### 10.34. Nhật ký: thêm lọc Thôn/Xóm/Gốc-Lãi + chuyển trang, tự xóa sau 60 ngày (BẮT BUỘC chạy SQL + deploy lại CẢ 2 Edge Function)

Thêm 3 việc theo yêu cầu:

1. **Ghi thêm khi lọc theo Thôn, theo Xóm, và theo "Gốc/Lãi"** (nút "Sắp xếp theo" ở trang Khách hàng —
   4 lựa chọn Gốc thấp→cao/cao→thấp, Lãi thấp→cao/cao→thấp) — trước đó mục 10.33/10.33-mở-rộng chỉ ghi
   log cho bộ lọc "Tất cả/Nợ quá hạn/Gần đến hạn", còn thiếu 3 loại lọc này.
2. **Ghi log mỗi lần bấm vào 1 mục menu (chuyển trang)** — VD "Vào trang Tổng quan", "Vào trang Khách
   hàng & Hợp đồng"... Chỉ ghi khi THẬT SỰ chuyển sang trang khác (không ghi lặp lại nếu vẫn đứng nguyên
   1 trang mà có dữ liệu mới/đổi quyền khiến màn hình vẽ lại).
3. **Tự động xóa nhật ký cũ hơn 60 ngày** — trước đây (mục 10.33) CHƯA có cơ chế này, nhật ký sẽ phình to
   dần mãi theo thời gian. Giờ mỗi ngày (tận dụng LUÔN lịch chạy hàng ngày có sẵn của `send-due-reminders`
   — function nhắc nợ tự động, KHÔNG cần tạo thêm lịch riêng) tự xóa hết dòng nhật ký cũ hơn 60 ngày, chạy
   sau cùng, không ảnh hưởng gì tới việc nhắc nợ/gửi Zalo tự động ở function đó.

**Lưu ý quan trọng về việc tự xóa**: cơ chế này CHỈ chạy được nếu `send-due-reminders` vẫn đang được lên
lịch chạy hàng ngày trên Supabase Dashboard (Edge Functions → chọn function đó → tab Schedules/Cron —
phần này bạn đã cấu hình sẵn từ trước cho việc nhắc nợ). Nếu sau này tắt/xóa lịch chạy của function đó vì
lý do khác, việc tự xóa nhật ký cũ cũng dừng theo — nhật ký sẽ lại phình to dần, cần nhớ bật lại lịch hoặc
báo lại để dọn bằng cách khác.

```sql
-- Cấp thêm quyền XÓA cho service_role trên bảng activity_log — mục 10.33
-- trước đây chỉ cấp select+insert (đủ cho ghi/đọc nhật ký), giờ cần thêm để
-- Edge Function tự xóa được dòng cũ.
grant delete on activity_log to service_role;
```

**Việc cần bạn làm**:
1. Chạy đoạn SQL trên (chỉ 1 dòng, KHÔNG cần chạy lại toàn bộ SQL mục 10.33 — bảng đã có sẵn rồi).
2. Deploy lại **CẢ 2** Edge Function (cả 2 đều có sửa lần này):
   - `create-account` (file vừa gửi — thêm ghi log lọc Thôn/Xóm/Gốc-Lãi + chuyển trang).
   - `send-due-reminders` (file vừa gửi — thêm bước tự xóa nhật ký cũ hơn 60 ngày).
   Supabase Dashboard → Edge Functions → chọn từng function → dán đè toàn bộ nội dung file mới → Deploy.

---

### 10.35. Nhật ký hiện "Quản trị viên" thay vì tên thật + tự che mất thao tác vừa làm (BẮT BUỘC deploy lại `create-account`, KHÔNG cần SQL)

Sau khi lọc Thôn/Xóm/Gốc-Lãi hoặc bấm menu rồi vào xem Nhật ký, thấy dòng mới nhất luôn là "Quản trị
viên — Vào trang 'Nhật ký'" chứ không phải đúng thao tác vừa làm. 2 nguyên nhân khác nhau, đã sửa cả 2:

1. **Tên hiển thị "Quản trị viên" không phải lỗi ghi log** — đây là tên THẬT đang lưu trong hồ sơ của
   chính tài khoản đang dùng (tài khoản toàn quyền khởi tạo ban đầu thường để tên chung chung như vậy,
   chưa từng đổi lại). Nhật ký chỉ hiển thị ĐÚNG tên đang lưu — sửa lại tên thật thì Nhật ký tự hiện đúng
   từ lần ghi tiếp theo (các dòng ĐÃ GHI trước đó vẫn giữ nguyên tên cũ, vì tên ghi vào Nhật ký là "ảnh
   chụp" tại đúng lúc đó, không tự đổi theo sau này).
   **Đã thêm chỗ sửa**: vào **Quản lý User** → bấm vào tài khoản cần sửa (bấm vào chính mình cũng được)
   → ô "Tên hiển thị" ở đầu → sửa rồi bấm "Lưu tên". Chỉ quản trị viên toàn quyền sửa được (sửa tên chính
   mình hoặc của người khác).
2. **Vào xem Nhật ký lại tự che mất đúng thao tác vừa muốn kiểm tra** — do bản thân việc BẤM VÀO MENU
   "Nhật ký" để xem cũng đang được tính là 1 lần chuyển trang, tự ghi thêm dòng "Vào trang 'Nhật ký'" đứng
   đầu danh sách (mới nhất lên đầu) — che mất đúng dòng ghi thao tác trước đó mà người dùng đang muốn
   thấy. Đã sửa: KHÔNG tự ghi log khi vào xem chính trang Nhật ký nữa — các trang khác vẫn ghi bình
   thường.

**Việc cần bạn làm**: deploy lại **`create-account`** (file vừa gửi) — Supabase Dashboard → Edge
Functions → chọn `create-account` → dán đè toàn bộ nội dung file mới → Deploy. Không có SQL nào cần
chạy thêm. Sau khi deploy xong, nhớ vào Quản lý User sửa lại tên thật cho tài khoản đang thấy hiện
"Quản trị viên".

---

### 10.36. Nhật ký: gộp nhiều thao tác liên tiếp của cùng 1 người (KHÔNG cần chạy SQL/deploy Edge Function)

1 người thao tác liên tục (VD: bấm qua lại nhiều menu) trước đây lặp lại avatar + tên ở MỖI dòng, dài
dòng khó theo dõi. Giờ các dòng LIÊN TIẾP NHAU của CÙNG 1 người được gộp thành 1 khối — avatar/tên chỉ
hiện 1 lần ở đầu khối, bên dưới chỉ còn giờ + nội dung từng thao tác, gọn hơn hẳn. 2 dòng của cùng 1
người nhưng bị CHEN NGANG bởi thao tác của người khác thì KHÔNG gộp (giữ đúng thứ tự thời gian thật).

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ sửa file JS/CSS tĩnh, GitHub Pages
tự deploy khi push `main`.

---

### 10.37. Tài khoản đăng nhập "admin" không bị ghi vào Nhật ký (BẮT BUỘC deploy lại `create-account`, KHÔNG cần SQL)

Theo yêu cầu: mọi tài khoản quản trị viên toàn quyền/chỉ xem vẫn ghi nhật ký bình thường, RIÊNG tài khoản
có **tên đăng nhập đúng "admin"** (không phân biệt hoa/thường) thì KHÔNG ghi bất kỳ thao tác nào của tài
khoản đó vào Nhật ký nữa — kể cả đăng nhập, xem chi tiết, lọc danh sách, chuyển trang, quản lý tài
khoản/hợp đồng, gửi Zalo OA... Chặn ngay tại nơi ghi log (`logActivity()` trong `create-account`) — chặn
ở 1 chỗ DUY NHẤT áp dụng cho MỌI loại thao tác, không cần sửa từng chỗ gọi riêng lẻ.

Lưu ý: các dòng nhật ký đã ghi TỪ TRƯỚC của tài khoản "admin" (nếu có) vẫn còn nguyên trong bảng — thay
đổi này chỉ áp dụng cho thao tác MỚI từ lúc deploy trở đi, không tự xóa lịch sử cũ.

**Việc cần bạn làm**: deploy lại **`create-account`** (file vừa gửi) — Supabase Dashboard → Edge
Functions → chọn `create-account` → dán đè toàn bộ nội dung file mới → Deploy. Không có SQL nào cần
chạy thêm.

---

### 10.38. Nhật ký: đưa ngày lên đầu mỗi ngày (in đậm), chỉ ghi giờ ở từng dòng, in đậm nội dung chính (KHÔNG cần chạy SQL/deploy Edge Function)

Trang "Nhật ký" giờ chia theo TỪNG NGÀY — ngày ("Hôm nay"/"Hôm qua"/dd-mm-yyyy) đưa lên làm tiêu đề **in
đậm** riêng ở đầu mỗi ngày (giống vạch chia ngày trong khung chat), các dòng thao tác bên dưới chỉ còn
ghi GIỜ (không lặp lại ngày ở từng dòng nữa, đỡ rối mắt).

Nội dung chính của thao tác được **in đậm** — TRỪ RIÊNG dòng "Vào trang..." (chỉ là chuyển menu, không
phải thao tác quan trọng cần nổi bật) vẫn để chữ thường như trước, phân biệt rõ với các thao tác thật sự
đáng chú ý (VD: "**Xóa hợp đồng HD-001**", "**Cấp lại mật khẩu khách hàng "Trần Văn A"**"...).

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ sửa file JS/CSS tĩnh, GitHub Pages
tự deploy khi push `main`.

---

### 10.39. Nhật ký tự cập nhật dòng mới, không cần bấm tải lại (KHÔNG cần chạy SQL/deploy Edge Function)

Trang "Nhật ký" giờ tự kiểm tra dòng mới mỗi 5 giây, CHỈ khi đang thật sự đứng ở trang này — tự dừng
ngay khi rời trang. Cùng kiểu polling phạm vi hẹp đã dùng cho khung chat (mục 10.24), KHÁC HẲN kiểu
`setInterval` chạy khắp toàn app đã bị bỏ trước đây (mục 10.22) — chỉ ảnh hưởng đúng trang Nhật ký,
không đụng gì tới trang khác. Nếu đang gõ dở trong ô tìm kiếm thì tạm hoãn vẽ lại (tránh mất focus/con
trỏ đang gõ giữa chừng, đúng lỗi đã từng gặp) — dữ liệu mới vẫn lấy được ở lượt kế tiếp sau khi gõ xong.

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ sửa file JS tĩnh, GitHub Pages tự
deploy khi push `main`.

---

### 10.40. Nhật ký: chỉ in đậm ĐÚNG phần giá trị chính trong từng dòng, chữ nối câu vẫn thường (BẮT BUỘC deploy lại `create-account`)

Trước đó in đậm CẢ CÂU mô tả (trừ riêng "Vào trang..." để thường) — giờ đổi cách làm chính xác hơn: chỉ
in đậm ĐÚNG đoạn giá trị/tên riêng trong câu, phần chữ nối câu xung quanh vẫn để thường, áp dụng ĐỒNG LOẠT
cho MỌI loại thao tác (kể cả "Vào trang..." — "Vào trang" thường, tên trang in đậm). VD:

- `Vào trang "**Tổng quan**"` → "Vào trang" thường, **Tổng quan** đậm.
- `Lọc danh sách khách hàng — Xóm: **Xóm 01, Xóm 02...**` → phần đầu thường, danh sách Xóm đậm.
- `Lọc danh sách khách hàng — Sắp xếp: **Lãi: Cao → Thấp**` → phần đầu thường, kiểu sắp xếp đậm.
- `Xóa hợp đồng **HD-001**`, `Cấp lại mật khẩu khách hàng "**Trần Văn A**"`... — tên/mã đậm, còn lại thường.

Cách làm: server tự đánh dấu đúng đoạn giá trị bằng `**...**` ngay lúc soạn câu mô tả (xem `logActivity()`
trong `create-account`), trang Nhật ký (client) đọc marker này để in đậm ĐÚNG đoạn đó — **LUÔN chống chèn
HTML lạ**: toàn bộ câu được `escapeHtml()` (biến an toàn) TRƯỚC, marker `**...**` chỉ được thay thành in
đậm SAU KHI đã an toàn, không bao giờ chèn thẳng HTML thô từ tên khách hàng/nội dung người dùng nhập.

**Việc cần bạn làm**: deploy lại **`create-account`** (file vừa gửi) — Supabase Dashboard → Edge
Functions → chọn `create-account` → dán đè toàn bộ nội dung file mới → Deploy. Không có SQL nào cần
chạy thêm.

---

### 10.41. Khung chat khách hàng: đổi tiêu đề + chữ trống chưa có tin nhắn, in đậm/nổi hơn (KHÔNG cần chạy SQL/deploy Edge Function)

Khung chat phía khách hàng (nút tròn nổi góc màn hình):
- Tiêu đề "Hỗ trợ" → **"Hỗ trợ tư vấn"**.
- Chưa có tin nhắn nào: "Chưa có tin nhắn nào, hãy gửi câu hỏi của bạn." → **"Hãy đặt câu hỏi để gặp
  trực tiếp nhân viên tư vấn."** — chữ này cũng chỉnh **nổi hơn** (in đậm, cỡ chữ lớn hơn 1 chút, màu đậm
  hơn thay vì màu xám mờ như trước) để khách vừa mở khung chat trống là thấy ngay, dễ hiểu cần làm gì.

Phía quản trị viên/nhân viên (mở hộ 1 hội thoại của khách trong trang "Hỗ trợ") KHÔNG đổi gì — tiêu đề ở
đó vẫn luôn là TÊN THẬT của khách hàng, không liên quan tới tiêu đề mặc định này.

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ sửa file JS/CSS tĩnh, GitHub Pages
tự deploy khi push `main`.

---

### 10.42. Nhấn phím Esc để đóng nhanh popup trên máy tính (KHÔNG cần chạy SQL/deploy Edge Function)

Trên máy tính, trước đây phải bấm đúng nút "x" (hoặc bấm ra vùng nền mờ xung quanh) mới đóng được popup —
giờ nhấn phím **Esc** cũng đóng được, y hệt bấm "x". Nếu đang mở NHIỀU popup chồng nhau (VD: đang chọn
Thôn/Xóm bên trong popup chi tiết khách hàng), Esc chỉ đóng ĐÚNG popup trên cùng trước, giống cách nút
"quay lại" của điện thoại/trình duyệt vẫn hoạt động — nhấn Esc thêm lần nữa mới đóng tiếp popup bên dưới.

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ sửa file JS tĩnh, GitHub Pages tự
deploy khi push `main`.

---

### 10.43. Hỗ trợ nhập từ mẫu Excel "Sao kê hợp đồng tín dụng" mới (KHÔNG cần chạy SQL/deploy Edge Function)

Trang Khách hàng & Hợp đồng → "Nhập từ Excel" giờ đọc được thêm mẫu file mới (file in ra từ phần mềm
nghiệp vụ, dạng "IN SAO KÊ HỢP ĐỒNG TÍN DỤNG THEO SẢN PHẨM" — có vài dòng quốc hiệu/tiêu đề ở trên, dòng
tiêu đề cột thật có ô "STT", xen giữa các dòng khách hàng là các dòng "cộng dồn theo loại vay"/"Tổng
cộng"/chữ ký cuối file), NGOÀI mẫu phẳng cũ (đúng 11 cột cố định) vẫn dùng được như trước — **tự nhận
diện đúng loại file, không cần chọn**.

**Cách nhận diện + xử lý mẫu mới**:
- Tìm dòng có ô "STT" để biết đây là mẫu báo cáo (không có thì coi là mẫu cũ, xử lý y hệt trước giờ).
- Từ dòng đó, tự dò đúng cột cần dùng theo **TÊN cột** (Tên khách hàng, Địa chỉ, Số CMND, Điện thoại, Số
  HĐ, Ngày vay, Ngày đáo hạn, Lãi suất, Số tiền vay, Số dư, Thu lãi đến ngày) — **không quan tâm thứ tự
  cột trong file, có thêm cột khác (Mã KH, Sổ thành viên, Dự thu lũy kế, Phân kỳ theo từng năm...) cũng
  không ảnh hưởng gì**, những cột đó chỉ đơn giản không được dùng tới.
- Lọc bỏ mọi dòng KHÔNG PHẢI hợp đồng thật (dòng cộng dồn theo loại vay/"Tổng cộng"/chữ ký cuối file) —
  nhận biết qua việc dòng đó KHÔNG có đúng 1 số CMND/CCCD hợp lệ (9-12 số) ở cột "Số CMND".

**Đã sửa thêm 1 lỗi số liệu quan trọng** phát hiện trong lúc làm mẫu mới: mẫu mới ghi số tiền kiểu
"100,000,000" (dấu **phẩy** ngăn cách hàng nghìn) — code đọc số cũ chỉ hiểu đúng kiểu Việt Nam "100.000.000"
(dấu **chấm**), gặp kiểu có phẩy sẽ hiểu sai nghiêm trọng (chỉ đổi đúng dấu phẩy ĐẦU TIÊN thành dấu chấm
rồi dừng đọc luôn ở dấu phẩy kế tiếp — "100,000,000" bị đọc thành **100**, sai đến hàng triệu lần). Đã
sửa để đọc đúng CẢ 2 kiểu (chấm hoặc phẩy ngăn cách hàng nghìn) — không ảnh hưởng gì tới mẫu cũ.

**Đã tự kiểm tra kỹ với đúng file mẫu bạn gửi**: 548 hợp đồng đọc đúng, không dòng nào lỗi, tổng Số tiền
vay + Số dư của toàn bộ 548 dòng sau khi đọc **khớp chính xác từng đồng** với dòng "Tổng cộng" có sẵn
trong chính file đó (49.582.825.420đ và 45.539.744.000đ).

**Việc cần bạn làm**: KHÔNG cần chạy SQL/deploy Edge Function gì — chỉ sửa file JS tĩnh, GitHub Pages tự
deploy khi push `main`. Thử nhập lại file mẫu mới, kiểm tra kỹ danh sách hợp đồng sau khi nhập cho chắc.

---

### 10.44. Ghi nhận thêm "Mã khế ước" + "Phân kỳ trả nợ theo năm" khi nhập Excel (BẮT BUỘC chạy SQL + deploy lại `create-account`)

**1. Dòng "cộng dồn theo loại vay" ở giữa các dòng khách hàng — ĐÃ tự bỏ từ mục 10.43, không cần sửa
thêm**: bộ lọc dòng thật ở mục 10.43 không dựa vào ĐÚNG CHỮ "ngắn hạn"/"trung hạn" (nên không sợ đổi tên
loại vay khác đi là bị sót) — mà dựa vào việc dòng đó có ĐÚNG 1 số CMND/CCCD hợp lệ hay không. Dòng
"cộng dồn theo loại vay" nào cũng đều KHÔNG có CCCD (chỉ có số tiền cộng dồn) nên tự động bị loại bỏ, dù
sau này có thêm loại vay khác (VD: "Cho vay vốn trong nước dài hạn") cũng tự loại đúng, không cần sửa
code thêm.

**2. Mã khế ước** — thêm cột mới lưu lại "Mã khế ước" từ file Excel (hiện tại luôn trùng với "Số HĐ",
nhưng ghi nhận riêng phòng khi sau này khác nhau) — hiện thêm 1 dòng trong chi tiết hợp đồng, KHÔNG thay
đổi gì cách tính/hiển thị các số liệu hiện có.

**3. Phân kỳ trả nợ theo năm (tính năng ĐANG THỬ NGHIỆM)** — file Excel mẫu mới có thể có các cột "Phân
kỳ năm 2026", "Phân kỳ năm 2027"... và sẽ có thêm các năm sau này (2031, 2032...) — hệ thống tự dò các
cột này theo MẪU TÊN CỘT (không liệt kê cứng danh sách năm) nên KHÔNG cần sửa code khi file có thêm cột
năm mới.

- Hợp đồng nào chỉ có **1 năm** ghi số liệu > 0 (hoặc không có cột nào) → **coi như KHÔNG có phân kỳ trả
  nợ**, tính và hiển thị Y HỆT hiện tại (dùng "Ngày đáo hạn" như bình thường) — **không đổi gì**.
- Hợp đồng có **từ 2 năm trở lên** ghi số liệu > 0 → coi là có **nhiều kỳ trả nợ**, mỗi năm là 1 kỳ:
  - Ngày đến hạn của kỳ đó = **Ngày vay, đổi sang đúng năm của kỳ** (giữ nguyên tháng/ngày). VD: vay ngày
    03/08/2026, kỳ năm 2027 → đến hạn 03/08/2027; kỳ năm 2028 → đến hạn 03/08/2028.
  - Mỗi kỳ tự xét có cảnh báo đến hạn hay không dựa vào **số tiền đã trả LŨY KẾ tới hiện tại** (= Số
    tiền vay ban đầu − Số dư hiện tại), so với **TỔNG các kỳ tính đến kỳ đang xét** (cộng dồn từ kỳ đầu
    tiên, không phải chỉ riêng số tiền của kỳ đó): kỳ đã tới/qua ngày đến hạn nhưng đã trả lũy kế **≥**
    tổng các kỳ tính đến kỳ đó → coi như đã trả đủ (hoặc vượt) mốc này rồi (trả sớm/trả nhiều hơn lịch
    cho các kỳ trước) → **không cảnh báo kỳ đó nữa**, và cứ thế xét tiếp các kỳ sau. Ngược lại (đã trả
    lũy kế < tổng các kỳ tính đến kỳ đó) → cảnh báo, số tiền báo = **phần còn thiếu** để đủ tổng các kỳ
    tính đến đó (= tổng lũy kế − đã trả lũy kế), KHÔNG phải nguyên số tiền ghi trong kỳ — nếu kỳ trước đã
    trả thiếu (VD kỳ cần 10tr nhưng mới trả 5tr) thì kỳ đó chỉ báo thêm đúng phần còn thiếu (5tr) cho đủ.
  - **Riêng KỲ CUỐI CÙNG** (trùng "Ngày đáo hạn" hợp đồng): nếu còn số dư nợ → chắc chắn sẽ báo, và số
    tiền báo luôn **đúng bằng số dư nợ hiện tại còn lại** (không dùng số tính lũy kế nữa, để không lệ
    thuộc việc tổng các kỳ khai báo trong Excel có khớp tuyệt đối với Số tiền vay hay không).
    - VD thực tế (khách NGUYỄN THỊ NHƯ Ý, HĐ 259/26): vay 280tr, dư nợ hiện tại 140tr → đã trả lũy kế
      140tr. Phân kỳ 2027: 10tr, 2028: 10tr, 2029: 260tr (kỳ cuối). Kỳ 2027: lũy kế đến kỳ này = 10tr, đã
      trả 140tr ≥ 10tr → **không báo**. Kỳ 2028: lũy kế 2 kỳ = 20tr, đã trả 140tr ≥ 20tr → **không báo**.
      Kỳ 2029 (kỳ cuối): đã trả 140tr < lũy kế 280tr → **sẽ báo**, đúng bằng **số dư nợ còn lại** lúc đó
      (không cố định 260.000.000đ theo Excel) khi tới 04/06/2029.
    - VD trả thiếu: vay 100tr 01/01/2026, phân kỳ 2027: 10tr, 2028: 10tr — nhưng trong năm chỉ trả được
      5tr (dư nợ còn 95tr) → đến 01/01/2027 hệ thống sẽ báo **thêm đúng 5.000.000đ** (phần còn thiếu cho
      đủ 10tr của kỳ 2027), không báo lại nguyên 10 triệu.
- **CHƯA gắn vào bất kỳ chỗ nào khác** (Tổng quan, danh sách "Gần đến hạn", nhắc nợ tự động, Zalo OA...)
  — đúng yêu cầu "bảng này chưa cần thể hiện". Chỉ xem được khi bấm vào **chi tiết 1 hợp đồng cụ thể**
  (chỉ hiện khối này nếu hợp đồng đó thật sự có ≥ 2 kỳ), có ghi rõ "(thử nghiệm)" để biết đây là tính
  năng đang thử, chưa dùng cho cảnh báo/nhắc nợ thật.

**Đã tự kiểm tra với đúng file mẫu bạn gửi**: 547/548 hợp đồng chỉ có 1 năm có số liệu (tính như bình
thường, không đổi gì) — đúng 11/548 hợp đồng có từ 2 năm trở lên (có phân kỳ trả nợ thật), đã tự tính thử
ra đúng ngày đến hạn theo từng năm và số tiền từng kỳ.

**Cập nhật 26/08/2026 (lần 1)**: sửa lại đúng quy tắc "cộng dồn" ở trên (bản đầu tiên chỉ so từng kỳ riêng
lẻ với Số dư hiện tại — với hợp đồng có kỳ CUỐI là kỳ LỚN NHẤT như VD trên thì bị suy ra sai, kỳ lớn
nhất/quan trọng nhất lại không báo).

**Cập nhật 26/08/2026 (lần 2)**: sửa thêm số tiền BÁO khi cảnh báo — trước đó báo nguyên số tiền ghi
trong kỳ theo Excel, giờ báo đúng **phần còn thiếu thực tế** (đã trừ phần trả dư từ kỳ trước), và riêng
KỲ CUỐI CÙNG luôn báo đúng **số dư nợ hiện tại còn lại** thay vì con số cố định theo Excel — xem 2 VD ở
trên.

**Cập nhật 26/08/2026 (lần 3)**: đổi khối hiển thị trong chi tiết hợp đồng thành **bảng đúng 3 cột "Kỳ hạn
trả nợ | Ngày | Số tiền"** (trước đó là danh sách dòng) — để dễ theo dõi hơn. Kỳ GẦN NHẤT chưa tới hạn
(kỳ tới) được tô nền xám riêng + ghi chú "(kỳ tới)" để nhìn ra ngay kỳ sắp tới là kỳ nào, ngày nào, số
tiền dự kiến bao nhiêu — kể cả những kỳ CHƯA đến hạn cũng hiện số tiền dự kiến (số tiền THỰC SỰ còn thiếu
tính đến kỳ đó theo đúng lũy kế, không phải số tiền cố định ghi trong Excel). Vẫn giữ nguyên vị trí xem
(bấm vào chi tiết 1 hợp đồng, chưa gắn vào Tổng quan/nhắc nợ/Zalo OA).

**Cập nhật 26/08/2026 (lần 4)**: 2 thay đổi lớn theo đúng yêu cầu:

1. **Hiện cả bên khách hàng** (trước đó chỉ có bên quản trị): trang "Chi tiết hợp đồng" của khách hàng
   (`js/views/contractDetail.js`) giờ cũng có ô "Kỳ tới" y hệt bên quản trị.
2. **Đổi cách hiển thị**: thay vì hiện LUÔN cả bảng đầy đủ trong chi tiết hợp đồng, giờ chỉ hiện 1 Ô TÓM
   TẮT đúng **kỳ đến hạn TIẾP THEO** (kỳ đầu tiên còn thiếu tiền — có thể đã quá hạn hoặc còn ở tương
   lai): "Kỳ N — Ngày — Số tiền trả". Bấm vào ô này mới mở popup xem bảng đầy đủ TỪNG kỳ (dùng chung 1
   component `installmentNextBoxHtml()` / `openInstallmentPlanModal()` trong `js/components/ui.js` cho
   cả 2 bên, tránh lặp code, đảm bảo tính toán/hiển thị giống hệt nhau).
3. **Cảnh báo "gần đến hạn"/"quá hạn" cho TỪNG KỲ** — dùng ĐÚNG ngưỡng `NEAR_DUE_DAYS` (15 ngày) sẵn có
   (y hệt cảnh báo "Gần đến hạn"/"Quá hạn" của ngày đáo hạn HỢP ĐỒNG GỐC hiện tại): còn ≤ 15 ngày nữa đến
   kỳ đó → tô vàng cảnh báo "Còn N ngày nữa đến hạn kỳ này"; đã qua ngày mà kỳ đó vẫn còn thiếu tiền → tô
   đỏ cảnh báo "Kỳ này đã quá hạn N ngày". Số tiền cảnh báo luôn là **số tiền THỰC SỰ còn thiếu của kỳ đó**
   (đã trừ phần trả dư từ kỳ trước — xem 2 lần cập nhật trước), không phải số cố định ghi trong Excel.
4. VD thực tế (khách Nguyễn Tưởng, HĐTĐ 329/26): vay 200tr 24/07/2026, phân kỳ 2027: 20tr, 2028: 20tr,
   2029: 160tr. Nếu trong năm 2026 đã trả 10tr (dư nợ còn 190tr) → kỳ tới là **24/07/2027, còn thiếu
   10.000.000đ** (20tr của kỳ đó − 10tr đã trả trước) — khi còn ≤ 15 ngày tới 24/07/2027 sẽ tự tô vàng
   cảnh báo, qua ngày đó mà chưa đủ tiền sẽ tự chuyển sang tô đỏ "quá hạn".

**Cập nhật 26/08/2026 (lần 5)**: 3 sửa đổi theo đúng yêu cầu:

1. **Bỏ hiển thị "Mã khế ước"** khỏi chi tiết hợp đồng (bên quản trị) — vẫn LƯU đầy đủ trong DB
   (`contracts.agreement_code`), chỉ không hiện ra màn hình nữa. Dữ liệu này để dành riêng cho việc gửi
   Zalo OA sau này (chưa làm, chỉ ghi nhận trước).
2. **Sửa lại đúng số tiền hiển thị cho từng kỳ** — bug ở "lần 1-2": các kỳ CHƯA đến hạn (kể cả kỳ cuối)
   trước đó bị tính "dự kiến" theo kiểu cộng dồn/theo dư nợ hiện tại, ra số SAI khi chưa có gì bất thường
   xảy ra (VD SAI: phân kỳ 20tr/20tr/160tr nhưng hiển thị 20tr/40tr/200tr). Sửa lại: MẶC ĐỊNH mỗi kỳ hiện
   ĐÚNG số tiền ghi trong kỳ theo Excel (20tr/20tr/160tr) — chỉ kỳ ĐÃ đến/quá hạn mới trừ bớt phần trả dư
   từ các kỳ TRƯỚC nó; riêng KỲ CUỐI chỉ đổi thành SỐ DƯ NỢ CÒN LẠI khi số tiền đã trả LŨY KẾ đã VƯỢT quá
   tổng tất cả các kỳ TRƯỚC kỳ cuối (không phải cứ tới kỳ cuối là dùng dư nợ như trước).
3. **Bộ lọc "Gần đến hạn"/"Nợ quá hạn" ở trang Khách hàng giờ xét CẢ kỳ hạn trả nợ** (trước chỉ xét ngày
   đáo hạn hợp đồng gốc): hợp đồng có 1 kỳ GIỮA CHỪNG (không phải kỳ cuối/ngày đáo hạn hợp đồng) đã đến
   hoặc gần đến hạn cũng tự lọt vào đúng bộ lọc, hiện đúng badge "Quá hạn N ngày"/"Gần đến hạn N ngày" +
   dòng "Kỳ trễ hạn: Kỳ N — số tiền" ngay ở dòng hợp đồng gọn, y hệt cách cảnh báo ngày đáo hạn hợp đồng
   gốc hiện có (`contractAttentionInfo()`/`S.nextInstallmentInfo()`).

**Cập nhật 26/08/2026 (lần 6)**: sửa tiếp — số tiền đã trả dư ra phải PHÂN BỔ NGAY cho kỳ sau (kỳ trước
"no" đủ mới tới lượt kỳ sau), áp dụng cho MỌI kỳ, kể cả kỳ CHƯA tới hạn (bản "lần 5" chỉ trừ bớt khi kỳ đã
đến/quá hạn, kỳ chưa tới hạn luôn hiện nguyên số ghi Excel dù đã trả dư — chưa đúng). VD: phân kỳ
20tr/20tr/160tr (kỳ cuối):
- Trả dư 30tr (dư nợ 170tr) → kỳ 1 dùng hết 20tr (dư 10tr) → hiển thị **0đ**; kỳ 2 chỉ còn thiếu
  20tr − 10tr = **10tr**; kỳ cuối vẫn 160tr (30tr chưa vượt tổng 2 kỳ đầu 40tr).
- Trả dư 50tr (dư nợ 150tr) → kỳ 1 và kỳ 2 đều **0đ** (dùng hết 40tr cho cả 2 kỳ); kỳ cuối đổi thành
  đúng **150tr** (= số dư nợ hiện tại, vì 50tr đã vượt tổng 2 kỳ đầu).

**Cập nhật 26/08/2026 (lần 7)**: "Trạng thái" (badge Trong hạn/Gần đến hạn/Quá hạn/Đã tất toán) + dòng
cảnh báo ở **chi tiết hợp đồng CẢ 2 BÊN** (quản trị VÀ khách hàng) + **trang chủ khách hàng** ("Hợp đồng
vay của bạn") giờ cũng xét luôn "Kỳ tới" của phân kỳ trả nợ (không chỉ ngày đáo hạn hợp đồng gốc như
trước) — dùng hàm mới `S.contractStatusInfo()`. Hợp đồng có 1 kỳ GIỮA CHỪNG (không phải kỳ cuối/ngày đáo
hạn hợp đồng) đến/gần đến/quá hạn thì "Trạng thái" tự chuyển màu + hiện đúng cảnh báo, số tiền cảnh báo
= đúng số tiền đến hạn của KỲ đó (không phải toàn bộ dư nợ). VD thực tế: hợp đồng đáo hạn 24/07/2029
(còn rất xa) nhưng kỳ 2027 (20tr) đã trễ 22 ngày → "Trạng thái" tự chuyển đỏ **"Quá hạn 22 ngày"**, dòng
cảnh báo hiện **"Kỳ trả nợ đã quá hạn 22 ngày"** — dù ngày đáo hạn hợp đồng vẫn còn 2 năm nữa.

Ô "Kỳ tới" (đã có từ lần 4) đã tự động chuyển sang kỳ kế tiếp khi kỳ trước đã trả đủ (dueAmount = 0) —
không cần sửa gì thêm.

CHỦ Ý: `contractUrgency()`/`effectiveContractStatus()` gốc (dùng cho mẫu tin Zalo OA/nhắc nợ tự động)
**giữ NGUYÊN VẸN, KHÔNG đổi** — đúng yêu cầu "chưa gắn phân kỳ vào Zalo OA". Chỗ mới
(`contractStatusInfo()`) là hàm RIÊNG, chỉ dùng cho "Trạng thái" ở chi tiết hợp đồng + trang chủ khách
hàng.

**Cập nhật 26/08/2026 (lần 8)**: 5 tinh chỉnh theo đúng yêu cầu:

1. **Bỏ dòng cảnh báo TRÙNG lặp bên khách hàng (và cả bên quản trị)**: trước đó khi 1 KỲ gần/quá hạn, có
   2 dòng cảnh báo giống nhau (1 ở ô "Kỳ tới", 1 ở cuối khung chi tiết) — giờ chỉ còn ĐÚNG 1 dòng (gắn
   liền với ô "Kỳ tới"), chữ to hơn (13px, đậm). Dòng cảnh báo cuối khung chỉ còn hiện khi cảnh báo đến từ
   NGÀY ĐÁO HẠN hợp đồng gốc (không phải từ 1 kỳ cụ thể) — không còn trùng lặp.
2. **Tự động điền sẵn "Thanh toán" khi có kỳ gần/quá hạn (bên khách hàng)**: nếu hợp đồng đang có 1 kỳ
   gần đến hạn/quá hạn, bấm nút "Thanh toán" sẽ tự chọn sẵn **"Trả gốc"** + điền sẵn đúng **số tiền của kỳ
   đó** (không cần tự gõ tay) — hợp đồng thường (không có kỳ, hoặc cảnh báo từ ngày đáo hạn hợp đồng gốc)
   vẫn mặc định "Trả lãi" như trước giờ.
3. **Trang chủ khách hàng: hợp đồng gần/quá hạn lên đầu danh sách** — sắp xếp theo mức độ: Quá hạn > Gần
   đến hạn > Trong hạn > Đã tất toán (xét cả kỳ hạn trả nợ, không chỉ ngày đáo hạn hợp đồng gốc).
4. **Tổng quan (Tổng quan quản trị) giờ đã gắn phân kỳ trả nợ vào** — ô "Hợp đồng quá hạn"/"Gần đến hạn"
   (số lượng + tổng tiền) và popup danh sách khi bấm vào 2 ô đó giờ xét CẢ kỳ hạn trả nợ, không chỉ ngày
   đáo hạn hợp đồng gốc — dùng hàm mới `S.contractAttentionInfo()` (chuyển từ hàm cục bộ trong
   `admin/customers.js` sang `state.js` để dùng chung cho cả 2 trang). Vẫn CHƯA gắn vào mẫu tin Zalo
   OA/nhắc nợ tự động (`contractUrgency()` gốc giữ nguyên, xem CHỦ Ý ở trên).
5. **Dòng "Kỳ trễ hạn: Kỳ N — số tiền" ở trang Khách hàng rõ hơn** — chữ to hơn (13px), đậm, tô màu đỏ
   (quá hạn) hoặc vàng (gần đến hạn) thay vì chữ nhỏ xám mờ như trước.

**Cập nhật 26/08/2026 (lần 9)**: sửa tiếp — khách hàng CHỈ CÓ 1 hợp đồng trước đó KHÔNG hiện dòng "Kỳ
trễ hạn:.../Kỳ gần đến hạn:..." dưới dòng địa chỉ (chỉ khách có TỪ 2 hợp đồng trở lên mới hiện, do dùng 2
đường code khác nhau: `contractRowCompact()` cho nhiều hợp đồng, `contractAmountsHtml()` cho 1 hợp đồng —
dòng cảnh báo chỉ có ở đường đầu). Tách riêng `installmentHintHtml()` dùng CHUNG cho cả 2 trường hợp — giờ
khách chỉ có 1 hợp đồng cũng hiện đúng dòng cảnh báo này (to/đậm, đỏ/vàng theo đúng mức, y hệt khách có
nhiều hợp đồng).

**Cập nhật 26/08/2026 (lần 10)**: 2 tinh chỉnh theo đúng yêu cầu:

1. **Số tiền ở Tổng quan (ô "Hợp đồng quá hạn"/"Gần đến hạn" + popup danh sách khi bấm vào)** giờ là ĐÚNG
   số tiền của KỲ đến hạn (nếu cảnh báo đến từ 1 kỳ cụ thể trong phân kỳ trả nợ), KHÔNG phải toàn bộ dư nợ
   hợp đồng như trước — mở rộng `S.contractAttentionInfo()` trả thêm `dueAmount`/`source` (y hệt cách
   `contractStatusInfo()` đã làm), áp dụng cho cả tổng cộng của cả nhóm LẪN từng dòng trong popup.
2. **Dòng "Kỳ trễ hạn:.../Kỳ gần đến hạn:..." ở trang Khách hàng** — bỏ in đậm + tô màu cho CẢ DÒNG (bản
   "lần 8/9"), giờ chữ nhãn bình thường như field-hint, CHỈ riêng SỐ TIỀN mới in đậm + tô màu (đỏ = trễ
   hạn, vàng = gần đến hạn).

**Cập nhật 26/08/2026 (lần 11)**: trang chủ khách hàng — bỏ chữ "Quá hạn N ngày"/"Gần đến hạn — còn N
ngày" ngay cạnh dòng "Ngày đến hạn" (dễ gây hiểu lầm là NGÀY ĐÁO HẠN HỢP ĐỒNG quá/gần hạn, trong khi có
thể chỉ 1 KỲ giữa chừng đang cảnh báo, ngày đáo hạn hợp đồng thật ra còn xa) — badge ở đầu mỗi thẻ hợp
đồng ("Trong hạn"/"Gần đến hạn N ngày"/"Quá hạn N ngày") đã đủ để cảnh báo rồi, "Ngày đến hạn" giờ chỉ
hiện đúng ngày, không kèm chữ trạng thái nữa.

**Cập nhật 26/08/2026 (lần 12) — BẮT BUỘC deploy lại 2 Edge Function**: đây là lần đầu tiên phân kỳ trả
nợ được gắn vào Zalo OA/thông báo đẩy tự động (trước đó CHỦ Ý chưa gắn, theo đúng yêu cầu ban đầu — giờ
người dùng yêu cầu gắn vào).

1. **App (thông báo đẩy) + Zalo OA**: khi khách có 1 KỲ (không nhất thiết phải là kỳ cuối) gần đến
   hạn/quá hạn, hệ thống tự chuyển sang mẫu "Gần đến hạn"/"Quá hạn" y hệt cách đang làm với ngày đáo hạn
   hợp đồng gốc — nhưng **"Số tiền gốc"/"GỐC_PHẢI_TRA" giờ là ĐÚNG số tiền của KỲ đó**, không phải toàn bộ
   dư nợ hợp đồng nữa (`SO_DU`/dư nợ trong mẫu Zalo vẫn luôn là dư nợ thật, không đổi — chỉ riêng
   `GOC_PHAI_TRA` đổi).
2. **Lịch gửi TỰ ĐỘNG (App + Zalo OA "báo lãi tự động") được MỞ RỘNG** để xét luôn kỳ hạn trả nợ — trước
   đó CHỈ tính theo ngày đáo hạn hợp đồng gốc (bắt đầu nhắc 10 ngày trước hạn, lặp mỗi 3 ngày). Giờ nếu 1
   kỳ giữa chừng (VD: kỳ 2027, trong khi hợp đồng đáo hạn 2029) gần/quá hạn TRƯỚC ngày đáo hạn hợp đồng
   gốc, lịch nhắc sẽ tự bắt đầu SỚM HƠN, đúng theo kỳ đó — công thức "10 ngày trước + lặp mỗi 3 ngày" và
   toàn bộ cơ chế chống gửi trùng/giới hạn 5 ngày/lần Zalo **giữ nguyên không đổi**, chỉ đổi MỐC để tính.
3. **Gửi tay Zalo OA** (nút "Gửi tin Zalo OA ngay") cũng tự chọn đúng mẫu + đúng số tiền gốc theo kỳ y
   hệt gửi tự động (đồng nhất giữa gửi tay/gửi tự động như quy ước sẵn có của hệ thống).
4. **SMS KHÔNG đổi gì** — tin nhắn SMS hiện tại CHỈ báo số tiền lãi (không có trường "gốc"/không có mẫu
   "gần đến hạn"/"quá hạn" riêng nào cả, luôn 1 mẫu cố định) nên không có gì để sửa theo yêu cầu này —
   nếu muốn SMS cũng có mẫu gần/quá hạn kèm số tiền gốc thì đây là việc MỚI, báo lại để làm riêng.
5. VD thực tế (Nguyễn Tưởng, HĐTĐ 329/26): hợp đồng đáo hạn 24/07/2029 (còn rất xa), nhưng phân kỳ 2027:
   20tr, 2028: 20tr, 2029: 160tr — kỳ 2027 gần/quá hạn thì App + Zalo OA tự động nhắc SỚM (từ 14/07/2027
   trở đi, lặp mỗi 3 ngày), báo đúng **20.000.000đ** (số tiền của kỳ 2027), KHÔNG đợi tới gần 2029 và
   KHÔNG báo nguyên dư nợ 200 triệu.

**Cập nhật 26/08/2026 (lần 13) — BẮT BUỘC deploy lại 2 Edge Function lần nữa**: sửa thêm — trường
`NGAY_DAO_HAN` trong mẫu Zalo OA (lần 12 CHỦ Ý để nguyên = ngày đáo hạn hợp đồng gốc, coi là tên tham số
cố định của mẫu ZNS đã đăng ký) giờ ĐỔI theo đúng yêu cầu "tất cả ngày đáo hạn đều lấy theo ngày của kỳ
trả nợ": khi mẫu "Đến hạn" được gửi vì 1 KỲ đang cần chú ý, `NGAY_DAO_HAN` lấy ĐÚNG ngày đến hạn của KỲ
đó (không phải ngày đáo hạn hợp đồng gốc nữa). Áp dụng cho cả gửi tự động (`send-due-reminders`) lẫn gửi
tay (`create-account`). Dòng "Vui lòng thanh toán trước ngày..." trong thông báo đẩy (App) và "Số tiền
gốc"/"hạn chót" trong popup admin tự gửi tay (`buildContractNotificationPreset`) đã ĐÚNG đúng theo kỳ từ
lần 12, không cần sửa thêm.

Việc cần bạn làm: **deploy lại CẢ 2 Edge Function `send-due-reminders` và `create-account`** (2 file vừa
gửi lại lần này) — vào Supabase Dashboard → Edge Functions → chọn từng function → dán đè toàn bộ nội dung
file mới → Deploy. Không cần chạy SQL gì thêm (chỉ dùng cột `installment_schedule` đã có sẵn từ mục 10.44).

Cả 13 lần cập nhật (11 lần đầu chỉ sửa JS/CSS phía trình duyệt; lần 12 và 13 BẮT BUỘC deploy lại 2 Edge
Function ở trên) — không đụng dữ liệu, không cần chạy SQL thêm nào khác.

```sql
alter table contracts add column if not exists agreement_code text;
alter table contracts add column if not exists installment_schedule jsonb;
```

**Việc cần bạn làm**:
1. Chạy đoạn SQL trên (2 dòng, chỉ thêm cột mới, không đụng dữ liệu đã có).
2. Deploy lại **`create-account`** (file vừa gửi) — Supabase Dashboard → Edge Functions → chọn
   `create-account` → dán đè toàn bộ nội dung file mới → Deploy.
3. Nhập lại file Excel mẫu mới — bấm vào 1-2 hợp đồng có nhiều kỳ trả nợ (VD: các hợp đồng vay lớn, chia
   trả nhiều năm) để xem thử khối "Phân kỳ trả nợ (thử nghiệm)" trong chi tiết hợp đồng, kiểm tra đúng ý
   trước khi quyết định có gắn vào các cảnh báo/nhắc nợ chính thức hay không.

---

*Tài liệu hướng dẫn — code triển khai thật đã có trong repo này (`js/state.js`, `js/lib/`,
`supabase/functions/`), gắn với project Supabase thật của bạn. Các mục "Việc cần bạn làm" rải rác ở
trên là những bước KHÔNG tự động (SQL/secret/deploy Edge Function) bạn cần tự chạy trên Supabase
Dashboard — sửa code trong repo không tự áp dụng lên project Supabase đang chạy.*
