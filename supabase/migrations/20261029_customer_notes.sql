-- Ghi chú & nhắc việc theo khách hàng (docs mục 10.92). An toàn chạy lại nhiều lần.
create table if not exists customer_notes (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  contract_id text references contracts(id) on delete set null,
  body text not null check (char_length(body) between 1 and 300),
  kind text not null default 'none' check (kind in ('none', 'after', 'date', 'monthly')),
  after_days int check (after_days between 1 and 365),
  monthly_day int check (monthly_day between 1 and 31),
  remind_on date,
  amount bigint check (amount >= 0),
  visibility text not null default 'all' check (visibility in ('all', 'me')),
  status text not null default 'open' check (status in ('open', 'done')),
  created_by text references admins(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_by text references admins(id) on delete set null,
  done_by_name text,
  done_at timestamptz
);
create index if not exists customer_notes_customer_idx on customer_notes (customer_id, status);
create index if not exists customer_notes_due_idx on customer_notes (status, remind_on);

create table if not exists customer_note_log (
  id text primary key,
  note_id text not null references customer_notes(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  contract_id text,
  action text not null check (action in ('done', 'snooze')),
  body text not null default '',
  due_on date,
  amount bigint,
  by_id text references admins(id) on delete set null,
  by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists customer_note_log_customer_idx on customer_note_log (customer_id, created_at desc);

alter table customer_notes enable row level security;
alter table customer_note_log enable row level security;
grant select, insert, update, delete on customer_notes to anon, authenticated, service_role;
grant select, insert on customer_note_log to anon, authenticated, service_role;

drop policy if exists "admins read notes" on customer_notes;
create policy "admins read notes" on customer_notes
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and (visibility = 'all' or created_by = (auth.jwt() ->> 'row_id'))
    and exists (select 1 from customers c where c.id = customer_notes.customer_id)
  );

drop policy if exists "admins add notes" on customer_notes;
create policy "admins add notes" on customer_notes
  for insert with check (
    (auth.jwt() ->> 'app_role') = 'admin'
    and created_by = (auth.jwt() ->> 'row_id')
    and exists (select 1 from customers c where c.id = customer_notes.customer_id)
  );

drop policy if exists "admins update notes" on customer_notes;
create policy "admins update notes" on customer_notes
  for update using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and (visibility = 'all' or created_by = (auth.jwt() ->> 'row_id'))
    and exists (select 1 from customers c where c.id = customer_notes.customer_id)
  ) with check (
    (auth.jwt() ->> 'app_role') = 'admin'
    and (visibility = 'all' or created_by = (auth.jwt() ->> 'row_id'))
    and exists (select 1 from customers c where c.id = customer_notes.customer_id)
  );

drop policy if exists "owner or super delete notes" on customer_notes;
create policy "owner or super delete notes" on customer_notes
  for delete using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (select 1 from customers c where c.id = customer_notes.customer_id)
    and (
      created_by = (auth.jwt() ->> 'row_id')
      or exists (select 1 from admins a where a.id = (auth.jwt() ->> 'row_id') and a.role = 'super')
    )
  );

drop policy if exists "admins read note log" on customer_note_log;
create policy "admins read note log" on customer_note_log
  for select using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (select 1 from customer_notes n where n.id = customer_note_log.note_id)
  );

drop policy if exists "admins add note log" on customer_note_log;
create policy "admins add note log" on customer_note_log
  for insert with check (
    (auth.jwt() ->> 'app_role') = 'admin'
    and by_id = (auth.jwt() ->> 'row_id')
    and exists (select 1 from customer_notes n where n.id = customer_note_log.note_id)
  );
