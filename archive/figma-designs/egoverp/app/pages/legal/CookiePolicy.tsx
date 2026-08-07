import { Card, Button } from '../../components/ui';
import { Cookie, Download, Calendar, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const COOKIE_TYPES = [
  {
    name: 'Essential Cookies',
    purpose: 'Required for basic site functionality',
    duration: 'Session / 1 year',
    canDisable: false,
    examples: ['Authentication tokens', 'Session management', 'Security features', 'Load balancing'],
  },
  {
    name: 'Functional Cookies',
    purpose: 'Remember your preferences and settings',
    duration: '1 year',
    canDisable: true,
    examples: ['Language preference', 'Theme selection', 'Dashboard layout', 'Recent searches'],
  },
  {
    name: 'Analytics Cookies',
    purpose: 'Help us understand how you use our service',
    duration: '2 years',
    canDisable: true,
    examples: ['Google Analytics', 'Usage patterns', 'Feature adoption', 'Performance metrics'],
  },
  {
    name: 'Marketing Cookies',
    purpose: 'Track effectiveness of marketing campaigns',
    duration: '1 year',
    canDisable: true,
    examples: ['Campaign tracking', 'Conversion analytics', 'A/B testing', 'Remarketing'],
  },
];

export function CookiePolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 px-4 py-2 bg-intent-warning-bg rounded-full mb-6">
            <Cookie className="size-5 text-intent-warning" />
            <span className="text-body-sm font-medium text-intent-warning">Cookie Usage</span>
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-display mb-4">Cookie Policy</motion.h1>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex items-center gap-4 text-body-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <Calendar className="size-4" />
              <span>Last updated: May 23, 2026</span>
            </div>
            <Button variant="secondary" size="sm" leadingIcon={<Download />}>Download PDF</Button>
          </motion.div>
        </div>

        <Card className="p-8 bg-intent-warning-bg border-2 border-intent-warning mb-8">
          <p className="text-body-sm text-text-primary">
            This Cookie Policy explains how CivitasOne Suite uses cookies and similar technologies to recognize you when you visit our service. It explains what these technologies are, why we use them, and your rights to control our use of them.
          </p>
        </Card>

        <Card className="p-8 mb-8">
          <h2 className="text-h2 mb-4">What Are Cookies?</h2>
          <p className="text-body-sm text-text-secondary mb-4">
            Cookies are small text files that are stored on your device (computer, tablet, or mobile) when you visit a website. They are widely used to make websites work more efficiently and provide information to website owners.
          </p>
          <p className="text-body-sm text-text-secondary">
            We use both session cookies (which expire when you close your browser) and persistent cookies (which stay on your device until deleted or expired).
          </p>
        </Card>

        <div className="space-y-6 mb-12">
          {COOKIE_TYPES.map((type, idx) => (
            <Card key={idx} className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-h3 mb-2">{type.name}</h3>
                  <p className="text-body-sm text-text-secondary mb-2">{type.purpose}</p>
                  <p className="text-caption text-text-muted">Duration: {type.duration}</p>
                </div>
                <div className="text-end">
                  {type.canDisable ? (
                    <span className="text-caption text-intent-warning">Optional</span>
                  ) : (
                    <span className="text-caption text-intent-success">Required</span>
                  )}
                </div>
              </div>
              <div className="p-4 bg-surface-sunken rounded-lg">
                <p className="text-caption text-text-muted mb-2">Examples:</p>
                <ul className="list-disc list-inside space-y-1">
                  {type.examples.map((example, eIdx) => (
                    <li key={eIdx} className="text-body-sm text-text-primary">{example}</li>
                  ))}
                </ul>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-8 mb-8">
          <h2 className="text-h2 mb-4">Managing Your Cookie Preferences</h2>
          <p className="text-body-sm text-text-secondary mb-6">
            You can control and manage cookies in various ways. Please note that removing or blocking cookies can impact your user experience and some functionality may no longer be available.
          </p>
          <div className="space-y-4">
            <div className="p-4 bg-surface-sunken rounded-lg">
              <h4 className="text-h4 mb-2">Browser Settings</h4>
              <p className="text-caption text-text-muted">Most browsers allow you to refuse or accept cookies. Instructions vary by browser type.</p>
            </div>
            <div className="p-4 bg-surface-sunken rounded-lg">
              <h4 className="text-h4 mb-2">Opt-Out Tools</h4>
              <p className="text-caption text-text-muted">You can opt out of analytics cookies using browser extensions or platform-specific opt-out pages.</p>
            </div>
            <div className="p-4 bg-surface-sunken rounded-lg flex items-start justify-between">
              <div>
                <h4 className="text-h4 mb-2">Cookie Preferences</h4>
                <p className="text-caption text-text-muted">Manage your cookie preferences for CivitasOne Suite</p>
              </div>
              <Button variant="primary" size="sm" leadingIcon={<Settings />}>Manage Cookies</Button>
            </div>
          </div>
        </Card>

        <Card className="p-8 mb-8">
          <h2 className="text-h2 mb-4">Third-Party Cookies</h2>
          <p className="text-body-sm text-text-secondary mb-4">
            We use services from trusted third-party providers that may also set cookies on your device:
          </p>
          <ul className="space-y-2">
            <li className="text-body-sm text-text-primary">• Google Analytics - for usage analytics</li>
            <li className="text-body-sm text-text-primary">• Payment processors - for secure payment processing</li>
            <li className="text-body-sm text-text-primary">• Cloud providers (AWS/Azure) - for service delivery</li>
          </ul>
        </Card>

        <Card className="p-8 bg-surface-sunken">
          <h3 className="text-h3 mb-4">Questions About Cookies?</h3>
          <p className="text-body-sm text-text-secondary mb-4">
            If you have questions about our use of cookies, please contact us:
          </p>
          <p className="text-body-sm text-text-primary mb-1"><strong>Email:</strong> privacy@civitasone.com</p>
          <Button variant="primary" size="md" onClick={() => navigate('/company/contact')} className="mt-4">Contact Us</Button>
        </Card>
      </div>

      <PublicFooter />
    </div>
  );
}
