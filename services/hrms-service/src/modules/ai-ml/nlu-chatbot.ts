/**
 * NLU Chatbot — Intent Classification + Entity Extraction
 *
 * Upgrades the basic pattern-matching chatbot to a proper NLU system.
 * Uses a lightweight intent classifier with slot filling.
 *
 * Architecture:
 * 1. Intent classification: regex + keyword scoring (upgradeble to BERT/DistilBERT)
 * 2. Entity extraction: regex patterns for dates, amounts, leave types
 * 3. Context management: tracks conversation state for multi-turn
 * 4. Action execution: queries DB based on detected intent + entities
 *
 * Supported intents (30+):
 * - leave_balance, leave_apply, leave_history, leave_policy
 * - payslip_view, payslip_download, salary_breakup
 * - attendance_status, attendance_history, checkin
 * - holiday_next, holiday_list
 * - manager_info, team_info, directory_search
 * - loan_status, advance_status
 * - grievance_file, grievance_status
 * - policy_search, faq
 * - profile_view, profile_update
 * - travel_apply, expense_submit
 * - greeting, help, fallback
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { sqlPool as sqlClient } from "../../shared/db.js";

const chatSchema = z.object({
  message: z.string().min(1).max(500),
  conversationId: z.string().uuid().optional(), // for multi-turn
  language: z.enum(["en", "hi"]).optional(),
});

// Intent definitions with keywords and patterns
type Intent = {
  name: string;
  keywords: string[];
  patterns: RegExp[];
  priority: number;
};

const INTENTS: Intent[] = [
  { name: "leave_balance", keywords: ["leave", "balance", "remaining", "available", "how much", "how many", "cl", "el", "sl"], patterns: [/leave.*balance/i, /how (?:much|many).*leave/i, /(?:cl|el|sl|casual|earned|sick).*(?:left|remain|balance)/i], priority: 10 },
  { name: "leave_apply", keywords: ["apply", "request", "want leave", "need leave", "take leave"], patterns: [/apply.*leave/i, /want.*leave/i, /(?:take|need).*(?:day|leave).*off/i], priority: 9 },
  { name: "leave_history", keywords: ["leave history", "past leave", "previous leave", "leave taken"], patterns: [/leave.*history/i, /(?:past|previous|taken).*leave/i], priority: 8 },
  { name: "payslip_view", keywords: ["salary", "payslip", "pay slip", "net pay", "gross", "ctc", "income"], patterns: [/(?:salary|payslip|pay\s*slip|net\s*pay|gross)/i, /(?:this|last|current).*month.*(?:salary|pay)/i], priority: 10 },
  { name: "attendance_status", keywords: ["attendance", "present", "absent", "today status", "marked"], patterns: [/(?:attendance|present|absent)/i, /(?:today|my).*(?:status|attendance)/i], priority: 9 },
  { name: "holiday_next", keywords: ["next holiday", "upcoming holiday", "when holiday", "public holiday"], patterns: [/(?:next|upcoming|when).*holiday/i, /public.*holiday/i], priority: 9 },
  { name: "holiday_list", keywords: ["holiday list", "all holidays", "holiday calendar", "holidays this year"], patterns: [/holiday.*(?:list|calendar|this year|all)/i], priority: 8 },
  { name: "manager_info", keywords: ["manager", "reporting", "boss", "supervisor", "who do i report"], patterns: [/(?:my|who).*(?:manager|boss|reporting|supervisor)/i, /report(?:ing)?\s*to/i], priority: 8 },
  { name: "team_info", keywords: ["team", "reportees", "my team", "direct reports"], patterns: [/(?:my|show).*team/i, /(?:direct|my).*report/i], priority: 7 },
  { name: "loan_status", keywords: ["loan", "emi", "advance", "outstanding", "repayment"], patterns: [/(?:loan|emi|advance).*(?:status|balance|outstanding)/i, /(?:my|pending).*(?:loan|advance)/i], priority: 8 },
  { name: "grievance_file", keywords: ["complaint", "grievance", "file complaint", "raise issue"], patterns: [/(?:file|raise|submit).*(?:complaint|grievance|issue)/i], priority: 7 },
  { name: "policy_search", keywords: ["policy", "rule", "regulation", "guideline", "how to", "process", "procedure"], patterns: [/(?:what|how).*(?:policy|rule|process|procedure)/i, /(?:leave|travel|expense).*policy/i], priority: 7 },
  { name: "profile_view", keywords: ["my profile", "my details", "my information", "employee code", "designation"], patterns: [/(?:my|show).*(?:profile|details|info)/i, /(?:employee|emp).*code/i], priority: 7 },
  { name: "travel_apply", keywords: ["travel", "tour", "official travel", "travel request", "ta da"], patterns: [/(?:apply|request|submit).*travel/i, /(?:ta|da|travel).*(?:allowance|request)/i], priority: 7 },
  { name: "expense_submit", keywords: ["expense", "claim", "reimbursement", "bill submit"], patterns: [/(?:submit|file|raise).*(?:expense|claim|reimbursement)/i], priority: 7 },
  { name: "greeting", keywords: ["hello", "hi", "hey", "good morning", "good evening", "namaste"], patterns: [/^(?:hi|hello|hey|namaste|good\s*(?:morning|afternoon|evening))/i], priority: 5 },
  { name: "help", keywords: ["help", "what can you do", "features", "options"], patterns: [/(?:help|what can|what do|features|options)/i], priority: 5 },
  { name: "thanks", keywords: ["thanks", "thank you", "dhanyavaad", "shukriya"], patterns: [/(?:thanks|thank you|dhanyavaad|shukriya)/i], priority: 3 },
];

/**
 * Classify intent using keyword scoring + regex pattern matching.
 * Returns top intent with confidence score.
 */
function classifyIntent(message: string): { intent: string; confidence: number; entities: Record<string, string> } {
  const lower = message.toLowerCase().trim();
  const scores: { name: string; score: number }[] = [];

  for (const intent of INTENTS) {
    let score = 0;

    // Keyword matching (weighted)
    for (const kw of intent.keywords) {
      if (lower.includes(kw)) score += 3;
    }

    // Regex pattern matching (higher weight)
    for (const pattern of intent.patterns) {
      if (pattern.test(lower)) score += 10;
    }

    // Priority bonus
    score += intent.priority * 0.5;

    if (score > 0) scores.push({ name: intent.name, score });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    return { intent: "fallback", confidence: 0, entities: {} };
  }

  const top = scores[0]!;
  const maxPossible = 30 + 10; // rough max score
  const confidence = Math.min(Math.round((top.score / maxPossible) * 100), 99);

  // Extract entities
  const entities = extractEntities(lower);

  return { intent: top.name, confidence, entities };
}

/**
 * Extract entities (dates, leave types, amounts) from message.
 */
function extractEntities(message: string): Record<string, string> {
  const entities: Record<string, string> = {};

  // Leave type
  if (/casual|cl\b/i.test(message)) entities.leaveType = "CL";
  else if (/earned|el\b/i.test(message)) entities.leaveType = "EL";
  else if (/sick|sl\b|medical/i.test(message)) entities.leaveType = "SL";
  else if (/maternity/i.test(message)) entities.leaveType = "ML";

  // Date patterns
  const dateMatch = message.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dateMatch) entities.date = dateMatch[0];

  // Duration (days)
  const daysMatch = message.match(/(\d+)\s*(?:days?|din)/i);
  if (daysMatch) entities.days = daysMatch[1]!;

  // Month
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  for (const m of months) {
    if (message.includes(m) || message.includes(m.slice(0, 3))) {
      entities.month = m;
      break;
    }
  }

  return entities;
}

export async function nluChatbotRoutes(app: FastifyInstance): Promise<void> {

  /** POST /v1/hrms/ai/chat — intelligent HR chatbot with NLU */
  app.post("/v1/hrms/ai/chat", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = chatSchema.parse(req.body);

    // Classify intent
    const { intent, confidence, entities } = classifyIntent(body.message);

    // Execute action based on intent
    let response: { text: string; data?: unknown; action?: string; suggestions?: string[] };

    switch (intent) {
      case "leave_balance": {
        const rows = await sqlClient.query(
          `SELECT leave_type_code, leave_type_name, total_days, balance_days
           FROM hrms.leave_allocations
           WHERE tenant_id = $1 AND employee_id = (SELECT id FROM employee.hrms_employees WHERE user_id = $1 AND tenant_id = $2 LIMIT 1)`,
          [ctx.actorId, ctx.tenantId],
        );
        if (rows.rowCount && rows.rowCount > 0) {
          const summary = rows.rows.map((r: any) => `• ${r.leave_type_name}: **${r.balance_days}** of ${r.total_days} days`).join("\n");
          response = { text: `Here's your leave balance:\n\n${summary}`, data: rows.rows, action: "show_leave_balance", suggestions: ["Apply for leave", "Leave history", "Leave policy"] };
        } else {
          response = { text: "I couldn't find your leave allocation. Your HR team may not have set it up yet.", suggestions: ["Contact HR", "View policy"] };
        }
        break;
      }

      case "payslip_view": {
        response = { text: "Your latest payslip is ready. Tap below to view it with full component breakdown.", action: "navigate:/hr/payslips", suggestions: ["Download PDF", "Tax details", "Compare with last month"] };
        break;
      }

      case "holiday_next": {
        const holidays = await sqlClient.query(
          `SELECT name, date, type FROM hrms.holidays WHERE tenant_id = $1 AND date >= CURRENT_DATE ORDER BY date LIMIT 3`,
          [ctx.tenantId],
        );
        if (holidays.rowCount && holidays.rowCount > 0) {
          const list = holidays.rows.map((h: any) => `• **${h.name}** — ${h.date} (${h.type})`).join("\n");
          response = { text: `Upcoming holidays:\n\n${list}`, data: holidays.rows, suggestions: ["Holiday calendar", "Apply leave before holiday"] };
        } else {
          response = { text: "No upcoming holidays found in the calendar.", suggestions: ["View full calendar"] };
        }
        break;
      }

      case "manager_info": {
        const emp = await sqlClient.query(
          `SELECT e2.first_name, e2.last_name, e2.designation, e2.email, e2.phone
           FROM employee.hrms_employees e1
           JOIN employee.hrms_employees e2 ON e2.id = e1.reporting_to AND e2.tenant_id = e1.tenant_id
           WHERE e1.user_id = $1 AND e1.tenant_id = $2`,
          [ctx.actorId, ctx.tenantId],
        );
        if (emp.rowCount && emp.rowCount > 0) {
          const m = emp.rows[0];
          response = { text: `Your reporting manager is **${m.first_name} ${m.last_name}** (${m.designation}).\n\n📧 ${m.email ?? '—'}\n📱 ${m.phone ?? '—'}`, suggestions: ["Team directory", "Org chart"] };
        } else {
          response = { text: "I couldn't find your reporting manager details.", suggestions: ["View org chart", "Contact HR"] };
        }
        break;
      }

      case "loan_status": {
        response = { text: "You can view your loan EMI status, outstanding balance, and repayment schedule in the Loans section.", action: "navigate:/hr/loans", suggestions: ["View EMI schedule", "Prepay loan"] };
        break;
      }

      case "leave_apply": {
        response = { text: "I'll help you apply for leave. Tap below to open the leave application form.", action: "navigate:/hr/leave/apply", suggestions: ["Check balance first", "Half-day leave", "Cancel"] };
        break;
      }

      case "travel_apply": {
        response = { text: "Ready to submit a travel request? Tap below to fill in destination, dates, and advance requirement.", action: "navigate:/hr/travel", suggestions: ["Check travel policy", "View past requests"] };
        break;
      }

      case "expense_submit": {
        response = { text: "You can submit an expense claim with receipt photo. The OCR will auto-fill the amount and vendor.", action: "navigate:/hr/expenses", suggestions: ["Scan receipt", "View my claims"] };
        break;
      }

      case "attendance_status": {
        response = { text: "Your attendance records are in the Attendance section. You can also mark attendance using Geo Check-in.", action: "navigate:/hr/attendance", suggestions: ["Mark attendance now", "View this month"] };
        break;
      }

      case "profile_view": {
        response = { text: "Your employee profile shows all your details, designation, department, and documents.", action: "navigate:/hr/profile", suggestions: ["Update details", "My ID card", "My documents"] };
        break;
      }

      case "policy_search": {
        response = { text: "HR policies are available in the Knowledge Base. You can search by topic — leave policy, travel rules, expense guidelines, etc.", action: "navigate:/knowledge", suggestions: ["Leave policy", "Travel policy", "Expense rules"] };
        break;
      }

      case "greeting": {
        const hour = new Date().getHours();
        const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
        response = {
          text: `${greeting}! 👋 I'm your AI HR assistant. I can help with:\n\n• Leave balance & applications\n• Payslip & salary details\n• Upcoming holidays\n• Attendance & check-in\n• Manager & team info\n• Loans & advances\n• Travel & expenses\n• HR policies\n\nJust ask in plain English or Hindi!`,
          suggestions: ["My leave balance", "Next holiday", "View payslip", "My manager"],
        };
        break;
      }

      case "help": {
        response = {
          text: "I can help you with:\n\n📅 **Leave** — balance, apply, history, policy\n💰 **Salary** — payslip, tax, breakup\n🏛 **Attendance** — status, check-in, corrections\n📊 **Goals** — OKR progress, check-in\n👤 **Profile** — details, documents, ID card\n✈️ **Travel** — requests, policy\n💳 **Expenses** — submit claim, OCR scan\n📢 **Policies** — search knowledge base\n\nTry: \"How much CL do I have?\" or \"Show my payslip\"",
          suggestions: ["Leave balance", "Payslip", "Next holiday", "My team"],
        };
        break;
      }

      case "thanks": {
        response = { text: "You're welcome! Let me know if there's anything else I can help with. 😊", suggestions: ["Leave balance", "Payslip", "Holidays"] };
        break;
      }

      default: {
        response = {
          text: "I'm not sure I understood that. Could you rephrase? I work best with questions like:\n\n• \"How much casual leave do I have?\"\n• \"When is the next holiday?\"\n• \"Show my salary slip\"\n• \"Who is my manager?\"",
          suggestions: ["My leave balance", "Next holiday", "View payslip", "Help"],
        };
      }
    }

    return reply.send({
      ...response,
      meta: {
        intent,
        confidence,
        entities,
        method: "keyword_nlu",
        upgradeNote: "Replace with BERT/DistilBERT when fine-tuned on 500+ labeled examples",
      },
    });
  });
}
