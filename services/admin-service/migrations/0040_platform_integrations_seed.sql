-- Migration: 0040_platform_integrations_seed.sql
-- Purpose: idempotent seed of the platform integration catalogue (migration 0039).
--   INSERT ... ON CONFLICT (key) DO NOTHING: re-running never overwrites a
--   super-admin's later edits (status, availability, endpoints).
--
-- NO real provider endpoint is invented: endpoints.sandbox / endpoints.production
-- are NULL until the platform team records the provider-issued URLs during UAT
-- onboarding. In sandbox the adapters are mocks; in production they are stubs
-- that throw NotImplemented (see @civitasone/connector-framework/ports).
--
-- Field schema (config_schema.fields[]):
--   key, label, labelHi, type (text|number|url|select|boolean|multiline|keyRef),
--   required, secret, environments (["sandbox","production"] subset),
--   options[{value,label}], showWhen{field,equals}, default, pattern,
--   minLength, maxLength, min, max, help, helpHi.
-- `keyRef` (bank_api): a REFERENCE to the bank-file signing key owned by the
--   payroll bank-file signing feature. No key material is ever stored here.
--
-- Rollback: DELETE FROM platform_integrations.providers WHERE key IN (<seeded keys>);
-- Affected services: admin-service

SET lock_timeout = '5s';

BEGIN;

-- The catalogue write policy (0039) needs this transaction-local GUC.
SELECT set_config('app.platform_catalogue_write', 'true', true);

DO $seed$
DECLARE
  f_scn jsonb := '{"key":"sandboxScenario","label":"Sandbox test scenario","labelHi":"सैंडबॉक्स परीक्षण परिदृश्य","type":"select","required":false,"secret":false,"environments":["sandbox"],"default":"success","options":[{"value":"success","label":"Succeeds"},{"value":"auth_failed","label":"Credentials rejected"},{"value":"timeout","label":"Times out"},{"value":"provider_rejected","label":"Provider error"}],"help":"Sandbox only. Lets a tester exercise the failure paths of the mock adapter.","helpHi":"केवल सैंडबॉक्स। परीक्षक को मॉक एडेप्टर के विफलता मार्ग जाँचने देता है।"}';

  esign_fields jsonb;
  dsc_bridge_fields jsonb;
  dsc_hsm_fields jsonb;
  bank_fields jsonb;
  pfms_fields jsonb;

  esign_caps jsonb := '["esign.initiate","esign.verify"]';
  dsc_caps jsonb := '["dsc.sign"]';
  bank_caps jsonb := '["bank.submit_payment_file","bank.fetch_status"]';
  pfms_caps jsonb := '["pfms.initiate_disbursement","pfms.check_status"]';
BEGIN
  esign_fields := jsonb_build_array(
    '{"key":"aspId","label":"ASP / agency ID","labelHi":"ASP / एजेंसी आईडी","type":"text","required":true,"secret":false,"sensitive":true,"pattern":"^[A-Za-z0-9_-]{3,64}$","maxLength":64,"help":"Identifier issued to your organisation by the eSign service provider.","helpHi":"ई-साइन सेवा प्रदाता द्वारा आपके संगठन को जारी पहचानकर्ता।"}'::jsonb,
    '{"key":"authMode","label":"Aadhaar authentication mode","labelHi":"आधार प्रमाणीकरण मोड","type":"select","required":true,"secret":false,"default":"otp","options":[{"value":"otp","label":"OTP"},{"value":"biometric","label":"Biometric"}]}'::jsonb,
    '{"key":"callbackUrl","label":"Signer return URL","labelHi":"हस्ताक्षरकर्ता वापसी URL","type":"url","required":false,"secret":false,"sensitive":true,"maxLength":512,"help":"Where the signer is sent back after signing.","helpHi":"हस्ताक्षर के बाद हस्ताक्षरकर्ता को यहाँ वापस भेजा जाता है।"}'::jsonb,
    '{"key":"apiKey","label":"API key","labelHi":"API कुंजी","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":256}'::jsonb,
    '{"key":"clientSecret","label":"Client secret","labelHi":"क्लाइंट सीक्रेट","type":"text","required":false,"secret":true,"sensitive":true,"maxLength":256}'::jsonb,
    f_scn);

  dsc_bridge_fields := jsonb_build_array(
    '{"key":"bridgeHost","label":"Signer bridge host","labelHi":"साइनर ब्रिज होस्ट","type":"text","required":true,"secret":false,"sensitive":true,"default":"127.0.0.1","maxLength":253,"help":"Host of the local signer bridge that talks to the USB token.","helpHi":"USB टोकन से संवाद करने वाले स्थानीय साइनर ब्रिज का होस्ट।"}'::jsonb,
    '{"key":"bridgePort","label":"Signer bridge port","labelHi":"साइनर ब्रिज पोर्ट","type":"number","required":true,"secret":false,"sensitive":true,"min":1024,"max":65535}'::jsonb,
    '{"key":"certificateThumbprint","label":"Certificate thumbprint","labelHi":"प्रमाणपत्र थंबप्रिंट","type":"text","required":false,"secret":false,"sensitive":true,"pattern":"^[0-9A-Fa-f]{40,64}$","maxLength":64,"help":"Optional: pin signing to one certificate on the token.","helpHi":"वैकल्पिक: हस्ताक्षर को टोकन के एक प्रमाणपत्र तक सीमित करें।"}'::jsonb,
    '{"key":"bridgeAccessToken","label":"Bridge access token","labelHi":"ब्रिज एक्सेस टोकन","type":"text","required":false,"secret":true,"sensitive":true,"maxLength":256}'::jsonb,
    f_scn);

  dsc_hsm_fields := jsonb_build_array(
    '{"key":"clientId","label":"Client ID","labelHi":"क्लाइंट आईडी","type":"text","required":true,"secret":false,"sensitive":true,"maxLength":128}'::jsonb,
    '{"key":"clientSecret","label":"Client secret","labelHi":"क्लाइंट सीक्रेट","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":256}'::jsonb,
    '{"key":"keyLabel","label":"Signing key label","labelHi":"हस्ताक्षर कुंजी लेबल","type":"text","required":true,"secret":false,"sensitive":true,"pattern":"^[A-Za-z0-9._:/-]{1,128}$","maxLength":128,"help":"Label of the key inside the HSM. A reference only, never key material.","helpHi":"HSM के भीतर कुंजी का लेबल। केवल संदर्भ, कुंजी सामग्री नहीं।"}'::jsonb,
    '{"key":"partition","label":"HSM partition","labelHi":"HSM पार्टीशन","type":"text","required":false,"secret":false,"sensitive":true,"maxLength":128}'::jsonb,
    f_scn);

  bank_fields := jsonb_build_array(
    '{"key":"channel","label":"Channel","labelHi":"चैनल","type":"select","required":true,"secret":false,"sensitive":true,"default":"api","options":[{"value":"api","label":"Corporate banking API"},{"value":"sftp_h2h","label":"Host-to-host (SFTP)"}]}'::jsonb,
    '{"key":"corporateId","label":"Corporate ID","labelHi":"कॉर्पोरेट आईडी","type":"text","required":true,"secret":false,"sensitive":true,"maxLength":64}'::jsonb,
    '{"key":"userId","label":"User ID","labelHi":"उपयोगकर्ता आईडी","type":"text","required":true,"secret":false,"sensitive":true,"maxLength":64}'::jsonb,
    '{"key":"debitAccountNumber","label":"Debit account number","labelHi":"डेबिट खाता संख्या","type":"text","required":true,"secret":true,"sensitive":true,"pattern":"^[0-9]{9,18}$","maxLength":18,"help":"Stored encrypted and shown masked.","helpHi":"एन्क्रिप्टेड संग्रहीत और मास्क किया हुआ दिखता है।"}'::jsonb,
    '{"key":"fileFormat","label":"Payment file format","labelHi":"भुगतान फ़ाइल प्रारूप","type":"select","required":true,"secret":false,"default":"csv","options":[{"value":"csv","label":"CSV"},{"value":"iso20022","label":"ISO 20022 XML"},{"value":"fixed_width","label":"Fixed width"}]}'::jsonb,
    '{"key":"apiKey","label":"API key","labelHi":"API कुंजी","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":256,"showWhen":{"field":"channel","equals":"api"}}'::jsonb,
    '{"key":"apiSecret","label":"API secret","labelHi":"API सीक्रेट","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":256,"showWhen":{"field":"channel","equals":"api"}}'::jsonb,
    '{"key":"sftpHost","label":"SFTP host","labelHi":"SFTP होस्ट","type":"text","required":true,"secret":false,"sensitive":true,"maxLength":253,"showWhen":{"field":"channel","equals":"sftp_h2h"}}'::jsonb,
    '{"key":"sftpPort","label":"SFTP port","labelHi":"SFTP पोर्ट","type":"number","required":false,"secret":false,"sensitive":true,"default":22,"min":1,"max":65535,"showWhen":{"field":"channel","equals":"sftp_h2h"}}'::jsonb,
    '{"key":"sftpUsername","label":"SFTP username","labelHi":"SFTP उपयोगकर्ता नाम","type":"text","required":true,"secret":false,"sensitive":true,"maxLength":128,"showWhen":{"field":"channel","equals":"sftp_h2h"}}'::jsonb,
    '{"key":"sftpPrivateKey","label":"SFTP private key","labelHi":"SFTP निजी कुंजी","type":"multiline","required":true,"secret":true,"sensitive":true,"maxLength":8192,"showWhen":{"field":"channel","equals":"sftp_h2h"}}'::jsonb,
    '{"key":"sftpRemotePath","label":"SFTP remote directory","labelHi":"SFTP रिमोट डायरेक्टरी","type":"text","required":false,"secret":false,"sensitive":true,"maxLength":512,"showWhen":{"field":"channel","equals":"sftp_h2h"}}'::jsonb,
    '{"key":"keyRef","label":"Bank-file signing key reference","labelHi":"बैंक-फ़ाइल हस्ताक्षर कुंजी संदर्भ","type":"keyRef","required":false,"secret":false,"sensitive":true,"pattern":"^[A-Za-z0-9._:/-]{1,128}$","maxLength":128,"help":"Reference to the signing key managed by bank-file signing in payroll. No key material is stored here.","helpHi":"पेरोल में बैंक-फ़ाइल हस्ताक्षर द्वारा प्रबंधित हस्ताक्षर कुंजी का संदर्भ। यहाँ कोई कुंजी सामग्री संग्रहीत नहीं होती।"}'::jsonb,
    f_scn);

  pfms_fields := jsonb_build_array(
    '{"key":"agencyCode","label":"Agency code","labelHi":"एजेंसी कोड","type":"text","required":true,"secret":false,"sensitive":true,"maxLength":64}'::jsonb,
    '{"key":"schemeCode","label":"Default scheme code","labelHi":"डिफ़ॉल्ट योजना कोड","type":"text","required":true,"secret":false,"sensitive":true,"maxLength":64}'::jsonb,
    '{"key":"authToken","label":"Auth token","labelHi":"प्रमाणीकरण टोकन","type":"text","required":true,"secret":true,"sensitive":true,"maxLength":512}'::jsonb,
    f_scn);

  INSERT INTO platform_integrations.providers
    (key, category, name, vendor, description, capabilities, config_schema, status, sort_order)
  VALUES
    ('esign_nsdl_egov', 'esign', 'NSDL e-Gov eSign', 'NSDL e-Governance Infrastructure Ltd',
       'Aadhaar eSign through the NSDL e-Gov ESP.', esign_caps, jsonb_build_object('fields', esign_fields), 'available', 10),
    ('esign_emudhra', 'esign', 'eMudhra eSign', 'eMudhra Ltd',
       'Aadhaar eSign through the eMudhra ESP.', esign_caps, jsonb_build_object('fields', esign_fields), 'available', 20),
    ('esign_cdac', 'esign', 'C-DAC eSign', 'Centre for Development of Advanced Computing',
       'Aadhaar eSign through the C-DAC ESP.', esign_caps, jsonb_build_object('fields', esign_fields), 'beta', 30),
    ('dsc_usb_token_bridge', 'dsc', 'USB token / local signer bridge', '',
       'Sign with a Class 3 DSC on a USB token through a local signer bridge running on the signer''s workstation.',
       dsc_caps, jsonb_build_object('fields', dsc_bridge_fields), 'available', 10),
    ('dsc_remote_hsm', 'dsc', 'Remote / cloud HSM signing', '',
       'Sign with a certificate held in a remote or cloud HSM.', dsc_caps, jsonb_build_object('fields', dsc_hsm_fields), 'beta', 20),
    ('bank_sbi', 'bank_api', 'State Bank of India', 'State Bank of India',
       'Corporate banking API or host-to-host SFTP for payment files.', bank_caps, jsonb_build_object('fields', bank_fields), 'available', 10),
    ('bank_hdfc', 'bank_api', 'HDFC Bank', 'HDFC Bank Ltd',
       'Corporate banking API or host-to-host SFTP for payment files.', bank_caps, jsonb_build_object('fields', bank_fields), 'available', 20),
    ('bank_icici', 'bank_api', 'ICICI Bank', 'ICICI Bank Ltd',
       'Corporate banking API or host-to-host SFTP for payment files.', bank_caps, jsonb_build_object('fields', bank_fields), 'beta', 30),
    ('bank_axis', 'bank_api', 'Axis Bank', 'Axis Bank Ltd',
       'Corporate banking API or host-to-host SFTP for payment files.', bank_caps, jsonb_build_object('fields', bank_fields), 'beta', 40),
    ('bank_pnb', 'bank_api', 'Punjab National Bank', 'Punjab National Bank',
       'Corporate banking API or host-to-host SFTP for payment files.', bank_caps, jsonb_build_object('fields', bank_fields), 'beta', 50),
    ('bank_generic', 'bank_api', 'Generic bank profile', '',
       'A generic corporate banking API / host-to-host profile for banks without a dedicated entry.',
       bank_caps, jsonb_build_object('fields', bank_fields), 'available', 90),
    ('pfms_epayment', 'pfms', 'PFMS payment bridge', 'Public Financial Management System',
       'Disbursement initiation and status through PFMS.', pfms_caps, jsonb_build_object('fields', pfms_fields), 'available', 10)
  ON CONFLICT (key) DO NOTHING;
END
$seed$;

COMMIT;
