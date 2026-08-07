import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  DollarSign,
  Users,
  ShoppingCart,
  Package,
  Building2,
  FolderKanban,
  UserCircle,
  HelpCircle,
  FileText,
  Palette,
  Component,
  Menu,
  X,
  ChevronDown,
  Settings,
  LogOut,
  CheckCircle,
} from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
  children?: { label: string; path: string }[];
}

const navigation: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/app/dashboard',
    icon: <LayoutDashboard className="size-5" />,
  },
  {
    label: 'Approvals',
    path: '/app/approvals',
    icon: <CheckCircle className="size-5" />,
  },
  {
    label: 'Tenant Admin',
    path: '/tenant-admin',
    icon: <Settings className="size-5" />,
  },
  {
    label: 'Design System',
    path: '/design-system',
    icon: <Palette className="size-5" />,
    children: [
      { label: 'Tokens', path: '/design-tokens' },
      { label: 'Atoms', path: '/components' },
      { label: 'Molecules', path: '/molecules' },
      { label: 'Organisms', path: '/organisms' },
      { label: 'Templates', path: '/templates' },
    ],
  },
  {
    label: 'Finance',
    path: '/app/finance',
    icon: <DollarSign className="size-5" />,
    children: [
      { label: 'Chart of Accounts', path: '/app/finance/chart-of-accounts' },
      { label: 'Journal Entries', path: '/app/finance/journals/new' },
      { label: 'Invoices', path: '/app/finance/invoices' },
      { label: 'Payments', path: '/app/finance/payments' },
      { label: 'Reports', path: '/app/finance/reports' },
    ],
  },
  {
    label: 'HRMS',
    path: '/app/hrms',
    icon: <Users className="size-5" />,
    children: [
      { label: 'Employees', path: '/app/hrms/employees' },
      { label: 'Leave - Apply', path: '/app/hrms/leave/apply' },
      { label: 'Leave - My Leaves', path: '/app/hrms/leave/my' },
      { label: 'Leave - Approvals', path: '/app/hrms/leave/approvals' },
      { label: 'Attendance', path: '/app/hrms/attendance' },
      { label: 'Payroll', path: '/app/hrms/payroll' },
    ],
  },
  {
    label: 'Procurement',
    path: '/app/procurement',
    icon: <ShoppingCart className="size-5" />,
    children: [
      { label: 'Purchase Orders', path: '/app/procurement/orders' },
      { label: 'Vendors', path: '/app/procurement/vendors' },
      { label: 'Approvals', path: '/app/procurement/approvals' },
    ],
  },
  {
    label: 'Inventory',
    path: '/app/inventory',
    icon: <Package className="size-5" />,
  },
  {
    label: 'Assets',
    path: '/app/assets',
    icon: <Building2 className="size-5" />,
  },
  {
    label: 'Projects',
    path: '/app/projects',
    icon: <FolderKanban className="size-5" />,
  },
  {
    label: 'CRM',
    path: '/app/crm',
    icon: <UserCircle className="size-5" />,
    children: [
      { label: 'Pipeline', path: '/app/crm/pipeline' },
      { label: 'Contacts', path: '/app/crm/contacts' },
      { label: 'Activities', path: '/app/crm/activities' },
    ],
  },
  {
    label: 'Helpdesk',
    path: '/app/helpdesk',
    icon: <HelpCircle className="size-5" />,
    children: [
      { label: 'Tickets', path: '/app/helpdesk/tickets' },
      { label: 'Reports', path: '/app/helpdesk/reports' },
    ],
  },
  {
    label: 'Reports',
    path: '/app/reports',
    icon: <FileText className="size-5" />,
  },
];

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="size-full min-h-screen bg-surface-canvas flex">
      {/* Sidebar - Desktop */}
      <AnimatePresence mode="wait">
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="hidden lg:flex flex-col bg-surface-raised border-r-2 border-border-subtle overflow-hidden"
          >
            <SidebarContent location={location} onNavigate={() => {}} />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed top-0 left-0 bottom-0 w-[280px] bg-surface-raised z-50 lg:hidden flex flex-col shadow-lg"
            >
              <SidebarContent location={location} onNavigate={() => setMobileMenuOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 bg-surface-raised border-b-2 border-border-subtle flex items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:flex size-10 items-center justify-center rounded-lg hover:bg-surface-sunken transition-colors"
              aria-label="Toggle sidebar"
            >
              <Menu className="size-5 text-text-primary" />
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden flex size-10 items-center justify-center rounded-lg hover:bg-surface-sunken transition-colors"
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <h1 className="text-h4 font-semibold">CivitasOne Suite</h1>
          </div>

          <div className="flex items-center gap-3">
            <button className="size-10 rounded-lg hover:bg-surface-sunken transition-colors flex items-center justify-center">
              <Settings className="size-5 text-text-secondary" />
            </button>
            <div className="flex items-center gap-3 pl-3 border-l-2 border-border-subtle">
              <div className="hidden md:block text-right">
                <div className="text-body-sm font-medium text-text-primary">Admin User</div>
                <div className="text-caption text-text-muted">administrator@gov.in</div>
              </div>
              <div className="size-10 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold">
                AU
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ location, onNavigate }: { location: any; onNavigate: () => void }) {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const toggleExpand = (label: string) => {
    setExpandedItems((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  };

  return (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b-2 border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="size-8 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center">
            <Building2 className="size-5 text-white" />
          </div>
          <span className="font-semibold text-text-primary">CivitasOne</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {navigation.map((item) => (
            <NavItemComponent
              key={item.label}
              item={item}
              location={location}
              expanded={expandedItems.includes(item.label)}
              onToggleExpand={() => toggleExpand(item.label)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t-2 border-border-subtle">
        <button className="w-full flex items-center gap-3 px-3 py-2 text-text-secondary hover:text-intent-danger hover:bg-intent-danger-bg rounded-lg transition-colors">
          <LogOut className="size-5" />
          <span className="text-body-sm font-medium">Sign Out</span>
        </button>
      </div>
    </>
  );
}

function NavItemComponent({
  item,
  location,
  expanded,
  onToggleExpand,
  onNavigate,
}: {
  item: NavItem;
  location: any;
  expanded: boolean;
  onToggleExpand: () => void;
  onNavigate: () => void;
}) {
  const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
  const hasChildren = item.children && item.children.length > 0;

  return (
    <div>
      {hasChildren ? (
        <button
          onClick={onToggleExpand}
          className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors ${
            isActive
              ? 'bg-intent-primary-bg text-intent-primary font-medium'
              : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
          }`}
        >
          <div className="flex items-center gap-3">
            {item.icon}
            <span className="text-body-sm">{item.label}</span>
          </div>
          <ChevronDown
            className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      ) : (
        <Link
          to={item.path}
          onClick={onNavigate}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            isActive
              ? 'bg-intent-primary-bg text-intent-primary font-medium'
              : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
          }`}
        >
          {item.icon}
          <span className="text-body-sm">{item.label}</span>
        </Link>
      )}

      {/* Children */}
      <AnimatePresence>
        {hasChildren && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden ml-8 mt-1 space-y-1"
          >
            {item.children!.map((child) => {
              const isChildActive = location.pathname === child.path;
              return (
                <Link
                  key={child.path}
                  to={child.path}
                  onClick={onNavigate}
                  className={`block px-3 py-1.5 rounded-lg text-body-sm transition-colors ${
                    isChildActive
                      ? 'bg-intent-primary-bg text-intent-primary font-medium'
                      : 'text-text-muted hover:bg-surface-sunken hover:text-text-primary'
                  }`}
                >
                  {child.label}
                </Link>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
