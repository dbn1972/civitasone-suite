import { useState } from 'react';
import { Card, Table, Badge, Button, Input, FormField } from '../../components/ui';
import { Plus, Download, Search, Eye, Edit } from 'lucide-react';

export function FinanceInvoices() {
  const invoices = [
    { id: 'INV-2024-001', vendor: 'Acme Corp', amount: '₹2,50,000', date: '2024-05-20', status: 'Paid', dueDate: '2024-06-20' },
    { id: 'INV-2024-002', vendor: 'Tech Solutions Ltd', amount: '₹1,75,000', date: '2024-05-19', status: 'Pending', dueDate: '2024-06-19' },
    { id: 'INV-2024-003', vendor: 'Office Supplies Inc', amount: '₹45,000', date: '2024-05-18', status: 'Overdue', dueDate: '2024-05-25' },
    { id: 'INV-2024-004', vendor: 'Cloud Services Pro', amount: '₹3,25,000', date: '2024-05-17', status: 'Paid', dueDate: '2024-06-17' },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 mb-2">Invoices</h1>
          <p className="text-text-secondary">Manage vendor invoices and payments</p>
        </div>
        <Button leadingIcon={<Plus />}>Create Invoice</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Total Invoices" value="234" />
        <StatCard label="Pending Payment" value="₹8.5M" color="warning" />
        <StatCard label="Paid This Month" value="₹12.3M" color="success" />
        <StatCard label="Overdue" value="15" color="danger" />
      </div>

      {/* Filters & Table */}
      <Card padding="none">
        <div className="p-4 border-b-2 border-border-subtle space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
                <Input id="search-invoices" placeholder="Search invoices..." className="ps-10" />
              </div>
            </div>
            <Button variant="secondary" leadingIcon={<Download />}>Export</Button>
          </div>
        </div>

        <Table
          columns={[
            { key: 'id', label: 'Invoice ID' },
            { key: 'vendor', label: 'Vendor' },
            { key: 'amount', label: 'Amount' },
            { key: 'date', label: 'Invoice Date' },
            { key: 'dueDate', label: 'Due Date' },
            {
              key: 'status',
              label: 'Status',
              render: (row) => (
                <Badge
                  intent={
                    row.status === 'Paid' ? 'success' :
                    row.status === 'Pending' ? 'warning' : 'danger'
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
                    <Edit className="size-4 text-text-secondary" />
                  </button>
                </div>
              ),
            },
          ]}
          data={invoices}
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
