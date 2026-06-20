import { Card, Button, Input, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import { Mail, Phone, MapPin, Send, MessageSquare, Headphones, Globe } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

const CONTACT_METHODS = [
  { icon: Mail, title: 'Email Us', value: 'sales@civitasone.com', description: 'Response within 24 hours' },
  { icon: Phone, title: 'Call Us', value: '+91-22-1234-5678', description: 'Mon-Fri, 9 AM - 6 PM IST' },
  { icon: MessageSquare, title: 'Live Chat', value: 'Start Chat', description: 'Available during business hours' },
];

const OFFICES = [
  { city: 'Mumbai (HQ)', address: 'CivitasOne Technologies Pvt. Ltd.\nBandra Kurla Complex\nMumbai, Maharashtra 400051' },
  { city: 'New Delhi', address: 'Connaught Place\nNew Delhi, Delhi 110001' },
  { city: 'Bangalore', address: 'Whitefield Tech Park\nBangalore, Karnataka 560066' },
];

export function Contact() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-display mb-4">Get in Touch</motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-base text-text-secondary max-w-3xl mx-auto">
            Have questions? We'd love to hear from you. Send us a message and we'll respond as soon as possible.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {CONTACT_METHODS.map((method, idx) => {
            const Icon = method.icon;
            return (
              <Card key={idx} className="p-6 text-center hover:shadow-[var(--shadow-lg)] transition-shadow">
                <div className="size-12 bg-intent-primary-bg rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <Icon className="size-6 text-intent-primary" />
                </div>
                <h3 className="text-h4 mb-2">{method.title}</h3>
                <p className="text-h4 text-intent-primary mb-1">{method.value}</p>
                <p className="text-caption text-text-muted">{method.description}</p>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          <Card className="p-8">
            <h2 className="text-h2 mb-6">Send us a Message</h2>
            <form className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input placeholder="First Name" />
                <Input placeholder="Last Name" />
              </div>
              <Input type="email" placeholder="Email Address" />
              <Input placeholder="Organization" />
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select Inquiry Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales Inquiry</SelectItem>
                  <SelectItem value="support">Technical Support</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                  <SelectItem value="general">General Question</SelectItem>
                </SelectContent>
              </Select>
              <Textarea placeholder="Your Message" rows={4} />
              <Button variant="primary" size="lg" className="w-full" leadingIcon={<Send />}>Send Message</Button>
            </form>
          </Card>

          <div className="space-y-6">
            <Card className="p-8">
              <h2 className="text-h2 mb-6">Our Offices</h2>
              <div className="space-y-6">
                {OFFICES.map((office, idx) => (
                  <div key={idx} className="flex items-start gap-4">
                    <div className="size-10 bg-intent-success-bg rounded-lg flex items-center justify-center flex-shrink-0">
                      <MapPin className="size-5 text-intent-success" />
                    </div>
                    <div>
                      <h4 className="text-h4 mb-2">{office.city}</h4>
                      <p className="text-body-sm text-text-secondary whitespace-pre-line">{office.address}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-8 bg-gradient-to-br from-intent-info-bg to-surface-raised">
              <Headphones className="size-12 text-intent-info mb-4" />
              <h3 className="text-h3 mb-2">Customer Support</h3>
              <p className="text-body-sm text-text-secondary mb-4">
                For existing customers, please use the support portal within your account or email support@civitasone.com
              </p>
              <Button variant="primary" size="md" onClick={() => navigate('/auth/login')}>Access Support Portal</Button>
            </Card>
          </div>
        </div>

        <Card className="p-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white text-center">
          <h2 className="text-h1 mb-4">Need Immediate Assistance?</h2>
          <p className="text-base opacity-90 mb-6 max-w-2xl mx-auto">
            For urgent inquiries or technical emergencies, our support team is available 24/7 for enterprise customers.
          </p>
          <Button variant="secondary" size="lg">Call Emergency Support</Button>
        </Card>
      </div>

      <PublicFooter />
    </div>
  );
}
