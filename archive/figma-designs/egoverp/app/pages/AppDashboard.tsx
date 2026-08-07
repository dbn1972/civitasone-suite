import { Card, Badge, Button, Table } from '../components/ui';
import { TrendingUp, TrendingDown, Users, DollarSign, ShoppingCart, AlertCircle } from 'lucide-react';

export function AppDashboard() {
  const recentActivity = [
    { id: 1, user: 'Alice Kumar', action: 'Approved Purchase Order', target: 'PO-2024-001', time: '2h ago', type: 'approval' },
    { id: 2, user: 'Bob Smith', action: 'Created Invoice', target: 'INV-789', time: '4h ago', type: 'create' },
    { id: 3, user: 'Carol Chen', action: 'Updated Employee Record', target: 'EMP-456', time: '6h ago', type: 'update' },
  ];

  const pendingApprovals = [
    { id: 'PO-2024-045', type: 'Purchase Order', amount: '₹2,50,000', requestedBy: 'David Patel', status: 'Pending' },
    { id: 'INV-890', type: 'Invoice', amount: '₹1,75,000', requestedBy: 'Emma Wilson', status: 'Pending' },
    { id: 'EXP-234', type: 'Expense', amount: '₹45,000', requestedBy: 'Frank Kumar', status: 'Pending' },
  ];

  return (
    <div className="p-6 md:p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-h1 mb-2">Dashboard</h1>
        <p className="text-text-secondary">Welcome back! Here's what's happening today.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          icon={<DollarSign className="size-6" />}
          label="Total Revenue"
          value="₹12.5M"
          change="+12.5%"
          trend="up"
          color="success"
        />
        <KPICard
          icon={<Users className="size-6" />}
          label="Active Employees"
          value="1,234"
          change="+5.2%"
          trend="up"
          color="info"
        />
        <KPICard
          icon={<ShoppingCart className="size-6" />}
          label="Pending POs"
          value="47"
          change="-8.3%"
          trend="down"
          color="warning"
        />
        <KPICard
          icon={<AlertCircle className="size-6" />}
          label="Open Issues"
          value="23"
          change="+15.4%"
          trend="up"
          color="danger"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Activity */}
        <Card>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-h3">Recent Activity</h2>
            <Button variant="link" size="sm">View All</Button>
          </div>
          <div className="space-y-4">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-4 pb-4 border-b border-border-subtle last:border-b-0 last:pb-0">
                <div className="size-10 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold flex-shrink-0">
                  {activity.user.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base">
                    <span className="font-medium text-text-primary">{activity.user}</span>
                    {' '}
                    <span className="text-text-secondary">{activity.action}</span>
                    {' '}
                    <span className="font-medium text-text-primary">{activity.target}</span>
                  </p>
                  <p className="text-body-sm text-text-muted mt-1">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Quick Stats */}
        <Card>
          <h2 className="text-h3 mb-6">Quick Stats</h2>
          <div className="space-y-6">
            <StatRow label="Budget Utilization" value="78%" max={100} current={78} />
            <StatRow label="Employee Attendance" value="94%" max={100} current={94} />
            <StatRow label="Inventory Stock" value="67%" max={100} current={67} />
            <StatRow label="Project Completion" value="82%" max={100} current={82} />
          </div>
        </Card>
      </div>

      {/* Pending Approvals */}
      <Card padding="none">
        <div className="p-6 border-b-2 border-border-subtle flex items-center justify-between">
          <h2 className="text-h3">Pending Approvals</h2>
          <Badge intent="warning">{pendingApprovals.length} Pending</Badge>
        </div>
        <Table
          columns={[
            { key: 'id', label: 'ID' },
            { key: 'type', label: 'Type' },
            { key: 'amount', label: 'Amount' },
            { key: 'requestedBy', label: 'Requested By' },
            {
              key: 'status',
              label: 'Status',
              render: (row) => <Badge intent="warning">{row.status}</Badge>,
            },
            {
              key: 'actions',
              label: 'Actions',
              render: () => (
                <div className="flex gap-2">
                  <Button size="sm" variant="primary">Approve</Button>
                  <Button size="sm" variant="danger">Reject</Button>
                </div>
              ),
            },
          ]}
          data={pendingApprovals}
          density="compact"
        />
      </Card>
    </div>
  );
}

function KPICard({
  icon,
  label,
  value,
  change,
  trend,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  change: string;
  trend: 'up' | 'down';
  color: 'success' | 'info' | 'warning' | 'danger';
}) {
  const colorStyles = {
    success: 'bg-intent-success-bg text-intent-success',
    info: 'bg-intent-info-bg text-intent-info',
    warning: 'bg-intent-warning-bg text-intent-warning',
    danger: 'bg-intent-danger-bg text-intent-danger',
  };

  return (
    <Card hover>
      <div className="flex items-start justify-between mb-4">
        <div className={`size-12 rounded-lg ${colorStyles[color]} flex items-center justify-center`}>
          {icon}
        </div>
        <div className={`flex items-center gap-1 text-body-sm font-medium ${
          trend === 'up' ? 'text-intent-success' : 'text-intent-danger'
        }`}>
          {trend === 'up' ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          {change}
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-body-sm text-text-muted">{label}</div>
        <div className="text-h1 font-bold text-text-primary">{value}</div>
      </div>
    </Card>
  );
}

function StatRow({ label, value, max, current }: { label: string; value: string; max: number; current: number }) {
  const percentage = (current / max) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm text-text-primary">{label}</span>
        <span className="text-body-sm font-semibold text-text-primary">{value}</span>
      </div>
      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-brand-primary to-brand-accent rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
