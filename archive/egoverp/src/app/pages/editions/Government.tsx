import { Card, Button, Badge } from '../../components/ui';
import {
  Building2,
  CheckCircle,
  Shield,
  FileText,
  Globe,
  Users,
  Lock,
  Database,
  Cloud,
  Award,
  TrendingUp,
  Clock,
  Phone,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const FEATURES = [
  {
    icon: Shield,
    title: 'Government-Grade Security',
    description: 'MeitY empanelled, STQC certified, meets all government cybersecurity frameworks and data protection requirements.',
  },
  {
    icon: FileText,
    title: 'Complete Compliance',
    description: 'GFR, PFMS integration, e-Office compatibility, RTI compliance, and all statutory reporting built-in.',
  },
  {
    icon: Database,
    title: 'Data Sovereignty',
    description: 'On-premises deployment options. Data stays within your department with complete control and compliance.',
  },
  {
    icon: Globe,
    title: 'Multilingual Support',
    description: 'Native support for all 22 official Indian languages plus English. Unicode compliant and RTL support.',
  },
  {
    icon: Users,
    title: 'Unlimited Scale',
    description: 'From 100 to 10,000+ users across multiple locations. Scales to departmental and state-level requirements.',
  },
  {
    icon: Phone,
    title: '24/7 Dedicated Support',
    description: 'Priority support with dedicated team, on-site assistance, and 99.9% uptime SLA guarantee.',
  },
];

const GOVERNMENT_MODULES = [
  { name: 'E-Government Readiness', features: ['e-Office integration', 'Digital file movement', 'e-Signing (DSC/eSign)', 'Parliamentary questions module'] },
  { name: 'Public Finance Management', features: ['Budget allocation & control', 'PFMS integration', 'Fund management', 'Sanctions & re-appropriation'] },
  { name: 'Citizen Services', features: ['RTI compliance', 'Grievance redressal', 'Public disclosure', 'Service delivery tracking'] },
  { name: 'Audit & Compliance', features: ['CAG audit trails', 'Internal audit module', 'Compliance dashboard', 'Performance audit support'] },
  { name: 'HR & Establishment', features: ['Service book management', '7th Pay Commission', 'Pension calculations', 'Transfer & posting orders'] },
  { name: 'Asset & Infrastructure', features: ['Government asset register', 'CPWD integration', 'Maintenance management', 'Land & building records'] },
];

const DEPLOYMENT_OPTIONS = [
  {
    name: 'NIC Cloud',
    description: 'Deploy on National Informatics Centre cloud infrastructure',
    icon: Cloud,
  },
  {
    name: 'Department Data Center',
    description: 'On-premises installation in your own data center',
    icon: Database,
  },
  {
    name: 'State SDC',
    description: 'State Data Centre hosting for state government departments',
    icon: Building2,
  },
  {
    name: 'Hybrid Model',
    description: 'Cloud for non-sensitive, on-premises for classified data',
    icon: Zap,
  },
];

const IMPLEMENTATIONS = [
  {
    department: 'Ministry of Social Justice',
    scope: '5,000+ users across 35 states',
    modules: 'Scheme management, beneficiary tracking, fund disbursement',
  },
  {
    department: 'State Transport Department',
    scope: '2,500 users in 75 RTOs',
    modules: 'Vehicle registration, license management, tax collection',
  },
  {
    department: 'Municipal Corporation',
    scope: '1,200 users, 85 wards',
    modules: 'Property tax, water billing, birth/death registration',
  },
];

export function Government() {
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-intent-danger-bg rounded-full mb-6"
          >
            <Globe className="size-5 text-intent-danger" />
            <span className="text-body-sm font-medium text-intent-danger">Government Edition</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            Digital India Ready ERP
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-text-secondary max-w-3xl mx-auto mb-8"
          >
            Purpose-built for government departments, agencies, and public institutions. Fully compliant with
            GFR, RTI Act, e-Office standards, and all government frameworks. Trusted by central and state departments.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-center gap-4"
          >
            <Button variant="primary" size="lg">
              Request Proposal
            </Button>
            <Button variant="secondary" size="lg">
              Download Compliance Document
            </Button>
          </motion.div>
        </div>

        {/* Certifications */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-16"
        >
          <Card className="p-8 bg-gradient-to-br from-intent-success-bg to-surface-raised">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
              <div>
                <div className="size-16 bg-white rounded-full mx-auto mb-3 flex items-center justify-center">
                  <Award className="size-8 text-intent-success" />
                </div>
                <p className="text-caption font-semibold text-text-primary">MeitY Empanelled</p>
              </div>
              <div>
                <div className="size-16 bg-white rounded-full mx-auto mb-3 flex items-center justify-center">
                  <Shield className="size-8 text-intent-success" />
                </div>
                <p className="text-caption font-semibold text-text-primary">STQC Certified</p>
              </div>
              <div>
                <div className="size-16 bg-white rounded-full mx-auto mb-3 flex items-center justify-center">
                  <Lock className="size-8 text-intent-success" />
                </div>
                <p className="text-caption font-semibold text-text-primary">ISO 27001</p>
              </div>
              <div>
                <div className="size-16 bg-white rounded-full mx-auto mb-3 flex items-center justify-center">
                  <FileText className="size-8 text-intent-success" />
                </div>
                <p className="text-caption font-semibold text-text-primary">GFR Compliant</p>
              </div>
              <div>
                <div className="size-16 bg-white rounded-full mx-auto mb-3 flex items-center justify-center">
                  <Globe className="size-8 text-intent-success" />
                </div>
                <p className="text-caption font-semibold text-text-primary">GIGW Standards</p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Features Grid */}
        <div className="mb-16">
          <div className="text-center mb-12">
            <h2 className="text-h1 mb-4">Built for Government Excellence</h2>
            <p className="text-base text-text-secondary max-w-3xl mx-auto">
              Every feature designed to meet the unique requirements of government operations and public service delivery.
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
                    <div className="size-12 bg-intent-danger-bg rounded-lg flex items-center justify-center mb-4">
                      <Icon className="size-6 text-intent-danger" />
                    </div>
                    <h3 className="text-h4 mb-2">{feature.title}</h3>
                    <p className="text-body-sm text-text-secondary">{feature.description}</p>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Government Modules */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="mb-16"
        >
          <Card className="p-8">
            <h2 className="text-h2 mb-2">Government-Specific Modules</h2>
            <p className="text-body-sm text-text-secondary mb-6">
              Specialized modules designed for government workflows, compliance, and citizen service delivery.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {GOVERNMENT_MODULES.map((module, index) => (
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

        {/* Deployment Options */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mb-16"
        >
          <div className="text-center mb-8">
            <h2 className="text-h2 mb-2">Flexible Deployment Options</h2>
            <p className="text-body-sm text-text-secondary">
              Choose the deployment model that meets your security, compliance, and operational requirements.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {DEPLOYMENT_OPTIONS.map((option, index) => {
              const Icon = option.icon;
              return (
                <Card key={index} className="p-6 text-center hover:shadow-[var(--shadow-lg)] transition-shadow">
                  <div className="size-12 bg-intent-primary-bg rounded-lg mx-auto mb-4 flex items-center justify-center">
                    <Icon className="size-6 text-intent-primary" />
                  </div>
                  <h4 className="text-h4 mb-2">{option.name}</h4>
                  <p className="text-caption text-text-muted">{option.description}</p>
                </Card>
              );
            })}
          </div>
        </motion.div>

        {/* Implementations */}
        <div className="mb-16">
          <div className="text-center mb-12">
            <h2 className="text-h1 mb-4">Serving Government Departments Nationwide</h2>
            <p className="text-base text-text-secondary max-w-3xl mx-auto">
              Trusted by central ministries, state departments, and local bodies for mission-critical operations.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {IMPLEMENTATIONS.map((impl, index) => (
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
                  <h3 className="text-h4 mb-3">{impl.department}</h3>
                  <p className="text-caption text-text-muted mb-2">{impl.scope}</p>
                  <p className="text-body-sm text-text-primary">{impl.modules}</p>
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
            <h2 className="text-h1 mb-4">Ready to Digitally Transform Your Department?</h2>
            <p className="text-base opacity-90 mb-6 max-w-2xl mx-auto">
              Our government specialists will work with you to understand your requirements and provide
              a customized solution that meets all compliance and operational needs.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button variant="secondary" size="lg">
                Request Detailed Proposal
              </Button>
              <Button variant="secondary" size="lg">
                Schedule Presentation
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
