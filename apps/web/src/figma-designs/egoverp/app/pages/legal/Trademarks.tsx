import { Card, Button } from '../../components/ui';
import { Award, AlertTriangle, Calendar, CheckCircle, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

export function Trademarks() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 px-4 py-2 bg-intent-primary-bg rounded-full mb-6">
            <Award className="size-5 text-intent-primary" />
            <span className="text-body-sm font-medium text-intent-primary">Intellectual Property</span>
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-display mb-4">Trademark Usage Policy</motion.h1>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex items-center gap-4 text-body-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <Calendar className="size-4" />
              <span>Last updated: May 23, 2026</span>
            </div>
          </motion.div>
        </div>

        <Card className="p-8 bg-intent-primary-bg border-2 border-intent-primary mb-8">
          <p className="text-body-sm text-text-primary">
            CivitasOne, CivitasOne Suite, and related marks are trademarks or registered trademarks of CivitasOne Technologies Pvt. Ltd. in India and other countries. This page explains how you may and may not use our trademarks.
          </p>
        </Card>

        <Card className="p-8 mb-8">
          <h2 className="text-h2 mb-4">Our Trademarks</h2>
          <p className="text-body-sm text-text-secondary mb-6">
            The following are registered or common law trademarks of CivitasOne Technologies Pvt. Ltd.:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              'CivitasOne®',
              'CivitasOne Suite®',
              'CivitasOne Logo',
              'C1 Design Mark',
              'CivitasOne Technologies',
              'Digital India Ready ERP™',
            ].map((mark, idx) => (
              <div key={idx} className="p-4 bg-surface-sunken rounded-lg">
                <p className="text-body-sm font-semibold text-text-primary">{mark}</p>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="size-8 text-intent-success" />
              <h3 className="text-h3">Permitted Uses</h3>
            </div>
            <ul className="space-y-2">
              {[
                'Referencing our products in reviews or articles',
                'Accurately describing integration with our service',
                'Educational or training materials (with attribution)',
                'Factual comparative advertising',
              ].map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-intent-success mt-1">•</span>
                  <span className="text-body-sm text-text-primary flex-1">{item}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <X className="size-8 text-intent-danger" />
              <h3 className="text-h3">Prohibited Uses</h3>
            </div>
            <ul className="space-y-2">
              {[
                'Implying endorsement or partnership without agreement',
                'Using marks in domain names or app names',
                'Modifying or altering our trademarks',
                'Using marks in a misleading manner',
              ].map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-intent-danger mt-1">•</span>
                  <span className="text-body-sm text-text-primary flex-1">{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="p-8 mb-8">
          <h2 className="text-h2 mb-4">Trademark Usage Guidelines</h2>
          <div className="space-y-4">
            <div>
              <h4 className="text-h4 mb-2">1. Always Use as an Adjective</h4>
              <p className="text-body-sm text-text-secondary mb-2">Correct: "CivitasOne Suite software"</p>
              <p className="text-body-sm text-text-muted">Incorrect: "I use CivitasOne daily"</p>
            </div>
            <div>
              <h4 className="text-h4 mb-2">2. Use Proper Trademark Symbols</h4>
              <p className="text-body-sm text-text-secondary">Use ® for registered marks and ™ for unregistered marks on first prominent use.</p>
            </div>
            <div>
              <h4 className="text-h4 mb-2">3. Do Not Modify or Abbreviate</h4>
              <p className="text-body-sm text-text-secondary">Use our trademarks exactly as shown. Do not create variations or portmanteaus.</p>
            </div>
            <div>
              <h4 className="text-h4 mb-2">4. Include Attribution</h4>
              <p className="text-body-sm text-text-secondary">
                "CivitasOne is a registered trademark of CivitasOne Technologies Pvt. Ltd."
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-8 bg-intent-warning-bg border-2 border-intent-warning mb-8">
          <div className="flex items-start gap-4">
            <AlertTriangle className="size-6 text-intent-warning flex-shrink-0 mt-1" />
            <div>
              <h3 className="text-h3 mb-2">Third-Party Trademarks</h3>
              <p className="text-body-sm text-text-primary">
                All other trademarks mentioned on our website are the property of their respective owners. Mention of third-party trademarks does not imply endorsement or affiliation.
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-8 bg-surface-sunken">
          <h3 className="text-h3 mb-4">Questions or Trademark Violations?</h3>
          <p className="text-body-sm text-text-secondary mb-4">
            For trademark licensing inquiries or to report unauthorized use:
          </p>
          <p className="text-body-sm text-text-primary mb-1"><strong>Email:</strong> legal@civitasone.com</p>
          <p className="text-body-sm text-text-primary mb-4"><strong>Subject:</strong> Trademark Inquiry</p>
          <Button variant="primary" size="md" onClick={() => navigate('/company/contact')}>Contact Legal Team</Button>
        </Card>
      </div>

      <PublicFooter />
    </div>
  );
}
