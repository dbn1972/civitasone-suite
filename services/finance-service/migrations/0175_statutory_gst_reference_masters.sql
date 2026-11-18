-- Migration 0175: statutory GST reference masters (MSME commercial segment, Phase C, lane A1)
--
-- Three NEW, GLOBAL (non-tenant) reference tables in the gl schema:
--   gl.finance_gst_rate_master  effective-dated GST rate slabs (replaces the hard-coded 5/12/18/28 list in
--                               src/modules/gst/gst-rates.ts for the future M3 slab validator)
--   gl.finance_hsn_sac_master   HSN (goods) / SAC (services) code master with a default-rate linkage
--   gl.finance_gst_state_codes  GST state / UT codes (place-of-supply, intra- vs inter-state)
--
-- DESIGN: statutory data is the same for every tenant, so these follow the budget.finance_major_heads
-- convention (migrations 0010 / 0043): GLOBAL reference, NO tenant_id, NO row-level security, read-only
-- to tenants by construction (nothing in the app writes them). tenant-table-rls-guard only governs tables
-- that carry tenant_id, so these are out of its scope. budget.finance_major_heads itself is NOT touched.
--
-- NO CONSUMER: nothing reads these yet (M2/M3/M4 will). gst-rates.ts is unchanged; govt tenants see no change.
-- Additive and lock-safe: new tables only, small plain indexes (tables hold tens/hundreds of rows, so no
-- CREATE INDEX CONCURRENTLY file is needed). Seeds are idempotent (ON CONFLICT DO NOTHING).
--
-- VERIFY-by-CA: every GST rate / HSN value below is a PLACEHOLDER DEFAULT (verify_by_ca = true), not a
-- sourced statutory figure. The 2025-26 rationalisation rows reflect the author's understanding of the 56th
-- GST Council decision (effective 2025-09-22) and MUST be confirmed by the named CA before any consumer
-- relies on them. State codes are static, well-known data (verify_by_ca = false).

CREATE TABLE IF NOT EXISTS gl.finance_gst_rate_master (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_pct       numeric(5,2) NOT NULL,
  cess_pct       numeric(6,2),
  hsn_prefix     text NOT NULL DEFAULT '',   -- '' = general slab; else applies to HSN/SAC codes starting with this prefix
  effective_from date NOT NULL,
  effective_to   date,                       -- NULL = open-ended
  source         text NOT NULL DEFAULT 'placeholder',
  notes          text,
  verify_by_ca   boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_gst_rate_pct   CHECK (rate_pct >= 0 AND rate_pct <= 100),
  CONSTRAINT chk_gst_cess_pct   CHECK (cess_pct IS NULL OR (cess_pct >= 0 AND cess_pct <= 1000)),
  CONSTRAINT chk_gst_rate_hsn   CHECK (hsn_prefix ~ '^[0-9]{0,8}$'),
  CONSTRAINT chk_gst_rate_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gst_rate_master_identity
  ON gl.finance_gst_rate_master (rate_pct, COALESCE(cess_pct, -1), hsn_prefix, effective_from);
CREATE INDEX IF NOT EXISTS ix_gst_rate_master_lookup
  ON gl.finance_gst_rate_master (hsn_prefix, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS gl.finance_hsn_sac_master (
  code             text PRIMARY KEY,
  kind             varchar(3) NOT NULL,
  description      text NOT NULL,
  digits           smallint GENERATED ALWAYS AS (length(code)) STORED,
  default_rate_pct numeric(5,2),             -- indicative linkage only; the effective-dated rate master is authoritative
  is_active        boolean NOT NULL DEFAULT true,
  source           text NOT NULL DEFAULT 'placeholder',
  notes            text,
  verify_by_ca     boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_hsn_sac_kind   CHECK (kind IN ('HSN','SAC')),
  CONSTRAINT chk_hsn_sac_code   CHECK (code ~ '^[0-9]{2}([0-9]{2}([0-9]{2}([0-9]{2})?)?)?$'),
  CONSTRAINT chk_hsn_sac_rate   CHECK (default_rate_pct IS NULL OR (default_rate_pct >= 0 AND default_rate_pct <= 100))
);
COMMENT ON TABLE gl.finance_hsn_sac_master IS
  'Global HSN/SAC master, EXTENSIBLE (seed is a small representative set only). The mandatory HSN digit count on invoices/GSTR-1 depends on aggregate turnover (2/4/6/8) -- VERIFY-by-CA; not encoded here.';

CREATE TABLE IF NOT EXISTS gl.finance_gst_state_codes (
  code         char(2) PRIMARY KEY,
  name         text NOT NULL,
  alpha_code   varchar(2),
  kind         varchar(16) NOT NULL DEFAULT 'state',
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  verify_by_ca boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_gst_state_code CHECK (code ~ '^[0-9]{2}$'),
  CONSTRAINT chk_gst_state_kind CHECK (kind IN ('state','ut','special'))
);

-- State / UT codes (GSTIN first two digits).
INSERT INTO gl.finance_gst_state_codes (code, name, alpha_code, kind, is_active, notes) VALUES
  ('01','Jammu and Kashmir','JK','ut',true,NULL),
  ('02','Himachal Pradesh','HP','state',true,NULL),
  ('03','Punjab','PB','state',true,NULL),
  ('04','Chandigarh','CH','ut',true,NULL),
  ('05','Uttarakhand','UK','state',true,NULL),
  ('06','Haryana','HR','state',true,NULL),
  ('07','Delhi','DL','ut',true,NULL),
  ('08','Rajasthan','RJ','state',true,NULL),
  ('09','Uttar Pradesh','UP','state',true,NULL),
  ('10','Bihar','BR','state',true,NULL),
  ('11','Sikkim','SK','state',true,NULL),
  ('12','Arunachal Pradesh','AR','state',true,NULL),
  ('13','Nagaland','NL','state',true,NULL),
  ('14','Manipur','MN','state',true,NULL),
  ('15','Mizoram','MZ','state',true,NULL),
  ('16','Tripura','TR','state',true,NULL),
  ('17','Meghalaya','ML','state',true,NULL),
  ('18','Assam','AS','state',true,NULL),
  ('19','West Bengal','WB','state',true,NULL),
  ('20','Jharkhand','JH','state',true,NULL),
  ('21','Odisha','OD','state',true,NULL),
  ('22','Chhattisgarh','CG','state',true,NULL),
  ('23','Madhya Pradesh','MP','state',true,NULL),
  ('24','Gujarat','GJ','state',true,NULL),
  ('25','Daman and Diu (legacy)','DD','ut',false,'Merged into 26 on 2020-01-26; retained so historical GSTINs resolve'),
  ('26','Dadra and Nagar Haveli and Daman and Diu','DN','ut',true,NULL),
  ('27','Maharashtra','MH','state',true,NULL),
  ('28','Andhra Pradesh (before bifurcation, legacy)','AP','state',false,'Pre-2014 code; retained so historical GSTINs resolve; current Andhra Pradesh is 37'),
  ('29','Karnataka','KA','state',true,NULL),
  ('30','Goa','GA','state',true,NULL),
  ('31','Lakshadweep','LD','ut',true,NULL),
  ('32','Kerala','KL','state',true,NULL),
  ('33','Tamil Nadu','TN','state',true,NULL),
  ('34','Puducherry','PY','ut',true,NULL),
  ('35','Andaman and Nicobar Islands','AN','ut',true,NULL),
  ('36','Telangana','TS','state',true,NULL),
  ('37','Andhra Pradesh','AD','state',true,NULL),
  ('38','Ladakh','LA','ut',true,NULL),
  ('97','Other Territory','OT','special',true,'Offshore / other territory, treated as inter-state'),
  ('99','Centre Jurisdiction','CJ','special',true,'Centre-administered; used for centre jurisdiction registrations')
ON CONFLICT (code) DO NOTHING;

-- GST rate slabs. PLACEHOLDER defaults, all verify_by_ca = true.
INSERT INTO gl.finance_gst_rate_master (rate_pct, cess_pct, hsn_prefix, effective_from, effective_to, source, notes) VALUES
  (0,    NULL, '', DATE '2017-07-01', NULL,              'placeholder', 'Nil / exempt slab. VERIFY-by-CA'),
  (0.25, NULL, '', DATE '2017-07-01', NULL,              'placeholder', 'Rough precious stones slab. VERIFY-by-CA'),
  (3,    NULL, '', DATE '2017-07-01', NULL,              'placeholder', 'Gold / silver slab. VERIFY-by-CA'),
  (5,    NULL, '', DATE '2017-07-01', NULL,              'placeholder', 'Standard slab. VERIFY-by-CA'),
  (12,   NULL, '', DATE '2017-07-01', DATE '2025-09-21', 'placeholder', 'Closed by 2025-26 rationalisation (assumed 2025-09-21). VERIFY-by-CA'),
  (18,   NULL, '', DATE '2017-07-01', NULL,              'placeholder', 'Standard slab. VERIFY-by-CA'),
  (28,   NULL, '', DATE '2017-07-01', DATE '2025-09-21', 'placeholder', 'Closed by 2025-26 rationalisation (assumed 2025-09-21). VERIFY-by-CA'),
  (40,   NULL, '', DATE '2025-09-22', NULL,              'placeholder', 'Demerit/sin-goods slab introduced by 2025-26 rationalisation (assumed). VERIFY-by-CA')
ON CONFLICT DO NOTHING;

-- HSN/SAC: small representative, EXTENSIBLE set. default_rate_pct is indicative and unverified.
INSERT INTO gl.finance_hsn_sac_master (code, kind, description, default_rate_pct, notes) VALUES
  ('1001','HSN','Wheat and meslin',                       0,  'VERIFY-by-CA'),
  ('1006','HSN','Rice',                                   0,  'VERIFY-by-CA'),
  ('0402','HSN','Milk and cream, concentrated/sweetened', 5,  'VERIFY-by-CA'),
  ('2106','HSN','Food preparations not elsewhere specified',18,'VERIFY-by-CA'),
  ('3004','HSN','Medicaments (mixed/unmixed, dosage form)',5, 'VERIFY-by-CA'),
  ('4820','HSN','Registers, account books, note books, diaries',18,'VERIFY-by-CA'),
  ('6109','HSN','T-shirts, singlets and other vests, knitted',5,'VERIFY-by-CA'),
  ('7308','HSN','Structures of iron or steel',            18, 'VERIFY-by-CA'),
  ('8471','HSN','Automatic data-processing machines',     18, 'VERIFY-by-CA'),
  ('8517','HSN','Telephone sets, smartphones, network apparatus',18,'VERIFY-by-CA'),
  ('8703','HSN','Motor cars and other motor vehicles for persons',NULL,'Rate and cess vary by type; VERIFY-by-CA'),
  ('9403','HSN','Other furniture and parts',              18, 'VERIFY-by-CA'),
  ('9954','SAC','Construction services',                  18, 'VERIFY-by-CA'),
  ('9961','SAC','Services in wholesale trade',            18, 'VERIFY-by-CA'),
  ('9963','SAC','Accommodation, food and beverage services',NULL,'Rate depends on tariff; VERIFY-by-CA'),
  ('9965','SAC','Goods transport services',               NULL,'Rate depends on RCM/FCM; VERIFY-by-CA'),
  ('9971','SAC','Financial and related services',         18, 'VERIFY-by-CA'),
  ('9983','SAC','Other professional, technical and business services',18,'VERIFY-by-CA'),
  ('9987','SAC','Maintenance, repair and installation services',18,'VERIFY-by-CA'),
  ('9988','SAC','Manufacturing services on physical inputs owned by others',NULL,'Rate varies; VERIFY-by-CA'),
  ('9997','SAC','Other services',                         18, 'VERIFY-by-CA')
ON CONFLICT (code) DO NOTHING;
