import { Card, Button } from '../../components/ui';
import { Target, Users, Globe, Award, TrendingUp, Heart, Shield, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const STATS = [
  { label: 'Year Founded', value: '2018' },
  { label: 'Active Customers', value: '500+' },
  { label: 'Team Members', value: '150+' },
  { label: 'Countries Served', value: '12' },
];

const VALUES = [
  { icon: Shield, title: 'Trust & Security', description: 'We prioritize data security and customer privacy in everything we build.' },
  { icon: Users, title: 'Customer First', description: 'Our customers\' success is our success. We listen, adapt, and deliver.' },
  { icon: Zap, title: 'Innovation', description: 'Continuous improvement and cutting-edge technology drive our product development.' },
  { icon: Heart, title: 'Social Impact', description: 'Empowering government and public sector to serve citizens better.' },
];

const MILESTONES = [
  { year: '2018', title: 'Company Founded', description: 'Started with a vision to digitize government operations in India' },
  { year: '2019', title: 'First Government Deployment', description: 'Deployed for a state government department serving 50,000+ citizens' },
  { year: '2021', title: 'MeitY Empanelment', description: 'Recognized and empanelled by Ministry of Electronics & IT' },
  { year: '2023', title: 'Pan-India Expansion', description: 'Serving PSUs and government departments across 20+ states' },
  { year: '2026', title: 'AI-Powered Features', description: 'Launched machine learning capabilities for predictive analytics' },
];

export function About() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-display mb-4">
            Empowering Government Digital Transformation
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-base text-text-secondary max-w-3xl mx-auto">
            CivitasOne Technologies is India's leading provider of enterprise resource planning software for government and public sector organizations. We combine deep domain expertise with cutting-edge technology to deliver solutions that transform how governments serve their citizens.
          </motion.p>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mb-16">
          <Card className="p-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              {STATS.map((stat, idx) => (
                <div key={idx}>
                  <p className="text-display mb-2">{stat.value}</p>
                  <p className="text-caption text-text-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        <div className="mb-16">
          <h2 className="text-h1 mb-8 text-center">Our Mission & Vision</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-8 bg-gradient-to-br from-intent-primary-bg to-surface-raised">
              <div className="size-16 bg-gradient-to-br from-brand-primary to-brand-accent rounded-2xl mb-6 flex items-center justify-center">
                <Target className="size-8 text-white" />
              </div>
              <h3 className="text-h2 mb-4">Our Mission</h3>
              <p className="text-body-sm text-text-secondary">
                To enable digital transformation in government and public sector by providing world-class, compliant, and user-friendly ERP solutions that improve efficiency, transparency, and citizen service delivery.
              </p>
            </Card>
            <Card className="p-8 bg-gradient-to-br from-intent-success-bg to-surface-raised">
              <div className="size-16 bg-gradient-to-br from-brand-primary to-brand-accent rounded-2xl mb-6 flex items-center justify-center">
                <Globe className="size-8 text-white" />
              </div>
              <h3 className="text-h2 mb-4">Our Vision</h3>
              <p className="text-body-sm text-text-secondary">
                To be the most trusted technology partner for government institutions across India, setting the standard for innovation, compliance, and impact in public sector digital transformation.
              </p>
            </Card>
          </div>
        </div>

        <div className="mb-16">
          <h2 className="text-h1 mb-8 text-center">Our Values</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {VALUES.map((value, idx) => {
              const Icon = value.icon;
              return (
                <Card key={idx} className="p-6 text-center">
                  <div className="size-12 bg-intent-primary-bg rounded-lg mx-auto mb-4 flex items-center justify-center">
                    <Icon className="size-6 text-intent-primary" />
                  </div>
                  <h3 className="text-h4 mb-2">{value.title}</h3>
                  <p className="text-caption text-text-muted">{value.description}</p>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="mb-16">
          <h2 className="text-h1 mb-8 text-center">Our Journey</h2>
          <Card className="p-8">
            <div className="space-y-8">
              {MILESTONES.map((milestone, idx) => (
                <div key={idx} className="flex items-start gap-6">
                  <div className="size-16 bg-gradient-to-br from-brand-primary to-brand-accent rounded-full flex items-center justify-center text-white font-bold flex-shrink-0">
                    {milestone.year}
                  </div>
                  <div className="flex-1 pt-2">
                    <h4 className="text-h3 mb-2">{milestone.title}</h4>
                    <p className="text-body-sm text-text-secondary">{milestone.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="p-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white text-center">
          <h2 className="text-h1 mb-4">Join Our Mission</h2>
          <p className="text-base opacity-90 mb-6 max-w-2xl mx-auto">
            We're always looking for talented individuals passionate about technology and public service.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button variant="secondary" size="lg" onClick={() => navigate('/company/careers')}>
              View Open Positions
            </Button>
            <Button variant="secondary" size="lg" onClick={() => navigate('/company/contact')}>
              Get in Touch
            </Button>
          </div>
        </Card>
      </div>

      <PublicFooter />
    </div>
  );
}
