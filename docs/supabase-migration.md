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

---

*Tài liệu hướng dẫn — code triển khai thật đã có trong repo này (`js/state.js`, `js/lib/`,
`supabase/functions/`), gắn với project Supabase thật của bạn. Các mục "Việc cần bạn làm" rải rác ở
trên là những bước KHÔNG tự động (SQL/secret/deploy Edge Function) bạn cần tự chạy trên Supabase
Dashboard — sửa code trong repo không tự áp dụng lên project Supabase đang chạy.*
