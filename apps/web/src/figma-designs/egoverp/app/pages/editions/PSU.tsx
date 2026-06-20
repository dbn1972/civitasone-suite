import { Card, Button, Badge } from '../../components/ui';
import {
  Building2,
  CheckCircle,
  Users,
  Shield,
  FileText,
  TrendingUp,
  Zap,
  BarChart3,
  Cloud,
  Database,
  Lock,
  Award,
  Globe,
  Settings,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const FEATURES = [
  {
    icon: Users,
    title: 'Scalable for 50-500 Users',
    description: 'Grows with your organization. Add users, modules, and capacity as your PSU expands.',
  },
  {
    icon: Shield,
    title: 'Compliance First',
    description: 'Built-in support for DPE guidelines, CVC norms, RTI Act, and government audit requirements.',
  },
  {
    icon: BarChart3,
    title: 'Advanced Analytics',
    description: 'Executive dashboards, custom reports, and AI-powered insights for data-driven decisions.',
  },
  {
    icon: Cloud,
    title: 'Flexible Deployment',
    description: 'Cloud, on-premises, or hybrid. Meets data sovereignty and security requirements.',
  },
  {
    icon: Lock,
    title: 'Enterprise Security',
    description: 'ISO 27001, SOC 2, and government-grade encryption. Complete audit trails and access controls.',
  },
  {
    icon: Award,
    title: 'Dedicated Support',
    description: '99.5% SLA guarantee with dedicated account manager and priority support channels.',
  },
];

const MODULES = [
  { name: 'Finance & Accounting', features: ['Fund-based accounting', 'Budget management', 'Cash flow forecasting', 'Multi-entity consolidation'] },
  { name: 'HR & Payroll', features: ['CTC structure', 'Statutory compliance (PF/ESI/PT)', 'Performance management', 'Training & development'] },
  { name: 'Procurement', features: ['e-Procurement', 'Vendor management', 'GeM integration', 'Three-way matching'] },
  { name: 'Asset Management', features: ['Fixed asset register', 'Depreciation tracking', 'Maintenance schedules', 'Asset transfer workflows'] },
  { name: 'Projects', features: ['Project accounting', 'Resource allocation', 'Milestone tracking', 'Budget vs actual'] },
  { name: 'Advanced Reporting', features: ['MIS reports', 'Board presentations', 'Statutory returns', 'Custom dashboards'] },
];

const COMPLIANCE_FEATURES = [
  'DPE Guidelines compliance',
  'CVC norms for procurement',
  'RTI Act compliance',
  'Govt audit trail requirements',
  'CPWD rate integration',
  'Performance metrics (ONORC)',
  'Budget allocation and tracking',
  'Parliamentary questions support',
];

const CASE_STUDIES = [
  {
    name: 'BHEL Regional Unit',
    industry: 'Manufacturing PSU',
    users: 250,
    result: '40% reduction in procurement cycle time, full GeM compliance',
  },
  {
    name: 'State Electricity Board',
    industry: 'Power Distribution',
    users: 380,
    result: 'Centralized billing for 500K+ consumers, 99.8% collection efficiency',
  },
  {
    name: 'Port Trust Authority',
    industry: 'Infrastructure',
    users: 150,
    result: 'Integrated cargo tracking, customs clearance, and revenue management',
  },
];

export function PSU() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-intent-primary-bg rounded-full mb-6"
          >
            <Building2 className="size-5 text-intent-primary" />
            <span className="text-body-sm font-medium text-intent-primary">PSU Edition</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            Built for Public Sector Excellence
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-text-secondary max-w-3xl mx-auto mb-8"
          >
            Comprehensive ERP solution designed for PSUs, public sector undertakings, and large enterprises.
            Full compliance with DPE guidelines, government norms, and audit requirements.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-center gap-4"
          >
            <Button variant="primary" size="lg">
              Request Detailed Demo
            </Button>
            <Button variant="secondary" size="lg" onClick={() => navigate('/pricing')}>
              View Pricing
            </Button>
          </motion.div>
        </div>

        {/* Trust Badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-16"
        >
          <Card className="p-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              <div>
                <p className="text-h2 mb-1">50+</p>
                <p className="text-caption text-text-muted">PSUs Using</p>
              </div>
              <div>
                <p className="text-h2 mb-1">99.5%</p>
                <p className="text-caption text-text-muted">Uptime SLA</p>
              </div>
              <div>
                <p className="text-h2 mb-1">100%</p>
                <p className="text-caption text-text-muted">DPE Compliant</p>
              </div>
              <div>
                <p className="text-h2 mb-1">24/7</p>
                <p className="text-caption text-text-muted">Priority Support</p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Features Grid */}
        <div className="mb-16">
          <div className="text-center mb-12">
            <h2 className="text-h1 mb-4">Enterprise-Grade Capabilities</h2>
            <p className="text-base text-text-secondary max-w-3xl mx-auto">
              Everything your PSU needs to operate efficiently while meeting all regulatory and compliance requirements.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + index * 0.05 }}
                >
                  <Card className="p-6 h-full hover:shadow-[var(--shadow-lg)] transition-shadow">
                    <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center mb-4">
                      <Icon className="size-6 text-intent-primary" />
                    </div>
                    <h3 className="text-h4 mb-2">{feature.title}</h3>
                    <p className="text-body-sm text-text-secondary">{feature.description}</p>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Modules Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="mb-16"
        >
          <Card className="p-8">
            <h2 className="text-h2 mb-2">Comprehensive Module Suite</h2>
            <p className="text-body-sm text-text-secondary mb-6">
              All modules included in PSU Edition. No additional costs for essential functionality.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {MODULES.map((module, index) => (
                <div key={index} className="p-4 bg-surface-sunken rounded-lg">
                  <h4 className="text-h4 mb-3">{module.name}</h4>
                  <ul className="space-y-2">
                    {module.features.map((feature, fIdx) => (
                      <li key={fIdx} className="flex items-start gap-2">
                        <CheckCircle className="size-4 text-intent-success flex-shrink-0 mt-0.5" />
                        <span className="text-caption text-text-primary">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        {/* Compliance Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mb-16"
        >
          <Card className="p-8 bg-gradient-to-br from-intent-primary-bg to-surface-raised">
            <div className="flex items-start gap-6">
              <div className="size-16 bg-gradient-to-br from-brand-primary to-brand-accent rounded-2xl flex items-center justify-center flex-shrink-0">
                <FileText className="size-8 text-white" />
              </div>
              <div className="flex-1">
                <h2 className="text-h2 mb-4">Government Compliance Built-In</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {COMPLIANCE_FEATURES.map((feature, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <CheckCircle className="size-5 text-intent-primary flex-shrink-0 mt-0.5" />
                      <span className="text-body-sm text-text-primary">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Case Studies */}
        <div className="mb-16">
          <div className="text-center mb-12">
            <h2 className="text-h1 mb-4">Trusted by Leading PSUs</h2>
            <p className="text-base text-text-secondary max-w-3xl mx-auto">
              PSUs across sectors have transformed their operations with CivitasOne.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {CASE_STUDIES.map((study, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.0 + index * 0.1 }}
              >
                <Card className="p-6 h-full">
                  <div className="size-12 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center mb-4">
                    <Building2 className="size-6 text-white" />
                  </div>
                  <h3 className="text-h4 mb-2">{study.name}</h3>
                  <Badge variant="info" className="mb-3">{study.industry}</Badge>
                  <p className="text-caption text-text-muted mb-3">{study.users} users</p>
                  <p className="text-body-sm text-text-primary">{study.result}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>

        {/* CTA Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3 }}
        >
          <Card className="p-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white text-center">
            <h2 className="text-h1 mb-4">Ready to Transform Your PSU?</h2>
            <p className="text-base opacity-90 mb-6 max-w-2xl mx-auto">
              Schedule a personalized demo with our PSU specialists. We'll show you how CivitasOne
              can streamline operations while ensuring full regulatory compliance.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button variant="secondary" size="lg">
                Request Demo
              </Button>
              <Button variant="secondary" size="lg">
                Download Brochure
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
