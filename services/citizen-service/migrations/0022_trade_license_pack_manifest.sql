-- citizen-service migration 0022 — Trade License pack manifest (FN-09 pilot / FN-13 runtime).
-- Idempotent: updates municipal-in-v1 TL pack with B1–B8 block wiring + embedded formDesign.

UPDATE packs.service_packs
SET manifest = '{
  "businessService": "TL",
  "pilot": true,
  "blocks": {
    "description": "Apply for a municipal trade license. Fee varies by category. Inspection and approval required before issuance.",
    "slaDays": 15,
    "formId": "cccccccc-0001-4000-8000-000000000001",
    "forms": [{
      "layoutId": "cccccccc-0001-4000-8000-000000000001",
      "formDesign": {
        "sections": [
          {"id": "tl-sec-business", "label": "Business details", "fieldIds": ["tl-f1","tl-f2","tl-f3","tl-f4","tl-f5","tl-f6","tl-f7"]},
          {"id": "tl-sec-owner", "label": "Owner details", "fieldIds": ["tl-f8","tl-f9","tl-f10","tl-f11","tl-f12"]},
          {"id": "tl-sec-docs", "label": "Documents", "fieldIds": ["tl-f13","tl-f14","tl-f15"]}
        ],
        "fields": {
          "tl-f1": {"id":"tl-f1","apiName":"tradeName","type":"text","label":"Trade / business name","required":true,"sectionId":"tl-sec-business"},
          "tl-f2": {"id":"tl-f2","apiName":"propertyId","type":"text","label":"Property ID","helpText":"Municipal property reference, if known","required":false,"sectionId":"tl-sec-business"},
          "tl-f3": {"id":"tl-f3","apiName":"applicationDate","type":"date","label":"Application date","required":true,"sectionId":"tl-sec-business"},
          "tl-f4": {"id":"tl-f4","apiName":"licenseType","type":"picklist_single","label":"License type","required":true,"sectionId":"tl-sec-business","choices":["TEMPORARY","PERMANENT"]},
          "tl-f5": {"id":"tl-f5","apiName":"tradeCategory","type":"picklist_single","label":"Trade category","required":true,"sectionId":"tl-sec-business","choices":["Retail","Manufacturing","Services","Food & beverage"]},
          "tl-f6": {"id":"tl-f6","apiName":"tradeSubcategory","type":"text","label":"Trade sub-category","required":true,"sectionId":"tl-sec-business"},
          "tl-f7": {"id":"tl-f7","apiName":"unitOfMeasure","type":"text","label":"Unit of measure","required":false,"sectionId":"tl-sec-business"},
          "tl-f8": {"id":"tl-f8","apiName":"ownerName","type":"profile_name","label":"Owner / applicant name","required":true,"sectionId":"tl-sec-owner"},
          "tl-f9": {"id":"tl-f9","apiName":"ownerMobile","type":"profile_mobile","label":"Mobile number","required":true,"sectionId":"tl-sec-owner"},
          "tl-f10": {"id":"tl-f10","apiName":"ownerEmail","type":"profile_email","label":"Email","required":false,"sectionId":"tl-sec-owner"},
          "tl-f11": {"id":"tl-f11","apiName":"businessAddress","type":"address","label":"Business address","required":true,"sectionId":"tl-sec-owner"},
          "tl-f12": {"id":"tl-f12","apiName":"ward","type":"ward","label":"Ward","required":true,"sectionId":"tl-sec-owner"},
          "tl-f13": {"id":"tl-f13","apiName":"idProof","type":"file","label":"Identity proof","required":true,"sectionId":"tl-sec-docs","fileTypes":["pdf","jpg"],"fileMaxMb":5},
          "tl-f14": {"id":"tl-f14","apiName":"addressProof","type":"file","label":"Address proof","required":true,"sectionId":"tl-sec-docs","fileTypes":["pdf","jpg"],"fileMaxMb":5},
          "tl-f15": {"id":"tl-f15","apiName":"tradePhoto","type":"file","label":"Shop / trade photo","required":true,"sectionId":"tl-sec-docs","fileTypes":["jpg","png"],"fileMaxMb":5}
        }
      }
    }],
    "eligibilityRuleSetId": "cccccccc-0002-4000-8000-000000000001",
    "workflowDefinitionId": "cccccccc-0003-4000-8000-000000000001",
    "feeScheduleId": "cccccccc-0004-4000-8000-000000000001",
    "feeModel": "flat",
    "hoaCode": "4201",
    "issuanceType": "certificate",
    "outputs": [{"type":"certificate","templateKey":"tl-certificate","numberingFormat":"TL/{ward}/{year}/{seq:5}"}],
    "requiredDocuments": [
      {"docType":"id_proof","label":"Identity proof","mandatory":true},
      {"docType":"address_proof","label":"Address proof","mandatory":true},
      {"docType":"trade_photo","label":"Shop / trade photo","mandatory":true}
    ],
    "feeFromMinor": 50000,
    "feeCurrency": "INR",
    "channels": ["portal","counter","mobile"]
  }
}'::jsonb,
    updated_at = now()
WHERE pack_key = 'pack:trade-license'
  AND tenant_id = '00000000-0000-0000-0000-000000000001';
