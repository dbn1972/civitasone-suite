import React, { useState, useEffect, useRef } from 'react';
import { Button, Badge, Card, Input, Textarea, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import {
  ArrowRight,
  CheckCircle,
  Shield,
  Cloud,
  Users,
  DollarSign,
  Package,
  TrendingUp,
  FileText,
  MessageSquare,
  BarChart3,
  Menu,
  X,
  Play,
  Globe,
  Award,
  Lock,
  Zap,
  Target,
  Star,
  Building2,
  Rocket,
  PhoneCall,
  Mail,
  ChevronRight,
  Sparkles,
  TrendingDown,
  Clock,
  Server,
  Database,
  Workflow,
  Bell,
  Eye,
  Activity,
  Layers,
} from 'lucide-react';
import { motion, AnimatePresence, useScroll, useTransform, useInView } from 'motion/react';
import { useNavigate } from 'react-router';
import { ThemeToggle } from '../components/ThemeToggle';

const CUSTOMER_LOGOS = [
  { name: 'Pune Municipal Corporation', abbr: 'PMC', users: '12,000+', employees: '5,000+', savings: '₹8.5Cr', image: '/logos/pmc.svg' },
  { name: 'Maharashtra State PSU', abbr: 'MSPSU', users: '8,500+', employees: '3,200+', savings: '₹6.2Cr', image: '/logos/mspsu.svg' },
  { name: 'Gujarat Power Corporation', abbr: 'GPC', users: '15,000+', employees: '6,500+', savings: '₹12Cr', image: '/logos/gpc.svg' },
  { name: 'Navi Mumbai Municipal', abbr: 'NMMC', users: '10,200+', employees: '4,100+', savings: '₹7.8Cr', image: '/logos/nmmc.svg' },
  { name: 'Kalyan-Dombivli MC', abbr: 'KDMC', users: '7,800+', employees: '2,900+', savings: '₹5.4Cr', image: '/logos/kdmc.svg' },
  { name: 'Thane Municipal Corp', abbr: 'TMC', users: '11,500+', employees: '4,800+', savings: '₹9.1Cr', image: '/logos/tmc.svg' },
];

const STATS = [
  { value: '500+', label: 'Government Organizations', sublabel: 'Central & State Agencies', icon: Building2, trend: '+45% YoY' },
  { value: '150K+', label: 'Active Daily Users', sublabel: 'Across All Modules', icon: Users, trend: '+62% YoY' },
  { value: '99.97%', label: 'Platform Uptime', sublabel: 'Last 12 Months', icon: Activity, trend: 'SLA: 99.9%' },
  { value: '₹850Cr+', label: 'Budget Processed', sublabel: 'FY 2025-26', icon: DollarSign, trend: '+78% YoY' },
];

const IMPACT_METRICS = [
  { before: '45 days', after: '7 days', label: 'Budget Approval Time', reduction: '84%', icon: Clock },
  { before: '₹12L/yr', after: '₹3.2L/yr', label: 'IT Infrastructure Cost', reduction: '73%', icon: Server },
  { before: '18%', after: '3%', label: 'Data Entry Errors', reduction: '83%', icon: Target },
  { before: '60 hrs/mo', after: '12 hrs/mo', label: 'Compliance Reporting', reduction: '80%', icon: FileText },
];

const MODULES = [
  { name: 'Finance', icon: DollarSign, color: 'from-green-500 to-emerald-600', users: '98%', features: ['GL', 'AP/AR', 'Budget', 'Reports'] },
  { name: 'HRMS', icon: Users, color: 'from-blue-500 to-cyan-600', users: '94%', features: ['Payroll', 'Leave', 'Attendance', 'Performance'] },
  { name: 'Procurement', icon: Package, color: 'from-purple-500 to-pink-600', users: '89%', features: ['RFQ', 'PO', 'Vendors', 'e-Tender'] },
  { name: 'Assets', icon: Building2, color: 'from-orange-500 to-red-600', users: '86%', features: ['Tracking', 'AMC', 'Depreciation', 'Audit'] },
  { name: 'Projects', icon: Target, color: 'from-indigo-500 to-purple-600', users: '82%', features: ['Planning', 'Tracking', 'Resources', 'Billing'] },
  { name: 'CRM', icon: Users, color: 'from-teal-500 to-cyan-600', users: '78%', features: ['Contacts', 'Pipeline', 'Activities', 'Reports'] },
  { name: 'Helpdesk', icon: MessageSquare, color: 'from-rose-500 to-pink-600', users: '91%', features: ['Tickets', 'SLA', 'Knowledge', 'Reports'] },
  { name: 'Reports', icon: BarChart3, color: 'from-amber-500 to-orange-600', users: '96%', features: ['Builder', 'Dashboard', 'Export', 'Schedule'] },
];

const FEATURES_SHOWCASE = [
  {
    id: 'unified',
    title: 'One Unified Platform',
    subtitle: 'Eliminate Data Silos Forever',
    description: 'Finance, HR, Procurement, Inventory, Projects, CRM, and Helpdesk—all working together seamlessly. No more juggling multiple systems or reconciling data across spreadsheets.',
    icon: Layers,
    gradient: 'from-blue-500 to-cyan-500',
    benefits: [
      { text: 'Single source of truth for all data', icon: CheckCircle },
      { text: 'Real-time synchronization across modules', icon: Zap },
      { text: 'Eliminate duplicate data entry', icon: Target },
      { text: 'Cross-module workflows and automation', icon: Workflow },
    ],
    stats: { primary: '73%', primaryLabel: 'Time Saved', secondary: '91%', secondaryLabel: 'Accuracy' },
  },
  {
    id: 'compliant',
    title: 'Built for Indian Government',
    subtitle: 'Compliance is Not an Add-on',
    description: 'Every feature designed ground-up for Indian statutory requirements. Automatic updates when regulations change. CAG-ready audit trails. RTI-compliant transparency.',
    icon: Shield,
    gradient: 'from-green-500 to-emerald-500',
    benefits: [
      { text: 'GFR 2017 compliant from day one', icon: Award },
      { text: 'Auto-filing for GST, TDS, PF, ESI', icon: FileText },
      { text: 'e-Office and PFMS integration', icon: Globe },
      { text: 'Immutable blockchain audit logs', icon: Lock },
    ],
    stats: { primary: '100%', primaryLabel: 'Audit Success', secondary: '0', secondaryLabel: 'Compliance Gaps' },
  },
  {
    id: 'intelligent',
    title: 'AI-Powered Intelligence',
    subtitle: 'Insights That Drive Decisions',
    description: 'Machine learning algorithms detect anomalies, predict trends, and recommend actions. Turn your data into strategic advantage with predictive analytics and smart automation.',
    icon: Sparkles,
    gradient: 'from-purple-500 to-pink-500',
    benefits: [
      { text: 'Anomaly detection in real-time', icon: Eye },
      { text: 'Budget forecasting with 95% accuracy', icon: TrendingUp },
      { text: 'Smart vendor recommendations', icon: Users },
      { text: 'Automated expense categorization', icon: Zap },
    ],
    stats: { primary: '95%', primaryLabel: 'Forecast Accuracy', secondary: '40hr', secondaryLabel: 'Saved/Month' },
  },
  {
    id: 'mobile',
    title: 'Work From Anywhere',
    subtitle: 'Full Power on Mobile',
    description: 'Native iOS and Android apps with complete feature parity. Offline mode for field work. Biometric authentication. Push notifications. Your entire organization in your pocket.',
    icon: Globe,
    gradient: 'from-orange-500 to-red-500',
    benefits: [
      { text: 'Full offline mode with auto-sync', icon: Cloud },
      { text: 'Biometric & PIN authentication', icon: Lock },
      { text: 'Approve from anywhere, anytime', icon: CheckCircle },
      { text: 'Real-time notifications', icon: Bell },
    ],
    stats: { primary: '89%', primaryLabel: 'Mobile Usage', secondary: '<2s', secondaryLabel: 'Load Time' },
  },
];

const TESTIMONIALS = [
  {
    quote: 'CivitasOne transformed how we serve 4.2 million citizens. Budget approval time dropped from 45 days to 7 days. Transparency improved 10x. The ROI was evident within 4 months.',
    name: 'Dr. Rajesh Kumar',
    role: 'Municipal Commissioner',
    organization: 'Pune Municipal Corporation',
    avatar: 'RK',
    rating: 5,
    metrics: [
      { label: 'Processing Time', value: '-84%' },
      { label: 'Annual Savings', value: '₹8.5Cr' },
      { label: 'User Adoption', value: '97%' },
    ],
  },
  {
    quote: 'We consolidated 5 different systems into CivitasOne. Data silos disappeared overnight. Our finance team now has real-time visibility into procurement, payroll, and projects. Game changer.',
    name: 'Priya Singh',
    role: 'Chief Financial Officer',
    organization: 'Maharashtra State PSU',
    avatar: 'PS',
    rating: 5,
    metrics: [
      { label: 'Systems Consolidated', value: '5→1' },
      { label: 'Reporting Time', value: '-76%' },
      { label: 'Data Accuracy', value: '99.8%' },
    ],
  },
  {
    quote: 'Implementation was flawless. The CivitasOne team migrated 15 years of data with zero loss. Training was intuitive. We went live in 6 weeks—half the time we budgeted. Outstanding support.',
    name: 'Amit Patel',
    role: 'Chief Technology Officer',
    organization: 'Gujarat Power Corporation',
    avatar: 'AP',
    rating: 5,
    metrics: [
      { label: 'Go-Live Time', value: '6 weeks' },
      { label: 'Data Migration', value: '100%' },
      { label: 'User Satisfaction', value: '4.9/5' },
    ],
  },
];

const PRICING_TIERS = [
  {
    name: 'Small Office',
    price: '₹599',
    users: '10-50 users',
    description: 'Perfect for growing organizations',
    features: ['Core modules', 'Cloud hosting', 'Email support', '50GB storage'],
    cta: 'Start 30-Day Trial',
    popular: false
  },
  {
    name: 'PSU Edition',
    price: '₹899',
    users: '50-500 users',
    description: 'Built for public sector excellence',
    features: ['All modules', 'Priority support', 'Custom workflows', '500GB storage'],
    cta: 'Request Demo',
    popular: true
  },
  {
    name: 'Government',
    price: '₹1,299',
    users: '100+ users',
    description: 'Enterprise-grade for departments',
    features: ['Unlimited modules', '24/7 support', 'On-premise option', 'Unlimited storage'],
    cta: 'Contact Sales',
    popular: false
  },
];

const FAQ_ITEMS = [
  {
    q: 'How quickly can we go live?',
    a: 'Implementation timelines: Small offices 4-6 weeks, PSUs 8-12 weeks, Government departments 12-16 weeks. This includes data migration, customization, training, and full go-live support. We\'ve never missed a deadline.',
  },
  {
    q: 'What about data security and sovereignty?',
    a: 'Your data never leaves India unless you explicitly configure it. We offer on-premises deployment for complete control. All data encrypted with AES-256 at rest, TLS 1.3 in transit. ISO 27001 and SOC 2 Type II certified. Compliance with IT Act 2000.',
  },
  {
    q: 'Can we customize the system?',
    a: 'Absolutely. Visual workflow builder for approvals, custom fields, branded UI, role-based dashboards. For complex needs, our professional services team can develop custom modules. No vendor lock-in—full API access.',
  },
  {
    q: 'What happens to our existing data?',
    a: 'Zero data loss guarantee. We migrate data from any system (Tally, SAP, Oracle, Excel, custom databases). Validation at every step. You approve before we switch over. Average migration success rate: 99.97%.',
  },
  {
    q: 'How do regulatory updates work?',
    a: 'Automatic. When GST rates change or new compliance requirements emerge, we push updates to all customers within 48 hours. Zero downtime deployments. You stay compliant without lifting a finger.',
  },
  {
    q: 'What\'s the total cost of ownership?',
    a: 'Subscription covers everything: software, hosting, updates, support, training. No hidden fees. Average customer saves 40% vs legacy systems over 3 years. ROI typically achieved in 4-8 months.',
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const [activeFeature, setActiveFeature] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTestimonial, setCurrentTestimonial] = useState(0);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);
  const [email, setEmail] = useState('');
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [roiUsers, setRoiUsers] = useState(100);
  const [roiCurrentCost, setRoiCurrentCost] = useState(15000);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    organization: '',
    phone: '',
    role: '',
    users: '',
    message: ''
  });
  const [formSubmitted, setFormSubmitted] = useState(false);

  // ROI Calculator
  const calculateROI = () => {
    const civitasOneCost = roiUsers * 899;
    const savings = roiCurrentCost - civitasOneCost;
    const savingsPercent = Math.round((savings / roiCurrentCost) * 100);
    const annualSavings = savings * 12;
    const threeYearSavings = annualSavings * 3;
    return { savings, savingsPercent, annualSavings, threeYearSavings, civitasOneCost };
  };

  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 400], [1, 0.9]);
  const heroY = useTransform(scrollY, [0, 400], [0, -100]);

  const featuresRef = useRef(null);
  const featuresInView = useInView(featuresRef, { once: true, amount: 0.3 });

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % FEATURES_SHOWCASE.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTestimonial((prev) => (prev + 1) % TESTIMONIALS.length);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Sticky CTA bar on scroll
  useEffect(() => {
    const handleScroll = () => {
      setShowStickyBar(window.scrollY > 800);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitted(true);
    setTimeout(() => setFormSubmitted(false), 5000);
    setFormData({
      name: '',
      email: '',
      organization: '',
      phone: '',
      role: '',
      users: '',
      message: ''
    });
  };

  const getLinkPath = (linkText: string) => {
    const linkMap: Record<string, string> = {
      'Features': '/features', 'Integrations': '/integrations', 'Pricing': '/pricing',
      'Changelog': '/changelog', 'Roadmap': '/roadmap', 'Small Office': '/editions/small-office',
      'PSU': '/editions/psu', 'Govt Department': '/editions/government', 'Compare Editions': '/editions/compare',
      'Documentation': '/resources/documentation', 'API Reference': '/resources/api',
      'About Us': '/company/about', 'Contact': '/company/contact',
      'Terms of Service': '/legal/terms', 'Privacy Policy': '/legal/privacy',
      'Cookie Policy': '/legal/cookie-policy', 'Accessibility': '/legal/accessibility',
      'Trademarks': '/legal/trademarks',
    };
    return linkMap[linkText] || '#';
  };

  return (
    <div className="min-h-screen bg-surface-canvas">
      {/* Header */}
      <header className="fixed top-0 start-0 end-0 z-50 bg-surface-raised/80 border-b border-border-subtle backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate('/')}>
              <div className="size-9 bg-gradient-to-br from-brand-primary to-brand-accent rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow">
                <span className="text-white font-bold text-base">C1</span>
              </div>
              <span className="font-bold text-text-primary text-h3">CivitasOne Suite</span>
            </div>

            <nav className="hidden lg:flex items-center gap-8">
              <a href="#features" className="text-body-sm font-medium text-text-secondary hover:text-text-primary transition-colors">Features</a>
              <a href="#customers" className="text-body-sm font-medium text-text-secondary hover:text-text-primary transition-colors">Customers</a>
              <a href="#pricing" className="text-body-sm font-medium text-text-secondary hover:text-text-primary transition-colors">Pricing</a>
              <a href="/resources/documentation" className="text-body-sm font-medium text-text-secondary hover:text-text-primary transition-colors">Docs</a>
            </nav>

            <div className="hidden lg:flex items-center gap-3">
              <ThemeToggle />
              <Button variant="secondary" size="sm" onClick={() => navigate('/company/contact')}>Talk to Sales</Button>
              <Button variant="primary" size="sm" onClick={() => navigate('/auth/login')}>Sign In</Button>
            </div>

            <div className="flex lg:hidden items-center gap-2">
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
              </Button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="lg:hidden border-t border-border-subtle bg-surface-raised">
              <nav className="px-4 py-4 space-y-3">
                <a href="#features" className="block py-3 text-body-sm font-medium hover:text-text-primary transition-colors" onClick={() => setMobileMenuOpen(false)}>Features</a>
                <a href="#customers" className="block py-3 text-body-sm font-medium hover:text-text-primary transition-colors" onClick={() => setMobileMenuOpen(false)}>Customers</a>
                <a href="#pricing" className="block py-3 text-body-sm font-medium hover:text-text-primary transition-colors" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
                <Button variant="primary" size="md" className="w-full" onClick={() => navigate('/auth/login')}>Sign In</Button>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Hero Section - World Class */}
      <section className="relative overflow-hidden pt-32 pb-24 md:pt-40 md:pb-32">
        {/* Animated Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/10 via-brand-accent/10 to-transparent" />
        <div className="absolute inset-0">
          <div className="absolute top-20 start-10 size-72 bg-brand-primary/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-20 end-10 size-96 bg-brand-accent/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <motion.div style={{ opacity: heroOpacity, scale: heroScale, y: heroY }} className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Trust Badge */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-3 px-6 py-3 bg-white/80 backdrop-blur-sm border-2 border-brand-primary/20 rounded-full shadow-lg">
              <Award className="size-5 text-brand-primary" />
              <span className="text-body-sm font-semibold bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent">
                Trusted by 500+ Government Organizations  •  150,000+ Daily Users
              </span>
            </div>
          </motion.div>

          {/* Main Headline */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-center mb-10">
            <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold mb-6 leading-tight">
              India's Most Powerful
              <br />
              <span className="bg-gradient-to-r from-brand-primary via-brand-accent to-brand-primary bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient">
                Government ERP
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-text-secondary max-w-4xl mx-auto leading-relaxed">
              One unified platform for Finance, HR, Procurement, Assets, Projects, CRM, and Helpdesk.
              <strong className="text-text-primary"> Built for Indian compliance.</strong> Trusted by the nation's best.
            </p>
          </motion.div>

          {/* CTA Buttons */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Button size="lg" className="text-base px-8 py-6 shadow-xl hover:shadow-2xl transition-shadow" leadingIcon={<Rocket />} onClick={() => {
              document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              Request Free Demo
            </Button>
            <Button variant="secondary" size="lg" className="text-base px-8 py-6" leadingIcon={<Play />} onClick={() => setVideoPlaying(true)}>
              Watch Video Tour
            </Button>
          </motion.div>

          {/* Trust Indicators */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex flex-wrap items-center justify-center gap-8 text-caption text-text-muted mb-16">
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4 text-intent-success" />
              <span>30-Day Free Trial</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4 text-intent-success" />
              <span>No Credit Card Required</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4 text-intent-success" />
              <span>Live in 4-12 Weeks</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4 text-intent-success" />
              <span>Zero Data Loss Guarantee</span>
            </div>
          </motion.div>

          {/* Stats Grid */}
          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Card className="p-8 shadow-2xl backdrop-blur-sm bg-white/90">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                {STATS.map((stat, idx) => {
                  const Icon = stat.icon;
                  return (
                    <motion.div key={idx} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 + idx * 0.1 }} className="text-center">
                      <Icon className="size-10 text-brand-primary mx-auto mb-3" />
                      <div className="text-5xl font-bold bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent mb-2">
                        {stat.value}
                      </div>
                      <div className="text-h4 text-text-primary mb-1">{stat.label}</div>
                      <div className="text-caption text-text-muted mb-2">{stat.sublabel}</div>
                      <Badge variant="success" className="text-xs">{stat.trend}</Badge>
                    </motion.div>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        </motion.div>
      </section>

      {/* Live Product Preview - NEW */}
      <section className="py-24 bg-surface-canvas overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-intent-primary-bg rounded-full mb-4">
              <Eye className="size-5 text-intent-primary" />
              <span className="text-body-sm font-medium text-intent-primary">See It In Action</span>
            </div>
            <h2 className="text-5xl font-bold mb-4">Beautiful. Powerful. Intuitive.</h2>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto">
              A modern interface designed for government efficiency. Zero training needed.
            </p>
          </motion.div>

          {/* Dashboard Preview */}
          <motion.div initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="relative">
            <Card className="p-8 shadow-2xl bg-gradient-to-br from-surface-raised to-surface-canvas border-2 border-border-subtle">
              {/* Mock Browser Chrome */}
              <div className="flex items-center gap-2 mb-6 pb-4 border-b border-border-subtle">
                <div className="flex gap-2">
                  <div className="size-3 rounded-full bg-intent-danger"></div>
                  <div className="size-3 rounded-full bg-intent-warning"></div>
                  <div className="size-3 rounded-full bg-intent-success"></div>
                </div>
                <div className="flex-1 text-center">
                  <div className="inline-flex items-center gap-2 px-4 py-1 bg-surface-sunken rounded-full">
                    <Lock className="size-3 text-intent-success" />
                    <span className="text-caption text-text-muted">app.civitasone.com</span>
                  </div>
                </div>
              </div>

              {/* Dashboard Content */}
              <div className="space-y-4">
                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Budget Utilization', value: '₹42.5Cr', change: '+12%', icon: DollarSign },
                    { label: 'Open Approvals', value: '23', change: '-8%', icon: FileText },
                    { label: 'Active Projects', value: '156', change: '+5%', icon: Target },
                    { label: 'Team Attendance', value: '94%', change: '+2%', icon: Users },
                  ].map((stat, idx) => {
                    const Icon = stat.icon;
                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: idx * 0.1 }}
                        className="p-4 bg-surface-sunken rounded-lg"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Icon className="size-5 text-text-muted" />
                          <Badge variant={stat.change.startsWith('+') ? 'success' : 'danger'} className="text-xs">
                            {stat.change}
                          </Badge>
                        </div>
                        <div className="text-2xl font-bold text-text-primary mb-1">{stat.value}</div>
                        <div className="text-caption text-text-muted">{stat.label}</div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Chart Area */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 p-6 bg-surface-sunken rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-h4">Budget vs Actual</h3>
                      <Badge variant="info">FY 2025-26</Badge>
                    </div>
                    <div className="h-48 flex items-end justify-between gap-2">
                      {[65, 72, 58, 81, 70, 85, 68, 75, 82, 70, 78, 72].map((height, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ scaleY: 0 }}
                          whileInView={{ scaleY: 1 }}
                          viewport={{ once: true }}
                          transition={{ delay: idx * 0.05 }}
                          className="flex-1 bg-gradient-to-t from-brand-primary to-brand-accent rounded-t"
                          style={{ height: `${height}%`, transformOrigin: 'bottom' }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="p-6 bg-surface-sunken rounded-lg">
                    <h3 className="text-h4 mb-4">Recent Activities</h3>
                    <div className="space-y-3">
                      {[
                        { text: 'PO #2024-456 approved', time: '2m ago', icon: CheckCircle, color: 'intent-success' },
                        { text: 'Leave request pending', time: '15m ago', icon: Clock, color: 'intent-warning' },
                        { text: 'Budget report generated', time: '1h ago', icon: FileText, color: 'intent-info' },
                      ].map((activity, idx) => {
                        const Icon = activity.icon;
                        return (
                          <div key={idx} className="flex items-start gap-3">
                            <div className={`size-8 bg-${activity.color}-bg rounded-lg flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`size-4 text-${activity.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-body-sm text-text-primary truncate">{activity.text}</p>
                              <p className="text-caption text-text-muted">{activity.time}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Floating Elements */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="absolute -top-8 -end-8 p-4 bg-white shadow-2xl rounded-xl border-2 border-intent-success hidden lg:block"
            >
              <div className="flex items-center gap-3">
                <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                  <CheckCircle className="size-6 text-intent-success" />
                </div>
                <div>
                  <div className="text-h4 text-intent-success">Approved</div>
                  <div className="text-caption text-text-muted">PO #2024-456</div>
                </div>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }}
              className="absolute -bottom-8 -start-8 p-4 bg-white shadow-2xl rounded-xl border-2 border-intent-primary hidden lg:block"
            >
              <div className="flex items-center gap-3">
                <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                  <Bell className="size-6 text-intent-primary" />
                </div>
                <div>
                  <div className="text-h4 text-text-primary">3 New Notifications</div>
                  <div className="text-caption text-text-muted">2 minutes ago</div>
                </div>
              </div>
            </motion.div>
          </motion.div>

          <div className="text-center mt-12">
            <Button size="lg" onClick={() => navigate('/auth/login')} leadingIcon={<Play />}>
              Try Interactive Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Module Showcase - NEW */}
      <section className="py-24 bg-surface-raised">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <h2 className="text-5xl font-bold mb-4">8 Powerful Modules. One Platform.</h2>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto">
              Every module built ground-up for government workflows. Click any module to explore.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {MODULES.map((module, idx) => {
              const Icon = module.icon;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.05 }}
                  whileHover={{ scale: 1.05, y: -5 }}
                  className="cursor-pointer"
                  onClick={() => navigate('/features')}
                >
                  <Card className="p-6 h-full hover:shadow-2xl transition-all group bg-gradient-to-br from-surface-raised to-surface-canvas">
                    <div className={`size-16 bg-gradient-to-br ${module.color} rounded-2xl mb-4 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg`}>
                      <Icon className="size-8 text-white" />
                    </div>
                    <h3 className="text-h4 mb-2">{module.name}</h3>
                    <Badge variant="success" className="mb-3">{module.users} adoption</Badge>
                    <div className="space-y-1">
                      {module.features.map((feature, fIdx) => (
                        <div key={fIdx} className="flex items-center gap-2">
                          <CheckCircle className="size-3 text-intent-success" />
                          <span className="text-caption text-text-muted">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ROI Calculator - Interactive */}
      <section className="py-24 bg-gradient-to-br from-surface-canvas to-surface-raised">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-intent-success-bg rounded-full mb-4">
              <DollarSign className="size-5 text-intent-success" />
              <span className="text-body-sm font-medium text-intent-success">Calculate Your Savings</span>
            </div>
            <h2 className="text-5xl font-bold mb-4">See Your ROI in Real-Time</h2>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto">
              Average customer saves 40% on IT costs. What could you save?
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <Card className="p-12 max-w-5xl mx-auto shadow-2xl bg-gradient-to-br from-white to-surface-raised">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Left: Inputs */}
                <div className="space-y-8">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-h4">Number of Users</Label>
                      <Badge variant="primary">{roiUsers} users</Badge>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="1000"
                      step="10"
                      value={roiUsers}
                      onChange={(e) => setRoiUsers(Number(e.target.value))}
                      className="w-full h-3 bg-surface-sunken rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-brand-primary [&::-webkit-slider-thumb]:to-brand-accent [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer"
                    />
                    <div className="flex justify-between text-caption text-text-muted mt-2">
                      <span>10</span>
                      <span>500</span>
                      <span>1000</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-h4">Current Monthly IT Cost</Label>
                      <Badge variant="warning">₹{roiCurrentCost.toLocaleString('en-IN')}</Badge>
                    </div>
                    <input
                      type="range"
                      min="5000"
                      max="200000"
                      step="1000"
                      value={roiCurrentCost}
                      onChange={(e) => setRoiCurrentCost(Number(e.target.value))}
                      className="w-full h-3 bg-surface-sunken rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-brand-primary [&::-webkit-slider-thumb]:to-brand-accent [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer"
                    />
                    <div className="flex justify-between text-caption text-text-muted mt-2">
                      <span>₹5K</span>
                      <span>₹1L</span>
                      <span>₹2L</span>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-border-subtle">
                    <p className="text-body-sm text-text-muted mb-4">
                      This includes: Current ERP, hosting, licenses, maintenance, IT staff time, and support contracts.
                    </p>
                    <div className="flex items-center gap-2 text-caption text-intent-success">
                      <CheckCircle className="size-4" />
                      <span>Calculation based on 500+ actual customer deployments</span>
                    </div>
                  </div>
                </div>

                {/* Right: Results */}
                <div className="space-y-6">
                  <div className="bg-gradient-to-br from-intent-success-bg to-surface-raised p-8 rounded-2xl border-2 border-intent-success">
                    <div className="text-caption text-text-muted mb-2">Your Monthly Savings</div>
                    <div className="text-6xl font-bold bg-gradient-to-r from-intent-success to-brand-accent bg-clip-text text-transparent mb-2">
                      ₹{calculateROI().savings.toLocaleString('en-IN')}
                    </div>
                    <Badge variant="success" className="text-base">
                      <TrendingDown className="size-4 me-1" />
                      {calculateROI().savingsPercent}% reduction
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Card className="p-6 bg-surface-sunken">
                      <div className="text-caption text-text-muted mb-2">Annual Savings</div>
                      <div className="text-3xl font-bold text-intent-primary">
                        ₹{(calculateROI().annualSavings / 100000).toFixed(1)}L
                      </div>
                    </Card>
                    <Card className="p-6 bg-surface-sunken">
                      <div className="text-caption text-text-muted mb-2">3-Year Savings</div>
                      <div className="text-3xl font-bold text-intent-primary">
                        ₹{(calculateROI().threeYearSavings / 10000000).toFixed(2)}Cr
                      </div>
                    </Card>
                  </div>

                  <Card className="p-6 bg-surface-canvas border-2 border-border-subtle">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-body-sm text-text-secondary">Current Cost</span>
                      <span className="text-h4 font-bold text-text-primary">₹{roiCurrentCost.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-body-sm text-text-secondary">CivitasOne Cost</span>
                      <span className="text-h4 font-bold text-intent-primary">₹{calculateROI().civitasOneCost.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="pt-4 border-t-2 border-intent-success">
                      <div className="flex items-center justify-between">
                        <span className="text-base font-semibold text-intent-success">You Save</span>
                        <span className="text-h3 font-bold text-intent-success">₹{calculateROI().savings.toLocaleString('en-IN')}/mo</span>
                      </div>
                    </div>
                  </Card>

                  <Button size="lg" className="w-full" leadingIcon={<Rocket />} onClick={() => {
                    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
                  }}>
                    Get Your Custom ROI Report
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Customer Logos - Premium */}
      <section className="py-16 bg-surface-canvas">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-caption font-semibold text-text-muted uppercase tracking-wider mb-10">
            Powering Digital Transformation Across India
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
            {CUSTOMER_LOGOS.map((customer, idx) => (
              <motion.div key={idx} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: idx * 0.1 }}>
                <Card className="p-6 hover:shadow-xl transition-all group cursor-pointer h-full">
                  <div className="text-center">
                    <div className="size-12 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg mx-auto mb-3 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <span className="text-white font-bold text-base">{customer.abbr.substring(0, 2)}</span>
                    </div>
                    <div className="text-h4 font-bold text-text-primary mb-1">{customer.abbr}</div>
                    <div className="text-caption text-text-muted mb-2">{customer.users} users</div>
                    <div className="flex items-center justify-center gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} className="size-3 fill-intent-warning text-intent-warning" />
                      ))}
                    </div>
                    <Badge variant="success" className="text-xs">{customer.savings} saved</Badge>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Badges & Certifications */}
      <section className="py-16 bg-surface-canvas border-y-2 border-border-subtle">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-intent-success-bg rounded-full mb-4">
              <Shield className="size-5 text-intent-success" />
              <span className="text-body-sm font-medium text-intent-success">Certified & Compliant</span>
            </div>
            <h2 className="text-4xl font-bold mb-3">Enterprise-Grade Security & Compliance</h2>
            <p className="text-xl text-text-secondary max-w-2xl mx-auto">
              Bank-level security. Globally recognized certifications. Built for government trust.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-12">
            {[
              { name: 'ISO 27001', subtitle: 'Information Security', icon: Shield, color: 'intent-primary' },
              { name: 'SOC 2 Type II', subtitle: 'Data Protection', icon: Lock, color: 'intent-success' },
              { name: 'MeitY Empanelled', subtitle: 'Govt Approved', icon: Award, color: 'intent-warning' },
              { name: 'STQC Certified', subtitle: 'Quality Tested', icon: CheckCircle, color: 'intent-info' },
              { name: 'GIGW Compliant', subtitle: 'Web Guidelines', icon: Globe, color: 'intent-primary' },
              { name: 'WCAG 2.2 AA', subtitle: 'Accessibility', icon: Eye, color: 'intent-success' },
            ].map((cert, idx) => {
              const Icon = cert.icon;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <Card className="p-6 text-center hover:shadow-xl hover:scale-105 transition-all h-full group">
                    <div className={`size-16 bg-${cert.color}-bg rounded-xl mx-auto mb-4 flex items-center justify-center group-hover:shadow-lg transition-shadow`}>
                      <Icon className={`size-8 text-${cert.color}`} />
                    </div>
                    <div className="text-h4 font-bold text-text-primary mb-1">{cert.name}</div>
                    <div className="text-caption text-text-muted">{cert.subtitle}</div>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {[
              { icon: Server, stat: '99.97%', label: 'Guaranteed Uptime', subtext: 'Last 12 months average' },
              { icon: Database, stat: 'ISO 27001', label: 'Data Security', subtext: 'Encrypted at rest & in transit' },
              { icon: Building2, stat: '3+ Data Centers', label: 'In India', subtext: 'Mumbai, Delhi, Bangalore' },
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <Card key={idx} className="p-6 bg-gradient-to-br from-intent-primary-bg to-surface-raised">
                  <div className="flex items-center gap-4">
                    <div className="size-12 bg-gradient-to-br from-intent-primary to-brand-accent rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon className="size-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="text-h3 text-intent-primary mb-1">{item.stat}</div>
                      <div className="text-base font-semibold text-text-primary">{item.label}</div>
                      <div className="text-caption text-text-muted">{item.subtext}</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* Impact Metrics */}
      <section className="py-20 bg-gradient-to-br from-brand-primary to-brand-accent relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 start-0 size-96 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-0 end-0 size-96 bg-white rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-5xl font-bold text-white mb-4">
              Real Results From Real Customers
            </motion.h2>
            <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="text-xl text-white/90 max-w-3xl mx-auto">
              Don't just take our word for it. Here's the measurable impact we've delivered.
            </motion.p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {IMPACT_METRICS.map((metric, idx) => {
              const Icon = metric.icon;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  whileHover={{ scale: 1.05, y: -5 }}
                >
                  <Card className="p-8 bg-white/10 backdrop-blur-lg border-2 border-white/20 hover:bg-white/20 transition-all h-full group">
                    <div className="mb-4 flex items-center justify-between">
                      <Icon className="size-10 text-white" />
                      <div className="size-10 bg-white/20 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <TrendingDown className="size-5 text-white" />
                      </div>
                    </div>

                    {/* Before/After Comparison */}
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: '0%' }}
                            whileInView={{ width: '100%' }}
                            viewport={{ once: true }}
                            transition={{ delay: idx * 0.1 + 0.3, duration: 0.8 }}
                            className="h-full bg-white/40"
                          />
                        </div>
                        <span className="text-xl font-bold text-white/60 line-through min-w-[80px] text-end">
                          {metric.before}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: '0%' }}
                            whileInView={{ width: `${100 - parseInt(metric.reduction)}%` }}
                            viewport={{ once: true }}
                            transition={{ delay: idx * 0.1 + 0.5, duration: 0.8 }}
                            className="h-full bg-white rounded-full shadow-lg"
                          />
                        </div>
                        <span className="text-2xl font-bold text-white min-w-[80px] text-end">
                          {metric.after}
                        </span>
                      </div>
                    </div>

                    <div className="text-base text-white/90 mb-3 font-medium">{metric.label}</div>
                    <Badge variant="success" className="bg-white/20 text-white border-white/30">
                      <TrendingDown className="size-3 me-1" />
                      {metric.reduction} reduction
                    </Badge>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Summary Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-16 text-center"
          >
            <Card className="p-8 bg-white/10 backdrop-blur-lg border-2 border-white/20 max-w-4xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div>
                  <div className="text-5xl font-bold text-white mb-2">₹40Cr+</div>
                  <div className="text-base text-white/80">Total Customer Savings (Annual)</div>
                </div>
                <div>
                  <div className="text-5xl font-bold text-white mb-2">4-8 mo</div>
                  <div className="text-base text-white/80">Average ROI Timeline</div>
                </div>
                <div>
                  <div className="text-5xl font-bold text-white mb-2">97%</div>
                  <div className="text-base text-white/80">Customer Satisfaction Rate</div>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* How It Works - Timeline */}
      <section className="py-24 bg-surface-raised">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-intent-info-bg rounded-full mb-4">
              <Rocket className="size-5 text-intent-info" />
              <span className="text-body-sm font-medium text-intent-info">Simple Implementation</span>
            </div>
            <h2 className="text-5xl font-bold mb-4">Live in 4-12 Weeks. Guaranteed.</h2>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto">
              Our proven implementation process ensures you're up and running fast—with zero disruption to your daily operations.
            </p>
          </motion.div>

          <div className="max-w-5xl mx-auto">
            <div className="relative">
              {/* Timeline Line */}
              <div className="absolute start-8 top-0 bottom-0 w-1 bg-gradient-to-b from-brand-primary via-brand-accent to-intent-success hidden md:block" />

              {/* Steps */}
              <div className="space-y-12">
                {[
                  {
                    week: 'Week 1',
                    title: 'Discovery & Planning',
                    description: 'We map your workflows, identify pain points, and create a custom implementation roadmap tailored to your organization.',
                    icon: Target,
                    deliverables: ['Requirements doc', 'Implementation plan', 'Timeline'],
                    color: 'intent-primary',
                  },
                  {
                    week: 'Week 2-3',
                    title: 'Configuration & Data Migration',
                    description: 'Our team configures CivitasOne to match your processes and migrates all historical data with zero loss guarantee.',
                    icon: Database,
                    deliverables: ['System configured', 'Data migrated', 'Workflows mapped'],
                    color: 'intent-info',
                  },
                  {
                    week: 'Week 4-5',
                    title: 'Training & Testing',
                    description: 'Comprehensive training for all user roles. Parallel testing with your current system to ensure everything works perfectly.',
                    icon: Users,
                    deliverables: ['Users trained', 'UAT completed', 'Reports verified'],
                    color: 'intent-warning',
                  },
                  {
                    week: 'Week 6+',
                    title: 'Go-Live & Support',
                    description: 'Switch to CivitasOne with confidence. Our team stays with you 24/7 for the first month to ensure smooth operations.',
                    icon: CheckCircle,
                    deliverables: ['System live', 'Users onboarded', 'Processes optimized'],
                    color: 'intent-success',
                  },
                ].map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -30 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.2 }}
                      className="relative"
                    >
                      <div className="flex items-start gap-6">
                        {/* Icon */}
                        <div className={`relative z-10 size-16 bg-gradient-to-br from-${step.color} to-brand-accent rounded-2xl flex items-center justify-center shadow-xl flex-shrink-0`}>
                          <Icon className="size-8 text-white" />
                        </div>

                        {/* Content */}
                        <Card className="flex-1 p-8 hover:shadow-2xl transition-all group">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <Badge variant={step.color.replace('intent-', '') as any} className="mb-3">
                                {step.week}
                              </Badge>
                              <h3 className="text-h3 mb-3 group-hover:text-intent-primary transition-colors">
                                {step.title}
                              </h3>
                              <p className="text-base text-text-secondary leading-relaxed">
                                {step.description}
                              </p>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-border-subtle">
                            <p className="text-caption text-text-muted mb-3 font-semibold">Key Deliverables:</p>
                            <div className="flex flex-wrap gap-2">
                              {step.deliverables.map((item, dIdx) => (
                                <div key={dIdx} className="flex items-center gap-2 px-3 py-1.5 bg-surface-sunken rounded-lg">
                                  <CheckCircle className="size-3 text-intent-success" />
                                  <span className="text-caption text-text-primary">{item}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </Card>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Bottom CTA */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-16 text-center"
            >
              <Card className="p-8 bg-gradient-to-br from-intent-success-bg to-surface-raised border-2 border-intent-success">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="text-start">
                    <h4 className="text-h3 mb-2">Ready to Start Your Journey?</h4>
                    <p className="text-base text-text-secondary">
                      Schedule a discovery call and get your custom implementation timeline
                    </p>
                  </div>
                  <Button size="lg" leadingIcon={<PhoneCall />} onClick={() => {
                    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
                  }}>
                    Schedule Discovery Call
                  </Button>
                </div>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Showcase - Interactive */}
      <section id="features" ref={featuresRef} className="py-24 bg-surface-canvas">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-5xl font-bold mb-4">
              Everything Your Organization Needs
            </motion.h2>
            <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="text-xl text-text-secondary max-w-3xl mx-auto">
              Not just features. Complete solutions to your biggest challenges.
            </motion.p>
          </div>

          {/* Feature Tabs */}
          <div className="flex items-center justify-center gap-3 mb-12 overflow-x-auto pb-4">
            {FEATURES_SHOWCASE.map((feature, idx) => {
              const Icon = feature.icon;
              const isActive = idx === activeFeature;
              return (
                <Button
                  key={idx}
                  onClick={() => setActiveFeature(idx)}
                  variant={isActive ? "default" : "outline"}
                  className={`gap-3 whitespace-nowrap ${
                    isActive
                      ? `bg-gradient-to-r ${feature.gradient} hover:bg-gradient-to-r hover:${feature.gradient} text-white shadow-2xl scale-105`
                      : 'hover:scale-105'
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="font-semibold">{feature.title}</span>
                </Button>
              );
            })}
          </div>

          {/* Feature Content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeFeature}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              transition={{ duration: 0.5 }}
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div>
                  <Badge variant="success" className="mb-4">{FEATURES_SHOWCASE[activeFeature].subtitle}</Badge>
                  <h3 className="text-4xl font-bold mb-6">{FEATURES_SHOWCASE[activeFeature].title}</h3>
                  <p className="text-xl text-text-secondary mb-8 leading-relaxed">{FEATURES_SHOWCASE[activeFeature].description}</p>

                  <div className="space-y-4 mb-8">
                    {FEATURES_SHOWCASE[activeFeature].benefits.map((benefit, idx) => {
                      const Icon = benefit.icon;
                      return (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="flex items-start gap-3"
                        >
                          <div className="size-6 bg-intent-success-bg rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                            <Icon className="size-4 text-intent-success" />
                          </div>
                          <span className="text-base text-text-primary">{benefit.text}</span>
                        </motion.div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-8">
                    <div>
                      <div className="text-5xl font-bold bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent mb-2">
                        {FEATURES_SHOWCASE[activeFeature].stats.primary}
                      </div>
                      <div className="text-caption text-text-muted">{FEATURES_SHOWCASE[activeFeature].stats.primaryLabel}</div>
                    </div>
                    <div>
                      <div className="text-5xl font-bold bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent mb-2">
                        {FEATURES_SHOWCASE[activeFeature].stats.secondary}
                      </div>
                      <div className="text-caption text-text-muted">{FEATURES_SHOWCASE[activeFeature].stats.secondaryLabel}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <Card className={`p-12 bg-gradient-to-br ${FEATURES_SHOWCASE[activeFeature].gradient} shadow-2xl`}>
                    <div className="aspect-video bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center border-2 border-white/20">
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.5 }}
                      >
                        {React.createElement(FEATURES_SHOWCASE[activeFeature].icon, { className: 'size-32 text-white/30' })}
                      </motion.div>
                    </div>
                  </Card>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* Testimonials - Premium */}
      <section id="customers" className="py-24 bg-surface-raised">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-5xl font-bold mb-4">
              Loved by India's Best Organizations
            </motion.h2>
            <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="text-xl text-text-secondary">
              Real stories. Real results. Real people.
            </motion.p>
          </div>

          <Card className="p-12 md:p-16 max-w-5xl mx-auto shadow-2xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentTestimonial}
                initial={{ opacity: 0, x: 100 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ duration: 0.5 }}
              >
                <div className="flex items-center justify-center gap-1 mb-8">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className="size-8 fill-intent-warning text-intent-warning" />
                  ))}
                </div>

                <p className="text-2xl md:text-3xl text-center mb-10 italic leading-relaxed text-text-primary">
                  "{TESTIMONIALS[currentTestimonial].quote}"
                </p>

                <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-8">
                  <div className="flex items-center gap-4">
                    <div className="size-20 bg-gradient-to-br from-brand-primary to-brand-accent rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-lg">
                      {TESTIMONIALS[currentTestimonial].avatar}
                    </div>
                    <div>
                      <div className="text-h3 font-bold">{TESTIMONIALS[currentTestimonial].name}</div>
                      <div className="text-body-sm text-text-muted">{TESTIMONIALS[currentTestimonial].role}</div>
                      <div className="text-caption text-text-muted">{TESTIMONIALS[currentTestimonial].organization}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {TESTIMONIALS[currentTestimonial].metrics.map((metric, idx) => (
                      <div key={idx} className="text-center">
                        <div className="text-3xl font-bold text-brand-primary mb-1">{metric.value}</div>
                        <div className="text-caption text-text-muted">{metric.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-center gap-3">
                  {TESTIMONIALS.map((_, idx) => (
                    <Button
                      key={idx}
                      onClick={() => setCurrentTestimonial(idx)}
                      variant="ghost"
                      size="icon"
                      className={`size-3 p-0 rounded-full transition-all hover:bg-transparent ${
                        idx === currentTestimonial ? 'bg-brand-primary w-12' : 'bg-surface-sunken hover:bg-surface-raised'
                      }`}
                    />
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </Card>
        </div>
      </section>

      {/* Case Studies - Download Cards */}
      <section className="py-24 bg-surface-canvas">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-intent-info-bg rounded-full mb-4">
              <FileText className="size-5 text-intent-info" />
              <span className="text-body-sm font-medium text-intent-info">Success Stories</span>
            </div>
            <h2 className="text-5xl font-bold mb-4">Real Results. Real Organizations.</h2>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto">
              Download detailed case studies and see exactly how we transformed these organizations
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                org: 'Pune Municipal Corporation',
                logo: 'PMC',
                challenge: 'Budget approval bottlenecks',
                solution: 'Automated workflows & real-time tracking',
                result: '84% faster approvals, ₹8.5Cr saved annually',
                stats: [
                  { label: 'Users', value: '12,000+' },
                  { label: 'Departments', value: '38' },
                  { label: 'ROI Timeline', value: '4 months' },
                ],
                color: 'from-blue-500 to-cyan-500',
              },
              {
                org: 'Gujarat Power Corporation',
                logo: 'GPC',
                challenge: '15 years of legacy data in Excel',
                solution: 'Zero-loss migration + unified platform',
                result: '100% data migrated in 6 weeks, 15K+ users',
                stats: [
                  { label: 'Data Migrated', value: '100%' },
                  { label: 'Go-Live Time', value: '6 weeks' },
                  { label: 'Satisfaction', value: '4.9/5' },
                ],
                color: 'from-orange-500 to-red-500',
              },
              {
                org: 'Maharashtra State PSU',
                logo: 'MSPSU',
                challenge: '5 different systems, data silos',
                solution: 'Single unified platform for all operations',
                result: '76% faster reporting, 99.8% data accuracy',
                stats: [
                  { label: 'Systems Replaced', value: '5→1' },
                  { label: 'Employees', value: '3,200+' },
                  { label: 'Annual Savings', value: '₹6.2Cr' },
                ],
                color: 'from-green-500 to-emerald-500',
              },
            ].map((caseStudy, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.1 }}
                className="group"
              >
                <Card className="p-8 h-full flex flex-col hover:shadow-2xl transition-all">
                  {/* Header */}
                  <div className={`size-20 bg-gradient-to-br ${caseStudy.color} rounded-2xl mb-6 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                    <span className="text-white font-bold text-2xl">{caseStudy.logo}</span>
                  </div>

                  <h3 className="text-h4 mb-4">{caseStudy.org}</h3>

                  {/* Challenge */}
                  <div className="mb-4">
                    <Badge variant="danger" className="mb-2">Challenge</Badge>
                    <p className="text-body-sm text-text-secondary">{caseStudy.challenge}</p>
                  </div>

                  {/* Solution */}
                  <div className="mb-4">
                    <Badge variant="info" className="mb-2">Solution</Badge>
                    <p className="text-body-sm text-text-secondary">{caseStudy.solution}</p>
                  </div>

                  {/* Result */}
                  <div className="mb-6 flex-1">
                    <Badge variant="success" className="mb-2">Result</Badge>
                    <p className="text-base font-semibold text-text-primary">{caseStudy.result}</p>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3 mb-6 p-4 bg-surface-sunken rounded-lg">
                    {caseStudy.stats.map((stat, sIdx) => (
                      <div key={sIdx} className="text-center">
                        <div className="text-h4 font-bold text-intent-primary mb-1">{stat.value}</div>
                        <div className="text-caption text-text-muted">{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Download Button */}
                  <Button variant="secondary" className="w-full group-hover:bg-gradient-to-r group-hover:from-brand-primary group-hover:to-brand-accent group-hover:text-white transition-all" leadingIcon={<FileText />}>
                    Download Case Study
                  </Button>
                </Card>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-12 text-center"
          >
            <Card className="p-8 max-w-3xl mx-auto bg-gradient-to-br from-intent-primary-bg to-surface-raised">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="text-start">
                  <h4 className="text-h3 mb-2">Want a Custom Case Study?</h4>
                  <p className="text-base text-text-secondary">
                    We can create a tailored analysis showing exactly how CivitasOne would work for your organization
                  </p>
                </div>
                <Button size="lg" leadingIcon={<Mail />} onClick={() => {
                  document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
                }}>
                  Request Analysis
                </Button>
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Pricing - Premium */}
      <section id="pricing" className="py-24 bg-surface-raised">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-5xl font-bold mb-4">
              Transparent Pricing. No Surprises.
            </motion.h2>
            <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="text-xl text-text-secondary max-w-3xl mx-auto">
              Everything included. No hidden fees. Cancel anytime.
            </motion.p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {PRICING_TIERS.map((tier, idx) => (
              <motion.div key={idx} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: idx * 0.1 }}>
                <Card className={`p-8 h-full flex flex-col ${tier.popular ? 'border-4 border-brand-primary shadow-2xl scale-105 relative' : ''}`}>
                  {tier.popular && (
                    <div className="absolute -top-5 start-1/2 -translate-x-1/2">
                      <Badge variant="primary" className="px-6 py-2 text-base shadow-lg">Most Popular</Badge>
                    </div>
                  )}
                  <div className="text-center mb-6">
                    <h3 className="text-2xl font-bold mb-2">{tier.name}</h3>
                    <p className="text-body-sm text-text-muted mb-4">{tier.description}</p>
                    <div className="mb-2">
                      <span className="text-6xl font-bold bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent">
                        {tier.price}
                      </span>
                      <span className="text-text-muted">/user/mo</span>
                    </div>
                    <p className="text-caption text-text-muted">{tier.users}</p>
                  </div>
                  <ul className="space-y-4 mb-8 flex-1">
                    {tier.features.map((feature, fIdx) => (
                      <li key={fIdx} className="flex items-start gap-3">
                        <CheckCircle className="size-5 text-intent-success flex-shrink-0 mt-0.5" />
                        <span className="text-body-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button variant={tier.popular ? 'primary' : 'secondary'} size="lg" className="w-full">
                    {tier.cta}
                  </Button>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Comparison Table */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-20"
          >
            <h3 className="text-h3 text-center mb-8">Feature Comparison</h3>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface-sunken border-b-2 border-border-subtle">
                    <tr>
                      <th className="px-6 py-4 text-start text-body-sm font-semibold text-text-primary">Feature</th>
                      {PRICING_TIERS.map((tier, idx) => (
                        <th key={idx} className={`px-6 py-4 text-center text-body-sm font-semibold ${tier.popular ? 'text-intent-primary' : 'text-text-primary'}`}>
                          {tier.name}
                          {tier.popular && (
                            <Badge variant="primary" className="ms-2 text-xs">Popular</Badge>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {[
                      { feature: 'Core Modules (Finance, HRMS)', values: [true, true, true] },
                      { feature: 'Procurement & Assets', values: [true, true, true] },
                      { feature: 'CRM & Helpdesk', values: [false, true, true] },
                      { feature: 'Projects & Inventory', values: [false, true, true] },
                      { feature: 'Custom Workflows', values: [false, true, true] },
                      { feature: 'Advanced Reports & Analytics', values: [false, true, true] },
                      { feature: 'API Access', values: ['Read-only', 'Full', 'Full + Custom'] },
                      { feature: 'Support', values: ['Email', 'Priority', '24/7 Dedicated'] },
                      { feature: 'Training Sessions', values: ['2 hours', '8 hours', 'Unlimited'] },
                      { feature: 'Data Retention', values: ['2 years', '5 years', 'Unlimited'] },
                      { feature: 'On-Premise Deployment', values: [false, false, true] },
                      { feature: 'Custom Integrations', values: [false, '2 included', 'Unlimited'] },
                    ].map((row, idx) => (
                      <tr key={idx} className="hover:bg-surface-sunken transition-colors">
                        <td className="px-6 py-4 text-body-sm text-text-primary font-medium">{row.feature}</td>
                        {row.values.map((value, vIdx) => (
                          <td key={vIdx} className="px-6 py-4 text-center">
                            {typeof value === 'boolean' ? (
                              value ? (
                                <CheckCircle className="size-5 text-intent-success mx-auto" />
                              ) : (
                                <X className="size-5 text-text-muted mx-auto" />
                              )
                            ) : (
                              <span className="text-body-sm text-text-secondary">{value}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>

          <div className="text-center mt-12">
            <Button variant="secondary" size="lg" onClick={() => navigate('/editions/compare')}>
              Compare All Plans →
            </Button>
          </div>
        </div>
      </section>

      {/* FAQ - Premium */}
      <section className="py-24 bg-surface-raised">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-5xl font-bold mb-4">
              Questions? Answered.
            </motion.h2>
            <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="text-xl text-text-secondary">
              Everything you need to know about CivitasOne Suite
            </motion.p>
          </div>

          <div className="space-y-4">
            {FAQ_ITEMS.map((faq, idx) => (
              <motion.div key={idx} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: idx * 0.05 }}>
                <Card
                  className={`p-6 cursor-pointer hover:shadow-lg transition-all ${expandedFaq === idx ? 'border-2 border-brand-primary' : ''}`}
                  onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="text-h4 flex-1">{faq.q}</h4>
                    <ChevronRight className={`size-6 text-brand-primary transition-transform flex-shrink-0 ${expandedFaq === idx ? 'rotate-90' : ''}`} />
                  </div>
                  <AnimatePresence>
                    {expandedFaq === idx && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                        <p className="text-base text-text-secondary mt-4 leading-relaxed">{faq.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact / Enquiry Form - Premium */}
      <section id="contact" className="py-24 bg-gradient-to-br from-surface-canvas via-surface-raised to-surface-canvas">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            {/* Left Side - Form */}
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
              <div className="mb-8">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-intent-primary-bg rounded-full mb-6">
                  <Mail className="size-5 text-intent-primary" />
                  <span className="text-body-sm font-medium text-intent-primary">Get in Touch</span>
                </div>
                <h2 className="text-5xl font-bold mb-4">
                  Request a <span className="text-brand-primary">Free Demo</span>
                </h2>
                <p className="text-xl text-text-secondary leading-relaxed">
                  See CivitasOne in action. Our experts will show you how we can transform your organization in just 30 minutes.
                </p>
              </div>

              <AnimatePresence mode="wait">
                {formSubmitted ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="bg-intent-success-bg border-2 border-intent-success rounded-2xl p-8 text-center"
                  >
                    <div className="size-16 bg-intent-success rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="size-8 text-white" />
                    </div>
                    <h3 className="text-h3 mb-2">Thank You!</h3>
                    <p className="text-base text-text-secondary">
                      We've received your enquiry. Our team will contact you within 2 business hours.
                    </p>
                  </motion.div>
                ) : (
                  <motion.form
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onSubmit={handleFormSubmit}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">
                          Full Name <span className="text-intent-danger">*</span>
                        </Label>
                        <Input
                          type="text"
                          id="name"
                          required
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          placeholder="John Doe"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">
                          Work Email <span className="text-intent-danger">*</span>
                        </Label>
                        <Input
                          type="email"
                          id="email"
                          required
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          placeholder="john@organization.gov.in"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="organization">
                          Organization <span className="text-intent-danger">*</span>
                        </Label>
                        <Input
                          type="text"
                          id="organization"
                          required
                          value={formData.organization}
                          onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                          placeholder="Municipal Corporation"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">
                          Phone Number <span className="text-intent-danger">*</span>
                        </Label>
                        <Input
                          type="tel"
                          id="phone"
                          required
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          placeholder="+91 98765 43210"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="role">
                          Your Role
                        </Label>
                        <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                          <SelectTrigger id="role">
                            <SelectValue placeholder="Select your role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cio">CIO / IT Head</SelectItem>
                            <SelectItem value="cfo">CFO / Finance Head</SelectItem>
                            <SelectItem value="admin">Administrator</SelectItem>
                            <SelectItem value="manager">Department Manager</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="users">
                          Number of Users
                        </Label>
                        <Select value={formData.users} onValueChange={(value) => setFormData({ ...formData, users: value })}>
                          <SelectTrigger id="users">
                            <SelectValue placeholder="Select user count" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="10-50">10-50 users</SelectItem>
                            <SelectItem value="50-200">50-200 users</SelectItem>
                            <SelectItem value="200-500">200-500 users</SelectItem>
                            <SelectItem value="500+">500+ users</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="message">
                        How can we help?
                      </Label>
                      <Textarea
                        id="message"
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        rows={4}
                        placeholder="Tell us about your requirements..."
                        className="resize-none"
                      />
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full text-lg py-6"
                      leadingIcon={<Rocket />}
                    >
                      Request Free Demo
                    </Button>

                    <p className="text-caption text-text-muted text-center">
                      By submitting, you agree to our <a href="/legal/privacy" className="text-intent-primary hover:underline">Privacy Policy</a>.
                      We'll contact you within 2 business hours.
                    </p>
                  </motion.form>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Right Side - Benefits & Trust */}
            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="space-y-8">
              {/* What You Get */}
              <Card className="p-8 bg-gradient-to-br from-intent-primary-bg to-surface-raised border-2 border-intent-primary/20">
                <h3 className="text-h3 mb-6 flex items-center gap-3">
                  <div className="size-12 bg-gradient-to-br from-intent-primary to-brand-accent rounded-xl flex items-center justify-center">
                    <Star className="size-6 text-white" />
                  </div>
                  What You'll Get
                </h3>
                <div className="space-y-4">
                  {[
                    { icon: Eye, text: '30-minute personalized demo', subtext: 'See your workflows in action' },
                    { icon: FileText, text: 'Custom ROI analysis', subtext: 'Savings calculator for your org' },
                    { icon: Users, text: 'Implementation roadmap', subtext: 'Timeline and migration plan' },
                    { icon: Award, text: 'Free trial access', subtext: '30 days, no credit card needed' },
                  ].map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <div key={idx} className="flex items-start gap-4">
                        <div className="size-10 bg-intent-success-bg rounded-lg flex items-center justify-center flex-shrink-0">
                          <Icon className="size-5 text-intent-success" />
                        </div>
                        <div className="flex-1">
                          <p className="text-base font-semibold text-text-primary">{item.text}</p>
                          <p className="text-caption text-text-muted">{item.subtext}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Trust Indicators */}
              <Card className="p-6">
                <h4 className="text-h4 mb-4">Trusted By</h4>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {['500+', '150K+', '99.97%'].map((stat, idx) => (
                    <div key={idx} className="text-center">
                      <div className="text-h2 text-intent-primary mb-1">{stat}</div>
                      <div className="text-caption text-text-muted">
                        {idx === 0 ? 'Organizations' : idx === 1 ? 'Users' : 'Uptime'}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3">
                  {['ISO 27001', 'SOC 2', 'MeitY', 'STQC', 'WCAG 2.2'].map((badge, idx) => (
                    <Badge key={idx} variant="success">{badge}</Badge>
                  ))}
                </div>
              </Card>

              {/* Contact Info */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <PhoneCall className="size-5 text-intent-primary" />
                  <div>
                    <p className="text-body-sm font-semibold text-text-primary">Call Us</p>
                    <p className="text-caption text-text-muted">+91-22-1234-5678</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="size-5 text-intent-primary" />
                  <div>
                    <p className="text-body-sm font-semibold text-text-primary">Email Us</p>
                    <p className="text-caption text-text-muted">sales@civitasone.com</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <MessageSquare className="size-5 text-intent-primary" />
                  <div>
                    <p className="text-body-sm font-semibold text-text-primary">Live Chat</p>
                    <p className="text-caption text-text-muted">Available Mon-Fri, 9 AM - 6 PM IST</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Final CTA - Premium */}
      <section className="py-32 bg-gradient-to-br from-brand-primary via-brand-accent to-brand-primary bg-[length:200%_200%] animate-gradient">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-6xl font-bold text-white mb-6">
              Ready to Transform Your Organization?
            </h2>
            <p className="text-2xl text-white/90 mb-12 max-w-3xl mx-auto leading-relaxed">
              Join 500+ government departments and PSUs who trust CivitasOne for their digital transformation.
              See why we're India's #1 Government ERP.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <Button variant="secondary" size="lg" className="text-lg px-10 py-6 shadow-2xl" leadingIcon={<PhoneCall />} onClick={() => navigate('/company/contact')}>
                Schedule Live Demo
              </Button>
              <Button variant="secondary" size="lg" className="text-lg px-10 py-6 shadow-2xl" leadingIcon={<Mail />}>
                Talk to Sales
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-8 text-white/80">
              <div className="flex items-center gap-2">
                <CheckCircle className="size-5" />
                <span>Free 30-Day Trial</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="size-5" />
                <span>No Credit Card</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="size-5" />
                <span>Setup in 4-12 Weeks</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="size-5" />
                <span>ROI in 4-8 Months</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-surface-raised border-t-2 border-border-subtle py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            {[
              { title: 'Product', links: ['Features', 'Integrations', 'Pricing', 'Changelog', 'Roadmap'] },
              { title: 'Editions', links: ['Small Office', 'PSU', 'Govt Department', 'Compare Editions'] },
              { title: 'Resources', links: ['Documentation', 'API Reference', 'Guides', 'Blog', 'Community'] },
              { title: 'Company', links: ['About Us', 'Careers', 'Contact', 'Partners', 'Press Kit'] },
              { title: 'Legal', links: ['Terms of Service', 'Privacy Policy', 'Cookie Policy', 'Accessibility', 'Trademarks'] },
            ].map((column, index) => (
              <div key={index}>
                <h3 className="text-body-sm font-semibold text-text-primary mb-4">{column.title}</h3>
                <ul className="space-y-3">
                  {column.links.map((link) => (
                    <li key={link}>
                      <a href={getLinkPath(link)} className="text-caption text-text-muted hover:text-text-primary transition-colors">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="pt-8 border-t border-border-subtle flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-caption text-text-muted">
              © 2026 CivitasOne Technologies Pvt. Ltd. All rights reserved.
            </div>
            <div className="flex items-center gap-6">
              <a href="/status" className="flex items-center gap-2 text-caption text-text-muted hover:text-text-primary transition-colors">
                <div className="size-2 bg-intent-success rounded-full animate-pulse" />
                All Systems Operational
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Sticky CTA Bar */}
      <AnimatePresence>
        {showStickyBar && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-0 start-0 end-0 z-50 bg-gradient-to-r from-brand-primary to-brand-accent border-t-4 border-white/20 shadow-2xl backdrop-blur-lg"
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-white">
                  <h4 className="text-h4 font-bold mb-1">Ready to Get Started?</h4>
                  <p className="text-caption opacity-90">Join 500+ organizations. Free 30-day trial, no credit card required.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    leadingIcon={<Rocket />}
                  >
                    Request Demo
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setShowStickyBar(false)}
                  >
                    <X className="size-5" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live Chat Indicator */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 2, type: 'spring' }}
        className="fixed bottom-6 end-6 z-40"
      >
        <Button
          onClick={() => navigate('/company/contact')}
          size="icon"
          className="group relative size-16 bg-gradient-to-br from-intent-success to-brand-accent hover:bg-gradient-to-br hover:from-intent-success hover:to-brand-accent rounded-full shadow-2xl hover:shadow-3xl transition-all hover:scale-110"
          aria-label="Start live chat"
        >
          <MessageSquare className="size-8 text-white" />
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute -top-1 -end-1 size-4 bg-intent-danger rounded-full border-2 border-white pointer-events-none"
          />
          <div className="absolute bottom-full end-0 mb-2 hidden group-hover:block pointer-events-none">
            <div className="bg-surface-canvas text-text-primary px-4 py-2 rounded-lg shadow-lg whitespace-nowrap text-body-sm">
              Chat with us! We're online →
            </div>
          </div>
        </Button>
      </motion.div>

      {/* Video Modal */}
      <AnimatePresence>
        {videoPlaying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setVideoPlaying(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-6xl w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <Card className="p-8 bg-surface-raised shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-h3">CivitasOne Platform Tour</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setVideoPlaying(false)}
                    aria-label="Close video"
                  >
                    <X className="size-6" />
                  </Button>
                </div>

                {/* Video Player Placeholder */}
                <div className="aspect-video bg-gradient-to-br from-brand-primary to-brand-accent rounded-xl flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-black/40" />
                  <div className="relative z-10 text-center text-white">
                    <Play className="size-24 mx-auto mb-6 opacity-80" />
                    <h4 className="text-h3 mb-3">Interactive Demo Video</h4>
                    <p className="text-lg mb-6 max-w-2xl mx-auto">
                      See how CivitasOne transforms government operations with real workflows from our customers
                    </p>
                    <div className="flex items-center justify-center gap-4">
                      <Badge variant="success" className="text-base px-4 py-2">5 min overview</Badge>
                      <Badge variant="info" className="text-base px-4 py-2">All modules</Badge>
                      <Badge variant="warning" className="text-base px-4 py-2">Real workflows</Badge>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-4">
                  {[
                    { time: '0:30', title: 'Unified Dashboard', icon: BarChart3 },
                    { time: '2:15', title: 'Finance & Procurement', icon: DollarSign },
                    { time: '4:00', title: 'HRMS & Approvals', icon: Users },
                  ].map((chapter, idx) => {
                    const Icon = chapter.icon;
                    return (
                      <button
                        key={idx}
                        className="p-4 bg-surface-sunken hover:bg-surface-canvas rounded-lg text-start transition-colors group"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <Icon className="size-5 text-intent-primary" />
                          <Badge variant="neutral" className="text-xs">{chapter.time}</Badge>
                        </div>
                        <p className="text-body-sm font-medium text-text-primary group-hover:text-intent-primary transition-colors">
                          {chapter.title}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient {
          animation: gradient 3s ease infinite;
        }
      `}</style>
    </div>
  );
}
