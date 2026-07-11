\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'

\echo '### whoami (must be court_svc, non-superuser)'
select current_user,
       (select rolsuper from pg_roles where rolname=current_user) as is_super,
       (select rolbypassrls from pg_roles where rolname=current_user) as bypass_rls;

\echo '### 1. as tenant A: insert a court (WITH CHECK must accept matching tenant)'
select set_config('app.tenant_id', :'A', false);
insert into court.courts (tenant_id, name, court_type) values (:'A', 'SDM Court Ward 1', 'revenue');
select count(*) as a_sees_own_after_insert from court.courts;

\echo '### 2. as tenant B: MUST NOT see tenant A rows (isolation)'
select set_config('app.tenant_id', :'B', false);
select count(*) as b_sees_a_rows from court.courts;

\echo '### 3. as tenant B: spoofed insert with tenant_id=A MUST be rejected by WITH CHECK'
insert into court.courts (tenant_id, name, court_type) values (:'A', 'spoofed', 'revenue');

\echo '### 4. as tenant B: cross-tenant UPDATE must affect 0 rows'
update court.courts set name='HACKED' where name='SDM Court Ward 1';

\echo '### 5. as tenant B: cross-tenant DELETE must affect 0 rows'
delete from court.courts;

\echo '### 6. back to tenant A: original row intact and visible (1 row, unmodified name)'
select set_config('app.tenant_id', :'A', false);
select count(*) as a_row_count, max(name) as a_name from court.courts;

\echo '### 7. UNSET/empty GUC: fail-closed via NULLIF -> 0 rows visible'
select set_config('app.tenant_id', '', false);
select count(*) as visible_with_empty_guc from court.courts;
