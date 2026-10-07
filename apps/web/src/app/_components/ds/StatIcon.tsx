import type { LucideIcon } from "lucide-react";
import {
  Wrench,
  KeyRound,
  Flag,
  Settings,
  Radio,
  Landmark,
  Users,
  ShoppingCart,
  BarChart2,
  Gift,
  Building2,
  HardHat,
  Package,
  Handshake,
  Headphones,
  IdCard,
  Search,
  Scale,
  TrendingUp,
  BookOpen,
  Bell,
  ShieldCheck,
  Wallet,
  Send,
  Inbox,
  Hourglass,
  FolderOpen,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Target,
  Link2,
  PenLine,
  Calculator,
  Banknote,
  ClipboardList,
  BookMarked,
  CreditCard,
  Boxes,
  XCircle,
  Clock,
  MailOpen,
  Puzzle,
  HeartPulse,
  AlertCircle,
  Palmtree,
  Receipt,
  Megaphone,
  Star,
  GraduationCap,
  Network,
  Book,
  Plus,
  Ticket,
  Repeat,
  Globe,
  Mail,
  Briefcase,
  CircleDot,
  Monitor,
  Siren,
  Smartphone,
  UserRound,
  Fingerprint,
  MapPin,
  Navigation,
  RefreshCw,
  PlayCircle,
  MessageSquare,
  Bot,
} from "lucide-react";

/**
 * Emoji glyph -> lucide-react vector icon, for the `.ic` icon-box pattern
 * shared by StatCard, the dashboard's "Your Modules" tiles, the
 * finance/procurement dashboard quick-link tiles, and LinkTiles/ModuleHub
 * (module-hub "quick navigation" tiles used across ~16 pages).
 *
 * Root cause: `.stat .ic` (civitas-ds.css) renders its `icon` prop as plain
 * text and pins font-family to OS-installed color-emoji fonts ("Apple Color
 * Emoji", "Segoe UI Emoji", "Noto Color Emoji"), falling back to a plain
 * sans-serif. Any environment without one of those three installed -- most
 * headless/server Linux boxes, including the one this repo's own
 * scripts/dev/capture-screenshots.mjs runs on -- has no glyph to fall back
 * to, so the browser renders the ".notdef" "missing glyph" box instead of
 * the emoji: an empty square. lucide-react vector icons have no such
 * dependency -- Sidebar.tsx (LucideIcon map) and HRKPIStrip.tsx (inline
 * SVG) already render their icons this way for exactly that reason.
 *
 * Callers are unchanged: they keep passing the same emoji string they
 * always have. An emoji with no entry here falls back to the original
 * raw-text render (pre-existing behavior, not a regression), so coverage
 * can grow incrementally -- add to this map rather than inventing a second
 * mechanism.
 */
const STAT_ICON_MAP: Record<string, LucideIcon> = {
  "🏦": Landmark,
  "🏛": Landmark,
  "👥": Users,
  "🛒": ShoppingCart,
  "📊": BarChart2,
  "🎁": Gift,
  "🏢": Building2,
  "🏗": HardHat,
  "📦": Package,
  "🤝": Handshake,
  "🎧": Headphones,
  "🪪": IdCard,
  "🔍": Search,
  "⚖": Scale,
  "📈": TrendingUp,
  "📚": BookOpen,
  "🔔": Bell,
  "🛡": ShieldCheck,
  "💰": Wallet,
  "📤": Send,
  "📥": Inbox,
  "⏳": Hourglass,
  "📁": FolderOpen,
  "🗂": FolderOpen,
  "📄": FileText,
  "✅": CheckCircle2,
  "⚠": AlertTriangle,
  "📅": Calendar,
  "🎯": Target,
  "🔗": Link2,
  "🖊": PenLine,
  "📝": PenLine,
  "🧮": Calculator,
  "💵": Banknote,
  "📋": ClipboardList,
  "📒": BookMarked,
  "💳": CreditCard,
  "🧱": Boxes,
  "❌": XCircle,
  "⏱": Clock,
  "📬": MailOpen,
  "🧩": Puzzle,
  "💚": HeartPulse,
  "🔴": AlertCircle,
  "🌴": Palmtree,
  "🧾": Receipt,
  "📢": Megaphone,
  "⭐": Star,
  "🎓": GraduationCap,
  "🌳": Network,
  "📗": Book,
  "➕": Plus,
  "💸": Banknote,
  "🎫": Ticket,
  "🔁": Repeat,
  // Admin hub tiles (GAP-ADMIN-HOME-05)
  "🔑": KeyRound,
  "🚩": Flag,
  "⚙": Settings,
  "📡": Radio,
  "🧰": Wrench,
  // Recruitment hub stat cards (GAP-RECRUITMENT-HOME-06): these used to fall back to the raw emoji.
  "🟢": CircleDot,
  "📨": Mail,
  "🌐": Globe,
  "💼": Briefcase,
  // Helpdesk stat cards (GAP-HELPDESK-HOME-05): coloured circle emoji that
  // have no glyph on headless Linux; map to a neutral CircleDot instead.
  "🟠": CircleDot,
  "🔵": CircleDot,
  "⚠️": AlertTriangle,
  // Identity hub tiles (GAP-IDENTITY-HOME-01): these previously fell back to
  // the raw emoji — which renders as the ".notdef" box on headless/server
  // Linux with no color-emoji font — so the seven tiles were visually
  // indistinguishable. Map them to vector icons like the other hub tiles.
  "👤": UserRound,     // Users
  "🖥": Monitor,       // Sessions
  "🚨": Siren,         // Break-glass
  "🔐": Fingerprint,   // WebAuthn / passkeys
  "📱": Smartphone,    // MFA policy
  // Field hub tiles (GAP-FIELD-HOME-01): previously all five fell through to
  // the generic 📁 folder glyph. ✅ (Tasks) and 👷 (HardHat, Agents) already
  // map; add the remaining three as vector icons like the other hub tiles.
  "📍": MapPin,        // Visits
  "🧭": Navigation,    // Routes
  "👷": HardHat,       // Agents
  "🔄": RefreshCw,     // Offline Sync
  // Works hub "Active" stat (GAP-WORKS-HOME-03): used to render raw ▶️ text.
  "▶️": PlayCircle,
  // AI hub tiles (GAP-AI-HOME-01): previously fell back to the raw emoji
  // (".notdef" box on headless Linux), leaving all five tiles visually
  // identical. 🛡️ and ⚖️ already map (ShieldCheck/Scale); add the rest.
  "💬": MessageSquare, // Chat
  "🤖": Bot,           // Agents
};

// Variation Selector-16 (U+FE0F) makes an otherwise-identical emoji string
// fail a plain lookup (e.g. "⏱" vs "⏱️") -- callers use both forms
// inconsistently, so strip it before matching instead of doubling up every
// map entry.
const VARIATION_SELECTOR_16 = new RegExp(String.fromCharCode(0xfe0f), "g");

export function StatIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const Icon = STAT_ICON_MAP[icon.replace(VARIATION_SELECTOR_16, "")];
  if (!Icon) return <>{icon}</>;
  return <Icon size={size} aria-hidden="true" />;
}
