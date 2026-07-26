import { useState } from 'react';
import { Card, Table, Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import { Plus, Download, Search, Eye, CheckCircle, XCircle } from 'lucide-react';

interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendor: string;
  date: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'partially_received' | 'received' | 'cancelled';
  total: number;
  currency: string;
  approver: string;
  receivedQty?: number;
  totalQty?: number;
}

const SAMPLE_POS: PurchaseOrder[] = [
  { id: '1', poNumber: 'PO-2024-045', vendor: 'Acme Supplies Ltd', date: '2024-05-23', status: 'approved', total: 250000, currency: 'INR', approver: 'Alice Kumar' },
  { id: '2', poNumber: 'PO-2024-044', vendor: 'Tech Equipment Co', date: '2024-05-22', status: 'pending_approval', total: 875000, currency: 'INR', approver: 'Bob Smith' },
  { id: '3', poNumber: 'PO-2024-043', vendor: 'Office Furniture Inc', date: '2024-05-21', status: 'partially_received', total: 450000, currency: 'INR', approver: 'Alice Kumar', receivedQty: 15, totalQty: 25 },
  { id: '4', poNumber: 'PO-2024-042', vendor: 'Stationery World', date: '2024-05-20', status: 'received', total: 125000, currency: 'INR', approver: 'Carol Chen' },
  { id: '5', poNumber: 'PO-2024-041', vendor: 'IT Solutions Pro', date: '2024-05-19', status: 'draft', total: 325000, currency: 'INR', approver: '-' },
  { id: '6', poNumber: 'PO-2024-040', vendor: 'Green Energy Systems', date: '2024-05-18', status: 'cancelled', total: 550000, currency: 'INR', approver: 'Alice Kumar' },
];

export function PurchaseOrderList() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  const getStatusBadge = (status: PurchaseOrder['status']) => {
    const config = {
      draft: { intent: 'neutral' as const, label: 'Draft' },
      pending_approval: { intent: 'warning' as const, label: 'Pending Approval' },
      approved: { intent: 'success' as const, label: 'Approved' },
      partially_received: { intent: 'info' as const, label: 'Partially Received' },
      received: { intent: 'success' as const, label: 'Received' },
      cancelled: { intent: 'danger' as const, label: 'Cancelled' },
    };
    return config[status];
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedOrders(new Set(SAMPLE_POS.map(po => po.id)));
    } else {
      setSelectedOrders(new Set());
    }
  };

  const handleSelectOrder = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedOrders);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedOrders(newSelected);
  };

  const handleBulkApprove = () => {
    console.log('Bulk approving:', Array.from(selectedOrders));
    // Implement bulk approval logic
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Purchase Orders</h1>
          <p className="text-text-secondary">Manage vendor purchase orders and track deliveries</p>
        </div>
        <Button leadingIcon={<Plus />} onClick={() => window.location.href = '/app/procurement/orders/new'}>
          New PO
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Total Orders" value="487" />
        <StatCard label="Pending Approval" value="23" color="warning" />
        <StatCard label="In Transit" value="45" color="info" />
        <StatCard label="Total Value" value="₹45.2M" color="success" />
      </div>

      {/* Toolbar */}
      <Card>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[250px] max-w-md">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
                <Input
                  id="search-pos"
                  placeholder="Search by PO number or vendor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                />
              </div>
            </div>

            {/* Filters */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_approval">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="partially_received">Partially Received</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vendors</SelectItem>
                <SelectItem value="acme">Acme Supplies Ltd</SelectItem>
                <SelectItem value="tech">Tech Equipment Co</SelectItem>
                <SelectItem value="furniture">Office Furniture Inc</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="secondary" size="sm" leadingIcon={<Download />}>
              Export
            </Button>
          </div>

          {/* Bulk Actions */}
          {selectedOrders.size > 0 && (
            <div className="flex items-center gap-4 p-3 bg-intent-primary-bg border border-intent-primary-border rounded-lg">
              <span className="text-body-sm text-intent-primary font-medium">
                {selectedOrders.size} order{selectedOrders.size > 1 ? 's' : ''} selected
              </span>
              <Button size="sm" onClick={handleBulkApprove} leadingIcon={<CheckCircle />}>
                Bulk Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSelectedOrders(new Set())}>
                Clear Selection
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                <th className="w-12 px-4 py-4">
                  <input
                    type="checkbox"
                    checked={selectedOrders.size === SAMPLE_POS.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="size-4 text-intent-primary border-border-default rounded"
                  />
                </th>
                <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">PO Number</th>
                <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Vendor</th>
                <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Date</th>
                <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Status</th>
                <th className="px-4 py-4 text-end text-body-sm font-semibold text-text-primary">Total</th>
                <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Approver</th>
                <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {SAMPLE_POS.map((po) => {
                const statusBadge = getStatusBadge(po.status);
                return (
                  <tr
                    key={po.id}
                    className="hover:bg-surface-sunken transition-colors cursor-pointer"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
                        window.location.href = `/app/procurement/orders/${po.id}`;
                      }
                    }}
                  >
                    <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(po.id)}
                        onChange={(e) => handleSelectOrder(po.id, e.target.checked)}
                        className="size-4 text-intent-primary border-border-default rounded"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-mono text-text-primary font-medium">{po.poNumber}</span>
                    </td>
                    <td className="px-4 py-4 text-text-primary">{po.vendor}</td>
                    <td className="px-4 py-4 text-text-secondary">{po.date}</td>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <Badge intent={statusBadge.intent}>{statusBadge.label}</Badge>
                        {po.status === 'partially_received' && po.receivedQty && po.totalQty && (
                          <div className="w-32">
                            <div className="flex items-center justify-between text-caption text-text-muted mb-1">
                              <span>{po.receivedQty}/{po.totalQty}</span>
                              <span>{Math.round((po.receivedQty / po.totalQty) * 100)}%</span>
                            </div>
                            <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                              <div
                                className="h-full bg-intent-info rounded-full"
                                style={{ width: `${(po.receivedQty / po.totalQty) * 100}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-end">
                      <span className="font-mono text-text-primary">
                        {po.total.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-text-secondary">{po.approver}</td>
                    <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => window.location.href = `/app/procurement/orders/${po.id}`}
                          className="p-1.5 hover:bg-surface-canvas rounded transition-colors"
                          title="View details"
                        >
                          <Eye className="size-4 text-text-secondary" />
                        </button>
                        {po.status === 'pending_approval' && (
                          <>
                            <button
                              className="p-1.5 hover:bg-surface-canvas rounded transition-colors"
                              title="Approve"
                            >
                              <CheckCircle className="size-4 text-intent-success" />
                            </button>
                            <button
                              className="p-1.5 hover:bg-surface-canvas rounded transition-colors"
                              title="Reject"
                            >
                              <XCircle className="size-4 text-intent-danger" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
