import { useState } from 'react';
import { Card, Button, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  BarChart3,
  Download,
  Calendar,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  AlertTriangle,
  Users,
  FileText,
} from 'lucide-react';
import { motion } from 'motion/react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const TICKET_TREND_DATA = [
  { month: 'Jan', created: 145, resolved: 138, breached: 7 },
  { month: 'Feb', created: 162, resolved: 155, breached: 9 },
  { month: 'Mar', created: 178, resolved: 171, breached: 5 },
  { month: 'Apr', created: 156, resolved: 160, breached: 4 },
  { month: 'May', created: 189, resolved: 182, breached: 6 },
];

const CATEGORY_DATA = [
  { name: 'System Access', value: 145, color: 'var(--intent-primary)' },
  { name: 'Hardware', value: 89, color: 'var(--intent-warning)' },
  { name: 'Software', value: 67, color: 'var(--intent-info)' },
  { name: 'Infrastructure', value: 54, color: 'var(--intent-success)' },
  { name: 'Security', value: 34, color: 'var(--intent-danger)' },
];

const AGENT_PERFORMANCE = [
  { agent: 'IT Support Team', resolved: 234, avgTime: 2.5, satisfaction: 4.5 },
  { agent: 'Hardware Support', resolved: 189, avgTime: 3.2, satisfaction: 4.2 },
  { agent: 'Network Team', resolved: 156, avgTime: 4.1, satisfaction: 4.8 },
  { agent: 'Security Team', resolved: 98, avgTime: 1.8, satisfaction: 4.6 },
  { agent: 'Procurement Team', resolved: 67, avgTime: 5.3, satisfaction: 3.9 },
];

const SLA_METRICS = {
  firstResponse: { target: 15, actual: 12, compliance: 95 },
  resolution: { target: 240, actual: 198, compliance: 92 },
  escalation: { target: 60, actual: 45, compliance: 98 },
};

export function HelpdeskReports() {
  const [selectedPeriod, setSelectedPeriod] = useState('current_month');

  const stats = {
    totalTickets: 189,
    resolved: 182,
    avgResolutionTime: 3.2,
    slaCompliance: 92,
    satisfaction: 4.4,
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Helpdesk Reports</h1>
          <p className="text-body-sm text-text-secondary">
            Analytics and insights on ticket performance and SLA metrics
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current_month">Current Month</SelectItem>
              <SelectItem value="last_month">Last Month</SelectItem>
              <SelectItem value="current_quarter">Current Quarter</SelectItem>
              <SelectItem value="last_quarter">Last Quarter</SelectItem>
              <SelectItem value="ytd">Year to Date</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="primary" size="md" leadingIcon={<Download />}>
            Export Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Tickets</p>
                <p className="text-h2">{stats.totalTickets}</p>
              </div>
              <div className="size-12 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <FileText className="size-6 text-intent-info" />
              </div>
            </div>
            <Badge variant="success">
              <TrendingUp className="size-3" />
              +12% vs last month
            </Badge>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-caption text-text-muted mb-1">Resolved</p>
                <p className="text-h2">{stats.resolved}</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <CheckCircle className="size-6 text-intent-success" />
              </div>
            </div>
            <Badge variant="success">
              <TrendingUp className="size-3" />
              +8% vs last month
            </Badge>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-caption text-text-muted mb-1">Avg Resolution</p>
                <p className="text-h2">{stats.avgResolutionTime}h</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <Clock className="size-6 text-intent-warning" />
              </div>
            </div>
            <Badge variant="success">
              <TrendingDown className="size-3" />
              -15% vs last month
            </Badge>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-caption text-text-muted mb-1">SLA Compliance</p>
                <p className="text-h2">{stats.slaCompliance}%</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <BarChart3 className="size-6 text-intent-primary" />
              </div>
            </div>
            <Badge variant="success">
              <TrendingUp className="size-3" />
              +3% vs last month
            </Badge>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-caption text-text-muted mb-1">Satisfaction</p>
                <p className="text-h2">{stats.satisfaction}/5</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <Users className="size-6 text-intent-success" />
              </div>
            </div>
            <Badge variant="success">
              <TrendingUp className="size-3" />
              +0.2 vs last month
            </Badge>
          </Card>
        </motion.div>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ticket Trend */}
        <Card className="p-6">
          <h3 className="text-h3 mb-4">Ticket Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={TICKET_TREND_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={12} />
              <YAxis stroke="var(--text-muted)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-raised)',
                  border: '2px solid var(--border-default)',
                  borderRadius: '0.5rem',
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="created" stroke="var(--intent-info)" strokeWidth={2} name="Created" />
              <Line type="monotone" dataKey="resolved" stroke="var(--intent-success)" strokeWidth={2} name="Resolved" />
              <Line type="monotone" dataKey="breached" stroke="var(--intent-danger)" strokeWidth={2} name="SLA Breached" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Tickets by Category */}
        <Card className="p-6">
          <h3 className="text-h3 mb-4">Tickets by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={CATEGORY_DATA}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="var(--intent-primary)"
                dataKey="value"
              >
                {CATEGORY_DATA.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-raised)',
                  border: '2px solid var(--border-default)',
                  borderRadius: '0.5rem',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* SLA Metrics */}
      <Card className="p-6">
        <h3 className="text-h3 mb-4">SLA Performance Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Object.entries(SLA_METRICS).map(([key, metric]) => (
            <div key={key} className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-h4 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</h4>
                <Badge variant={metric.compliance >= 95 ? 'success' : metric.compliance >= 85 ? 'warning' : 'danger'}>
                  {metric.compliance}% Compliance
                </Badge>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-body-sm">
                  <span className="text-text-muted">Target</span>
                  <span className="font-semibold text-text-primary">{metric.target} min</span>
                </div>
                <div className="flex items-center justify-between text-body-sm">
                  <span className="text-text-muted">Actual</span>
                  <span className="font-semibold text-intent-success">{metric.actual} min</span>
                </div>
                <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      metric.compliance >= 95 ? 'bg-intent-success' : metric.compliance >= 85 ? 'bg-intent-warning' : 'bg-intent-danger'
                    }`}
                    style={{ width: `${metric.compliance}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Agent Performance */}
      <Card className="p-6">
        <h3 className="text-h3 mb-4">Agent Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Agent/Team</th>
                <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase">Tickets Resolved</th>
                <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase">Avg Resolution Time</th>
                <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase">Satisfaction</th>
              </tr>
            </thead>
            <tbody>
              {AGENT_PERFORMANCE.map((agent, index) => (
                <motion.tr
                  key={agent.agent}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="border-b border-border-subtle hover:bg-surface-sunken transition-colors"
                >
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="size-10 bg-gradient-to-br from-brand-primary to-brand-accent rounded-full flex items-center justify-center text-white font-semibold text-caption">
                        {agent.agent.charAt(0)}
                      </div>
                      <p className="text-body-sm font-medium text-text-primary">{agent.agent}</p>
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <p className="text-body-sm font-semibold text-text-primary">{agent.resolved}</p>
                  </td>
                  <td className="p-4 text-right">
                    <p className="text-body-sm text-text-primary">{agent.avgTime}h</p>
                  </td>
                  <td className="p-4 text-right">
                    <Badge variant={agent.satisfaction >= 4.5 ? 'success' : agent.satisfaction >= 4.0 ? 'info' : 'warning'}>
                      {agent.satisfaction}/5
                    </Badge>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
