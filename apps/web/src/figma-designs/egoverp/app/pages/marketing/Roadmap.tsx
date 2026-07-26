import { Card, Button, Badge } from '../../components/ui';
import {
  Calendar,
  Sparkles,
  Target,
  Lightbulb,
  Vote,
  MessageSquare,
  TrendingUp,
  Zap,
  Shield,
  Globe,
  Smartphone,
  BarChart3,
  Database,
  Brain,
  CloudCog,
  CheckCircle2,
  Clock,
  Users,
} from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

interface RoadmapItem {
  title: string;
  description: string;
  category: 'feature' | 'improvement' | 'integration' | 'platform';
  status: 'in_progress' | 'planned' | 'considering';
  quarter: string;
  votes: number;
  icon: typeof Sparkles;
}

const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    title: 'AI-Powered Budget Recommendations',
    description: 'Machine learning models to suggest budget allocations based on historical spending patterns and organizational goals.',
    category: 'feature',
    status: 'in_progress',
    quarter: 'Q3 2026',
    votes: 342,
    icon: Brain,
  },
  {
    title: 'Advanced Workflow Automation Builder',
    description: 'Visual workflow designer with conditional logic, loops, and integrations for no-code automation.',
    category: 'feature',
    status: 'in_progress',
    quarter: 'Q3 2026',
    votes: 287,
    icon: Zap,
  },
  {
    title: 'Mobile App Offline Mode',
    description: 'Full offline capability for mobile apps with background sync when connectivity is restored.',
    category: 'improvement',
    status: 'in_progress',
    quarter: 'Q3 2026',
    votes: 419,
    icon: Smartphone,
  },
  {
    title: 'Power BI Connector',
    description: 'Native Power BI connector for real-time data visualization and custom report building.',
    category: 'integration',
    status: 'planned',
    quarter: 'Q4 2026',
    votes: 203,
    icon: BarChart3,
  },
  {
    title: 'E-Office Integration',
    description: 'Seamless integration with government e-Office systems for file movement and noting.',
    category: 'integration',
    status: 'planned',
    quarter: 'Q4 2026',
    votes: 156,
    icon: Globe,
  },
  {
    title: 'Advanced Document OCR',
    description: 'AI-powered OCR for automatic data extraction from invoices, receipts, and government forms.',
    category: 'feature',
    status: 'planned',
    quarter: 'Q4 2026',
    votes: 298,
    icon: Brain,
  },
  {
    title: 'Multi-Tenant Architecture',
    description: 'Support for multiple organizations within a single deployment with complete data isolation.',
    category: 'platform',
    status: 'planned',
    quarter: 'Q1 2027',
    votes: 87,
    icon: CloudCog,
  },
  {
    title: 'Enhanced Audit Trail with Blockchain',
    description: 'Immutable audit logs stored on permissioned blockchain for government compliance.',
    category: 'feature',
    status: 'planned',
    quarter: 'Q1 2027',
    votes: 134,
    icon: Shield,
  },
  {
    title: 'Natural Language Reporting',
    description: 'Ask questions in plain English/Hindi and get instant reports and visualizations.',
    category: 'feature',
    status: 'considering',
    quarter: 'Q2 2027',
    votes: 412,
    icon: MessageSquare,
  },
  {
    title: 'GraphQL API',
    description: 'Modern GraphQL API alongside REST for more efficient data fetching.',
    category: 'platform',
    status: 'considering',
    quarter: 'Q2 2027',
    votes: 76,
    icon: Database,
  },
  {
    title: 'Predictive Analytics Dashboard',
    description: 'ML-powered forecasting for revenue, expenses, attrition, and inventory levels.',
    category: 'feature',
    status: 'considering',
    quarter: 'Q2 2027',
    votes: 267,
    icon: TrendingUp,
  },
  {
    title: 'Voice Commands',
    description: 'Hands-free operation with voice commands in English, Hindi, and regional languages.',
    category: 'feature',
    status: 'considering',
    quarter: 'Q3 2027',
    votes: 189,
    icon: Smartphone,
  },
];

const QUARTERS = ['Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027', 'Q3 2027'];

const STATUS_CONFIG = {
  in_progress: { label: 'In Progress', variant: 'success' as const, icon: Zap },
  planned: { label: 'Planned', variant: 'info' as const, icon: Target },
  considering: { label: 'Under Consideration', variant: 'default' as const, icon: Lightbulb },
};

const CATEGORY_CONFIG = {
  feature: { label: 'Feature', color: 'intent-success' },
  improvement: { label: 'Improvement', color: 'intent-info' },
  integration: { label: 'Integration', color: 'intent-warning' },
  platform: { label: 'Platform', color: 'intent-primary' },
};

const ROADMAP_STATS = [
  { value: '12', label: 'Features in Progress', icon: Zap },
  { value: '89%', label: 'On-Time Delivery', icon: CheckCircle2 },
  { value: '2.1K', label: 'Community Votes', icon: Vote },
  { value: '500+', label: 'Active Users', icon: Users },
];

export function Roadmap() {
  const navigate = useNavigate();
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroY = useTransform(scrollY, [0, 300], [0, -50]);

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section with Parallax */}
        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-intent-primary-bg to-intent-info-bg rounded-full mb-6"
          >
            <Sparkles className="size-5 text-intent-primary" />
            <span className="text-body-sm font-medium text-intent-primary">Public Roadmap • Updated Weekly</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            Shape the Future with Us
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-text-secondary max-w-3xl mx-auto mb-8"
          >
            See what we're building, vote on features you need, and track our progress in real-time.
            Your feedback directly influences our development priorities.
          </motion.p>

          {/* Roadmap Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto"
          >
            {ROADMAP_STATS.map((stat, idx) => {
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

        {/* Status Legend - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-12"
        >
          <div className="flex flex-wrap items-center justify-center gap-4">
            {Object.entries(STATUS_CONFIG).map(([key, config]) => {
              const Icon = config.icon;
              const count = ROADMAP_ITEMS.filter(item => item.status === key).length;
              return (
                <Card key={key} className="px-6 py-3 hover:shadow-[var(--shadow-md)] transition-shadow">
                  <div className="flex items-center gap-3">
                    <Icon className="size-5 text-intent-primary" />
                    <span className="text-body-sm font-medium text-text-primary">{config.label}</span>
                    <Badge variant={config.variant}>{count}</Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        </motion.div>

        {/* Roadmap Timeline */}
        <div className="space-y-12">
          {QUARTERS.map((quarter, qIndex) => {
            const itemsInQuarter = ROADMAP_ITEMS.filter(item => item.quarter === quarter);
            if (itemsInQuarter.length === 0) return null;

            return (
              <motion.div
                key={quarter}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + qIndex * 0.1 }}
              >
                {/* Quarter Header */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex items-center gap-3 px-4 py-2 bg-surface-raised rounded-lg">
                    <Calendar className="size-5 text-intent-primary" />
                    <h2 className="text-h2">{quarter}</h2>
                  </div>
                  <div className="h-px flex-1 bg-border-subtle" />
                </div>

                {/* Items Grid - Enhanced */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {itemsInQuarter.map((item, index) => {
                    const Icon = item.icon;
                    const statusConfig = STATUS_CONFIG[item.status];
                    const categoryConfig = CATEGORY_CONFIG[item.category];
                    const isInProgress = item.status === 'in_progress';

                    return (
                      <Card key={index} className={`p-6 hover:shadow-[var(--shadow-lg)] transition-all cursor-pointer group ${
                        isInProgress ? 'border-2 border-intent-success bg-gradient-to-b from-surface-raised to-surface-canvas' : 'hover:border-intent-primary border-2 border-transparent'
                      }`}>
                        <div className="flex items-start justify-between mb-4">
                          <div className={`size-14 rounded-xl flex items-center justify-center ${
                            isInProgress
                              ? 'bg-gradient-to-br from-intent-success to-brand-accent shadow-[0_8px_16px_rgba(34,197,94,0.3)]'
                              : 'bg-gradient-to-br from-intent-primary to-brand-accent group-hover:shadow-[0_8px_16px_rgba(59,130,246,0.3)] transition-shadow'
                          }`}>
                            <Icon className="size-7 text-white" />
                          </div>
                          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                        </div>

                        <h3 className="text-h4 mb-2 group-hover:text-intent-primary transition-colors">{item.title}</h3>
                        <p className="text-body-sm text-text-secondary mb-4 line-clamp-3">{item.description}</p>

                        <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
                          <Badge variant="default">{categoryConfig.label}</Badge>
                          <button className="flex items-center gap-2 px-4 py-2 bg-surface-sunken hover:bg-intent-primary hover:text-white rounded-lg transition-all group-hover:shadow-[var(--shadow-sm)]">
                            <Vote className="size-4" />
                            <span className="text-caption font-bold">{item.votes}</span>
                          </button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Feature Request CTA - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="mt-20"
        >
          <Card className="p-16 bg-gradient-to-br from-brand-primary via-intent-primary to-brand-accent text-white text-center relative overflow-hidden">
            <div className="absolute top-0 end-0 w-64 h-64 bg-white opacity-5 rounded-full -me-32 -mt-32" />
            <div className="absolute bottom-0 start-0 w-48 h-48 bg-white opacity-5 rounded-full -ms-24 -mb-24" />

            <div className="relative z-10">
              <div className="size-20 bg-white bg-opacity-20 rounded-2xl mx-auto mb-6 flex items-center justify-center backdrop-blur-sm">
                <Lightbulb className="size-10 text-white" />
              </div>
              <h2 className="text-h1 mb-4">Have a Feature Request?</h2>
              <p className="text-base opacity-95 mb-8 max-w-2xl mx-auto leading-relaxed">
                Your ideas drive our innovation! Submit feature requests, vote on proposals from other users,
                and participate in shaping the future of CivitasOne Suite. Every voice matters.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button variant="secondary" size="lg" className="min-w-[200px]">
                  Submit Feature Request
                </Button>
                <Button variant="secondary" size="lg" className="min-w-[200px]">
                  Browse Requests
                </Button>
              </div>
              <p className="text-caption opacity-80 mt-6">
                Join 2,100+ votes • Most requested features ship within 6 months
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Disclaimer - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mt-12"
        >
          <Card className="p-8 bg-gradient-to-r from-intent-warning-bg to-intent-info-bg border-2 border-intent-warning">
            <div className="flex items-start gap-4">
              <div className="size-10 bg-intent-warning rounded-lg flex items-center justify-center flex-shrink-0">
                <MessageSquare className="size-5 text-white" />
              </div>
              <div>
                <h4 className="text-h4 mb-2">Roadmap Disclaimer</h4>
                <p className="text-body-sm text-text-primary">
                  <strong>Important:</strong> This roadmap reflects our current development priorities and is subject to change based on customer feedback,
                  market conditions, and technical considerations. Timeline estimates are approximate and do not constitute contractual commitments.
                  For enterprise customers with specific feature requirements, please contact your dedicated account manager to discuss custom development timelines and SLAs.
                </p>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
