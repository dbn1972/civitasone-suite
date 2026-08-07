import { Card, Button } from '../../components/ui';
import { FileText, Download, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    content: 'By accessing and using CivitasOne Suite ("the Service"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.',
  },
  {
    title: '2. Use License',
    content: 'Permission is granted to temporarily access and use the Service for personal or internal business purposes. This is the grant of a license, not a transfer of title, and under this license you may not: modify or copy the materials; use the materials for any commercial purpose without prior authorization; attempt to decompile or reverse engineer any software contained in the Service; remove any copyright or other proprietary notations from the materials.',
  },
  {
    title: '3. Service Description',
    content: 'CivitasOne Suite provides cloud-based and on-premises enterprise resource planning software including but not limited to finance, human resources, procurement, inventory, and project management modules. The Service is provided on a subscription basis with various tiers and pricing plans.',
  },
  {
    title: '4. User Accounts and Security',
    content: 'You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to immediately notify us of any unauthorized use of your account. We reserve the right to disable any user account at any time if we believe you have violated any provision of these Terms.',
  },
  {
    title: '5. Data Ownership and Privacy',
    content: 'You retain all rights, title, and interest in and to your data. We claim no ownership or control over any data submitted, posted, or displayed by you. Your use of the Service is also governed by our Privacy Policy. We implement industry-standard security measures to protect your data, including encryption at rest and in transit.',
  },
  {
    title: '6. Subscription and Payment',
    content: 'Service fees are based on the selected subscription plan and user count. Subscriptions automatically renew unless canceled before the renewal date. All fees are exclusive of applicable taxes. Payment is due within 30 days of invoice date. Failure to pay may result in service suspension. Refunds are not provided for partial subscription periods.',
  },
  {
    title: '7. Service Level Agreement',
    content: 'We commit to service availability as specified in your subscription tier SLA. Scheduled maintenance will be communicated in advance. In case of unplanned downtime exceeding SLA thresholds, service credits may be issued as per the SLA document. The SLA does not apply to issues caused by factors outside our reasonable control.',
  },
  {
    title: '8. Disclaimer',
    content: 'The Service is provided "as is" without warranty of any kind, either express or implied, including but not limited to the implied warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, timely, secure, or error-free.',
  },
  {
    title: '9. Limitations of Liability',
    content: 'In no event shall CivitasOne Suite or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the Service, even if we have been notified of the possibility of such damage. Our total liability shall not exceed the amount paid by you for the Service in the 12 months preceding the claim.',
  },
  {
    title: '10. Indemnification',
    content: 'You agree to indemnify and hold harmless CivitasOne Suite, its contractors, and its licensors from any claims, damages, and expenses (including attorneys\' fees) arising from your use of the Service, your violation of these Terms, or your violation of any rights of another.',
  },
  {
    title: '11. Governing Law',
    content: 'These Terms shall be governed and construed in accordance with the laws of India, specifically under the Information Technology Act, 2000 and amendments thereto. Any disputes shall be subject to the exclusive jurisdiction of the courts in Mumbai, Maharashtra, India.',
  },
  {
    title: '12. Changes to Terms',
    content: 'We reserve the right to modify or replace these Terms at any time. Material changes will be notified via email at least 30 days prior to the new terms taking effect. By continuing to access or use our Service after those revisions become effective, you agree to be bound by the revised terms.',
  },
  {
    title: '13. Termination',
    content: 'We may terminate or suspend access to our Service immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms. Upon termination, your right to use the Service will immediately cease. You may terminate your subscription at any time through your account settings. Data export functionality will be available for 30 days post-termination.',
  },
];

export function Terms() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-intent-info-bg rounded-full mb-6"
          >
            <FileText className="size-5 text-intent-info" />
            <span className="text-body-sm font-medium text-intent-info">Legal Agreement</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            Terms of Service
          </motion.h1>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex items-center gap-4 text-body-sm text-text-secondary"
          >
            <div className="flex items-center gap-2">
              <Calendar className="size-4" />
              <span>Last updated: May 23, 2026</span>
            </div>
            <Button variant="secondary" size="sm" leadingIcon={<Download />}>
              Download PDF
            </Button>
          </motion.div>
        </div>

        {/* Introduction */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-8"
        >
          <Card className="p-8 bg-intent-info-bg border-2 border-intent-info">
            <p className="text-body-sm text-text-primary">
              <strong>Please read these Terms of Service carefully before using CivitasOne Suite.</strong> These Terms govern your access to and use of our software, services, and websites. By accessing or using any part of the Service, you agree to become bound by the Terms of this agreement. If you do not agree to all the terms and conditions of this agreement, then you may not access the Service.
            </p>
          </Card>
        </motion.div>

        {/* Terms Sections */}
        <div className="space-y-6 mb-12">
          {SECTIONS.map((section, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + index * 0.05 }}
            >
              <Card className="p-6">
                <h2 className="text-h3 mb-3">{section.title}</h2>
                <p className="text-body-sm text-text-secondary leading-relaxed">{section.content}</p>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Contact Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
        >
          <Card className="p-8 bg-surface-sunken">
            <h3 className="text-h3 mb-4">Questions About These Terms?</h3>
            <p className="text-body-sm text-text-secondary mb-4">
              If you have any questions about these Terms of Service, please contact our legal team:
            </p>
            <p className="text-body-sm text-text-primary mb-1">
              <strong>Email:</strong> legal@civitasone.com
            </p>
            <p className="text-body-sm text-text-primary mb-4">
              <strong>Address:</strong> CivitasOne Technologies Pvt. Ltd., Mumbai, Maharashtra, India
            </p>
            <Button variant="primary" size="md" onClick={() => navigate('/contact')}>
              Contact Legal Team
            </Button>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
