import { Card, Button } from '../../components/ui';
import { Eye, Download, Calendar, CheckCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

export function Accessibility() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 px-4 py-2 bg-intent-success-bg rounded-full mb-6">
            <Eye className="size-5 text-intent-success" />
            <span className="text-body-sm font-medium text-intent-success">WCAG 2.2 AA Compliant</span>
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-display mb-4">Accessibility Statement</motion.h1>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex items-center gap-4 text-body-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <Calendar className="size-4" />
              <span>Last updated: May 23, 2026</span>
            </div>
          </motion.div>
        </div>

        <Card className="p-8 bg-intent-success-bg border-2 border-intent-success mb-8">
          <p className="text-body-sm text-text-primary">
            CivitasOne Technologies is committed to ensuring digital accessibility for people with disabilities. We continually improve the user experience for everyone and apply relevant accessibility standards to ensure our service is accessible to all users.
          </p>
        </Card>

        <Card className="p-8 mb-8">
          <h2 className="text-h2 mb-4">Conformance Status</h2>
          <p className="text-body-sm text-text-secondary mb-4">
            CivitasOne Suite conforms to <strong>WCAG 2.2 Level AA</strong> standards. These guidelines explain how to make web content accessible to people with disabilities.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-surface-sunken rounded-lg text-center">
              <CheckCircle className="size-8 text-intent-success mx-auto mb-2" />
              <p className="text-h4">WCAG 2.2</p>
              <p className="text-caption text-text-muted">Level AA</p>
            </div>
            <div className="p-4 bg-surface-sunken rounded-lg text-center">
              <CheckCircle className="size-8 text-intent-success mx-auto mb-2" />
              <p className="text-h4">Section 508</p>
              <p className="text-caption text-text-muted">Compliant</p>
            </div>
            <div className="p-4 bg-surface-sunken rounded-lg text-center">
              <CheckCircle className="size-8 text-intent-success mx-auto mb-2" />
              <p className="text-h4">EN 301 549</p>
              <p className="text-caption text-text-muted">EU Standard</p>
            </div>
          </div>
        </Card>

        <Card className="p-8 mb-8">
          <h2 className="text-h2 mb-4">Accessibility Features</h2>
          <div className="space-y-3">
            {[
              'Keyboard navigation support for all interactive elements',
              'Screen reader compatibility (NVDA, JAWS, VoiceOver)',
              'Sufficient color contrast ratios (minimum 4.5:1)',
              'Resizable text up to 200% without loss of functionality',
              'Alternative text for all images and icons',
              'ARIA labels and landmarks for improved navigation',
              'Focus indicators on all interactive elements',
              'Support for browser zoom and text spacing',
              'Captions and transcripts for multimedia content',
              'Forms with clear labels and error messages',
            ].map((feature, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <CheckCircle className="size-5 text-intent-success flex-shrink-0 mt-0.5" />
                <p className="text-body-sm text-text-primary">{feature}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-8 mb-8">
          <h2 className="text-h2 mb-4">Assistive Technology Compatibility</h2>
          <p className="text-body-sm text-text-secondary mb-4">CivitasOne Suite is designed to be compatible with:</p>
          <ul className="space-y-2">
            <li className="text-body-sm text-text-primary">• Screen readers (NVDA, JAWS, VoiceOver, TalkBack)</li>
            <li className="text-body-sm text-text-primary">• Screen magnification software</li>
            <li className="text-body-sm text-text-primary">• Speech recognition software</li>
            <li className="text-body-sm text-text-primary">• Alternative input devices</li>
          </ul>
        </Card>

        <Card className="p-8 bg-surface-sunken">
          <h3 className="text-h3 mb-4">Feedback & Support</h3>
          <p className="text-body-sm text-text-secondary mb-4">
            We welcome feedback on the accessibility of CivitasOne Suite. If you encounter accessibility barriers, please contact us:
          </p>
          <p className="text-body-sm text-text-primary mb-1"><strong>Email:</strong> accessibility@civitasone.com</p>
          <p className="text-body-sm text-text-primary mb-4"><strong>Response Time:</strong> Within 2 business days</p>
          <Button variant="primary" size="md" onClick={() => navigate('/company/contact')}>Contact Accessibility Team</Button>
        </Card>
      </div>

      <PublicFooter />
    </div>
  );
}
