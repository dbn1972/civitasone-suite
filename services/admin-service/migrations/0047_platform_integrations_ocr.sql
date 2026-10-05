-- Migration: 0047_platform_integrations_ocr.sql
-- Purpose: add the `ocr` category to the platform integration catalogue (0039) and seed its providers, for the
--   bulk-scan OCR provider chain (document-service). Tesseract is on-device and ALWAYS available (no credentials);
--   the cloud engines are config-driven: the tenant fills the schema-driven form, secret fields are sealed at rest
--   by the existing secret-handling path (never returned), and every cloud provider is `beta` = sandbox-only until
--   its production adapter is built. NO real endpoint is invented (endpoints stay NULL), same rule as 0040.
-- Rollback: DELETE FROM platform_integrations.providers WHERE category = 'ocr';
--           ALTER TABLE ... DROP CONSTRAINT pi_providers_category_chk, re-add it WITHOUT 'ocr'
--           (rows of category ocr must be deleted first). Destructive - requires explicit approval.
-- Affected services: admin-service (document-service reads availability through GET /internal/v1/platform-integrations/ocr/availability)
-- Idempotent. Safe to re-run: the seed is INSERT ... ON CONFLICT (key) DO NOTHING.

SET lock_timeout = '5s';

BEGIN;

SELECT set_config('app.platform_catalogue_write', 'true', true);

ALTER TABLE platform_integrations.providers DROP CONSTRAINT IF EXISTS pi_providers_category_chk;
ALTER TABLE platform_integrations.providers
  ADD CONSTRAINT pi_providers_category_chk CHECK (category IN ('esign','dsc','bank_api','pfms','ocr'));

DO $seed$
DECLARE
  f_scn jsonb := '{"key":"sandboxScenario","label":"Sandbox test scenario","labelHi":"सैंडबॉक्स परीक्षण परिदृश्य","type":"select","required":false,"secret":false,"environments":["sandbox"],"default":"success","options":[{"value":"success","label":"Succeeds"},{"value":"auth_failed","label":"Credentials rejected"},{"value":"timeout","label":"Times out"},{"value":"provider_rejected","label":"Provider error"}],"help":"Sandbox only. Lets a tester exercise the failure paths of the mock adapter.","helpHi":"केवल सैंडबॉक्स। परीक्षक को मॉक एडेप्टर के विफलता मार्ग जाँचने देता है।"}';
  caps jsonb := '["ocr.recognize"]';
  docai_fields jsonb;
  textract_fields jsonb;
  azure_fields jsonb;
  bhashini_fields jsonb;
BEGIN
  docai_fields := jsonb_build_array(
    '{"key":"projectId","label":"Google Cloud project ID","labelHi":"Google Cloud प्रोजेक्ट आईडी","type":"text","required":true,"secret":false,"sensitive":true,"pattern":"^[a-z][a-z0-9-]{4,60}[a-z0-9]$","maxLength":64}'::jsonb,
    '{"key":"location","label":"Processor location","labelHi":"प्रोसेसर स्थान","type":"select","required":true,"secret":false,"sensitive":true,"default":"us","options":[{"value":"us","label":"US"},{"value":"eu","label":"EU"},{"value":"asia-south1","label":"Mumbai (asia-south1)"}]}'::jsonb,
    '{"key":"processorId","label":"Processor ID","labelHi":"प्रोसेसर आईडी","type":"text","required":true,"secret":false,"sensitive":true,"pattern":"^[A-Za-z0-9]{8,64}$","maxLength":64}'::jsonb,
    '{"key":"serviceAccountJson","label":"Service account key (JSON)","labelHi":"सेवा खाता कुंजी (JSON)","type":"multiline","required":true,"secret":true,"sensitive":true,"maxLength":8192,"help":"Stored encrypted and never shown again.","helpHi":"एन्क्रिप्टेड संग्रहीत, दोबारा नहीं दिखाई जाती।"}'::jsonb,
    f_scn);

  textract_fields := jsonb_build_array(
    '{"key":"region","label":"AWS region","labelHi":"AWS क्षेत्र","type":"text","required":true,"secret":false,"sensitive":true,"default":"ap-south-1","pattern":"^[a-z]{2}-[a-z]+-[0-9]$","maxLength":32}'::jsonb,
    '{"key":"accessKeyId","label":"Access key ID","labelHi":"एक्सेस की आईडी","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":128}'::jsonb,
    '{"key":"secretAccessKey","label":"Secret access key","labelHi":"सीक्रेट एक्सेस की","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":256}'::jsonb,
    f_scn);

  azure_fields := jsonb_build_array(
    '{"key":"endpoint","label":"Resource endpoint","labelHi":"रिसोर्स एंडपॉइंट","type":"url","required":true,"secret":false,"sensitive":true,"maxLength":256,"help":"The https endpoint of your Azure Document Intelligence resource.","helpHi":"आपके Azure Document Intelligence रिसोर्स का https एंडपॉइंट।"}'::jsonb,
    '{"key":"modelId","label":"Model","labelHi":"मॉडल","type":"text","required":false,"secret":false,"sensitive":true,"default":"prebuilt-read","pattern":"^[A-Za-z0-9._-]{1,64}$","maxLength":64}'::jsonb,
    '{"key":"apiKey","label":"API key","labelHi":"API कुंजी","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":256}'::jsonb,
    f_scn);

  bhashini_fields := jsonb_build_array(
    '{"key":"userId","label":"Bhashini user ID","labelHi":"भाषिणी उपयोगकर्ता आईडी","type":"text","required":true,"secret":false,"sensitive":true,"maxLength":128}'::jsonb,
    '{"key":"pipelineId","label":"OCR pipeline ID","labelHi":"OCR पाइपलाइन आईडी","type":"text","required":false,"secret":false,"sensitive":true,"maxLength":128}'::jsonb,
    '{"key":"apiKey","label":"API key (ulca key)","labelHi":"API कुंजी (ulca key)","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":256}'::jsonb,
    f_scn);

  INSERT INTO platform_integrations.providers
    (key, category, name, vendor, description, capabilities, config_schema, status, sort_order)
  VALUES
    ('ocr_tesseract', 'ocr', 'Tesseract (on-device)', 'Open source',
       'Local OCR that runs inside the platform. Always available; no credentials, no data leaves the deployment.',
       caps, jsonb_build_object('fields', '[]'::jsonb), 'available', 10),
    ('ocr_google_docai', 'ocr', 'Google Document AI', 'Google LLC',
       'Cloud OCR for hard scans. Sandbox only until the production adapter is built.',
       caps, jsonb_build_object('fields', docai_fields), 'beta', 20),
    ('ocr_aws_textract', 'ocr', 'Amazon Textract', 'Amazon Web Services',
       'Cloud OCR for hard scans. Sandbox only until the production adapter is built.',
       caps, jsonb_build_object('fields', textract_fields), 'beta', 30),
    ('ocr_azure_docint', 'ocr', 'Azure Document Intelligence', 'Microsoft Corporation',
       'Cloud OCR for hard scans. Sandbox only until the production adapter is built.',
       caps, jsonb_build_object('fields', azure_fields), 'beta', 40),
    ('ocr_bhashini', 'ocr', 'Bhashini OCR', 'Digital India Bhashini Division',
       'Indic-script OCR from the national language mission. Sandbox only until the production adapter is built.',
       caps, jsonb_build_object('fields', bhashini_fields), 'beta', 50)
  ON CONFLICT (key) DO NOTHING;
END
$seed$;

COMMIT;
