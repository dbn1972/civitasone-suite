import { useState, useRef } from 'react';
import { Card, Button, Badge, Input } from '../../components/ui';
import {
  Zap,
  CheckCircle,
  Cloud,
  Database,
  Mail,
  Calendar,
  FileText,
  DollarSign,
  Users,
  Smartphone,
  Lock,
  BarChart3,
  Package,
  Truck,
  Building2,
  CreditCard,
  MessageSquare,
  Phone,
  Webhook,
  Code,
  Globe,
  Sparkles,
  Search,
  ArrowRight,
  Play,
} from 'lucide-react';
import { motion, useScroll, useTransform, useInView } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

interface Integration {
  name: string;
  category: string;
  icon: typeof Zap;
  description: string;
  features: string[];
  status: 'available' | 'coming_soon' | 'enterprise_only';
  logo?: string;
}

const INTEGRATIONS: Integration[] = [
  {
    name: 'GST Portal',
    category: 'Government',
    icon: Building2,
    description: 'Direct integration with Government GST portal for automatic return filing, reconciliation, and compliance.',
    features: ['Auto GSTR filing', 'E-invoice generation', 'Real-time validation', 'ITC reconciliation'],
    status: 'available',
  },
  {
    name: 'Income Tax e-Filing',
    category: 'Government',
    icon: FileText,
    description: 'Seamless TDS filing, Form 16 generation, and income tax return preparation integrated with TRACES portal.',
    features: ['TDS return filing', 'Form 16/16A generation', 'Challan verification', 'Annual returns'],
    status: 'available',
  },
  {
    name: 'EPFO Portal',
    category: 'Government',
    icon: Users,
    description: 'Automated PF and pension contributions, ECR filing, and member management through unified portal.',
    features: ['ECR auto-filing', 'UAN management', 'Contribution tracking', 'Settlement processing'],
    status: 'available',
  },
  {
    name: 'ESIC Portal',
    category: 'Government',
    icon: Users,
    description: 'Direct ESI contribution filing, employee registration, and medical benefit tracking.',
    features: ['Auto ESI filing', 'Employee registration', 'IP tracking', 'Challan generation'],
    status: 'available',
  },
  {
    name: 'AWS Cloud',
    category: 'Infrastructure',
    icon: Cloud,
    description: 'Deploy and scale on AWS infrastructure with automated backups, monitoring, and disaster recovery.',
    features: ['Auto-scaling', 'S3 storage', 'CloudWatch monitoring', 'Multi-region DR'],
    status: 'available',
  },
  {
    name: 'Microsoft Azure',
    category: 'Infrastructure',
    icon: Cloud,
    description: 'Enterprise-grade deployment on Azure with Active Directory integration and hybrid cloud support.',
    features: ['Azure AD sync', 'Blob storage', 'Hybrid connectivity', 'Compliance templates'],
    status: 'available',
  },
  {
    name: 'Google Workspace',
    category: 'Productivity',
    icon: Mail,
    description: 'Seamless integration with Gmail, Calendar, Drive, and Meet for unified productivity.',
    features: ['Email sync', 'Calendar integration', 'Drive storage', 'SSO with Google'],
    status: 'available',
  },
  {
    name: 'Microsoft 365',
    category: 'Productivity',
    icon: Calendar,
    description: 'Full integration with Outlook, Teams, OneDrive, and SharePoint for enterprise collaboration.',
    features: ['Outlook sync', 'Teams integration', 'OneDrive storage', 'Azure AD SSO'],
    status: 'available',
  },
  {
    name: 'WhatsApp Business',
    category: 'Communication',
    icon: MessageSquare,
    description: 'Send notifications, alerts, and customer communications through WhatsApp Business API.',
    features: ['Message templates', 'Delivery tracking', 'Rich media', 'Automated responses'],
    status: 'available',
  },
  {
    name: 'SMS Gateway',
    category: 'Communication',
    icon: Phone,
    description: 'Multi-provider SMS integration for OTPs, alerts, and notifications with delivery tracking.',
    features: ['Multi-gateway support', 'Delivery reports', 'Template management', 'DND compliance'],
    status: 'available',
  },
  {
    name: 'Payment Gateways',
    category: 'Finance',
    icon: CreditCard,
    description: 'Integrate with Razorpay, PayU, CCAvenue, and government payment gateways for collections.',
    features: ['Multiple gateways', 'Reconciliation', 'Refund handling', 'BharatQR support'],
    status: 'available',
  },
  {
    name: 'Banking APIs',
    category: 'Finance',
    icon: DollarSign,
    description: 'Direct bank account integration for payment tracking, reconciliation, and virtual accounts.',
    features: ['Account aggregation', 'Payment verification', 'Virtual accounts', 'Auto-reconciliation'],
    status: 'available',
  },
  {
    name: 'Tally ERP',
    category: 'Accounting',
    icon: Database,
    description: 'Bi-directional sync with Tally for accounting data migration and real-time reconciliation.',
    features: ['Data import/export', 'Voucher sync', 'Ledger mapping', 'GST reconciliation'],
    status: 'available',
  },
  {
    name: 'Biometric Devices',
    category: 'Hardware',
    icon: Smartphone,
    description: 'Connect fingerprint scanners, face recognition, and RFID attendance systems.',
    features: ['Multiple device support', 'Real-time sync', 'Offline mode', 'Vendor agnostic'],
    status: 'available',
  },
  {
    name: 'Aadhaar eKYC',
    category: 'Identity',
    icon: Lock,
    description: 'UIDAI-authorized Aadhaar verification and eKYC for employee onboarding and vendor verification.',
    features: ['OTP-based auth', 'Biometric verification', 'XML download', 'Offline eKYC'],
    status: 'available',
  },
  {
    name: 'DigiLocker',
    category: 'Identity',
    icon: FileText,
    description: 'Fetch verified documents directly from DigiLocker for paperless onboarding.',
    features: ['Document fetching', 'XML verification', 'Aadhaar linking', 'Issued documents'],
    status: 'available',
  },
  {
    name: 'REST API',
    category: 'Developer',
    icon: Code,
    description: 'Comprehensive REST APIs with OAuth 2.0 for custom integrations and third-party apps.',
    features: ['Full API coverage', 'OAuth 2.0', 'Rate limiting', 'Webhook support'],
    status: 'available',
  },
  {
    name: 'Webhooks',
    category: 'Developer',
    icon: Webhook,
    description: 'Real-time event notifications for builds, custom workflows, and external system sync.',
    features: ['Event subscriptions', 'Retry logic', 'Signature verification', 'Custom payloads'],
    status: 'available',
  },
  {
    name: 'Power BI',
    category: 'Analytics',
    icon: BarChart3,
    description: 'Export data to Power BI for advanced analytics, custom dashboards, and executive reporting.',
    features: ['Direct query', 'Scheduled refresh', 'Row-level security', 'Custom visuals'],
    status: 'coming_soon',
  },
  {
    name: 'SAP Integration',
    category: 'ERP',
    icon: Package,
    description: 'Enterprise integration with SAP S/4HANA for large organizations with hybrid deployments.',
    features: ['Master data sync', 'Transaction posting', 'Idoc support', 'RFC connectivity'],
    status: 'enterprise_only',
  },
];

const CATEGORIES = ['All', 'Government', 'Infrastructure', 'Productivity', 'Communication', 'Finance', 'Accounting', 'Hardware', 'Identity', 'Developer', 'Analytics', 'ERP'];

const FEATURED_INTEGRATIONS = [
  { name: 'GST Portal', users: '450+', icon: Building2, description: 'Auto-filing & reconciliation' },
  { name: 'EPFO', users: '380+', icon: Users, description: 'PF contributions & ECR' },
  { name: 'AWS Cloud', users: '320+', icon: Cloud, description: 'Scalable infrastructure' },
  { name: 'WhatsApp Business', users: '290+', icon: MessageSquare, description: 'Automated notifications' },
];

const INTEGRATION_STATS = [
  { value: '50+', label: 'Integrations Available' },
  { value: '99.9%', label: 'Integration Uptime' },
  { value: '<5 min', label: 'Avg Setup Time' },
  { value: '24/7', label: 'Support Available' },
];

export function Integrations() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroY = useTransform(scrollY, [0, 300], [0, -50]);

  const filteredIntegrations = INTEGRATIONS.filter(i => {
    const matchesCategory = selectedCategory === 'All' || i.category === selectedCategory;
    const matchesSearch = searchQuery === '' ||
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getStatusConfig = (status: Integration['status']) => {
    const configs = {
      available: { label: 'Available', variant: 'success' as const },
      coming_soon: { label: 'Coming Soon', variant: 'info' as const },
      enterprise_only: { label: 'Enterprise Only', variant: 'default' as const },
    };
    return configs[status];
  };

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section with Parallax */}
        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-intent-primary-bg to-intent-success-bg rounded-full mb-6"
          >
            <Sparkles className="size-5 text-intent-primary" />
            <span className="text-body-sm font-medium text-intent-primary">50+ Pre-Built Integrations</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            Connect Everything in Your Tech Stack
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-text-secondary max-w-3xl mx-auto mb-8"
          >
            CivitasOne integrates seamlessly with government portals, productivity tools, payment gateways,
            and enterprise systems. Built for Indian compliance with global standards.
          </motion.p>

          {/* Stats Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto mb-8"
          >
            {INTEGRATION_STATS.map((stat, idx) => (
              <Card key={idx} className="p-4 text-center hover:shadow-[var(--shadow-md)] transition-shadow">
                <div className="text-h2 text-intent-primary mb-1">{stat.value}</div>
                <div className="text-caption text-text-muted">{stat.label}</div>
              </Card>
            ))}
          </motion.div>

          {/* Search Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="max-w-2xl mx-auto"
          >
            <div className="relative">
              <Search className="absolute start-4 top-1/2 -translate-y-1/2 size-5 text-text-muted pointer-events-none" />
              <Input
                type="text"
                placeholder="Search integrations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-12 pe-4 py-4"
              />
            </div>
          </motion.div>
        </motion.div>

        {/* Featured Integrations */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mb-16"
        >
          <h2 className="text-h2 mb-6 text-center">Most Popular Integrations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURED_INTEGRATIONS.map((integration, idx) => {
              const Icon = integration.icon;
              return (
                <Card key={idx} className="p-6 text-center hover:shadow-[var(--shadow-lg)] transition-all hover:border-intent-primary border-2 border-transparent cursor-pointer">
                  <div className="size-14 bg-gradient-to-br from-intent-primary to-brand-accent rounded-xl mx-auto mb-4 flex items-center justify-center shadow-[0_8px_16px_rgba(59,130,246,0.2)]">
                    <Icon className="size-7 text-white" />
                  </div>
                  <h3 className="text-h4 mb-2">{integration.name}</h3>
                  <p className="text-caption text-text-muted mb-3">{integration.description}</p>
                  <Badge variant="success">{integration.users} organizations</Badge>
                </Card>
              );
            })}
          </div>
        </motion.div>

        {/* Category Filter - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mb-12"
        >
          <h3 className="text-h3 mb-4 text-center">Browse by Category</h3>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {CATEGORIES.map((category) => {
              const count = category === 'All' ? INTEGRATIONS.length : INTEGRATIONS.filter(i => i.category === category).length;
              return (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-6 py-3 rounded-xl text-body-sm font-semibold whitespace-nowrap transition-all ${
                    selectedCategory === category
                      ? 'bg-gradient-to-r from-intent-primary to-brand-accent text-white shadow-[0_4px_12px_rgba(59,130,246,0.3)]'
                      : 'bg-surface-raised text-text-secondary hover:bg-surface-sunken hover:shadow-[var(--shadow-sm)]'
                  }`}
                >
                  {category}
                  <span className={`ms-2 text-caption ${
                    selectedCategory === category ? 'opacity-90' : 'opacity-60'
                  }`}>
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Integrations Grid - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mb-16"
        >
          {filteredIntegrations.length === 0 ? (
            <Card className="p-12 text-center">
              <Search className="size-12 text-text-muted mx-auto mb-4" />
              <h3 className="text-h3 mb-2">No integrations found</h3>
              <p className="text-body-sm text-text-secondary">
                Try a different search term or category
              </p>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-h3">
                  {filteredIntegrations.length} Integration{filteredIntegrations.length !== 1 ? 's' : ''}
                  {selectedCategory !== 'All' && ` in ${selectedCategory}`}
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredIntegrations.map((integration, index) => {
                  const Icon = integration.icon;
                  const statusConfig = getStatusConfig(integration.status);

                  return (
                    <motion.div
                      key={integration.name}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(0.8 + index * 0.03, 1.5) }}
                    >
                      <Card className="p-6 h-full hover:shadow-[var(--shadow-lg)] transition-all hover:border-intent-primary border-2 border-transparent cursor-pointer group">
                        <div className="flex items-start justify-between mb-4">
                          <div className="size-14 bg-gradient-to-br from-brand-primary to-brand-accent rounded-xl flex items-center justify-center group-hover:shadow-[0_8px_16px_rgba(59,130,246,0.3)] transition-shadow">
                            <Icon className="size-7 text-white" />
                          </div>
                          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                        </div>
                        <h3 className="text-h4 mb-1">{integration.name}</h3>
                        <p className="text-caption text-intent-primary font-medium mb-3">{integration.category}</p>
                        <p className="text-body-sm text-text-secondary mb-4 line-clamp-2">{integration.description}</p>
                        <div className="space-y-2 mb-4">
                          {integration.features.slice(0, 3).map((feature, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              <CheckCircle className="size-4 text-intent-success flex-shrink-0 mt-0.5" />
                              <span className="text-caption text-text-primary">{feature}</span>
                            </div>
                          ))}
                          {integration.features.length > 3 && (
                            <p className="text-caption text-intent-primary font-medium ms-6">
                              +{integration.features.length - 3} more features
                            </p>
                          )}
                        </div>
                        <div className="pt-4 border-t border-border-subtle flex items-center justify-between">
                          <span className="text-caption text-text-muted">Learn more</span>
                          <ArrowRight className="size-4 text-intent-primary group-hover:translate-x-1 transition-transform" />
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </motion.div>

        {/* Developer Section - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
          className="mb-16"
        >
          <Card className="p-12 bg-gradient-to-br from-surface-raised to-surface-sunken border-2 border-border-subtle">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="size-16 bg-gradient-to-br from-brand-primary to-brand-accent rounded-2xl mb-6 flex items-center justify-center shadow-[0_8px_16px_rgba(59,130,246,0.3)]">
                  <Code className="size-8 text-white" />
                </div>
                <h2 className="text-h1 mb-4">Build Custom Integrations</h2>
                <p className="text-base text-text-secondary mb-6">
                  Use our comprehensive REST API and webhook system to build custom integrations.
                  Complete documentation, SDKs in multiple languages, and a sandbox environment for testing.
                </p>
                <div className="space-y-3 mb-6">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="size-5 text-intent-success flex-shrink-0 mt-0.5" />
                    <span className="text-body-sm text-text-primary">
                      <strong>RESTful API</strong> - Full CRUD operations on all resources
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="size-5 text-intent-success flex-shrink-0 mt-0.5" />
                    <span className="text-body-sm text-text-primary">
                      <strong>Real-time Webhooks</strong> - Event-driven notifications
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="size-5 text-intent-success flex-shrink-0 mt-0.5" />
                    <span className="text-body-sm text-text-primary">
                      <strong>SDKs & Libraries</strong> - Python, JavaScript, Java, PHP
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="size-5 text-intent-success flex-shrink-0 mt-0.5" />
                    <span className="text-body-sm text-text-primary">
                      <strong>Sandbox Environment</strong> - Test without affecting production
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Button variant="primary" size="lg" onClick={() => navigate('/resources/api')}>
                    View API Docs
                  </Button>
                  <Button variant="secondary" size="lg">
                    Get API Key
                  </Button>
                </div>
              </div>

              <div className="bg-surface-canvas rounded-xl p-6 border-2 border-border-subtle">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex gap-1.5">
                    <div className="size-3 rounded-full bg-intent-danger" />
                    <div className="size-3 rounded-full bg-intent-warning" />
                    <div className="size-3 rounded-full bg-intent-success" />
                  </div>
                  <span className="text-caption text-text-muted ms-2">example.js</span>
                </div>
                <pre className="text-caption text-text-primary font-mono overflow-x-auto">
                  <code>{`// Initialize CivitasOne API
const civitas = require('@civitasone/sdk');

civitas.auth({
  apiKey: process.env.CIVITAS_API_KEY
});

// Create a new invoice
const invoice = await civitas.invoices.create({
  customer: 'ORG-12345',
  items: [{
    description: 'Consulting Services',
    amount: 50000,
    gst: 18
  }],
  dueDate: '2026-06-30'
});

console.log(\`Invoice created: \${invoice.id}\`);`}</code>
                </pre>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Video Tutorial Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1 }}
          className="mb-16"
        >
          <div className="text-center mb-8">
            <h2 className="text-h1 mb-3">Integration Tutorials</h2>
            <p className="text-base text-text-secondary max-w-2xl mx-auto">
              Step-by-step video guides to help you integrate faster.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: 'Setting up GST Portal Integration', duration: '8:32' },
              { title: 'WhatsApp Business API Setup', duration: '12:45' },
              { title: 'Building Custom Webhooks', duration: '15:20' },
            ].map((video, idx) => (
              <Card key={idx} className="p-6 hover:shadow-[var(--shadow-lg)] transition-shadow cursor-pointer group">
                <div className="aspect-video bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg mb-4 flex items-center justify-center group-hover:shadow-[0_8px_16px_rgba(59,130,246,0.3)] transition-shadow">
                  <div className="size-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center backdrop-blur-sm">
                    <Play className="size-8 text-white ms-1" />
                  </div>
                </div>
                <h4 className="text-h4 mb-2">{video.title}</h4>
                <p className="text-caption text-text-muted">{video.duration}</p>
              </Card>
            ))}
          </div>
        </motion.div>

        {/* CTA Section - Premium */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
        >
          <Card className="p-16 bg-gradient-to-br from-brand-primary via-intent-primary to-brand-accent text-white text-center relative overflow-hidden">
            <div className="absolute top-0 end-0 w-64 h-64 bg-white opacity-5 rounded-full -me-32 -mt-32" />
            <div className="absolute bottom-0 start-0 w-48 h-48 bg-white opacity-5 rounded-full -ms-24 -mb-24" />

            <div className="relative z-10">
              <div className="size-20 bg-white bg-opacity-20 rounded-2xl mx-auto mb-6 flex items-center justify-center backdrop-blur-sm">
                <Webhook className="size-10 text-white" />
              </div>
              <h2 className="text-h1 mb-4">Need a Custom Integration?</h2>
              <p className="text-base opacity-95 mb-8 max-w-2xl mx-auto leading-relaxed">
                Our integration specialists can build custom integrations for your specific government or enterprise requirements.
                From legacy system migrations to bespoke API connections, we've got you covered.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button variant="secondary" size="lg" className="min-w-[200px]" onClick={() => navigate('/company/contact')}>
                  Contact Integration Team
                </Button>
                <Button variant="secondary" size="lg" className="min-w-[200px]">
                  Schedule Consultation
                </Button>
              </div>
              <p className="text-caption opacity-80 mt-6">
                Professional services available • 30-day implementation guarantee • Dedicated support
              </p>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
