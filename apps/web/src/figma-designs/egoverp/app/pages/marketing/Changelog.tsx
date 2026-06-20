import { Card, Button, Badge, Input } from '../../components/ui';
import {
  Sparkles,
  Bug,
  Zap,
  Shield,
  Database,
  Smartphone,
  Globe,
  BarChart3,
  FileText,
  Users,
  Calendar,
  Download,
  Bell,
  TrendingUp,
  CheckCircle2,
} from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

interface ChangelogEntry {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  categories: {
    type: 'feature' | 'improvement' | 'bugfix' | 'security';
    items: string[];
  }[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '3.2.0',
    date: '2026-05-15',
    type: 'minor',
    categories: [
      {
        type: 'feature',
        items: [
          'New Asset Management module with depreciation tracking and maintenance scheduling',
          'Integrated WhatsApp Business API for automated notifications and alerts',
          'Advanced Budget Variance Analysis with drill-down capabilities',
          'Multi-currency support for international transactions and reporting',
        ],
      },
      {
        type: 'improvement',
        items: [
          'Enhanced mobile app performance with 40% faster load times',
          'Redesigned dashboard with customizable widgets and layouts',
          'Improved search across all modules with AI-powered suggestions',
          'Batch processing for bulk data imports now 3x faster',
        ],
      },
      {
        type: 'bugfix',
        items: [
          'Fixed GST return filing issue for taxpayers with multiple GSTINs',
          'Resolved email notification delays in approval workflows',
          'Corrected PF calculation for employees with mid-month joining',
        ],
      },
    ],
  },
  {
    version: '3.1.5',
    date: '2026-04-20',
    type: 'patch',
    categories: [
      {
        type: 'security',
        items: [
          'Updated encryption protocols to AES-256-GCM for data at rest',
          'Patched vulnerability in session management (CVE-2026-XXXX)',
          'Enhanced password policy enforcement with breach detection',
        ],
      },
      {
        type: 'bugfix',
        items: [
          'Fixed reconciliation mismatch in TDS calculation for professional fees',
          'Resolved calendar sync issues with Google Workspace',
          'Corrected export format for Income Tax return XML files',
        ],
      },
    ],
  },
  {
    version: '3.1.0',
    date: '2026-03-10',
    type: 'minor',
    categories: [
      {
        type: 'feature',
        items: [
          'Real-time collaboration on budget proposals with comment threads',
          'Automated expense categorization using machine learning',
          'Integration with DigiLocker for document verification',
          'Custom approval workflows with parallel and sequential routing',
        ],
      },
      {
        type: 'improvement',
        items: [
          'Enhanced accessibility compliance with WCAG 2.2 AA standards',
          'Improved PDF generation for payslips and reports',
          'Optimized database queries for faster report generation',
          'Updated UI components with refined design tokens',
        ],
      },
      {
        type: 'bugfix',items: [
          'Fixed leave balance calculation for employees on long leave',
          'Resolved duplicate entry issue in vendor payment tracking',
          'Corrected date range handling in custom reports',
        ],
      },
    ],
  },
  {
    version: '3.0.0',
    date: '2026-01-15',
    type: 'major',
    categories: [
      {
        type: 'feature',
        items: [
          'Complete redesign with modern UI and improved navigation',
          'Advanced Analytics dashboard with AI-powered insights',
          'Project Management module with Gantt charts and resource allocation',
          'Mobile app overhaul with offline mode and biometric authentication',
          'Enhanced CRM with lead scoring and sales forecasting',
          'Integrated Helpdesk with SLA tracking and knowledge base',
        ],
      },
      {
        type: 'improvement',
        items: [
          'Performance improvements across all modules (50% faster average)',
          'Redesigned mobile experience with gesture-based navigation',
          'Enhanced data export with Excel, PDF, and custom formats',
          'Improved API with GraphQL support and webhook subscriptions',
        ],
      },
      {
        type: 'security',
        items: [
          'Implemented Zero Trust security architecture',
          'Added multi-factor authentication with hardware token support',
          'Enhanced audit logging with tamper-proof blockchain storage',
        ],
      },
    ],
  },
  {
    version: '2.9.3',
    date: '2025-12-05',
    type: 'patch',
    categories: [
      {
        type: 'bugfix',
        items: [
          'Fixed ESI contribution calculation for employees earning above ceiling',
          'Resolved timezone issues in attendance reports',
          'Corrected VAT calculation for interstate transactions',
        ],
      },
      {
        type: 'improvement',
        items: [
          'Updated GST rates database for FY 2025-26',
          'Enhanced error messages with actionable suggestions',
          'Improved backup performance with incremental snapshots',
        ],
      },
    ],
  },
  {
    version: '2.9.0',
    date: '2025-11-01',
    type: 'minor',
    categories: [
      {
        type: 'feature',
        items: [
          'Aadhaar-based eKYC integration for employee onboarding',
          'Automated bank reconciliation with direct bank feed integration',
          'Inventory forecasting using historical data and trends',
          'Custom role-based dashboards with widget library',
        ],
      },
      {
        type: 'improvement',
        items: [
          'Enhanced PDF rendering for multilingual documents',
          'Improved notification system with priority routing',
          'Optimized mobile app bundle size (30% reduction)',
        ],
      },
    ],
  },
];

const getCategoryIcon = (type: ChangelogEntry['categories'][0]['type']) => {
  const icons = {
    feature: Sparkles,
    improvement: Zap,
    bugfix: Bug,
    security: Shield,
  };
  return icons[type];
};

const getCategoryConfig = (type: ChangelogEntry['categories'][0]['type']) => {
  const configs = {
    feature: { label: 'New Features', color: 'intent-success' },
    improvement: { label: 'Improvements', color: 'intent-info' },
    bugfix: { label: 'Bug Fixes', color: 'intent-warning' },
    security: { label: 'Security', color: 'intent-danger' },
  };
  return configs[type];
};

const getVersionBadge = (type: ChangelogEntry['type']) => {
  const variants = {
    major: 'danger' as const,
    minor: 'success' as const,
    patch: 'info' as const,
  };
  return variants[type];
};

const CHANGELOG_STATS = [
  { value: CHANGELOG.length.toString(), label: 'Releases This Year', icon: Sparkles },
  { value: '145', label: 'Features Shipped', icon: Zap },
  { value: '98%', label: 'Uptime Last Quarter', icon: CheckCircle2 },
  { value: '< 24h', label: 'Avg Fix Time', icon: TrendingUp },
];

export function Changelog() {
  const navigate = useNavigate();
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroY = useTransform(scrollY, [0, 300], [0, -50]);

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section with Parallax */}
        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-intent-success-bg to-intent-info-bg rounded-full mb-6"
          >
            <Sparkles className="size-5 text-intent-success" />
            <span className="text-body-sm font-medium text-intent-success">Latest Release: v{CHANGELOG[0].version}</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            Product Changelog
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-text-secondary max-w-3xl mx-auto mb-8"
          >
            Track every feature, improvement, and fix. We ship major updates quarterly,
            minor releases monthly, and security patches weekly to keep you secure and ahead.
          </motion.p>

          {/* Changelog Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto"
          >
            {CHANGELOG_STATS.map((stat, idx) => {
              const Icon = stat.icon;
              return (
                <Card key={idx} className="p-4 text-center hover:shadow-[var(--shadow-md)] transition-shadow">
                  <Icon className="size-5 text-intent-primary mx-auto mb-2" />
                  <div className="text-h3 text-intent-primary mb-1">{stat.value}</div>
                  <div className="text-caption text-text-muted">{stat.label}</div>
                </Card>
              );
            })}
          </motion.div>
        </motion.div>

        {/* Changelog Timeline - Enhanced */}
        <div className="space-y-8">
          {CHANGELOG.map((entry, index) => {
            const isMajor = entry.type === 'major';
            const totalItems = entry.categories.reduce((acc, cat) => acc + cat.items.length, 0);

            return (
              <motion.div
                key={entry.version}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + index * 0.08 }}
              >
                <Card className={`p-8 ${isMajor ? 'border-2 border-intent-primary bg-gradient-to-b from-surface-raised to-surface-canvas' : ''}`}>
                  {/* Version Header - Enhanced */}
                  <div className="flex items-start justify-between mb-6 pb-6 border-b-2 border-border-subtle">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`size-12 rounded-xl flex items-center justify-center ${
                          isMajor
                            ? 'bg-gradient-to-br from-intent-primary to-brand-accent shadow-[0_8px_16px_rgba(59,130,246,0.3)]'
                            : 'bg-gradient-to-br from-brand-primary to-brand-accent'
                        }`}>
                          <span className="text-white font-bold">v{entry.version.split('.')[0]}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h2 className="text-h2">Version {entry.version}</h2>
                            <Badge variant={getVersionBadge(entry.type)}>
                              {entry.type.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-caption text-text-muted">
                            <div className="flex items-center gap-2">
                              <Calendar className="size-4" />
                              {new Date(entry.date).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                              })}
                            </div>
                            <span>•</span>
                            <span>{totalItems} changes</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {index === 0 && (
                      <Badge variant="success" className="ml-4">
                        <Sparkles className="size-3 mr-1" />
                        Latest
                      </Badge>
                    )}
                  </div>

                  {/* Categories - Enhanced */}
                  <div className="space-y-6">
                    {entry.categories.map((category, catIndex) => {
                      const Icon = getCategoryIcon(category.type);
                      const config = getCategoryConfig(category.type);

                      return (
                        <div key={catIndex}>
                          <div className="flex items-center gap-3 mb-4">
                            <div className={`size-10 rounded-xl flex items-center justify-center ${
                              category.type === 'feature' ? 'bg-intent-success-bg' :
                              category.type === 'improvement' ? 'bg-intent-info-bg' :
                              category.type === 'bugfix' ? 'bg-intent-warning-bg' :
                              'bg-intent-danger-bg'
                            }`}>
                              <Icon className={`size-5 ${
                                category.type === 'feature' ? 'text-intent-success' :
                                category.type === 'improvement' ? 'text-intent-info' :
                                category.type === 'bugfix' ? 'text-intent-warning' :
                                'text-intent-danger'
                              }`} />
                            </div>
                            <h3 className="text-h4">{config.label}</h3>
                            <Badge variant="default">{category.items.length}</Badge>
                          </div>
                          <ul className="space-y-3 ml-13">
                            {category.items.map((item, itemIndex) => (
                              <li key={itemIndex} className="flex items-start gap-3 p-3 bg-surface-sunken rounded-lg hover:bg-surface-raised transition-colors">
                                <CheckCircle2 className="size-4 text-intent-success flex-shrink-0 mt-0.5" />
                                <span className="text-body-sm text-text-primary flex-1">{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Archive Notice - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mt-16"
        >
          <Card className="p-12 bg-gradient-to-br from-surface-raised to-surface-sunken text-center">
            <div className="size-16 bg-gradient-to-br from-brand-primary to-brand-accent rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-[0_8px_16px_rgba(59,130,246,0.2)]">
              <FileText className="size-8 text-white" />
            </div>
            <h3 className="text-h2 mb-3">Looking for Older Versions?</h3>
            <p className="text-base text-text-secondary mb-6 max-w-2xl mx-auto">
              Access complete release history dating back to 2018. View detailed changelogs,
              download legacy versions, and review migration guides.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button variant="primary" size="lg">
                Browse Archive
              </Button>
              <Button variant="secondary" size="lg" leadingIcon={<Download />}>
                Download All Changelogs
              </Button>
            </div>
          </Card>
        </motion.div>

        {/* Subscribe CTA - Premium */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
          className="mt-12"
        >
          <Card className="p-16 bg-gradient-to-br from-brand-primary via-intent-primary to-brand-accent text-white text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-32 -mt-32" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white opacity-5 rounded-full -ml-24 -mb-24" />

            <div className="relative z-10">
              <div className="size-20 bg-white bg-opacity-20 rounded-2xl mx-auto mb-6 flex items-center justify-center backdrop-blur-sm">
                <Bell className="size-10 text-white" />
              </div>
              <h2 className="text-h1 mb-4">Never Miss an Update</h2>
              <p className="text-base opacity-95 mb-8 max-w-2xl mx-auto leading-relaxed">
                Get instant notifications about new features, security patches, and breaking changes.
                Join 5,000+ subscribers who stay ahead with our release notes.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-2xl mx-auto">
                <Input
                  type="email"
                  placeholder="Enter your email address"
                  className="flex-1 px-6 py-4 bg-white text-text-primary rounded-xl w-full sm:w-auto"
                />
                <Button variant="secondary" size="lg" className="min-w-[160px]">
                  Subscribe Free
                </Button>
              </div>
              <p className="text-caption opacity-80 mt-6">
                No spam, ever • Unsubscribe anytime • Weekly digest or instant notifications
              </p>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
