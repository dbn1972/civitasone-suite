import { Card, Button, Badge } from '../../components/ui';
import { Check, X, Building2, Users, Globe, Crown } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

interface Edition {
  name: string;
  icon: typeof Building2;
  tagline: string;
  price: string;
  userRange: string;
  highlighted?: boolean;
}

const EDITIONS: Edition[] = [
  {
    name: 'Small Office',
    icon: Building2,
    tagline: 'For small teams',
    price: '₹599/user/month',
    userRange: '10-50 users',
  },
  {
    name: 'PSU',
    icon: Users,
    tagline: 'For public sector',
    price: '₹899/user/month',
    userRange: '50-500 users',
    highlighted: true,
  },
  {
    name: 'Government',
    icon: Globe,
    tagline: 'For departments',
    price: '₹1,299/user/month',
    userRange: '100+ users',
  },
  {
    name: 'Enterprise',
    icon: Crown,
    tagline: 'Custom solutions',
    price: 'Custom pricing',
    userRange: '1000+ users',
  },
];

interface FeatureRow {
  category?: string;
  name: string;
  smallOffice: boolean | string;
  psu: boolean | string;
  government: boolean | string;
  enterprise: boolean | string;
}

const FEATURE_COMPARISON: FeatureRow[] = [
  { category: 'Core Modules' },
  { name: 'Finance & Accounting', smallOffice: true, psu: true, government: true, enterprise: true },
  { name: 'HR & Payroll', smallOffice: true, psu: true, government: true, enterprise: true },
  { name: 'Inventory Management', smallOffice: true, psu: true, government: true, enterprise: true },
  { name: 'Procurement', smallOffice: 'Basic', psu: true, government: true, enterprise: true },
  { name: 'Asset Management', smallOffice: false, psu: true, government: true, enterprise: true },
  { name: 'Project Management', smallOffice: false, psu: true, government: true, enterprise: true },
  { name: 'CRM & Sales', smallOffice: 'Add-on', psu: 'Add-on', government: true, enterprise: true },
  { name: 'Helpdesk', smallOffice: 'Add-on', psu: 'Add-on', government: true, enterprise: true },

  { category: 'Deployment & Infrastructure' },
  { name: 'Cloud Deployment (AWS/Azure)', smallOffice: true, psu: true, government: true, enterprise: true },
  { name: 'On-Premises Deployment', smallOffice: false, psu: 'Add-on', government: true, enterprise: true },
  { name: 'Hybrid Deployment', smallOffice: false, psu: false, government: true, enterprise: true },
  { name: 'Multi-Region DR', smallOffice: false, psu: 'Add-on', government: true, enterprise: true },
  { name: 'Data Storage', smallOffice: '50 GB', psu: '500 GB', government: 'Unlimited', enterprise: 'Unlimited' },

  { category: 'Compliance & Security' },
  { name: 'GST & TDS Compliance', smallOffice: true, psu: true, government: true, enterprise: true },
  { name: 'Statutory Reporting', smallOffice: 'Basic', psu: true, government: true, enterprise: true },
  { name: 'GFR Compliance', smallOffice: false, psu: false, government: true, enterprise: true },
  { name: 'e-Office Integration', smallOffice: false, psu: false, government: true, enterprise: true },
  { name: 'RTI Compliance Module', smallOffice: false, psu: false, government: true, enterprise: true },
  { name: 'Audit Trail', smallOffice: 'Basic', psu: 'Advanced', government: 'Complete', enterprise: 'Blockchain' },

  { category: 'Analytics & Reporting' },
  { name: 'Pre-built Reports', smallOffice: true, psu: true, government: true, enterprise: true },
  { name: 'Custom Report Builder', smallOffice: 'Limited', psu: true, government: true, enterprise: true },
  { name: 'Executive Dashboards', smallOffice: false, psu: true, government: true, enterprise: true },
  { name: 'AI-Powered Insights', smallOffice: false, psu: false, government: 'Coming Soon', enterprise: true },
  { name: 'Advanced Analytics', smallOffice: false, psu: true, government: true, enterprise: true },

  { category: 'Integrations' },
  { name: 'Standard Integrations', smallOffice: '10 included', psu: 'Unlimited', government: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'Government Portal Integration', smallOffice: 'Basic', psu: true, government: true, enterprise: true },
  { name: 'Banking APIs', smallOffice: false, psu: true, government: true, enterprise: true },
  { name: 'PFMS Integration', smallOffice: false, psu: false, government: true, enterprise: true },
  { name: 'Custom Integrations', smallOffice: false, psu: false, government: 'Limited', enterprise: 'Unlimited' },
  { name: 'API Access', smallOffice: 'Limited', psu: 'Full', government: 'Full', enterprise: 'Full + Custom' },

  { category: 'Support & SLA' },
  { name: 'Email Support', smallOffice: true, psu: true, government: true, enterprise: true },
  { name: 'Phone Support', smallOffice: false, psu: true, government: true, enterprise: true },
  { name: 'Priority Support', smallOffice: false, psu: false, government: true, enterprise: true },
  { name: 'Dedicated Account Manager', smallOffice: false, psu: true, government: true, enterprise: 'Team' },
  { name: 'On-site Support', smallOffice: false, psu: 'Add-on', government: true, enterprise: true },
  { name: 'SLA Guarantee', smallOffice: false, psu: '99.5%', government: '99.9%', enterprise: '99.95%' },
];

export function CompareEditions() {
  const navigate = useNavigate();

  const renderFeatureValue = (value: boolean | string) => {
    if (value === true) {
      return <Check className="size-5 text-intent-success mx-auto" />;
    } else if (value === false) {
      return <X className="size-5 text-text-muted mx-auto" />;
    } else {
      return <span className="text-body-sm text-text-primary">{value}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-display mb-4"
          >
            Compare Editions
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-base text-text-secondary max-w-3xl mx-auto"
          >
            Find the perfect edition for your organization. All editions include core modules,
            regular updates, and mobile apps. Upgrade or downgrade anytime.
          </motion.p>
        </div>

        {/* Edition Headers */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8"
        >
          <div className="grid grid-cols-5 gap-4">
            <div className="col-span-1"></div>
            {EDITIONS.map((edition, index) => {
              const Icon = edition.icon;
              return (
                <Card
                  key={index}
                  className={`p-6 text-center ${edition.highlighted ? 'border-2 border-intent-primary shadow-[var(--shadow-lg)]' : ''}`}
                >
                  {edition.highlighted && (
                    <Badge variant="primary" className="mb-3">Most Popular</Badge>
                  )}
                  <div className="size-12 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg mx-auto mb-4 flex items-center justify-center">
                    <Icon className="size-6 text-white" />
                  </div>
                  <h3 className="text-h3 mb-1">{edition.name}</h3>
                  <p className="text-caption text-text-muted mb-3">{edition.tagline}</p>
                  <p className="text-h4 mb-1">{edition.price}</p>
                  <p className="text-caption text-text-muted">{edition.userRange}</p>
                </Card>
              );
            })}
          </div>
        </motion.div>

        {/* Comparison Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <tbody>
                  {FEATURE_COMPARISON.map((row, index) => {
                    if (row.category) {
                      return (
                        <tr key={index} className="bg-surface-sunken">
                          <td colSpan={5} className="p-4">
                            <h4 className="text-h4">{row.category}</h4>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr
                        key={index}
                        className="border-b border-border-subtle hover:bg-surface-sunken transition-colors"
                      >
                        <td className="p-4 text-body-sm text-text-primary min-w-[250px]">{row.name}</td>
                        <td className="p-4 text-center">{renderFeatureValue(row.smallOffice)}</td>
                        <td className="p-4 text-center">{renderFeatureValue(row.psu)}</td>
                        <td className="p-4 text-center">{renderFeatureValue(row.government)}</td>
                        <td className="p-4 text-center">{renderFeatureValue(row.enterprise)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>

        {/* CTA Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-12"
        >
          <Card className="p-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white text-center">
            <h2 className="text-h1 mb-4">Still Have Questions?</h2>
            <p className="text-base opacity-90 mb-6 max-w-2xl mx-auto">
              Our team can help you choose the right edition and provide a personalized demo
              showing features relevant to your organization.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button variant="secondary" size="lg">
                Schedule Consultation
              </Button>
              <Button variant="secondary" size="lg" onClick={() => navigate('/contact')}>
                Contact Sales
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
