import { Card, Table, Badge, Button, Input } from '../../components/ui';
import { Plus, Download, Search, Eye, FileText } from 'lucide-react';

export function ProcurementOrders() {
  const orders = [
    { id: 'PO-2024-045', vendor: 'Office Supplies Inc', items: '15 items', amount: '₹2,50,000', date: '2024-05-20', status: 'Approved' },
    { id: 'PO-2024-044', vendor: 'Tech Equipment Ltd', items: '8 items', amount: '₹8,75,000', date: '2024-05-19', status: 'Pending Approval' },
    { id: 'PO-2024-043', vendor: 'Furniture Solutions', items: '25 items', amount: '₹4,50,000', date: '2024-05-18', status: 'In Progress' },
    { id: 'PO-2024-042', vendor: 'Stationery World', items: '50 items', amount: '₹1,25,000', date: '2024-05-17', status: 'Completed' },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 mb-2">Purchase Orders</h1>
          <p className="text-text-secondary">Track and manage procurement orders</p>
        </div>
        <Button leadingIcon={<Plus />}>New Purchase Order</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Total Orders" value="487" />
        <StatCard label="Pending Approval" value="23" color="warning" />
        <StatCard label="In Progress" value="45" color="info" />
        <StatCard label="Total Value" value="₹45.2M" color="success" />
      </div>

      {/* Table */}
      <Card padding="none">
        <div className="p-4 border-b-2 border-border-subtle">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
                <Input id="search-orders" placeholder="Search purchase orders..." className="ps-10" />
              </div>
            </div>
            <Button variant="secondary" leadingIcon={<Download />}>Export</Button>
          </div>
        </div>

        <Table
          columns={[
            { key: 'id', label: 'PO Number' },
            { key: 'vendor', label: 'Vendor' },
            { key: 'items', label: 'Items' },
            { key: 'amount', label: 'Amount' },
            { key: 'date', label: 'Date' },
            {
              key: 'status',
              label: 'Status',
              render: (row) => (
                <Badge
                  intent={
                    row.status === 'Completed' || row.status === 'Approved' ? 'success' :
                    row.status === 'Pending Approval' ? 'warning' : 'info'
                  }
                >
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
                    <FileText className="size-4 text-text-secondary" />
                  </button>
                </div>
              ),
            },
          ]}
          data={orders}
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
