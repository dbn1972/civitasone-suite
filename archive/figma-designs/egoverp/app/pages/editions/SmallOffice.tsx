import { Card, Button, Badge } from '../../components/ui';
import {
  Building2,
  CheckCircle,
  Users,
  DollarSign,
  Zap,
  Shield,
  Cloud,
  Smartphone,
  BarChart3,
  FileText,
  Package,
  Calendar,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const FEATURES = [
  {
    icon: Users,
    title: 'Perfect for 10-50 Users',
    description: 'Affordable pricing designed for small teams without compromising on essential features.',
  },
  {
    icon: DollarSign,
    title: 'Cost-Effective',
    description: 'Starting at ₹599/user/month with all core modules included. No hidden fees or surprise charges.',
  },
  {
    icon: Zap,
    title: 'Quick Setup',
    description: 'Get started in hours, not weeks. Self-service onboarding with guided setup wizards.',
  },
  {
    icon: Cloud,
    title: 'Cloud-First',
    description: 'Fully managed cloud deployment on AWS or Azure. No IT infrastructure needed.',
  },
  {
    icon: Shield,
    title: 'Enterprise Security',
    description: 'Bank-grade encryption, role-based access control, and automatic backups included.',
  },
  {
    icon: Smartphone,
    title: 'Mobile Apps',
    description: 'Native iOS and Android apps for on-the-go access to critical business functions.',
  },
];

const INCLUDED_MODULES = [
  { name: 'Finance & Accounting', description: 'Ledgers, invoicing, expense tracking, GST compliance' },
  { name: 'HR & Payroll', description: 'Employee records, attendance, leave management, payslips' },
  { name: 'Inventory Management', description: 'Stock tracking, purchase orders, supplier management' },
  { name: 'Basic Reporting', description: 'Pre-built reports for finance, HR, and inventory' },
  { name: 'Document Storage', description: '50 GB cloud storage for invoices, contracts, and records' },
  { name: 'Email Support', description: 'Dedicated support team via email (24-hour response time)' },
];

const TESTIMONIALS = [
  {
    quote: "We switched from Excel spreadsheets to CivitasOne and haven't looked back. The time saved in payroll processing alone paid for the subscription in the first month.",
    author: 'Priya Sharma',
    role: 'Owner, Design Studio',
    company: 'Mumbai',
  },
  {
    quote: 'As a CA firm serving small businesses, I recommend CivitasOne to all my clients. The GST compliance features are accurate and save hours of manual work.',
    author: 'Rajesh Patel',
    role: 'Chartered Accountant',
    company: 'Ahmedabad',
  },
  {
    quote: 'The mobile app is a game-changer for our field sales team. They can mark attendance and submit expense claims from anywhere.',
    author: 'Amit Kumar',
    role: 'Sales Manager',
    company: 'Delhi',
  },
];

export function SmallOffice() {
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-intent-success-bg rounded-full mb-6"
          >
            <Building2 className="size-5 text-intent-success" />
            <span className="text-body-sm font-medium text-intent-success">Small Office Edition</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            Enterprise Software for Small Teams
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-text-secondary max-w-3xl mx-auto mb-8"
          >
            Get the power of enterprise ERP at a price small businesses can afford. Finance, HR, and inventory
            management in one integrated platform. Perfect for startups, SMEs, and growing companies.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-center gap-4"
          >
            <Button variant="primary" size="lg" leadingIcon={<Zap />}>
              Start 30-Day Free Trial
            </Button>
            <Button variant="secondary" size="lg">
              Schedule Demo
            </Button>
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-caption text-text-muted mt-4"
          >
            No credit card required • Setup in minutes • Cancel anytime
          </motion.p>
        </div>

        {/* Pricing Highlight */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mb-16"
        >
          <Card className="p-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white text-center">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-h1 mb-4">Simple, Transparent Pricing</h2>
              <div className="flex items-baseline justify-center gap-2 mb-4">
                <span className="text-display">₹599</span>
                <span className="text-base opacity-90">/user/month</span>
              </div>
              <p className="text-base opacity-90 mb-6">
                Billed annually • 10-50 users • All core modules included
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 rounded-lg">
                <TrendingUp className="size-5" />
                <span className="text-body-sm">Save 20% with annual billing</span>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Features Grid */}
        <div className="mb-16">
          <div className="text-center mb-12">
            <h2 className="text-h1 mb-4">Why Small Businesses Choose Us</h2>
            <p className="text-base text-text-secondary max-w-3xl mx-auto">
              Everything you need to run your business efficiently, without the complexity and cost of traditional ERP systems.
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
                  transition={{ delay: 0.6 + index * 0.05 }}
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

        {/* Included Modules */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mb-16"
        >
          <Card className="p-8">
            <h2 className="text-h2 mb-2">What's Included</h2>
            <p className="text-body-sm text-text-secondary mb-6">
              All essential modules and features included in every Small Office plan. No add-ons required.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {INCLUDED_MODULES.map((module, index) => (
                <div key={index} className="flex items-start gap-3 p-4 bg-surface-sunken rounded-lg">
                  <CheckCircle className="size-5 text-intent-success flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-h4 mb-1">{module.name}</h4>
                    <p className="text-caption text-text-muted">{module.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        {/* Testimonials */}
        <div className="mb-16">
          <div className="text-center mb-12">
            <h2 className="text-h1 mb-4">Loved by Small Businesses</h2>
            <p className="text-base text-text-secondary max-w-3xl mx-auto">
              Join hundreds of small businesses across India who have transformed their operations with CivitasOne.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((testimonial, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.0 + index * 0.1 }}
              >
                <Card className="p-6 h-full">
                  <p className="text-body-sm text-text-primary mb-4 italic">"{testimonial.quote}"</p>
                  <div className="flex items-start gap-3">
                    <div className="size-10 bg-gradient-to-br from-brand-primary to-brand-accent rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
                      {testimonial.author.charAt(0)}
                    </div>
                    <div>
                      <p className="text-body-sm font-semibold text-text-primary">{testimonial.author}</p>
                      <p className="text-caption text-text-muted">{testimonial.role}</p>
                      <p className="text-caption text-text-muted">{testimonial.company}</p>
                    </div>
                  </div>
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
          <Card className="p-12 bg-surface-sunken text-center">
            <div className="max-w-3xl mx-auto">
              <div className="size-16 bg-gradient-to-br from-brand-primary to-brand-accent rounded-2xl mx-auto mb-6 flex items-center justify-center">
                <Clock className="size-8 text-white" />
              </div>
              <h2 className="text-h1 mb-4">Ready to Get Started?</h2>
              <p className="text-base text-text-secondary mb-6">
                Start your 30-day free trial today. No credit card required, no setup fees.
                Experience the full power of CivitasOne with zero commitment.
              </p>
              <div className="flex items-center justify-center gap-4">
                <Button variant="primary" size="lg">
                  Start Free Trial
                </Button>
                <Button variant="secondary" size="lg" onClick={() => navigate('/pricing')}>
                  View Pricing
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
