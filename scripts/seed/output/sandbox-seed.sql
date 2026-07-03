-- CivitasOne Sandbox Seed Data
-- Generated: 2026-07-03T11:32:08.441Z
-- Apply per-service using psql.

BEGIN;

-- Tenant service data
INSERT INTO tenant.tenants (id, name, slug, edition, state, district, pin_code, gstin, pan, email, phone, address, logo_url, settings, is_active, created_at, updated_at) VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'District Collectorate, Bhubaneswar', 'dc-bhubaneswar', 'govt_department', 'Odisha', 'Khordha', '751001', '21AABCU9603R1ZM', 'AABCU9603R', 'collector-khordha@nic.in', '+916742391234', 'Collectorate Road, Bhubaneswar, Odisha 751001', NULL, '{"locale":"en-IN","timezone":"Asia/Kolkata","currency":"INR","financial_year_start":"04-01"}', TRUE, '2024-04-01T00:00:00Z', '2024-04-01T00:00:00Z')
ON CONFLICT DO NOTHING;


-- HRMS service data
INSERT INTO hrms.employees (id, tenant_id, employee_code, first_name, last_name, designation, department, grade, date_of_joining, email, phone, status, reporting_to) VALUES
  ('emp-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-001', 'Rajesh', 'Patel', 'District Collector', 'Administration', 'IAS', '2020-06-15', 'rajesh.patel@nic.in', '+919876543001', 'active', NULL),
  ('emp-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-002', 'Priya', 'Sharma', 'Additional Collector', 'Administration', 'IAS', '2021-03-01', 'priya.sharma@nic.in', '+919876543002', 'active', 'emp-001'),
  ('emp-003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-003', 'Suresh', 'Mohanty', 'Sub-Collector', 'Revenue', 'OAS-A', '2019-07-20', 'suresh.mohanty@nic.in', '+919876543003', 'active', 'emp-002'),
  ('emp-004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-004', 'Anita', 'Das', 'District Finance Officer', 'Finance', 'OAS-A', '2018-04-10', 'anita.das@nic.in', '+919876543004', 'active', 'emp-001'),
  ('emp-005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-005', 'Bikash', 'Nayak', 'HR Officer', 'Human Resources', 'OAS-B', '2020-01-15', 'bikash.nayak@nic.in', '+919876543005', 'active', 'emp-002'),
  ('emp-006', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-006', 'Sunita', 'Behera', 'Procurement Officer', 'Procurement', 'OAS-B', '2021-08-01', 'sunita.behera@nic.in', '+919876543006', 'active', 'emp-002'),
  ('emp-007', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-007', 'Manoj', 'Pradhan', 'Accounts Clerk', 'Finance', 'Group-C', '2017-11-05', 'manoj.pradhan@nic.in', '+919876543007', 'active', 'emp-004'),
  ('emp-008', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-008', 'Lakshmi', 'Jena', 'Senior Clerk', 'Administration', 'Group-C', '2015-03-20', 'lakshmi.jena@nic.in', '+919876543008', 'active', 'emp-003'),
  ('emp-009', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-009', 'Ramesh', 'Sahoo', 'IT Officer', 'IT', 'OAS-B', '2022-02-14', 'ramesh.sahoo@nic.in', '+919876543009', 'active', 'emp-002'),
  ('emp-010', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC-BHU-010', 'Deepak', 'Mishra', 'Legal Officer', 'Legal', 'OAS-B', '2019-09-01', 'deepak.mishra@nic.in', '+919876543010', 'active', 'emp-001')
ON CONFLICT DO NOTHING;


-- Finance service data
INSERT INTO finance.bills (id, tenant_id, bill_number, bill_type, amount_paise, head_of_account, vendor_name, description, status, submitted_by, approved_by, submitted_at, approved_at) VALUES
  ('bill-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC/BHU/2025/001', 'salary', 4500000, '2049-00-001', NULL, 'Salary bill - April 2025', 'approved', 'emp-007', 'emp-004', '2025-04-05T10:00:00Z', '2025-04-06T14:30:00Z'),
  ('bill-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC/BHU/2025/002', 'contingency', 125000, '2049-00-051', 'Odisha Stationery Depot', 'Stationery supplies Q1', 'pending', 'emp-008', NULL, '2025-04-10T09:00:00Z', NULL),
  ('bill-003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC/BHU/2025/003', 'travel', 35000, '2049-00-011', NULL, 'TA/DA for field visit - Collector', 'approved', 'emp-008', 'emp-004', '2025-04-12T11:00:00Z', '2025-04-13T10:00:00Z'),
  ('bill-004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC/BHU/2025/004', 'works', 2500000, '4059-60-051', 'XYZ Construction Ltd', 'Road repair near collectorate', 'submitted', 'emp-007', NULL, '2025-04-15T09:30:00Z', NULL),
  ('bill-005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC/BHU/2025/005', 'utility', 89000, '2049-00-051', 'TPCODL', 'Electricity bill - March 2025', 'paid', 'emp-007', 'emp-004', '2025-04-02T08:00:00Z', '2025-04-02T16:00:00Z')
ON CONFLICT DO NOTHING;


INSERT INTO finance.sanctions (id, tenant_id, sanction_number, amount_paise, head_of_account, purpose, sanctioned_by, sanctioned_at, financial_year, status) VALUES
  ('sanc-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'SANC/2025/001', 5000000000, '2049-00-001', 'Annual salary budget - DC office', 'emp-001', '2025-04-01T00:00:00Z', '2025-26', 'active'),
  ('sanc-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'SANC/2025/002', 50000000, '4059-60-051', 'Road and building maintenance', 'emp-001', '2025-04-01T00:00:00Z', '2025-26', 'active')
ON CONFLICT DO NOTHING;


INSERT INTO finance.bank_accounts (id, tenant_id, account_name, bank_name, branch, account_number, ifsc, account_type, balance_paise, is_active) VALUES
  ('ba-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC Bhubaneswar - Main Treasury', 'State Bank of India', 'Treasury Branch, Bhubaneswar', '30712345678', 'SBIN0001234', 'treasury', 250000000, TRUE),
  ('ba-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC Bhubaneswar - Contingency', 'State Bank of India', 'Treasury Branch, Bhubaneswar', '30712345679', 'SBIN0001234', 'contingency', 5000000, TRUE),
  ('ba-003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'DC Bhubaneswar - PD Account', 'Union Bank of India', 'Bhubaneswar Main', '520101012345678', 'UBIN0534021', 'pd_account', 12000000, TRUE)
ON CONFLICT DO NOTHING;


-- Procurement service data
INSERT INTO procurement.vendors (id, tenant_id, name, gstin, pan, address, contact_person, phone, email, category, status) VALUES
  ('ven-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Odisha Stationery Depot', '21AABCO1234R1ZM', 'AABCO1234R', 'Janpath, Bhubaneswar', 'Ravi Kumar', '+919876540001', 'info@odishastationery.in', 'stationery', 'approved'),
  ('ven-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'XYZ Construction Ltd', '21AABCX5678R1ZM', 'AABCX5678R', 'Saheed Nagar, Bhubaneswar', 'Sanjay Dash', '+919876540002', 'tender@xyzconstruction.in', 'civil_works', 'approved'),
  ('ven-003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'InfoTech Solutions Pvt Ltd', '21AABCI9012R1ZM', 'AABCI9012R', 'Patia, Bhubaneswar', 'Amit Sahu', '+919876540003', 'govt@infotechsolutions.in', 'it_hardware', 'approved'),
  ('ven-004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Kalinga Furniture Works', '21AABCK3456R1ZM', 'AABCK3456R', 'Mancheswar Industrial Estate', 'Prasad Mohanty', '+919876540004', 'sales@kalingafurniture.in', 'furniture', 'approved'),
  ('ven-005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'TPCODL', '21AABCT7890R1ZM', 'AABCT7890R', 'Janpath, Bhubaneswar', 'Helpdesk', '1912', 'billing@tpcodl.in', 'utility', 'approved')
ON CONFLICT DO NOTHING;


INSERT INTO procurement.indents (id, tenant_id, indent_number, description, department, requested_by, amount_paise, status, created_at) VALUES
  ('ind-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'IND/2025/001', 'Office stationery for Q2 2025', 'Administration', 'emp-008', 75000, 'approved', '2025-04-20T10:00:00Z'),
  ('ind-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'IND/2025/002', 'Laptop procurement - IT dept', 'IT', 'emp-009', 350000, 'po_raised', '2025-04-22T11:00:00Z'),
  ('ind-003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'IND/2025/003', 'Conference room chairs (20 nos)', 'Administration', 'emp-008', 180000, 'pending', '2025-05-01T09:30:00Z')
ON CONFLICT DO NOTHING;


INSERT INTO procurement.purchase_orders (id, tenant_id, po_number, vendor_id, indent_id, description, amount_paise, gst_paise, total_paise, status, issued_at) VALUES
  ('po-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'PO/2025/001', 'ven-001', 'ind-001', 'Stationery supply Q2', 72000, 12960, 84960, 'delivered', '2025-04-25T14:00:00Z'),
  ('po-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'PO/2025/002', 'ven-003', 'ind-002', 'Dell Latitude laptops x5', 325000, 58500, 383500, 'in_transit', '2025-04-28T16:00:00Z')
ON CONFLICT DO NOTHING;


-- Helpdesk service data
INSERT INTO helpdesk.tickets (id, tenant_id, ticket_number, subject, category, priority, status, raised_by, assigned_to, created_at, resolved_at) VALUES
  ('tkt-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'HD/2025/001', 'Printer not working in Room 204', 'it_support', 'medium', 'open', 'emp-008', 'emp-009', '2025-05-01T09:00:00Z', NULL),
  ('tkt-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'HD/2025/002', 'AC repair needed in DC chamber', 'maintenance', 'high', 'in_progress', 'emp-008', NULL, '2025-04-28T14:30:00Z', NULL),
  ('tkt-003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'HD/2025/003', 'Network connectivity issue - Finance wing', 'it_support', 'critical', 'resolved', 'emp-007', 'emp-009', '2025-04-25T11:00:00Z', '2025-04-25T15:30:00Z'),
  ('tkt-004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'HD/2025/004', 'Water leakage in record room', 'maintenance', 'high', 'open', 'emp-003', NULL, '2025-05-02T08:00:00Z', NULL),
  ('tkt-005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'HD/2025/005', 'Request for additional parking space', 'general', 'low', 'closed', 'emp-005', 'emp-008', '2025-04-15T10:00:00Z', '2025-04-20T12:00:00Z')
ON CONFLICT DO NOTHING;


-- Citizen service data
INSERT INTO citizen.rti_requests (id, tenant_id, reference_number, applicant_name, subject, department, status, filed_at, due_date, replied_at) VALUES
  ('rti-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'RTI/2025/001', 'Sanjay Kumar', 'Details of road construction expenditure 2024-25', 'Finance', 'replied', '2025-03-15T10:00:00Z', '2025-04-14', '2025-04-10T16:00:00Z'),
  ('rti-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'RTI/2025/002', 'Meera Panda', 'Staff strength and vacancies in collectorate', 'HR', 'pending', '2025-04-25T09:00:00Z', '2025-05-25', NULL),
  ('rti-003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'RTI/2025/003', 'Biswajit Rout', 'Land acquisition details - NH expansion', 'Revenue', 'transferred', '2025-04-28T14:00:00Z', '2025-05-28', NULL),
  ('rti-004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'RTI/2025/004', 'Pooja Mishra', 'Status of pending building permissions', 'Planning', 'pending', '2025-05-01T11:00:00Z', '2025-05-31', NULL),
  ('rti-005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'RTI/2025/005', 'Ajay Nayak', 'List of contractors blacklisted since 2020', 'Procurement', 'replied', '2025-02-10T10:00:00Z', '2025-03-12', '2025-03-05T14:00:00Z')
ON CONFLICT DO NOTHING;


INSERT INTO citizen.grievances (id, tenant_id, reference_number, complainant_name, subject, category, status, filed_at, expected_resolution) VALUES
  ('grv-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'GRV/2025/001', 'Ramchandra Swain', 'Delay in pension disbursement', 'service_delivery', 'under_investigation', '2025-04-10T09:00:00Z', '2025-05-10'),
  ('grv-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'GRV/2025/002', 'Sarita Rath', 'Unauthorized construction near residential area', 'planning', 'open', '2025-04-28T11:30:00Z', '2025-05-28'),
  ('grv-003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'GRV/2025/003', 'Tapan Mohapatra', 'Corruption allegation in ration card distribution', 'vigilance', 'resolved', '2025-03-01T10:00:00Z', '2025-04-01')
ON CONFLICT DO NOTHING;


INSERT INTO citizen.service_requests (id, tenant_id, reference_number, applicant_name, service_type, status, applied_at, completed_at) VALUES
  ('sr-001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'SR/2025/001', 'Deepa Mohanty', 'income_certificate', 'issued', '2025-04-20T10:00:00Z', '2025-04-22T14:00:00Z'),
  ('sr-002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'SR/2025/002', 'Krishna Das', 'caste_certificate', 'processing', '2025-05-01T09:00:00Z', NULL)
ON CONFLICT DO NOTHING;


COMMIT;
