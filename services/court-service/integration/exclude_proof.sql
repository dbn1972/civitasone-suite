\set T '11111111-1111-1111-1111-111111111111'
-- parents (superuser bypasses RLS; this test targets the EXCLUDE constraint)
insert into court.courts (id, tenant_id, name, court_type)
  values ('c0000000-0000-0000-0000-000000000001', :'T', 'Test Court', 'revenue')
  on conflict (id) do nothing;
insert into court.cases (id, tenant_id, cnr_number)
  values ('ca000000-0000-0000-0000-000000000001', :'T', 'MHRV0100012026')
  on conflict (id) do nothing;
insert into court.cause_lists (id, tenant_id, court_id, list_date, status)
  values ('c1000000-0000-0000-0000-000000000001', :'T', 'c0000000-0000-0000-0000-000000000001', '2026-07-20', 'draft')
  on conflict (id) do nothing;

\echo '### (a) first item -> courtroom 3, slot 2  [expect INSERT 0 1]'
insert into court.cause_list_items (id, tenant_id, cause_list_id, case_id, list_date, slot, courtroom)
  values (gen_random_uuid(), :'T', 'c1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2026-07-20', '2', '3');

\echo '### (b) SECOND item -> SAME (tenant,date,slot,courtroom)  [MUST FAIL 23P01]'
insert into court.cause_list_items (id, tenant_id, cause_list_id, case_id, list_date, slot, courtroom)
  values (gen_random_uuid(), :'T', 'c1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2026-07-20', '2', '3');

\echo '### (c) DIFFERENT courtroom 4, same slot  [expect INSERT 0 1 — no conflict]'
insert into court.cause_list_items (id, tenant_id, cause_list_id, case_id, list_date, slot, courtroom)
  values (gen_random_uuid(), :'T', 'c1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2026-07-20', '2', '4');

\echo '### final item count for this cause list [expect 2]'
select count(*) as items from court.cause_list_items where cause_list_id='c1000000-0000-0000-0000-000000000001';
