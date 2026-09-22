import type { LucideIcon } from "lucide-react";
import {
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
