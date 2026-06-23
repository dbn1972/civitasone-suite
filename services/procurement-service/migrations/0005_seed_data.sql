-- procurement-service: seed data for dev / staging
-- Uses fixed UUIDs so seeds are idempotent (ON CONFLICT (id) DO NOTHING).
-- Tenant: 00000000-0000-0000-0000-000000000001
-- Actor:  00000000-0000-0000-0000-000000000099

BEGIN;

-- ── Vendors ───────────────────────────────────────────────────────────────

INSERT INTO vendor.procurement_vendors
  (id, tenant_id, name, gstin, pan, email, phone, vendor_type, mse, msme,
   bank_account, ifsc, kyc_status, kyc_verified_at, created_by, updated_by)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Bharat Electronics Limited',
   '07AACBD0987G1Z5',
   'AACBD0987G',
   'bel@bharat-electronics.in',
   '+91-80-25019000',
   'empanelled', false, false,
   '123456789012',
   'SBIN0001234',
   'verified',
   now() - interval '30 days',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('eeeeeeee-0002-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Tata Consultancy Services',
   '27AAACT8923B1ZH',
   'AAACT8923B',
   'tcs-gov@tcs.com',
   '+91-22-67789999',
   'empanelled', false, false,
   '987654321098',
   'HDFC0001001',
   'verified',
   now() - interval '60 days',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('eeeeeeee-0003-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Infosys Limited',
   '29AABCI2247H1ZM',
   'AABCI2247H',
   'infosys-govt@infosys.com',
   '+91-80-28520261',
   'empanelled', false, false,
   '112233445566',
   'ICIC0001001',
   'verified',
   now() - interval '45 days',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('eeeeeeee-0004-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Wipro Infrastructure Engineering',
   '29AAACW8756G1ZX',
   'AAACW8756G',
   'wipro-infra@wipro.com',
   '+91-80-28440011',
   'registered', true, true,
   '556677889900',
   'PUNB0001234',
   'pending',
   NULL,
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('eeeeeeee-0005-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'HCL Technologies Limited',
   '09AAACH8123C1ZD',
   'AAACH8123C',
   'hcl-gov@hcl.com',
   '+91-120-4520000',
   'empanelled', false, false,
   '334455667788',
   'AXIS0001001',
   'verified',
   now() - interval '15 days',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

-- ── Indents ───────────────────────────────────────────────────────────────

INSERT INTO indent.procurement_indents
  (id, tenant_id, indent_no, department, purpose,
   total_minor, currency, status, indent_date, required_by,
   created_by, updated_by)
VALUES
  ('dddddddd-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'IND-2024-0001',
   'Information Technology',
   'Server hardware for data centre expansion',
   250000000, 'INR', 'approved',
   '2024-01-15', '2024-03-31',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('dddddddd-0002-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'IND-2024-0002',
   'General Administration',
   'Office furniture and ergonomic chairs',
   45000000, 'INR', 'pending',
   '2024-02-01', '2024-04-15',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('dddddddd-0003-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'IND-2024-0003',
   'Public Works',
   'Civil maintenance materials Q2',
   120000000, 'INR', 'draft',
   '2024-03-01', '2024-05-30',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('dddddddd-0004-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'IND-2024-0004',
   'Finance',
   'Accounting software renewal and training',
   8500000, 'INR', 'approved',
   '2024-01-20', '2024-02-28',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

-- Indent line items

INSERT INTO indent.procurement_indent_items
  (id, indent_id, tenant_id, item_code, description, quantity, unit, unit_price_minor, currency,
   created_by, updated_by)
VALUES
  ('dddddddd-a001-0000-0000-000000000001',
   'dddddddd-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'SRV-RACK-001', 'Dell PowerEdge R740 Server', 5, 'nos', 45000000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('dddddddd-a002-0000-0000-000000000001',
   'dddddddd-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'NET-SW-001', 'Cisco Catalyst 9300 Switch', 2, 'nos', 12500000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('dddddddd-a003-0000-0000-000000000001',
   'dddddddd-0002-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'FURN-CHAIR-001', 'Ergonomic Office Chair', 50, 'nos', 750000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('dddddddd-a004-0000-0000-000000000001',
   'dddddddd-0003-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'CMENT-001', 'Portland Cement 53-grade bags', 1000, 'bag', 90000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('dddddddd-a005-0000-0000-000000000001',
   'dddddddd-0004-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'SW-ACCT-001', 'TallyPrime Enterprise License', 10, 'lic', 750000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

-- ── Purchase Orders ───────────────────────────────────────────────────────

INSERT INTO po.procurement_pos
  (id, tenant_id, po_no, vendor_id, indent_ref, total_minor, currency,
   status, delivery_date, created_by, updated_by)
VALUES
  ('cccccccc-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'PO-2024-0001',
   'eeeeeeee-0001-0000-0000-000000000001',
   'procurement_indent:dddddddd-0001-0000-0000-000000000001',
   250000000, 'INR', 'approved',
   '2024-04-30',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('cccccccc-0002-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'PO-2024-0002',
   'eeeeeeee-0002-0000-0000-000000000001',
   'procurement_indent:dddddddd-0002-0000-0000-000000000001',
   45000000, 'INR', 'dispatched',
   '2024-05-15',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('cccccccc-0003-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'PO-2024-0003',
   'eeeeeeee-0003-0000-0000-000000000001',
   'procurement_indent:dddddddd-0004-0000-0000-000000000001',
   8500000, 'INR', 'draft',
   '2024-03-31',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

INSERT INTO po.procurement_po_items
  (id, po_id, tenant_id, item_code, description, quantity, unit, unit_price_minor, currency,
   created_by, updated_by)
VALUES
  ('cccccccc-b001-0000-0000-000000000001',
   'cccccccc-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'SRV-RACK-001', 'Dell PowerEdge R740 Server', 5, 'nos', 45000000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('cccccccc-b002-0000-0000-000000000001',
   'cccccccc-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'NET-SW-001', 'Cisco Catalyst 9300 Switch', 2, 'nos', 12500000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('cccccccc-b003-0000-0000-000000000001',
   'cccccccc-0002-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'FURN-CHAIR-001', 'Ergonomic Office Chair', 50, 'nos', 750000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('cccccccc-b004-0000-0000-000000000001',
   'cccccccc-0003-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'SW-ACCT-001', 'TallyPrime Enterprise License', 10, 'lic', 750000, 'INR',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

-- ── Goods Receipt Notes ───────────────────────────────────────────────────

INSERT INTO grn.procurement_grns
  (id, tenant_id, grn_no, po_ref, vendor_id, received_date,
   three_way_match, status, created_by, updated_by)
VALUES
  ('11111111-0002-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000001',
   'GRN-2024-0001',
   'procurement_po:cccccccc-0001-0000-0000-000000000001',
   'eeeeeeee-0001-0000-0000-000000000001',
   '2024-04-25',
   true, 'accepted',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

INSERT INTO grn.procurement_grn_items
  (id, grn_id, tenant_id, po_item_ref, item_code,
   ordered_qty, received_qty, accepted_qty, unit,
   created_by, updated_by)
VALUES
  ('11111111-c001-0000-0000-000000000005',
   '11111111-0002-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000001',
   'procurement_po_item:cccccccc-b001-0000-0000-000000000001',
   'SRV-RACK-001', 5, 5, 5, 'nos',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('11111111-c002-0000-0000-000000000005',
   '11111111-0002-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000001',
   'procurement_po_item:cccccccc-b002-0000-0000-000000000001',
   'NET-SW-001', 2, 2, 2, 'nos',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

-- ── RFQs ──────────────────────────────────────────────────────────────────

INSERT INTO rfq.procurement_rfqs
  (id, tenant_id, rfq_no, title, description,
   indent_ref, vendors_invited, responses_received, closing_date, status,
   created_by, updated_by)
VALUES
  ('bbbbbbbb-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'RFQ-2024-0001',
   'Server Hardware Supply — Data Centre Expansion Phase I',
   'Request for quotations from empanelled IT hardware vendors for server procurement.',
   'procurement_indent:dddddddd-0001-0000-0000-000000000001',
   5, 3, '2024-02-15', 'issued',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('bbbbbbbb-0002-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'RFQ-2024-0002',
   'Office Furniture Annual Supply Contract',
   'Quotations required for ergonomic furniture as per GFR standards.',
   'procurement_indent:dddddddd-0002-0000-0000-000000000001',
   3, 2, '2024-03-10', 'awarded',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

INSERT INTO rfq.procurement_rfq_items
  (id, rfq_id, tenant_id, item_name, quantity, unit, created_by, updated_by)
VALUES
  ('bbbbbbbb-d001-0000-0000-000000000001',
   'bbbbbbbb-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Dell PowerEdge R740 Server', 5, 'nos',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('bbbbbbbb-d002-0000-0000-000000000001',
   'bbbbbbbb-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Cisco Catalyst 9300 Switch', 2, 'nos',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

-- ── Tenders ───────────────────────────────────────────────────────────────

INSERT INTO tender.procurement_tenders
  (id, tenant_id, tender_no, title, scope, eligibility, type,
   estimated_minor, currency, publish_date, bid_closing_date, bids_received, status,
   created_by, updated_by)
VALUES
  ('aaaaaaaa-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'TEN-2024-0001',
   'Construction of Administrative Block — Phase II',
   'Structural work, MEP, and internal finishes for 3-storey administrative block.',
   'Registered civil contractors with min 5 years experience. Annual turnover > Rs 10 Cr.',
   'open',
   150000000, 'INR',
   '2024-01-01', '2024-02-28', 4, 'evaluation',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099'),

  ('aaaaaaaa-0002-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'TEN-2024-0002',
   'IT Infrastructure Managed Services — 3-Year Contract',
   'Managed IT services including helpdesk, network management, and security operations.',
   'Empanelled IT service providers. ISO 27001 certified.',
   'limited',
   45000000, 'INR',
   '2024-02-15', '2024-03-31', 2, 'published',
   '00000000-0000-0000-0000-000000000099',
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

COMMIT;
