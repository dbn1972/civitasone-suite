/**
 * Typical CLEAN example documents per starter type (English + Hindi), as plain text. Used to tune and regression-test
 * the default classifier rules (tests/post/classify-examples.test.ts) and renderable with renderTextPage() for OCR runs.
 * Sample identifiers are fictitious; the Aadhaar number is UIDAI's published Verhoeff-valid test number.
 */
export interface ClassifierExample { id: string; lang: "eng" | "hin"; docType: string; lines: string[] }

export const CLASSIFIER_EXAMPLES: readonly ClassifierExample[] = [
  // ---- service_book
  { id: "sb-en-1", lang: "eng", docType: "service_book", lines: [
    "SERVICE BOOK", "Name of Government Servant: Ram Prasad Sharma", "Date of Birth: 12/03/1970",
    "Date of Appointment: 01/04/1995", "Designation: Upper Division Clerk",
    "Pay fixation and increment entries verified by the Head of Office", "Nomination for family pension recorded" ] },
  { id: "sb-en-2", lang: "eng", docType: "service_book", lines: [
    "Service Book - Page 14", "Entries of increment, promotion and leave", "Date of appointment 01/07/1998",
    "Pay fixation on promotion", "Entries verified by the Drawing and Disbursing Officer" ] },
  { id: "sb-hi-1", lang: "hin", docType: "service_book", lines: [
    "सेवा पुस्तिका", "सरकारी कर्मचारी का नाम: राम प्रसाद शर्मा", "जन्म तिथि: 12/03/1970",
    "नियुक्ति की तिथि: 01/04/1995", "वेतन निर्धारण एवं वेतन वृद्धि की प्रविष्टियाँ सत्यापित" ] },
  // ---- pay_slip
  { id: "ps-en-1", lang: "eng", docType: "pay_slip", lines: [
    "PAY SLIP FOR THE MONTH OF MARCH 2024", "Employee ID EMP-20431   Name: Sunita Verma",
    "Basic Pay 45,000   DA 22,500   HRA 12,150", "Gross Earnings 79,650", "Deductions: GPF 4,500   Income Tax 3,200", "Net Pay 71,950" ] },
  { id: "ps-en-2", lang: "eng", docType: "pay_slip", lines: [
    "Salary Slip April 2024", "Earnings: Basic Pay 52,000   Gross 90,100", "Deductions: NPS 5,200", "Net Pay 82,000" ] },
  { id: "ps-hi-1", lang: "hin", docType: "pay_slip", lines: [
    "वेतन पर्ची", "माह: मार्च 2024", "मूल वेतन 45,000   महंगाई भत्ता 22,500", "कुल आय 79,650", "कटौती: भविष्य निधि 4,500", "शुद्ध वेतन 71,950" ] },
  // ---- bill_voucher
  { id: "bv-en-1", lang: "eng", docType: "bill_voucher", lines: [
    "PAYMENT VOUCHER", "Voucher No: V-2024/045   Date: 05/03/2024", "Payee: M/s Sharma Stationers",
    "Bill No 1182 dated 28/02/2024", "Amount Rs. 45,000/-", "Amount in words: Rupees Forty Five Thousand only", "Passed for payment" ] },
  { id: "bv-en-2", lang: "eng", docType: "bill_voucher", lines: [
    "INVOICE", "Bill No 3321   GSTIN 07ABCDE1234F1Z5", "Received with thanks Rs. 12,500/-", "Payee M/s Delhi Traders" ] },
  { id: "bv-hi-1", lang: "hin", docType: "bill_voucher", lines: [
    "भुगतान वाउचर", "वाउचर संख्या: V-2024/045   दिनांक: 05/03/2024", "प्राप्तकर्ता: मेसर्स शर्मा स्टेशनर्स",
    "राशि रु. 45,000/-", "शब्दों में राशि: पैंतालीस हजार रुपये मात्र" ] },
  // ---- sanction_order
  { id: "so-en-1", lang: "eng", docType: "sanction_order", lines: [
    "GOVERNMENT OF INDIA", "Ministry of Finance", "F.No. 12(3)/2024-Estt", "SANCTION ORDER",
    "Administrative approval and expenditure sanction of the President is hereby accorded for the purchase of office furniture",
    "at a cost not exceeding Rs. 4,50,000/-. The expenditure is debitable to Major Head 2052." ] },
  { id: "so-en-2", lang: "eng", docType: "sanction_order", lines: [
    "Sanction is hereby accorded for the expenditure of Rs. 75,000/- on repair of the office vehicle.",
    "The sanction is valid for the current financial year. Administrative approval has been obtained." ] },
  { id: "so-hi-1", lang: "hin", docType: "sanction_order", lines: [
    "स्वीकृति आदेश", "प्रशासनिक स्वीकृति एवं व्यय की स्वीकृति के अनुसार कार्यालय फर्नीचर के क्रय हेतु",
    "रु. 4,50,000/- की राशि स्वीकृत की जाती है।" ] },
  // ---- office_order
  { id: "oo-en-1", lang: "eng", docType: "office_order", lines: [
    "OFFICE ORDER", "No. 45/2024-Admn", "Shri Anil Kumar, Assistant, is transferred and posted as Section Officer in the Accounts Branch with immediate effect.",
    "This order issues with the approval of the competent authority." ] },
  { id: "oo-en-2", lang: "eng", docType: "office_order", lines: [
    "OFFICE ORDER", "In continuation of the sanction conveyed earlier, Shri Mohan Lal is posted as Clerk with immediate effect.",
    "He will report to the Section Officer (Accounts)." ] },
  { id: "oo-hi-1", lang: "hin", docType: "office_order", lines: [
    "कार्यालय आदेश", "संख्या 45/2024-प्रशा.", "श्री अनिल कुमार, सहायक, का स्थानांतरण अनुभाग अधिकारी के पद पर किया जाता है।",
    "यह आदेश तत्काल प्रभाव से लागू होगा।" ] },
  // ---- letter
  { id: "le-en-1", lang: "eng", docType: "letter", lines: [
    "To,", "The Director,", "Subject: Request for release of pending salary", "Dear Sir,",
    "With reference to my earlier representation I request you to kindly release the arrears.", "Yours faithfully,", "Ram Prasad" ] },
  { id: "le-en-2", lang: "eng", docType: "letter", lines: [
    "Ref No. HR/2024/77", "Subject: Intimation of leave", "Respected Sir,", "I wish to inform you that I will be on leave from 10/04/2024.", "Yours sincerely," ] },
  { id: "le-hi-1", lang: "hin", docType: "letter", lines: [
    "सेवा में,", "निदेशक महोदय,", "विषय: लंबित वेतन के भुगतान हेतु अनुरोध", "महोदय,", "कृपया बकाया राशि जारी करने की कृपा करें।", "भवदीय," ] },
  // ---- id_proof
  { id: "id-en-1", lang: "eng", docType: "id_proof", lines: [
    "Unique Identification Authority of India", "Government of India", "Aadhaar", "Ravi Kumar", "DOB: 12/03/1985", "2341 2341 2346" ] },
  { id: "id-en-2", lang: "eng", docType: "id_proof", lines: [
    "INCOME TAX DEPARTMENT", "GOVT. OF INDIA", "Permanent Account Number", "ABCPE1234F", "Name: RAVI KUMAR" ] },
  { id: "id-hi-1", lang: "hin", docType: "id_proof", lines: [
    "भारतीय विशिष्ट पहचान प्राधिकरण", "आधार", "रवि कुमार", "जन्म वर्ष: 1985", "मेरा आधार, मेरी पहचान" ] },
  // ---- certificate
  { id: "ce-en-1", lang: "eng", docType: "certificate", lines: [
    "CERTIFICATE", "This is to certify that Shri Ravi Kumar S/o Shri Mohan Kumar has successfully completed",
    "the induction training from 01/02/2024 to 29/02/2024." ] },
  { id: "ce-en-2", lang: "eng", docType: "certificate", lines: [
    "Experience Certificate", "Certified that Smt. Anita Rao worked in this office as Stenographer from 2015 to 2022." ] },
  { id: "ce-hi-1", lang: "hin", docType: "certificate", lines: [
    "प्रमाण पत्र", "प्रमाणित किया जाता है कि श्री रवि कुमार ने दिनांक 01/02/2024 से 29/02/2024 तक प्रशिक्षण सफलतापूर्वक पूर्ण किया।" ] },
  // ---- other
  { id: "ot-en-1", lang: "eng", docType: "other", lines: [
    "Minutes of the canteen committee", "Agenda: tea and snacks arrangement for the annual day", "Members present: five" ] },
  { id: "ot-hi-1", lang: "hin", docType: "other", lines: [
    "कैंटीन समिति की बैठक का कार्यवृत्त", "चाय और नाश्ते की व्यवस्था पर चर्चा हुई" ] },
];
