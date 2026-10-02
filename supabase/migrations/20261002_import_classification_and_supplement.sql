-- Chạy trước khi triển khai create-account và giao diện nhập hai file.
-- Các cột mới mặc định NULL để giữ nguyên hợp đồng đã nhập trước đây.
alter table public.contracts add column if not exists collateral_type text;
alter table public.contracts add column if not exists loan_term text;
alter table public.contracts add column if not exists loan_purpose text;
alter table public.contracts add column if not exists agreement_code text;
alter table public.contracts add column if not exists installment_schedule jsonb;

-- File số 2 chỉ cập nhật hai trường bổ sung theo số HĐTD đang còn dư nợ.
-- Một lệnh gọi thực hiện trong một giao dịch: lỗi kiểm tra sẽ không cập nhật dở dang.
create or replace function public.apply_contract_supplement(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_count integer;
  updated_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid supplement rows';
  end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Invalid supplement rows';
  end if;

  select count(*) into requested_count from jsonb_array_elements(p_rows);
  if exists (
    select 1 from jsonb_array_elements(p_rows) as item
    where jsonb_typeof(item.value) <> 'object' or nullif(btrim(item.value->>'code'), '') is null
  ) then
    raise exception 'Missing contract code';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) as item
    group by btrim(item.value->>'code') having count(*) > 1
  ) then
    raise exception 'Duplicate contract code in supplement';
  end if;
  -- Giữ tập hợp đồng ổn định từ bước kiểm tra mã trùng tới bước UPDATE.
  lock table public.contracts in share row exclusive mode;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    join public.contracts as c on c.code = btrim(item.value->>'code') and c.balance > 0
    group by c.code having count(*) > 1
  ) then
    raise exception 'Duplicate active contract code in database';
  end if;

  update public.contracts as c
  set agreement_code = coalesce(nullif(btrim(item.value->>'agreementCode'), ''), c.agreement_code, c.code),
      installment_schedule = case
        when jsonb_typeof(item.value->'installmentSchedule') = 'object'
        then nullif(item.value->'installmentSchedule', '{}'::jsonb)
        else c.installment_schedule
      end
  from jsonb_array_elements(p_rows) as item
  where c.code = btrim(item.value->>'code') and c.balance > 0;
  get diagnostics updated_count = row_count;

  return jsonb_build_object('updated', updated_count, 'unmatched', requested_count - updated_count);
end;
$$;

revoke all on function public.apply_contract_supplement(jsonb) from public, anon, authenticated;
grant execute on function public.apply_contract_supplement(jsonb) to service_role;
