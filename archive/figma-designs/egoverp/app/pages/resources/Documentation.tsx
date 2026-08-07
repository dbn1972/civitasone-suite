import { Card, Button, Input } from '../../components/ui';
import {
  BookOpen,
  Search,
  FileText,
  Users,
  DollarSign,
  Package,
  Building2,
  BarChart3,
  Zap,
  Shield,
  Code,
  ArrowRight,
  Download,
  Play,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';
import { useState } from 'react';

const DOCUMENTATION_SECTIONS = [
  {
    title: 'Getting Started',
    icon: Zap,
    description: 'Quick start guides and tutorials',
    articles: [
      { name: 'Installation & Setup', time: '10 min read' },
      { name: 'First-Time Configuration', time: '15 min read' },
      { name: 'User Management Basics', time: '8 min read' },
      { name: 'Navigation & Interface', time: '12 min read' },
    ],
  },
  {
    title: 'Finance & Accounting',
    icon: DollarSign,
    description: 'Complete finance module documentation',
    articles: [
      { name: 'Chart of Accounts Setup', time: '20 min read' },
      { name: 'Voucher Entry & Posting', time: '15 min read' },
      { name: 'GST Configuration & Filing', time: '25 min read' },
      { name: 'Financial Reports', time: '18 min read' },
    ],
  },
  {
    title: 'HR & Payroll',
    icon: Users,
    description: 'Human resource management guides',
    articles: [
      { name: 'Employee Onboarding', time: '12 min read' },
      { name: 'Attendance & Leave Management', time: '16 min read' },
      { name: 'Payroll Processing', time: '22 min read' },
      { name: 'PF, ESI & TDS Configuration', time: '30 min read' },
    ],
  },
  {
    title: 'Procurement',
    icon: Package,
    description: 'Purchase and vendor management',
    articles: [
      { name: 'Purchase Order Creation', time: '14 min read' },
      { name: 'Vendor Management', time: '10 min read' },
      { name: 'GeM Integration', time: '20 min read' },
      { name: 'Approval Workflows', time: '18 min read' },
    ],
  },
  {
    title: 'Asset Management',
    icon: Building2,
    description: 'Fixed asset tracking and maintenance',
    articles: [
      { name: 'Asset Registration', time: '12 min read' },
      { name: 'Depreciation Calculation', time: '16 min read' },
      { name: 'Maintenance Scheduling', time: '14 min read' },
      { name: 'Asset Reports', time: '10 min read' },
    ],
  },
  {
    title: 'Reports & Analytics',
    icon: BarChart3,
    description: 'Business intelligence and reporting',
    articles: [
      { name: 'Pre-built Reports', time: '15 min read' },
      { name: 'Custom Report Builder', time: '25 min read' },
      { name: 'Dashboard Configuration', time: '18 min read' },
      { name: 'Data Export Options', time: '10 min read' },
    ],
  },
  {
    title: 'Security & Compliance',
    icon: Shield,
    description: 'Security features and compliance',
    articles: [
      { name: 'User Roles & Permissions', time: '20 min read' },
      { name: 'Audit Trail Configuration', time: '15 min read' },
      { name: 'Data Backup & Recovery', time: '18 min read' },
      { name: 'Compliance Checklists', time: '22 min read' },
    ],
  },
  {
    title: 'API & Integrations',
    icon: Code,
    description: 'Developer documentation',
    articles: [
      { name: 'REST API Overview', time: '12 min read' },
      { name: 'Authentication & Authorization', time: '16 min read' },
      { name: 'Webhook Configuration', time: '14 min read' },
      { name: 'Integration Examples', time: '25 min read' },
    ],
  },
];

const POPULAR_ARTICLES = [
  { title: 'How to configure GST rates and filing', category: 'Finance', views: '12.5K' },
  { title: 'Setting up payroll for 7th Pay Commission', category: 'HR', views: '9.8K' },
  { title: 'GeM integration step-by-step guide', category: 'Procurement', views: '8.2K' },
  { title: 'Understanding role-based access control', category: 'Security', views: '7.4K' },
  { title: 'Creating custom financial reports', category: 'Reports', views: '6.9K' },
];

const VIDEO_TUTORIALS = [
  { title: 'Quick Start: Your First Invoice', duration: '5:32' },
  { title: 'Processing Monthly Payroll', duration: '8:45' },
  { title: 'Creating Purchase Orders', duration: '6:18' },
  { title: 'Generating MIS Reports', duration: '7:22' },
];

export function Documentation() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-intent-info-bg rounded-full mb-6"
          >
            <BookOpen className="size-5 text-intent-info" />
            <span className="text-body-sm font-medium text-intent-info">Complete Documentation</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            CivitasOne Documentation
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-text-secondary max-w-3xl mx-auto mb-8"
          >
            Comprehensive guides, tutorials, and reference documentation to help you make the most of CivitasOne Suite.
          </motion.p>

          {/* Search Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="max-w-2xl mx-auto"
          >
            <div className="relative">
              <Search className="absolute start-4 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                type="text"
                placeholder="Search documentation..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-12 py-4 text-base"
              />
            </div>
          </motion.div>
        </div>

        {/* Documentation Sections Grid */}
        <div className="mb-16">
          <h2 className="text-h2 mb-6">Browse by Module</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {DOCUMENTATION_SECTIONS.map((section, index) => {
              const Icon = section.icon;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + index * 0.05 }}
                >
                  <Card className="p-6 h-full hover:shadow-[var(--shadow-lg)] transition-shadow cursor-pointer">
                    <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center mb-4">
                      <Icon className="size-6 text-intent-primary" />
                    </div>
                    <h3 className="text-h4 mb-2">{section.title}</h3>
                    <p className="text-caption text-text-muted mb-4">{section.description}</p>
                    <ul className="space-y-2">
                      {section.articles.map((article, aIdx) => (
                        <li key={aIdx} className="flex items-start justify-between gap-2">
                          <span className="text-body-sm text-text-secondary hover:text-intent-primary cursor-pointer flex-1">
                            {article.name}
                          </span>
                          <span className="text-caption text-text-muted whitespace-nowrap">{article.time}</span>
                        </li>
                      ))}
                    </ul>
                    <Button variant="secondary" size="sm" className="w-full mt-4" trailingIcon={<ArrowRight />}>
                      View All
                    </Button>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Two Column Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-16">
          {/* Popular Articles */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="lg:col-span-2"
          >
            <Card className="p-8">
              <h2 className="text-h2 mb-6">Popular Articles</h2>
              <div className="space-y-4">
                {POPULAR_ARTICLES.map((article, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-surface-sunken rounded-lg hover:bg-surface-raised transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-4 flex-1">
                      <FileText className="size-5 text-intent-primary flex-shrink-0 mt-1" />
                      <div>
                        <h4 className="text-h4 mb-1">{article.title}</h4>
                        <p className="text-caption text-text-muted">{article.category}</p>
                      </div>
                    </div>
                    <div className="text-end">
                      <p className="text-caption text-text-muted">{article.views} views</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Video Tutorials */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9 }}
          >
            <Card className="p-6">
              <h3 className="text-h3 mb-4">Video Tutorials</h3>
              <div className="space-y-3">
                {VIDEO_TUTORIALS.map((video, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-3 bg-surface-sunken rounded-lg hover:bg-surface-raised transition-colors cursor-pointer"
                  >
                    <div className="size-10 bg-intent-danger rounded-lg flex items-center justify-center flex-shrink-0">
                      <Play className="size-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-body-sm font-medium text-text-primary mb-1">{video.title}</p>
                      <p className="text-caption text-text-muted">{video.duration}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="md" className="w-full mt-4">
                View All Videos
              </Button>
            </Card>
          </motion.div>
        </div>

        {/* Download Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
        >
          <Card className="p-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white text-center">
            <div className="max-w-3xl mx-auto">
              <div className="size-16 bg-white bg-opacity-20 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                <Download className="size-8 text-white" />
              </div>
              <h2 className="text-h1 mb-4">Need Offline Access?</h2>
              <p className="text-base opacity-90 mb-6">
                Download complete documentation as PDF for offline reference and training purposes.
              </p>
              <div className="flex items-center justify-center gap-4">
                <Button variant="secondary" size="lg">
                  Download Full Documentation
                </Button>
                <Button variant="secondary" size="lg">
                  Download Quick Reference
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
