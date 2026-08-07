import React, { useState } from 'react';
import { Card, Button, Badge } from '../../components/ui';
import {
  Shield,
  Cloud,
  Users,
  BarChart3,
  Lock,
  Zap,
  Globe,
  CheckCircle,
  Server,
  RefreshCw,
  FileText,
  Smartphone,
  ArrowRight,
  Play,
  Award,
  TrendingUp,
  Database,
  Workflow,
  Bell,
  Key,
  MessageSquare,
  Calendar,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const FEATURE_CATEGORIES = [
  {
    id: 'security',
    name: 'Security & Compliance',
    icon: Shield,
    color: 'intent-success',
    features: [
      {
        title: 'Enterprise-Grade Security',
        description: 'Bank-level encryption with AES-256 at rest and TLS 1.3 in transit. Multi-factor authentication, IP whitelisting, and session management.',
        icon: Lock,
        metrics: ['ISO 27001', 'SOC 2', 'STQC Certified'],
      },
      {
        title: 'Complete Audit Trails',
        description: 'Immutable audit logs with blockchain storage option. Track every user action, data change, and system event with timestamps.',
        icon: FileText,
        metrics: ['CAG Compliant', 'Tamper-Proof', '10-Year Retention'],
      },
      {
        title: 'Role-Based Access Control',
        description: 'Granular permissions with department, role, and user-level controls. Separation of duties and maker-checker workflows.',
        icon: Key,
        metrics: ['100+ Roles', 'Field-Level', 'Time-Based'],
      },
      {
        title: 'Government Compliance',
        description: 'Built-in compliance with IT Act 2000, GFR, RTI Act, and all Indian statutory requirements. Auto-updated for regulatory changes.',
        icon: Award,
        metrics: ['GFR 2017', 'RTI Ready', 'e-Office Compatible'],
      },
    ],
  },
  {
    id: 'platform',
    name: 'Platform & Infrastructure',
    icon: Cloud,
    color: 'intent-info',
    features: [
      {
        title: 'Flexible Deployment',
        description: 'Deploy on cloud (AWS/Azure), on-premises, or hybrid. Complete data sovereignty with geo-fencing and residency controls.',
        icon: Server,
        metrics: ['Multi-Cloud', 'On-Premise', 'Hybrid'],
      },
      {
        title: 'Scalable Architecture',
        description: 'Microservices architecture handles 10 to 100,000+ users seamlessly. Auto-scaling, load balancing, and horizontal scaling.',
        icon: TrendingUp,
        metrics: ['Auto-Scale', '99.9% Uptime', 'Zero Downtime'],
      },
      {
        title: 'High Performance',
        description: 'Sub-second response times even with millions of records. Optimized queries, caching layers, and CDN integration.',
        icon: Zap,
        metrics: ['<500ms', '10M+ Records', 'Real-Time'],
      },
      {
        title: 'Disaster Recovery',
        description: 'Multi-region backup with automatic failover. RPO < 1 hour, RTO < 4 hours. Tested quarterly with full documentation.',
        icon: RefreshCw,
        metrics: ['RPO: 1hr', 'RTO: 4hr', 'Geo-Replicated'],
      },
    ],
  },
  {
    id: 'productivity',
    name: 'Productivity & Automation',
    icon: Workflow,
    color: 'intent-warning',
    features: [
      {
        title: 'Workflow Automation',
        description: 'Visual workflow builder with drag-and-drop. Create approval chains, notifications, and conditional routing without code.',
        icon: Workflow,
        metrics: ['No-Code', 'Unlimited Flows', 'Multi-Level'],
      },
      {
        title: 'Smart Notifications',
        description: 'Multi-channel alerts via email, SMS, WhatsApp, and in-app. Intelligent routing based on priority, role, and availability.',
        icon: Bell,
        metrics: ['5 Channels', 'Real-Time', 'Smart Routing'],
      },
      {
        title: 'Mobile-First Design',
        description: 'Native iOS and Android apps with offline mode. Responsive web interface optimized for tablets and smartphones.',
        icon: Smartphone,
        metrics: ['iOS & Android', 'Offline Mode', 'Biometric Auth'],
      },
      {
        title: 'Collaboration Tools',
        description: 'Built-in chat, comments, and file sharing. Real-time collaboration on documents, budgets, and reports.',
        icon: MessageSquare,
        metrics: ['Team Chat', 'File Sharing', '@Mentions'],
      },
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics & Reporting',
    icon: BarChart3,
    color: 'intent-primary',
    features: [
      {
        title: 'Advanced Analytics',
        description: 'AI-powered insights with predictive analytics. Anomaly detection, trend analysis, and forecasting built-in.',
        icon: BarChart3,
        metrics: ['ML-Powered', 'Predictive', 'Real-Time'],
      },
      {
        title: 'Custom Report Builder',
        description: 'Drag-and-drop report builder with 100+ pre-built templates. Export to Excel, PDF, or schedule automated delivery.',
        icon: FileText,
        metrics: ['100+ Templates', 'Scheduled', 'Multi-Format'],
      },
      {
        title: 'Real-Time Dashboards',
        description: 'Executive dashboards with live KPIs. Customizable widgets, drill-down capabilities, and mobile-optimized views.',
        icon: TrendingUp,
        metrics: ['Live Data', 'Drill-Down', 'Mobile Ready'],
      },
      {
        title: 'Data Export & API',
        description: 'Full API access with comprehensive documentation. Export data in any format for external analytics and integrations.',
        icon: Database,
        metrics: ['REST API', 'GraphQL', 'Webhooks'],
      },
    ],
  },
  {
    id: 'integration',
    name: 'Integration & Extensibility',
    icon: Globe,
    color: 'intent-danger',
    features: [
      {
        title: 'Multi-Language Support',
        description: 'Native support for all 22 official Indian languages plus English. RTL support for Arabic and Urdu. Unicode compliant.',
        icon: Globe,
        metrics: ['22 Languages', 'RTL Support', 'Auto-Translate'],
      },
      {
        title: '50+ Pre-Built Integrations',
        description: 'Connect with GST portal, PFMS, e-Office, payment gateways, banks, and productivity tools. Custom integrations available.',
        icon: Zap,
        metrics: ['Government', 'Banking', 'Productivity'],
      },
      {
        title: 'Comprehensive API',
        description: 'REST and GraphQL APIs with OAuth 2.0. Webhooks for real-time events. SDKs for Python, JavaScript, and Java.',
        icon: Database,
        metrics: ['REST', 'GraphQL', 'Webhooks'],
      },
      {
        title: 'Continuous Updates',
        description: 'Quarterly feature releases with monthly security patches. Automatic compliance updates for regulatory changes. Zero downtime.',
        icon: RefreshCw,
        metrics: ['Quarterly', 'Auto-Update', 'Zero Downtime'],
      },
    ],
  },
];

const COMPARISON_MATRIX = [
  { feature: 'Implementation Time', civitas: '4-12 weeks', legacy: '6-18 months' },
  { feature: 'User Training', civitas: '2-5 days', legacy: '2-4 weeks' },
  { feature: 'Cost of Ownership', civitas: '40% lower', legacy: 'Baseline' },
  { feature: 'Upgrade Frequency', civitas: 'Quarterly', legacy: 'Annually' },
  { feature: 'Mobile Support', civitas: 'Native apps', legacy: 'Web only' },
  { feature: 'Compliance Updates', civitas: 'Automatic', legacy: 'Manual' },
];

const CERTIFICATIONS = [
  { name: 'ISO 27001', description: 'Information Security', verified: true },
  { name: 'SOC 2 Type II', description: 'Security & Availability', verified: true },
  { name: 'MeitY Empanelled', description: 'Government Approved', verified: true },
  { name: 'STQC Certified', description: 'Quality Standards', verified: true },
  { name: 'GIGW Compliant', description: 'Web Guidelines', verified: true },
  { name: 'WCAG 2.2 AA', description: 'Accessibility', verified: true },
];

export function Features() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('security');
  const [selectedFeature, setSelectedFeature] = useState(0);

  const currentCategory = FEATURE_CATEGORIES.find((cat) => cat.id === activeCategory) || FEATURE_CATEGORIES[0];

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      {/* Hero Section */}
      <section className="py-20 md:py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/5 via-brand-accent/5 to-transparent" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center mb-16">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 px-4 py-2 bg-intent-success-bg border border-intent-success rounded-full mb-8">
              <Award className="size-4 text-intent-success" />
              <span className="text-caption font-medium text-intent-success">Enterprise-Grade Platform • Trusted by 500+ Organizations</span>
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-display mb-6">
              Powerful Features for <span className="bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent">Modern Government</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-base text-text-secondary max-w-3xl mx-auto mb-10">
              CivitasOne Suite combines enterprise-grade capabilities with government-specific compliance, security, and audit requirements. Built for the unique needs of Indian public sector and large organizations.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex items-center justify-center gap-4">
              <Button size="lg" leadingIcon={<Play />}>Watch Demo</Button>
              <Button variant="secondary" size="lg" onClick={() => navigate('/pricing')}>View Pricing</Button>
            </motion.div>
          </div>

          {/* Certifications Bar */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Card className="p-6">
              <p className="text-caption text-text-muted text-center mb-4">Certified & Compliant</p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {CERTIFICATIONS.map((cert, idx) => (
                  <div key={idx} className="text-center">
                    <div className="size-12 bg-intent-success-bg rounded-lg mx-auto mb-2 flex items-center justify-center">
                      <CheckCircle className="size-6 text-intent-success" />
                    </div>
                    <p className="text-caption font-semibold text-text-primary mb-1">{cert.name}</p>
                    <p className="text-caption text-text-muted">{cert.description}</p>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Feature Categories Navigation */}
      <section className="bg-surface-raised py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 overflow-x-auto pb-4">
            {FEATURE_CATEGORIES.map((category) => {
              const Icon = category.icon;
              const isActive = category.id === activeCategory;
              return (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={`flex items-center gap-3 px-6 py-3 rounded-lg transition-all whitespace-nowrap ${
                    isActive
                      ? `bg-${category.color} text-white shadow-lg`
                      : 'bg-surface-raised hover:bg-surface-sunken text-text-secondary'
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="text-body-sm font-medium">{category.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Feature Details */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {currentCategory.features.map((feature, idx) => {
                  const Icon = feature.icon;
                  return (
                    <Card key={idx} className="p-8 hover:shadow-[var(--shadow-lg)] transition-shadow group">
                      <div className={`size-14 bg-${currentCategory.color}-bg rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                        <Icon className={`size-7 text-${currentCategory.color}`} />
                      </div>
                      <h3 className="text-h3 mb-3">{feature.title}</h3>
                      <p className="text-body-sm text-text-secondary mb-4">{feature.description}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {feature.metrics.map((metric, mIdx) => (
                          <Badge key={mIdx} variant="default">{metric}</Badge>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* Comparison Matrix */}
      <section className="py-20 bg-surface-raised">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-h1 mb-4">CivitasOne vs Legacy Systems</h2>
            <p className="text-base text-text-secondary">See how we compare to traditional ERP solutions</p>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Feature</th>
                  <th className="text-center p-4 text-caption font-semibold text-intent-success uppercase">CivitasOne Suite</th>
                  <th className="text-center p-4 text-caption font-semibold text-text-secondary uppercase">Legacy Systems</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_MATRIX.map((row, idx) => (
                  <tr key={idx} className="border-b border-border-subtle hover:bg-surface-sunken transition-colors">
                    <td className="p-4 text-body-sm font-medium text-text-primary">{row.feature}</td>
                    <td className="p-4 text-center">
                      <Badge variant="success">{row.civitas}</Badge>
                    </td>
                    <td className="p-4 text-center text-body-sm text-text-muted">{row.legacy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="p-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white text-center">
            <h2 className="text-h1 mb-4">Ready to Transform Your Organization?</h2>
            <p className="text-base opacity-90 mb-8 max-w-2xl mx-auto">
              Join hundreds of government departments, PSUs, and enterprises across India who trust CivitasOne for their mission-critical operations.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button variant="secondary" size="lg" onClick={() => navigate('/company/contact')}>Request a Demo</Button>
              <Button variant="secondary" size="lg" onClick={() => navigate('/pricing')}>View Pricing</Button>
            </div>
          </Card>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
