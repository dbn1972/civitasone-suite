import { Card, Button, Input, Badge } from '../../components/ui';
import { Code, Search, Book, Zap, Lock, Database, Send, FileText, Key, Globe } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';
import { useState } from 'react';

const API_ENDPOINTS = [
  {
    category: 'Authentication',
    icon: Lock,
    endpoints: [
      { method: 'POST', path: '/api/v1/auth/login', description: 'Authenticate user and obtain access token' },
      { method: 'POST', path: '/api/v1/auth/refresh', description: 'Refresh expired access token' },
      { method: 'POST', path: '/api/v1/auth/logout', description: 'Invalidate access token' },
    ],
  },
  {
    category: 'Finance',
    icon: Database,
    endpoints: [
      { method: 'GET', path: '/api/v1/finance/invoices', description: 'List all invoices with pagination' },
      { method: 'POST', path: '/api/v1/finance/invoices', description: 'Create new invoice' },
      { method: 'GET', path: '/api/v1/finance/invoices/{id}', description: 'Get invoice details' },
      { method: 'PUT', path: '/api/v1/finance/invoices/{id}', description: 'Update invoice' },
      { method: 'DELETE', path: '/api/v1/finance/invoices/{id}', description: 'Delete invoice' },
    ],
  },
  {
    category: 'HR & Payroll',
    icon: Database,
    endpoints: [
      { method: 'GET', path: '/api/v1/hr/employees', description: 'List all employees' },
      { method: 'POST', path: '/api/v1/hr/employees', description: 'Create employee record' },
      { method: 'GET', path: '/api/v1/hr/attendance', description: 'Get attendance records' },
      { method: 'POST', path: '/api/v1/hr/leave/apply', description: 'Submit leave application' },
    ],
  },
  {
    category: 'Webhooks',
    icon: Send,
    endpoints: [
      { method: 'POST', path: '/api/v1/webhooks', description: 'Create webhook subscription' },
      { method: 'GET', path: '/api/v1/webhooks', description: 'List webhook subscriptions' },
      { method: 'DELETE', path: '/api/v1/webhooks/{id}', description: 'Delete webhook subscription' },
    ],
  },
];

const CODE_EXAMPLES = [
  {
    language: 'cURL',
    code: `curl -X POST https://api.civitasone.com/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "user@example.com",
    "password": "your_password"
  }'`,
  },
  {
    language: 'JavaScript',
    code: `const response = await fetch('https://api.civitasone.com/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'your_password'
  })
});
const data = await response.json();`,
  },
  {
    language: 'Python',
    code: `import requests

response = requests.post(
    'https://api.civitasone.com/v1/auth/login',
    json={
        'email': 'user@example.com',
        'password': 'your_password'
    }
)
data = response.json()`,
  },
];

export function APIReference() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExample, setSelectedExample] = useState(0);

  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 px-4 py-2 bg-intent-primary-bg rounded-full mb-6">
            <Code className="size-5 text-intent-primary" />
            <span className="text-body-sm font-medium text-intent-primary">REST API v1.0</span>
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-display mb-4">
            API Reference
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-base text-text-secondary max-w-3xl mx-auto mb-8">
            Complete REST API documentation for CivitasOne Suite. OAuth 2.0 authentication, rate limiting, and comprehensive endpoint coverage.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="max-w-2xl mx-auto">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input type="text" placeholder="Search endpoints..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-12 py-4 text-base" />
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
          <Card className="p-6 text-center">
            <Globe className="size-12 text-intent-primary mx-auto mb-4" />
            <h3 className="text-h3 mb-2">Base URL</h3>
            <code className="text-body-sm text-text-secondary bg-surface-sunken px-3 py-1 rounded">https://api.civitasone.com/v1</code>
          </Card>
          <Card className="p-6 text-center">
            <Lock className="size-12 text-intent-success mx-auto mb-4" />
            <h3 className="text-h3 mb-2">Authentication</h3>
            <p className="text-body-sm text-text-secondary">OAuth 2.0 Bearer Token</p>
          </Card>
          <Card className="p-6 text-center">
            <Zap className="size-12 text-intent-warning mx-auto mb-4" />
            <h3 className="text-h3 mb-2">Rate Limit</h3>
            <p className="text-body-sm text-text-secondary">1000 requests/hour</p>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          <div>
            <h2 className="text-h2 mb-6">API Endpoints</h2>
            <div className="space-y-6">
              {API_ENDPOINTS.map((category, idx) => {
                const Icon = category.icon;
                return (
                  <Card key={idx} className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="size-10 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                        <Icon className="size-5 text-intent-primary" />
                      </div>
                      <h3 className="text-h3">{category.category}</h3>
                    </div>
                    <div className="space-y-3">
                      {category.endpoints.map((endpoint, eIdx) => (
                        <div key={eIdx} className="p-3 bg-surface-sunken rounded-lg hover:bg-surface-raised transition-colors cursor-pointer">
                          <div className="flex items-start gap-3 mb-2">
                            <Badge variant={endpoint.method === 'GET' ? 'info' : endpoint.method === 'POST' ? 'success' : endpoint.method === 'PUT' ? 'warning' : 'danger'}>
                              {endpoint.method}
                            </Badge>
                            <code className="text-body-sm text-text-primary flex-1">{endpoint.path}</code>
                          </div>
                          <p className="text-caption text-text-muted ml-14">{endpoint.description}</p>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="text-h2 mb-6">Quick Start</h2>
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4 border-b border-border-subtle pb-4">
                {CODE_EXAMPLES.map((example, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedExample(idx)}
                    className={`px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
                      selectedExample === idx ? 'bg-intent-primary text-white' : 'text-text-secondary hover:bg-surface-sunken'
                    }`}
                  >
                    {example.language}
                  </button>
                ))}
              </div>
              <pre className="bg-surface-sunken p-4 rounded-lg overflow-x-auto">
                <code className="text-caption text-text-primary">{CODE_EXAMPLES[selectedExample].code}</code>
              </pre>
              <Button variant="secondary" size="sm" className="w-full mt-4">Copy Code</Button>
            </Card>

            <Card className="p-6 mt-6">
              <h3 className="text-h3 mb-4">Authentication Example</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-caption text-text-muted mb-2">1. Obtain API Key from Dashboard</p>
                  <Button variant="primary" size="sm" leadingIcon={<Key />}>Get API Key</Button>
                </div>
                <div>
                  <p className="text-caption text-text-muted mb-2">2. Include in Authorization Header</p>
                  <code className="block text-caption bg-surface-sunken p-3 rounded">Authorization: Bearer YOUR_API_KEY</code>
                </div>
                <div>
                  <p className="text-caption text-text-muted mb-2">3. Make API Request</p>
                  <p className="text-caption text-text-secondary">All requests must include the Authorization header</p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        <Card className="p-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white text-center">
          <h2 className="text-h1 mb-4">Need Help with Integration?</h2>
          <p className="text-base opacity-90 mb-6 max-w-2xl mx-auto">
            Our developer support team can assist with API integration, troubleshooting, and best practices.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button variant="secondary" size="lg">View Full Documentation</Button>
            <Button variant="secondary" size="lg">Contact Support</Button>
          </div>
        </Card>
      </div>

      <PublicFooter />
    </div>
  );
}
