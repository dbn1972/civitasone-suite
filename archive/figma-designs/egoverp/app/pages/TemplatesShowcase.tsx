import { Card } from '../components/ui';
import { LayoutDashboard, Lock, Settings, FileText, Globe } from 'lucide-react';

export function TemplatesShowcase() {
  return (
    <div className="size-full min-h-screen bg-surface-canvas p-8 overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="mb-12">
          <h1 className="text-display mb-4">Templates</h1>
          <p className="text-base text-text-muted">
            Full-page layout templates for different contexts
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* AppShell */}
          <TemplateCard
            icon={<LayoutDashboard className="size-8" />}
            title="AppShell"
            description="Main application layout with sidebar navigation, topbar, and content area. Used for all authenticated app pages."
            features={[
              'Collapsible sidebar navigation',
              'Top navigation bar with user menu',
              'Responsive mobile menu',
              'Nested routing support',
            ]}
            inUse={['Dashboard', 'Finance', 'HRMS', 'Procurement', 'All modules']}
          />

          {/* AuthShell */}
          <TemplateCard
            icon={<Lock className="size-8" />}
            title="AuthShell"
            description="Centered card layout on branded background. Used for authentication flows."
            features={[
              'Tenant brand gradient background',
              'Centered card with glassmorphism',
              'Animated background elements',
              'Dark mode support',
            ]}
            inUse={['Login', 'MFA', 'Forgot Password', 'Reset Password']}
          />

          {/* InstallerShell */}
          <TemplateCard
            icon={<Settings className="size-8" />}
            title="InstallerShell"
            description="Multi-step wizard layout with progress indicator. Used for guided setup flows."
            features={[
              'Step progress indicator',
              'Previous/Next navigation',
              'Step validation',
              'Summary review step',
            ]}
            inUse={['Initial Setup', 'Tenant Configuration', 'Module Installation']}
          />

          {/* ReportShell */}
          <TemplateCard
            icon={<FileText className="size-8" />}
            title="ReportShell"
            description="Layout optimized for reports with filters, chart grid, and export capabilities."
            features={[
              'Filter sidebar',
              'Chart grid layout',
              'Export toolbar',
              'Print-optimized styles',
            ]}
            inUse={['Financial Reports', 'Analytics Dashboard', 'Compliance Reports']}
          />

          {/* PublicSiteShell */}
          <TemplateCard
            icon={<Globe className="size-8" />}
            title="PublicSiteShell"
            description="Public-facing layout with header, content, and footer. Used for unauthenticated pages."
            features={[
              'Public header navigation',
              'Content area',
              'Footer with legal links',
              'SEO-friendly structure',
            ]}
            inUse={['Landing Page', 'About', 'Contact', 'Terms of Service']}
          />

          {/* Design Patterns */}
          <Card padding="lg" className="md:col-span-2 bg-gradient-to-br from-intent-primary-bg to-intent-info-bg border-intent-primary-border">
            <div className="space-y-4">
              <h3 className="text-h3 text-intent-primary">Template Design Patterns</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-body-sm font-semibold text-text-primary mb-2">Responsive Behavior</h4>
                  <p className="text-body-sm text-text-secondary">
                    All templates adapt seamlessly across devices:
                  </p>
                  <ul className="text-body-sm text-text-secondary mt-2 space-y-1 list-disc list-inside">
                    <li>Mobile: Single column, hamburger menu</li>
                    <li>Tablet: Adaptive layout, collapsible sidebar</li>
                    <li>Desktop: Full layout with all features</li>
                  </ul>
                </div>
                <div>
                  <h4 className="text-body-sm font-semibold text-text-primary mb-2">Accessibility</h4>
                  <p className="text-body-sm text-text-secondary">
                    Every template follows WCAG 2.2 AA:
                  </p>
                  <ul className="text-body-sm text-text-secondary mt-2 space-y-1 list-disc list-inside">
                    <li>Semantic landmark roles</li>
                    <li>Skip navigation links</li>
                    <li>Keyboard navigation support</li>
                    <li>Screen reader announcements</li>
                  </ul>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  icon,
  title,
  description,
  features,
  inUse,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  inUse: string[];
}) {
  return (
    <Card hover className="h-full">
      <div className="space-y-4">
        <div className="size-16 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center text-white">
          {icon}
        </div>
        <div>
          <h3 className="text-h3 mb-2">{title}</h3>
          <p className="text-body-sm text-text-secondary">{description}</p>
        </div>

        <div>
          <h4 className="text-body-sm font-semibold text-text-primary mb-2">Key Features</h4>
          <ul className="space-y-1.5">
            {features.map((feature, index) => (
              <li key={index} className="flex items-start gap-2 text-body-sm text-text-secondary">
                <span className="text-intent-success mt-0.5">✓</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-4 border-t border-border-subtle">
          <h4 className="text-body-sm font-semibold text-text-primary mb-2">Used In</h4>
          <div className="flex flex-wrap gap-2">
            {inUse.map((use, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-surface-sunken rounded text-caption text-text-muted"
              >
                {use}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
