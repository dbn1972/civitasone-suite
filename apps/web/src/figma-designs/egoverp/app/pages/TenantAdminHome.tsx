import { useState } from 'react';
import { Card, Badge, Button } from '../components/ui';
import {
  Users,
  Activity,
  AlertCircle,
  HardDrive,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  UserPlus,
  Shield,
  Palette,
  Puzzle,
  FileText,
  Settings,
  Eye,
  Clock,
} from 'lucide-react';
import { motion } from 'motion/react';

export function TenantAdminHome() {
  const [selectedAudit, setSelectedAudit] = useState<any>(null);

  const kpis = [
    {
      label: 'Active Users',
      value: '1,234',
      delta: '+127',
      deltaPercent: '+11.5%',
      trend: 'up',
      period: '7 days',
      icon: <Users className="size-6" />,
    },
    {
      label: 'Active Sessions',
      value: '856',
      delta: '',
      deltaPercent: '',
      trend: 'neutral',
      period: 'Live',
      icon: <Activity className="size-6" />,
    },
    {
      label: 'Open Approvals',
      value: '23',
      delta: '-5',
      deltaPercent: '',
      trend: 'down',
      period: 'At risk: 3',
      icon: <AlertCircle className="size-6" />,
      warning: true,
    },
    {
      label: 'Storage Used',
      value: '245 GB',
      delta: '',
      deltaPercent: '',
      trend: 'neutral',
      period: 'of 500 GB',
      icon: <HardDrive className="size-6" />,
      progress: 49,
    },
  ];

  const services = [
    { name: 'auth-service', status: 'ok', replicas: '3/3' },
    { name: 'api-gateway', status: 'ok', replicas: '2/2' },
    { name: 'platform-service', status: 'ok', replicas: '2/2' },
    { name: 'finance-service', status: 'ok', replicas: '1/1' },
    { name: 'hrms-service', status: 'degraded', replicas: '1/2' },
    { name: 'procurement-service', status: 'ok', replicas: '1/1' },
  ];

  const quickActions = [
    { title: 'Manage Users', description: 'Add, edit, or remove user accounts', icon: <UserPlus />, path: '/tenant-admin/users' },
    { title: 'Manage Roles', description: 'Configure roles and permissions', icon: <Shield />, path: '/tenant-admin/roles' },
    { title: 'Customize Theme', description: 'Brand colors and logo settings', icon: <Palette />, path: '/tenant-admin/theme' },
    { title: 'Manage Plugins', description: 'Enable or disable modules', icon: <Puzzle />, path: '/tenant-admin/plugins' },
    { title: 'View Audit Trail', description: 'Complete activity audit log', icon: <FileText />, path: '/audit' },
    { title: 'Settings', description: 'Tenant configuration and preferences', icon: <Settings />, path: '/tenant-admin/settings' },
  ];

  const auditActivity = [
    {
      id: 1,
      timestamp: '2024-05-23 14:32:15',
      actor: 'alice.kumar@gov.in',
      action: 'User Login',
      resource: 'auth-service',
      outcome: 'success',
      details: 'Successful login from IP 192.168.1.45',
    },
    {
      id: 2,
      timestamp: '2024-05-23 14:28:03',
      actor: 'bob.smith@gov.in',
      action: 'Role Updated',
      resource: 'user-role-assignments',
      outcome: 'success',
      details: 'Added Finance Manager role to user EMP-456',
    },
    {
      id: 3,
      timestamp: '2024-05-23 14:15:22',
      actor: 'carol.chen@gov.in',
      action: 'Invoice Approved',
      resource: 'INV-2024-045',
      outcome: 'success',
      details: 'Approved invoice for ₹2,50,000',
    },
    {
      id: 4,
      timestamp: '2024-05-23 13:58:47',
      actor: 'system',
      action: 'Password Policy Changed',
      resource: 'security-settings',
      outcome: 'success',
      details: 'Updated minimum password length to 12 characters',
    },
    {
      id: 5,
      timestamp: '2024-05-23 13:42:11',
      actor: 'david.patel@gov.in',
      action: 'User Login',
      resource: 'auth-service',
      outcome: 'failure',
      details: 'Failed login attempt - invalid password',
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-h1 mb-2">Tenant Administration</h1>
        <p className="text-text-secondary">Manage your CivitasOne workspace</p>
      </div>

      {/* Row 1: KPI Cards */}
      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">Key Performance Indicators</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {kpis.map((kpi, index) => (
            <KPICard key={index} {...kpi} />
          ))}
        </div>
      </section>

      {/* Row 2: Health and Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service Health */}
        <section aria-labelledby="health-heading">
          <Card>
            <div className="flex items-center justify-between mb-6">
              <h2 id="health-heading" className="text-h3">Service Health</h2>
              <Badge intent="success">All Systems Operational</Badge>
            </div>
            <div className="space-y-3">
              {services.map((service, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`size-2 rounded-full ${
                      service.status === 'ok' ? 'bg-intent-success' :
                      service.status === 'degraded' ? 'bg-intent-warning' : 'bg-intent-danger'
                    }`} />
                    <span className="text-base font-mono text-text-primary">{service.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-body-sm font-mono text-text-muted">{service.replicas}</span>
                    <Badge
                      intent={
                        service.status === 'ok' ? 'success' :
                        service.status === 'degraded' ? 'warning' : 'danger'
                      }
                      size="sm"
                    >
                      {service.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* Enterprise Readiness Score */}
        <section aria-labelledby="readiness-heading">
          <Card>
            <div className="flex items-center justify-between mb-6">
              <h2 id="readiness-heading" className="text-h3">Enterprise Readiness</h2>
              <span className="text-caption text-text-muted">Refreshed daily</span>
            </div>
            <div className="flex items-center gap-8">
              <div className="relative">
                <svg className="size-32" viewBox="0 0 120 120">
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke="var(--surface-sunken)"
                    strokeWidth="12"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke="var(--intent-success)"
                    strokeWidth="12"
                    strokeDasharray={`${(92 / 100) * 314} 314`}
                    strokeLinecap="round"
                    transform="rotate(-90 60 60)"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div
                    className="text-3xl font-bold text-intent-success"
                    role="meter"
                    aria-valuenow={92}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Readiness score: 92 out of 100"
                  >
                    92
                  </div>
                  <div className="text-caption text-text-muted">/ 100</div>
                </div>
              </div>
              <div className="flex-1 space-y-3">
                <ScoreBar label="Security" score={95} />
                <ScoreBar label="Reliability" score={90} />
                <ScoreBar label="Observability" score={88} />
                <ScoreBar label="Backup/DR" score={95} />
              </div>
            </div>
            <Button variant="link" className="mt-4 w-full" trailingIcon={<Eye />}>
              View Full Report
            </Button>
          </Card>
        </section>
      </div>

      {/* Row 3: Quick Actions */}
      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="text-h3 mb-6">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickActions.map((action, index) => (
            <QuickActionCard key={index} {...action} />
          ))}
        </div>
      </section>

      {/* Row 4: Recent Audit Activity */}
      <section aria-labelledby="audit-heading">
        <Card padding="none">
          <div className="p-6 border-b-2 border-border-subtle flex items-center justify-between">
            <h2 id="audit-heading" className="text-h3">Recent Activity</h2>
            <Button variant="link" size="sm">View All</Button>
          </div>
          <div className="divide-y divide-border-subtle">
            {auditActivity.map((event) => (
              <button
                key={event.id}
                onClick={() => setSelectedAudit(event)}
                className="w-full p-4 hover:bg-surface-sunken transition-colors text-start"
              >
                <div className="flex items-start gap-4">
                  <div className="size-10 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold text-body-sm flex-shrink-0">
                    {event.actor === 'system' ? 'SYS' : event.actor.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-text-primary">{event.actor}</span>
                          <span className="text-text-secondary">{event.action}</span>
                          <Badge
                            intent={event.outcome === 'success' ? 'success' : 'danger'}
                            size="sm"
                          >
                            {event.outcome}
                          </Badge>
                        </div>
                        <div className="text-body-sm text-text-secondary mt-1">
                          {event.resource}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-caption text-text-muted flex-shrink-0">
                        <Clock className="size-3" />
                        {event.timestamp.split(' ')[1]}
                      </div>
                    </div>
                    <p className="text-body-sm text-text-muted truncate">{event.details}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </section>

      {/* Audit Detail Drawer */}
      {selectedAudit && (
        <AuditDetailDrawer event={selectedAudit} onClose={() => setSelectedAudit(null)} />
      )}
    </div>
  );
}

function KPICard({
  label,
  value,
  delta,
  deltaPercent,
  trend,
  period,
  icon,
  warning = false,
  progress,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaPercent?: string;
  trend: 'up' | 'down' | 'neutral';
  period: string;
  icon: React.ReactNode;
  warning?: boolean;
  progress?: number;
}) {
  return (
    <Card hover>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className={`size-12 rounded-lg flex items-center justify-center ${
            warning ? 'bg-intent-warning-bg text-intent-warning' : 'bg-intent-primary-bg text-intent-primary'
          }`}>
            {icon}
          </div>
          {delta && (
            <div
              className={`flex items-center gap-1 text-body-sm font-medium ${
                trend === 'up' ? 'text-intent-success' : trend === 'down' ? 'text-intent-danger' : 'text-text-muted'
              }`}
              aria-label={`${trend === 'up' ? 'up' : 'down'} ${deltaPercent} over last ${period}`}
            >
              {trend === 'up' ? <TrendingUp className="size-4" /> : trend === 'down' ? <TrendingDown className="size-4" /> : null}
              <span>{delta}</span>
              {deltaPercent && <span className="text-caption">({deltaPercent})</span>}
            </div>
          )}
        </div>
        <div>
          <div className="text-body-sm text-text-muted mb-1">{label}</div>
          <div className="text-h1 font-bold text-text-primary mb-1">{value}</div>
          <div className="text-caption text-text-muted">{period}</div>
        </div>
        {progress !== undefined && (
          <div>
            <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-primary to-brand-accent rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-body-sm text-text-primary">{label}</span>
        <span className="text-body-sm font-semibold text-text-primary">{score}%</span>
      </div>
      <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${score >= 85 ? 'bg-intent-success' : 'bg-intent-warning'}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function QuickActionCard({
  title,
  description,
  icon,
  path,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
}) {
  return (
    <a href={path}>
      <Card hover className="h-full cursor-pointer group">
        <div className="flex items-start gap-4">
          <div className="size-12 bg-gradient-to-br from-brand-primary to-brand-accent text-white rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-medium text-text-primary mb-1 group-hover:text-intent-primary transition-colors">
              {title}
            </h3>
            <p className="text-body-sm text-text-secondary">{description}</p>
          </div>
        </div>
      </Card>
    </a>
  );
}

function AuditDetailDrawer({ event, onClose }: { event: any; onClose: () => void }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25 }}
        className="fixed top-0 end-0 bottom-0 w-full max-w-2xl bg-surface-raised shadow-2xl z-50 overflow-y-auto"
      >
        <div className="sticky top-0 bg-surface-raised border-b-2 border-border-subtle p-6 flex items-center justify-between">
          <h2 className="text-h3">Audit Event Details</h2>
          <button
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-surface-sunken flex items-center justify-center transition-colors"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <div className="text-body-sm text-text-muted mb-1">Event ID</div>
            <div className="text-base font-mono text-text-primary">AUD-{event.id.toString().padStart(6, '0')}</div>
          </div>

          <div>
            <div className="text-body-sm text-text-muted mb-1">Timestamp</div>
            <div className="text-base text-text-primary">{event.timestamp}</div>
          </div>

          <div>
            <div className="text-body-sm text-text-muted mb-1">Actor</div>
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold">
                {event.actor === 'system' ? 'SYS' : event.actor.charAt(0).toUpperCase()}
              </div>
              <div className="text-base text-text-primary">{event.actor}</div>
            </div>
          </div>

          <div>
            <div className="text-body-sm text-text-muted mb-1">Action</div>
            <div className="text-base text-text-primary">{event.action}</div>
          </div>

          <div>
            <div className="text-body-sm text-text-muted mb-1">Resource</div>
            <div className="text-base font-mono text-text-primary">{event.resource}</div>
          </div>

          <div>
            <div className="text-body-sm text-text-muted mb-1">Outcome</div>
            <Badge intent={event.outcome === 'success' ? 'success' : 'danger'}>
              {event.outcome}
            </Badge>
          </div>

          <div>
            <div className="text-body-sm text-text-muted mb-2">Details</div>
            <Card padding="sm">
              <p className="text-base text-text-primary">{event.details}</p>
            </Card>
          </div>
        </div>
      </motion.div>
    </>
  );
}
