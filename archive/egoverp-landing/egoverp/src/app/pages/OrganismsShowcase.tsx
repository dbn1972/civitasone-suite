import { useState } from 'react';
import { Card, Table, Badge, Button } from '../components/ui';
import { Eye, Edit, Trash2, Download } from 'lucide-react';

export function OrganismsShowcase() {
  const [selectedRows, setSelectedRows] = useState<number[]>([]);

  const sampleData = [
    { id: 1, name: 'Alice Kumar', email: 'alice@gov.in', department: 'Finance', status: 'Active' },
    { id: 2, name: 'Bob Smith', email: 'bob@gov.in', department: 'HRMS', status: 'Active' },
    { id: 3, name: 'Carol Chen', email: 'carol@gov.in', department: 'Procurement', status: 'Inactive' },
    { id: 4, name: 'David Patel', email: 'david@gov.in', department: 'Finance', status: 'Active' },
  ];

  return (
    <div className="size-full min-h-screen bg-surface-canvas p-8 overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="mb-12">
          <h1 className="text-display mb-4">Organisms</h1>
          <p className="text-base text-text-muted">
            Complex UI patterns and layouts
          </p>
        </div>

        {/* DataTable */}
        <Section title="DataTable">
          <Card padding="none">
            <div className="p-4 border-b-2 border-border-subtle flex items-center justify-between">
              <h3 className="text-h3">Employee List</h3>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" leadingIcon={<Download />}>
                  Export
                </Button>
                <Button size="sm">Add Employee</Button>
              </div>
            </div>
            <Table
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'email', label: 'Email' },
                { key: 'department', label: 'Department' },
                {
                  key: 'status',
                  label: 'Status',
                  render: (row) => (
                    <Badge intent={row.status === 'Active' ? 'success' : 'neutral'}>
                      {row.status}
                    </Badge>
                  ),
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: () => (
                    <div className="flex gap-2">
                      <button className="p-1 hover:bg-surface-sunken rounded transition-colors">
                        <Eye className="size-4 text-text-secondary" />
                      </button>
                      <button className="p-1 hover:bg-surface-sunken rounded transition-colors">
                        <Edit className="size-4 text-text-secondary" />
                      </button>
                      <button className="p-1 hover:bg-surface-sunken rounded transition-colors">
                        <Trash2 className="size-4 text-intent-danger" />
                      </button>
                    </div>
                  ),
                },
              ]}
              data={sampleData}
              density="comfortable"
            />
          </Card>
        </Section>

        {/* Dashboard Cards */}
        <Section title="Dashboard Cards">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <KPICard
              label="Total Revenue"
              value="₹12.5M"
              change="+12.5%"
              positive
            />
            <KPICard
              label="Active Users"
              value="1,234"
              change="+5.2%"
              positive
            />
            <KPICard
              label="Pending Approvals"
              value="47"
              change="-8.3%"
              positive
            />
            <KPICard
              label="Open Tickets"
              value="23"
              change="+15.4%"
              positive={false}
            />
          </div>
        </Section>

        {/* List Cards */}
        <Section title="Activity Feed">
          <div className="space-y-4 max-w-2xl">
            <ActivityItem
              user="Alice Kumar"
              action="approved purchase order"
              target="PO-2024-001"
              time="2 hours ago"
            />
            <ActivityItem
              user="Bob Smith"
              action="created new employee record"
              target="EMP-456"
              time="4 hours ago"
            />
            <ActivityItem
              user="Carol Chen"
              action="submitted invoice"
              target="INV-789"
              time="Yesterday"
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <h2 className="text-h2 mb-6">{title}</h2>
      {children}
    </div>
  );
}

function KPICard({
  label,
  value,
  change,
  positive,
}: {
  label: string;
  value: string;
  change: string;
  positive: boolean;
}) {
  return (
    <Card hover>
      <div className="space-y-2">
        <div className="text-body-sm text-text-muted">{label}</div>
        <div className="text-h1 font-bold text-text-primary">{value}</div>
        <div className={`text-body-sm font-medium ${positive ? 'text-intent-success' : 'text-intent-danger'}`}>
          {change} from last month
        </div>
      </div>
    </Card>
  );
}

function ActivityItem({
  user,
  action,
  target,
  time,
}: {
  user: string;
  action: string;
  target: string;
  time: string;
}) {
  return (
    <Card hover className="cursor-pointer">
      <div className="flex items-start gap-4">
        <div className="size-10 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold text-body-sm flex-shrink-0">
          {user.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base text-text-primary">
            <span className="font-medium">{user}</span> {action}{' '}
            <span className="font-medium">{target}</span>
          </p>
          <p className="text-body-sm text-text-muted mt-1">{time}</p>
        </div>
      </div>
    </Card>
  );
}
