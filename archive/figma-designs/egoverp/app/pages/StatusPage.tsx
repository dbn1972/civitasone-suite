import { Card, Badge } from '../components/ui';
import { CheckCircle, Activity, Server, Database, Globe } from 'lucide-react';
import { motion } from 'motion/react';

interface ServiceStatus {
  name: string;
  status: 'operational' | 'degraded' | 'down';
  uptime: string;
  responseTime: string;
  icon: any;
}

const SERVICES: ServiceStatus[] = [
  {
    name: 'Web Application',
    status: 'operational',
    uptime: '99.99%',
    responseTime: '120ms',
    icon: Globe,
  },
  {
    name: 'API Services',
    status: 'operational',
    uptime: '99.98%',
    responseTime: '45ms',
    icon: Activity,
  },
  {
    name: 'Database',
    status: 'operational',
    uptime: '99.99%',
    responseTime: '15ms',
    icon: Database,
  },
  {
    name: 'File Storage',
    status: 'operational',
    uptime: '99.97%',
    responseTime: '80ms',
    icon: Server,
  },
];

export function StatusPage() {
  return (
    <div className="min-h-screen bg-surface-canvas p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-h1 mb-2">System Status</h1>
          <p className="text-body-sm text-text-secondary">
            Current operational status of CivitasOne Suite services
          </p>
        </div>

        {/* Overall Status */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-6 bg-gradient-to-br from-intent-success to-intent-success text-white">
            <div className="flex items-center gap-4">
              <div className="size-16 bg-white/20 rounded-full flex items-center justify-center">
                <CheckCircle className="size-8" />
              </div>
              <div>
                <h2 className="text-h2 mb-1">All Systems Operational</h2>
                <p className="text-base opacity-90">All services are running normally</p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Services */}
        <div className="space-y-4">
          <h3 className="text-h3">Services</h3>
          {SERVICES.map((service, index) => {
            const Icon = service.icon;
            const statusConfig = {
              operational: { label: 'Operational', variant: 'success' as const, color: 'intent-success' },
              degraded: { label: 'Degraded Performance', variant: 'warning' as const, color: 'intent-warning' },
              down: { label: 'Service Disruption', variant: 'danger' as const, color: 'intent-danger' },
            }[service.status];

            return (
              <motion.div
                key={service.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`size-12 bg-${statusConfig.color}-bg rounded-lg flex items-center justify-center`}>
                        <Icon className={`size-6 text-${statusConfig.color}`} />
                      </div>
                      <div>
                        <h4 className="text-h4 mb-1">{service.name}</h4>
                        <Badge variant={statusConfig.variant}>
                          <CheckCircle className="size-3" />
                          {statusConfig.label}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="text-end">
                        <p className="text-caption text-text-muted mb-1">Uptime</p>
                        <p className="text-body-sm font-semibold text-text-primary">{service.uptime}</p>
                      </div>
                      <div className="text-end">
                        <p className="text-caption text-text-muted mb-1">Response Time</p>
                        <p className="text-body-sm font-semibold text-text-primary">{service.responseTime}</p>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Recent Incidents */}
        <Card className="p-6">
          <h3 className="text-h3 mb-4">Recent Incidents</h3>
          <div className="text-center py-8">
            <CheckCircle className="size-12 text-intent-success mx-auto mb-3" />
            <p className="text-body-sm text-text-secondary">No incidents reported in the last 90 days</p>
          </div>
        </Card>

        {/* Footer */}
        <div className="text-center text-caption text-text-muted">
          <p>Last updated: {new Date().toLocaleString('en-IN')}</p>
          <p className="mt-2">
            <a href="/" className="text-intent-primary hover:underline">
              ← Back to Home
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
