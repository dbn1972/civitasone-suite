import { Card, Button, Badge } from '../../components/ui';
import { Check, X, HelpCircle, Building2, Users, Globe, Crown, Sparkles, TrendingUp, Shield, Zap, Star } from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useNavigate } from 'react-router';
import { useState, useRef } from 'react';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

interface PricingTier {
  name: string;
  tagline: string;
  icon: typeof Building2;
  price: {
    annual: number;
    perUser: boolean;
  };
  minUsers: number;
  maxUsers: number | null;
  features: {
    name: string;
    included: boolean | string;
    tooltip?: string;
  }[];
  highlighted?: boolean;
  cta: string;
}

const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Small Office',
    tagline: 'Perfect for small teams and startups',
    icon: Building2,
    price: { annual: 599, perUser: true },
    minUsers: 10,
    maxUsers: 50,
    features: [
      { name: 'Core modules (Finance, HR, Inventory)', included: true },
      { name: 'Cloud deployment (AWS/Azure)', included: true },
      { name: 'Email & phone support', included: true },
      { name: 'Mobile apps (iOS & Android)', included: true },
      { name: 'Basic reporting', included: true },
      { name: 'GST & TDS compliance', included: true },
      { name: 'Standard integrations', included: '10 included' },
      { name: 'Data storage', included: '50 GB' },
      { name: 'API access', included: 'Limited' },
      { name: 'Custom workflows', included: false },
      { name: 'Advanced analytics', included: false },
      { name: 'On-premises deployment', included: false },
      { name: 'Dedicated account manager', included: false },
      { name: 'SLA guarantee', included: false },
    ],
    cta: 'Start Free Trial',
  },
  {
    name: 'PSU Edition',
    tagline: 'For public sector undertakings and enterprises',
    icon: Users,
    price: { annual: 899, perUser: true },
    minUsers: 50,
    maxUsers: 500,
    features: [
      { name: 'Core modules (Finance, HR, Inventory)', included: true },
      { name: 'Cloud deployment (AWS/Azure)', included: true },
      { name: 'Email & phone support', included: true },
      { name: 'Mobile apps (iOS & Android)', included: true },
      { name: 'Basic reporting', included: true },
      { name: 'GST & TDS compliance', included: true },
      { name: 'Standard integrations', included: 'Unlimited' },
      { name: 'Data storage', included: '500 GB' },
      { name: 'API access', included: 'Full' },
      { name: 'Custom workflows', included: true },
      { name: 'Advanced analytics', included: true },
      { name: 'On-premises deployment', included: 'Add-on' },
      { name: 'Dedicated account manager', included: true },
      { name: 'SLA guarantee', included: '99.5%' },
    ],
    highlighted: true,
    cta: 'Request Demo',
  },
  {
    name: 'Government',
    tagline: 'Tailored for government departments and agencies',
    icon: Globe,
    price: { annual: 1299, perUser: true },
    minUsers: 100,
    maxUsers: null,
    features: [
      { name: 'Core modules (Finance, HR, Inventory)', included: true },
      { name: 'Cloud deployment (AWS/Azure)', included: true },
      { name: 'Email & phone support', included: 'Priority 24/7' },
      { name: 'Mobile apps (iOS & Android)', included: true },
      { name: 'Basic reporting', included: true },
      { name: 'GST & TDS compliance', included: true },
      { name: 'Standard integrations', included: 'Unlimited' },
      { name: 'Data storage', included: 'Unlimited' },
      { name: 'API access', included: 'Full' },
      { name: 'Custom workflows', included: true },
      { name: 'Advanced analytics', included: true },
      { name: 'On-premises deployment', included: true },
      { name: 'Dedicated account manager', included: true },
      { name: 'SLA guarantee', included: '99.9%' },
    ],
    cta: 'Contact Sales',
  },
  {
    name: 'Enterprise',
    tagline: 'Custom solutions for large organizations',
    icon: Crown,
    price: { annual: 0, perUser: false },
    minUsers: 1000,
    maxUsers: null,
    features: [
      { name: 'Core modules (Finance, HR, Inventory)', included: true },
      { name: 'Cloud deployment (AWS/Azure)', included: 'Custom' },
      { name: 'Email & phone support', included: 'Dedicated 24/7' },
      { name: 'Mobile apps (iOS & Android)', included: true },
      { name: 'Basic reporting', included: true },
      { name: 'GST & TDS compliance', included: true },
      { name: 'Standard integrations', included: 'Unlimited + Custom' },
      { name: 'Data storage', included: 'Unlimited' },
      { name: 'API access', included: 'Full + Custom' },
      { name: 'Custom workflows', included: true },
      { name: 'Advanced analytics', included: true },
      { name: 'On-premises deployment', included: true },
      { name: 'Dedicated account manager', included: 'Team' },
      { name: 'SLA guarantee', included: '99.95%' },
    ],
    cta: 'Custom Quote',
  },
];

const ADDON_MODULES = [
  { name: 'Project Management', price: 99 },
  { name: 'CRM & Sales', price: 149 },
  { name: 'Advanced Procurement', price: 129 },
  { name: 'Asset Management', price: 89 },
  { name: 'Helpdesk & Support', price: 79 },
  { name: 'Document Management', price: 69 },
];

const TESTIMONIAL_STATS = [
  { label: 'Cost Savings', value: '73%', description: 'Average reduction in IT costs', icon: TrendingUp },
  { label: 'Customer Rating', value: '4.9/5', description: 'Based on 500+ reviews', icon: Star },
  { label: 'Deployment Time', value: '< 30 days', description: 'Average implementation', icon: Zap },
  { label: 'Uptime SLA', value: '99.97%', description: 'Guaranteed availability', icon: Shield },
];

const COMPARISON_FEATURES = [
  { feature: 'Users Included', small: '10-50', psu: '50-500', govt: '100+', enterprise: 'Unlimited' },
  { feature: 'Cloud Storage', small: '50 GB', psu: '500 GB', govt: 'Unlimited', enterprise: 'Unlimited' },
  { feature: 'API Calls/Month', small: '10,000', psu: '100,000', govt: '1M+', enterprise: 'Unlimited' },
  { feature: 'Support Response', small: '24 hours', psu: '4 hours', govt: '1 hour', enterprise: '15 min' },
  { feature: 'Implementation', small: 'Self-service', psu: 'Guided', govt: 'White-glove', enterprise: 'Custom' },
  { feature: 'Training Sessions', small: '2 hours', psu: '8 hours', govt: '20 hours', enterprise: 'Unlimited' },
  { feature: 'Custom Integrations', small: false, psu: false, govt: true, enterprise: true },
  { feature: 'Dedicated IP', small: false, psu: false, govt: true, enterprise: true },
  { feature: 'SOC 2 Compliance', small: false, psu: true, govt: true, enterprise: true },
];

export function Pricing() {
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<'annual' | 'monthly'>('annual');
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroY = useTransform(scrollY, [0, 300], [0, -50]);

  const getFeatureValue = (feature: PricingTier['features'][0]) => {
    if (feature.included === true) {
      return <Check className="size-5 text-intent-success" />;
    } else if (feature.included === false) {
      return <X className="size-5 text-text-muted" />;
    } else {
      return <span className="text-body-sm text-text-primary">{feature.included}</span>;
    }
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-intent-success-bg to-intent-info-bg rounded-full mb-6"
          >
            <Sparkles className="size-5 text-intent-success" />
            <span className="text-body-sm font-medium text-intent-success">Trusted by 500+ Organizations</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4 bg-gradient-to-r from-text-primary via-intent-primary to-text-primary bg-clip-text"
            style={{ backgroundSize: '200% auto', animation: 'gradient 3s ease infinite' }}
          >
            Pricing Built for Government Scale
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-text-secondary max-w-3xl mx-auto mb-8"
          >
            Transparent, predictable pricing with no surprises. All plans include enterprise-grade security,
            compliance features, and 24/7 support. Save an average of 73% compared to legacy systems.
          </motion.p>

          {/* Stats Pills */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-8"
          >
            {TESTIMONIAL_STATS.map((stat, idx) => {
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

          {/* Billing Toggle */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="inline-flex items-center gap-3 bg-surface-raised p-1.5 rounded-xl border-2 border-border-subtle"
          >
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-8 py-3 rounded-lg text-body-sm font-semibold transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-gradient-to-r from-intent-primary to-brand-accent text-white shadow-[var(--shadow-md)]'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-sunken'
              }`}
            >
              Monthly Billing
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`px-8 py-3 rounded-lg text-body-sm font-semibold transition-all flex items-center gap-2 ${
                billingCycle === 'annual'
                  ? 'bg-gradient-to-r from-intent-primary to-brand-accent text-white shadow-[var(--shadow-md)]'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-sunken'
              }`}
            >
              Annual Billing
              {billingCycle === 'annual' ? (
                <Badge variant="success" className="ml-1">Save 20%</Badge>
              ) : (
                <span className="text-intent-success text-caption font-bold">(Save 20%)</span>
              )}
            </button>
          </motion.div>
        </motion.div>

        {/* Pricing Cards - Premium Design */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
          {PRICING_TIERS.map((tier, index) => {
            const Icon = tier.icon;
            const monthlyPrice = tier.price.perUser
              ? billingCycle === 'annual'
                ? tier.price.annual
                : Math.round(tier.price.annual * 1.25)
              : 0;
            const annualSavings = tier.price.perUser && billingCycle === 'annual'
              ? Math.round(tier.price.annual * 12 * 0.2 * tier.minUsers)
              : 0;

            return (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
                className={tier.highlighted ? 'lg:scale-105 lg:-mt-4 lg:mb-4' : ''}
              >
                <Card className={`p-8 h-full flex flex-col relative overflow-hidden ${
                  tier.highlighted
                    ? 'border-2 border-intent-primary shadow-[0_20px_40px_rgba(0,0,0,0.1)] bg-gradient-to-b from-surface-raised to-surface-canvas'
                    : 'hover:shadow-[var(--shadow-lg)] transition-shadow'
                }`}>
                  {tier.highlighted && (
                    <>
                      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-intent-primary to-brand-accent opacity-10 rounded-full -mr-16 -mt-16" />
                      <Badge variant="primary" className="mb-4 self-start z-10">
                        <Star className="size-3 mr-1" />
                        Most Popular
                      </Badge>
                    </>
                  )}

                  <div className="mb-8">
                    <div className={`size-14 rounded-xl flex items-center justify-center mb-4 ${
                      tier.highlighted
                        ? 'bg-gradient-to-br from-intent-primary to-brand-accent shadow-[0_8px_16px_rgba(59,130,246,0.3)]'
                        : 'bg-gradient-to-br from-brand-primary to-brand-accent'
                    }`}>
                      <Icon className="size-7 text-white" />
                    </div>
                    <h3 className="text-h2 mb-2">{tier.name}</h3>
                    <p className="text-body-sm text-text-muted">{tier.tagline}</p>
                  </div>

                  <div className="mb-8">
                    {tier.price.perUser ? (
                      <>
                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="text-h1 font-bold bg-gradient-to-r from-intent-primary to-brand-accent bg-clip-text text-transparent">
                            ₹{monthlyPrice.toLocaleString()}
                          </span>
                          <span className="text-body-sm text-text-muted">/user/mo</span>
                        </div>
                        <p className="text-caption text-text-secondary mb-2">
                          {tier.minUsers.toLocaleString()} - {tier.maxUsers?.toLocaleString() || 'unlimited'} users
                        </p>
                        {billingCycle === 'annual' && annualSavings > 0 && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-intent-success-bg rounded-lg">
                            <TrendingUp className="size-4 text-intent-success" />
                            <span className="text-caption font-semibold text-intent-success">
                              Save ₹{annualSavings.toLocaleString()}/year
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-h1 mb-2 bg-gradient-to-r from-intent-primary to-brand-accent bg-clip-text text-transparent">
                          Custom
                        </div>
                        <p className="text-body-sm text-text-secondary">
                          Tailored to your requirements
                        </p>
                      </>
                    )}
                  </div>

                  <div className="flex-1 space-y-3 mb-8">
                    {tier.features.slice(0, 8).map((feature, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {getFeatureValue(feature)}
                        </div>
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-body-sm text-text-primary">{feature.name}</span>
                          {feature.tooltip && (
                            <HelpCircle className="size-4 text-text-muted cursor-help" />
                          )}
                        </div>
                      </div>
                    ))}
                    {tier.features.length > 8 && (
                      <p className="text-caption text-intent-primary font-medium cursor-pointer hover:underline">
                        +{tier.features.length - 8} more features
                      </p>
                    )}
                  </div>

                  <Button
                    variant={tier.highlighted ? 'primary' : 'secondary'}
                    size="lg"
                    className="w-full"
                  >
                    {tier.cta}
                  </Button>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Detailed Comparison Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mb-20"
        >
          <div className="text-center mb-8">
            <h2 className="text-h1 mb-3">Detailed Feature Comparison</h2>
            <p className="text-base text-text-secondary max-w-2xl mx-auto">
              See exactly what's included in each plan to find the perfect fit for your organization.
            </p>
          </div>
          <Card className="p-8 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-border-subtle">
                  <th className="text-left py-4 px-4 text-h4 text-text-primary">Feature</th>
                  <th className="text-center py-4 px-4 text-h4 text-text-primary">Small Office</th>
                  <th className="text-center py-4 px-4 text-h4 text-text-primary bg-intent-primary-bg">PSU Edition</th>
                  <th className="text-center py-4 px-4 text-h4 text-text-primary">Government</th>
                  <th className="text-center py-4 px-4 text-h4 text-text-primary">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FEATURES.map((row, idx) => (
                  <tr key={idx} className="border-b border-border-subtle hover:bg-surface-sunken transition-colors">
                    <td className="py-4 px-4 text-body-sm font-medium text-text-primary">{row.feature}</td>
                    <td className="py-4 px-4 text-center text-body-sm text-text-secondary">
                      {typeof row.small === 'boolean' ? (
                        row.small ? <Check className="size-5 text-intent-success mx-auto" /> : <X className="size-5 text-text-muted mx-auto" />
                      ) : row.small}
                    </td>
                    <td className="py-4 px-4 text-center text-body-sm text-text-primary font-semibold bg-intent-primary-bg">
                      {typeof row.psu === 'boolean' ? (
                        row.psu ? <Check className="size-5 text-intent-success mx-auto" /> : <X className="size-5 text-text-muted mx-auto" />
                      ) : row.psu}
                    </td>
                    <td className="py-4 px-4 text-center text-body-sm text-text-secondary">
                      {typeof row.govt === 'boolean' ? (
                        row.govt ? <Check className="size-5 text-intent-success mx-auto" /> : <X className="size-5 text-text-muted mx-auto" />
                      ) : row.govt}
                    </td>
                    <td className="py-4 px-4 text-center text-body-sm text-text-secondary">
                      {typeof row.enterprise === 'boolean' ? (
                        row.enterprise ? <Check className="size-5 text-intent-success mx-auto" /> : <X className="size-5 text-text-muted mx-auto" />
                      ) : row.enterprise}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </motion.div>

        {/* Add-on Modules - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
          className="mb-20"
        >
          <div className="text-center mb-8">
            <h2 className="text-h1 mb-3">Extend with Add-on Modules</h2>
            <p className="text-base text-text-secondary max-w-2xl mx-auto">
              Powerful specialized modules to expand your capabilities. Mix and match to create your perfect solution.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ADDON_MODULES.map((addon, index) => (
              <motion.div
                key={addon.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.1 + index * 0.05 }}
              >
                <Card className="p-6 hover:shadow-[var(--shadow-lg)] transition-all hover:border-intent-primary border-2 border-transparent cursor-pointer">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h4 className="text-h4 mb-2">{addon.name}</h4>
                      <p className="text-caption text-text-muted">Available for all plans</p>
                    </div>
                    <div className="size-10 bg-gradient-to-br from-intent-primary to-brand-accent rounded-lg flex items-center justify-center">
                      <Sparkles className="size-5 text-white" />
                    </div>
                  </div>
                  <div className="pt-4 border-t border-border-subtle flex items-center justify-between">
                    <span className="text-h3 font-bold text-intent-primary">+₹{addon.price}</span>
                    <span className="text-caption text-text-muted">/user/month</span>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* FAQ Section - Enhanced */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
          className="mb-16"
        >
          <div className="text-center mb-8">
            <h2 className="text-h1 mb-3">Pricing FAQs</h2>
            <p className="text-base text-text-secondary max-w-2xl mx-auto">
              Common questions about our pricing, billing, and plans.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
              <div className="flex items-start gap-4">
                <div className="size-10 bg-intent-primary-bg rounded-lg flex items-center justify-center flex-shrink-0">
                  <HelpCircle className="size-5 text-intent-primary" />
                </div>
                <div className="flex-1">
                  <h4 className="text-h4 mb-2">What's included in all plans?</h4>
                  <p className="text-body-sm text-text-secondary">
                    All plans include core Finance, HR, and Inventory modules, GST/TDS compliance,
                    mobile apps (iOS & Android), regular feature updates, automatic data backup, and email support.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
              <div className="flex items-start gap-4">
                <div className="size-10 bg-intent-success-bg rounded-lg flex items-center justify-center flex-shrink-0">
                  <HelpCircle className="size-5 text-intent-success" />
                </div>
                <div className="flex-1">
                  <h4 className="text-h4 mb-2">Can I switch plans later?</h4>
                  <p className="text-body-sm text-text-secondary">
                    Absolutely! You can upgrade or downgrade at any time. We apply prorated billing for plan changes
                    so you only pay for what you use. No penalties for switching.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
              <div className="flex items-start gap-4">
                <div className="size-10 bg-intent-warning-bg rounded-lg flex items-center justify-center flex-shrink-0">
                  <HelpCircle className="size-5 text-intent-warning" />
                </div>
                <div className="flex-1">
                  <h4 className="text-h4 mb-2">Is there a setup fee?</h4>
                  <p className="text-body-sm text-text-secondary">
                    No setup fees for Small Office and PSU Edition. Government and Enterprise plans include
                    professional implementation services with dedicated onboarding specialists.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
              <div className="flex items-start gap-4">
                <div className="size-10 bg-intent-info-bg rounded-lg flex items-center justify-center flex-shrink-0">
                  <HelpCircle className="size-5 text-intent-info" />
                </div>
                <div className="flex-1">
                  <h4 className="text-h4 mb-2">What payment methods do you accept?</h4>
                  <p className="text-body-sm text-text-secondary">
                    Bank transfer, credit/debit cards, and for government organizations: e-payment through GeM portal,
                    direct purchase orders, and treasury vouchers.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
              <div className="flex items-start gap-4">
                <div className="size-10 bg-intent-primary-bg rounded-lg flex items-center justify-center flex-shrink-0">
                  <Shield className="size-5 text-intent-primary" />
                </div>
                <div className="flex-1">
                  <h4 className="text-h4 mb-2">Is my data secure?</h4>
                  <p className="text-body-sm text-text-secondary">
                    Yes. All plans include bank-grade AES-256 encryption, SOC 2 compliance, ISO 27001 certification,
                    and data stored in Indian data centers with 99.97%+ uptime SLA.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
              <div className="flex items-start gap-4">
                <div className="size-10 bg-intent-success-bg rounded-lg flex items-center justify-center flex-shrink-0">
                  <Zap className="size-5 text-intent-success" />
                </div>
                <div className="flex-1">
                  <h4 className="text-h4 mb-2">Can I try before I buy?</h4>
                  <p className="text-body-sm text-text-secondary">
                    Yes! We offer a 30-day free trial with full access to all features (no credit card required).
                    We also provide live demos and sandbox environments.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </motion.div>

        {/* CTA Section - Premium */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3 }}
        >
          <Card className="p-16 bg-gradient-to-br from-brand-primary via-intent-primary to-brand-accent text-white text-center relative overflow-hidden">
            {/* Decorative Elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-32 -mt-32" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white opacity-5 rounded-full -ml-24 -mb-24" />

            <div className="relative z-10">
              <div className="size-20 bg-white bg-opacity-20 rounded-2xl mx-auto mb-6 flex items-center justify-center backdrop-blur-sm">
                <Users className="size-10 text-white" />
              </div>
              <h2 className="text-h1 mb-4">Ready to Transform Your Organization?</h2>
              <p className="text-base opacity-95 mb-8 max-w-2xl mx-auto leading-relaxed">
                Join 500+ government organizations and PSUs that have modernized their operations with CivitasOne.
                Start your free 30-day trial today or schedule a personalized demo with our solution experts.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button variant="secondary" size="lg" className="min-w-[200px]">
                  Start Free Trial
                </Button>
                <Button variant="secondary" size="lg" className="min-w-[200px]" onClick={() => navigate('/company/contact')}>
                  Schedule Demo
                </Button>
                <Button variant="secondary" size="lg" className="min-w-[200px]">
                  Contact Sales
                </Button>
              </div>
              <p className="text-caption opacity-80 mt-6">
                No credit card required • 30-day money-back guarantee • Dedicated support
              </p>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
