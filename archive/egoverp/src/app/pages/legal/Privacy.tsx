import { Card, Button } from '../../components/ui';
import { Shield, Download, Calendar, Lock, Eye, Database, UserCheck, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const SECTIONS = [
  {
    title: '1. Information We Collect',
    icon: Database,
    content: 'We collect information you provide directly to us when you create an account, use our Service, or communicate with us. This includes: Account information (name, email, phone number, company details), Payment information (processed securely through third-party payment processors), Usage data (features used, time spent, actions taken), Technical data (IP address, browser type, device information), Support communications and feedback.',
  },
  {
    title: '2. How We Use Your Information',
    icon: Eye,
    content: 'We use the information we collect to: Provide, maintain, and improve our Service; Process transactions and send related information; Send technical notices, updates, security alerts, and support messages; Respond to your comments and questions; Monitor and analyze trends, usage, and activities; Detect, prevent, and address technical issues and security vulnerabilities; Comply with legal obligations and enforce our Terms of Service.',
  },
  {
    title: '3. Data Storage and Security',
    icon: Lock,
    content: 'Your data is stored on secure servers located in India or other jurisdictions as specified in your service agreement. We implement industry-standard security measures including: AES-256 encryption at rest, TLS 1.3 for data in transit, Multi-factor authentication, Role-based access controls, Regular security audits and penetration testing, Automated backup and disaster recovery, 24/7 security monitoring and incident response. While we strive to protect your data, no method of transmission or storage is 100% secure.',
  },
  {
    title: '4. Data Sharing and Disclosure',
    icon: UserCheck,
    content: 'We do not sell your personal data. We may share your information only in the following circumstances: With your consent; With service providers who perform services on our behalf (cloud hosting, payment processing, customer support) under strict confidentiality agreements; To comply with legal obligations, court orders, or government requests; To protect our rights, property, or safety, and that of our users; In connection with a merger, acquisition, or sale of assets (you will be notified via email and/or notice on our website).',
  },
  {
    title: '5. Your Rights and Choices',
    icon: UserCheck,
    content: 'You have the right to: Access your personal data and request a copy; Correct inaccurate or incomplete data; Delete your data (subject to legal retention requirements); Object to processing of your data; Restrict processing of your data; Export your data in a portable format (data portability); Withdraw consent at any time; Lodge a complaint with a supervisory authority. To exercise these rights, contact us at privacy@civitasone.com.',
  },
  {
    title: '6. Data Retention',
    icon: Database,
    content: 'We retain your information for as long as your account is active or as needed to provide you services. After account termination, we retain data for: 30 days for data recovery, then: Financial records for 7 years (as per Indian tax laws), Audit logs and compliance data as required by applicable regulations, Aggregated and anonymized data indefinitely for analytics. You may request earlier deletion subject to legal retention requirements.',
  },
  {
    title: '7. International Data Transfers',
    icon: AlertTriangle,
    content: 'Your data is primarily stored in India. If you access our Service from outside India, your data may be transferred to, stored, and processed in India or other countries. We ensure appropriate safeguards are in place for international transfers, including Standard Contractual Clauses approved by relevant authorities and compliance with applicable data protection laws.',
  },
  {
    title: '8. Cookies and Tracking',
    icon: Eye,
    content: 'We use cookies and similar tracking technologies to collect usage information and improve your experience. You can control cookies through your browser settings. Types of cookies we use: Essential cookies (required for service functionality), Analytics cookies (to understand usage patterns), Preference cookies (to remember your settings). See our Cookie Policy for detailed information.',
  },
  {
    title: '9. Third-Party Services',
    icon: UserCheck,
    content: 'Our Service may contain links to third-party websites or integrate with third-party services (payment gateways, government portals, productivity tools). We are not responsible for the privacy practices of these third parties. We recommend reviewing their privacy policies before providing any personal information.',
  },
  {
    title: '10. Children\'s Privacy',
    icon: Shield,
    content: 'Our Service is not intended for individuals under 18 years of age. We do not knowingly collect personal information from children under 18. If you become aware that a child has provided us with personal information, please contact us and we will take steps to delete such information.',
  },
  {
    title: '11. Compliance with Indian Laws',
    icon: Shield,
    content: 'We comply with the Information Technology Act, 2000, and the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011. We implement reasonable security practices and procedures as mandated by Indian data protection regulations. We maintain grievance redressal mechanisms as required by law.',
  },
  {
    title: '12. Changes to Privacy Policy',
    icon: AlertTriangle,
    content: 'We may update this Privacy Policy from time to time. We will notify you of material changes by email and/or prominent notice on our Service at least 30 days before changes take effect. Your continued use of the Service after the effective date constitutes acceptance of the updated Privacy Policy.',
  },
];

export function Privacy() {
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-intent-success-bg rounded-full mb-6"
          >
            <Shield className="size-5 text-intent-success" />
            <span className="text-body-sm font-medium text-intent-success">Your Privacy Matters</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-display mb-4"
          >
            Privacy Policy
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
          <Card className="p-8 bg-intent-success-bg border-2 border-intent-success">
            <p className="text-body-sm text-text-primary mb-4">
              <strong>CivitasOne Technologies Pvt. Ltd.</strong> ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use CivitasOne Suite.
            </p>
            <p className="text-body-sm text-text-primary">
              We comply with the Information Technology Act, 2000 and applicable Indian data protection regulations. By using our Service, you consent to the data practices described in this policy.
            </p>
          </Card>
        </motion.div>

        {/* Privacy Sections */}
        <div className="space-y-6 mb-12">
          {SECTIONS.map((section, index) => {
            const Icon = section.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + index * 0.05 }}
              >
                <Card className="p-6">
                  <div className="flex items-start gap-4 mb-3">
                    <div className="size-10 bg-intent-success-bg rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon className="size-5 text-intent-success" />
                    </div>
                    <h2 className="text-h3">{section.title}</h2>
                  </div>
                  <p className="text-body-sm text-text-secondary leading-relaxed ml-14">{section.content}</p>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Grievance Officer */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
          className="mb-8"
        >
          <Card className="p-8">
            <h3 className="text-h3 mb-4">Grievance Redressal Officer</h3>
            <p className="text-body-sm text-text-secondary mb-4">
              As required under the Information Technology Act, 2000, we have appointed a Grievance Redressal Officer to address your concerns regarding data processing and privacy:
            </p>
            <div className="p-4 bg-surface-sunken rounded-lg">
              <p className="text-body-sm text-text-primary mb-1"><strong>Name:</strong> Dr. Ananya Verma</p>
              <p className="text-body-sm text-text-primary mb-1"><strong>Designation:</strong> Chief Privacy Officer</p>
              <p className="text-body-sm text-text-primary mb-1"><strong>Email:</strong> grievance@civitasone.com</p>
              <p className="text-body-sm text-text-primary mb-1"><strong>Phone:</strong> +91-22-1234-5678</p>
              <p className="text-body-sm text-text-primary"><strong>Address:</strong> CivitasOne Technologies Pvt. Ltd., Mumbai, Maharashtra, India</p>
            </div>
          </Card>
        </motion.div>

        {/* Contact Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1 }}
        >
          <Card className="p-8 bg-surface-sunken">
            <h3 className="text-h3 mb-4">Questions About Privacy?</h3>
            <p className="text-body-sm text-text-secondary mb-4">
              If you have questions or concerns about our privacy practices, please contact us:
            </p>
            <p className="text-body-sm text-text-primary mb-1"><strong>Email:</strong> privacy@civitasone.com</p>
            <p className="text-body-sm text-text-primary mb-4"><strong>Data Protection Officer:</strong> dpo@civitasone.com</p>
            <div className="flex items-center gap-3">
              <Button variant="primary" size="md" onClick={() => navigate('/contact')}>
                Contact Privacy Team
              </Button>
              <Button variant="secondary" size="md" onClick={() => navigate('/legal/cookie-policy')}>
                View Cookie Policy
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
