import { Card, Table, Badge, Button, Input } from '../../components/ui';
import { Plus, Download, Search, Eye, Edit, UserPlus } from 'lucide-react';

export function HRMSEmployees() {
  const employees = [
    { id: 'EMP-001', name: 'Alice Kumar', email: 'alice@gov.in', department: 'Finance', position: 'Manager', status: 'Active', joinDate: '2020-01-15' },
    { id: 'EMP-002', name: 'Bob Smith', email: 'bob@gov.in', department: 'IT', position: 'Developer', status: 'Active', joinDate: '2021-03-20' },
    { id: 'EMP-003', name: 'Carol Chen', email: 'carol@gov.in', department: 'HR', position: 'Specialist', status: 'Active', joinDate: '2019-06-10' },
    { id: 'EMP-004', name: 'David Patel', email: 'david@gov.in', department: 'Procurement', position: 'Officer', status: 'On Leave', joinDate: '2022-02-01' },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 mb-2">Employees</h1>
          <p className="text-text-secondary">Manage employee records and information</p>
        </div>
        <Button leadingIcon={<UserPlus />}>Add Employee</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Total Employees" value="1,234" />
        <StatCard label="Present Today" value="1,156" color="success" />
        <StatCard label="On Leave" value="45" color="warning" />
        <StatCard label="New This Month" value="23" color="info" />
      </div>

      {/* Table */}
      <Card padding="none">
        <div className="p-4 border-b-2 border-border-subtle">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
                <Input id="search-employees" placeholder="Search employees..." className="ps-10" />
              </div>
            </div>
            <Button variant="secondary" leadingIcon={<Download />}>Export</Button>
          </div>
        </div>

        <Table
          columns={[
            { key: 'id', label: 'Employee ID' },
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'department', label: 'Department' },
            { key: 'position', label: 'Position' },
            {
              key: 'status',
              label: 'Status',
              render: (row) => (
                <Badge intent={row.status === 'Active' ? 'success' : 'warning'}>
                  {row.status}
                </Badge>
              ),
            },
            {
              key: 'actions',
              label: 'Actions',
              render: () => (
                <div className="flex gap-2">
                  <button className="p-1.5 hover:bg-surface-sunken rounded transition-colors">
                    <Eye className="size-4 text-text-secondary" />
                  </button>
                  <button className="p-1.5 hover:bg-surface-sunken rounded transition-colors">
                    <Edit className="size-4 text-text-secondary" />
                  </button>
                </div>
              ),
            },
          ]}
          data={employees}
          density="comfortable"
        />
      </Card>
    </div>
  );
}

function StatCard({ label, value, color = 'primary' }: { label: string; value: string; color?: string }) {
  return (
    <Card>
      <div className="text-body-sm text-text-muted mb-2">{label}</div>
      <div className="text-h2 font-bold text-text-primary">{value}</div>
    </Card>
  );
}
