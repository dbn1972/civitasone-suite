import { useState } from 'react';
import { Card, Button, Badge, Input, Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  DollarSign,
  Calendar,
  Building2,
  CreditCard,
  ArrowRight,
  MoreVertical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Payment {
  id: string;
  paymentNumber: string;
  vendor: string;
  vendorId: string;
  amount: number;
  currency: string;
  paymentDate: string;
  dueDate: string;
  method: 'bank_transfer' | 'check' | 'upi' | 'cash' | 'card';
  status: 'draft' | 'pending_approval' | 'approved' | 'processed' | 'failed' | 'cancelled';
  invoiceRefs: string[];
  description: string;
  approver?: string;
  processedDate?: string;
  createdBy: string;
  createdAt: string;
}

const SAMPLE_PAYMENTS: Payment[] = [
  {
    id: '1',
    paymentNumber: 'PAY-2026-001234',
    vendor: 'Acme Office Supplies Pvt Ltd',
    vendorId: 'VEN-00123',
    amount: 245000,
    currency: 'INR',
    paymentDate: '2026-05-24',
    dueDate: '2026-05-20',
    method: 'bank_transfer',
    status: 'pending_approval',
    invoiceRefs: ['INV-2026-5678', 'INV-2026-5679'],
    description: 'Payment for office supplies - April 2026',
    approver: 'Finance Manager',
    createdBy: 'Rajesh Kumar',
    createdAt: '2026-05-22T14:30:00Z',
  },
  {
    id: '2',
    paymentNumber: 'PAY-2026-001235',
    vendor: 'Tech Solutions India Ltd',
    vendorId: 'VEN-00456',
    amount: 1250000,
    currency: 'INR',
    paymentDate: '2026-05-23',
    dueDate: '2026-05-25',
    method: 'bank_transfer',
    status: 'processed',
    invoiceRefs: ['INV-2026-5680'],
    description: 'Software licensing fees Q2 2026',
    approver: 'CFO',
    processedDate: '2026-05-23T10:15:00Z',
    createdBy: 'Priya Sharma',
    createdAt: '2026-05-21T09:00:00Z',
  },
  {
    id: '3',
    paymentNumber: 'PAY-2026-001236',
    vendor: 'Municipal Corporation',
    vendorId: 'VEN-00789',
    amount: 85000,
    currency: 'INR',
    paymentDate: '2026-05-25',
    dueDate: '2026-05-28',
    method: 'upi',
    status: 'approved',
    invoiceRefs: ['INV-2026-5681'],
    description: 'Property tax payment - Q1 2026',
    approver: 'Admin Head',
    createdBy: 'Amit Patel',
    createdAt: '2026-05-23T11:20:00Z',
  },
  {
    id: '4',
    paymentNumber: 'PAY-2026-001237',
    vendor: 'Green Energy Solutions',
    vendorId: 'VEN-00234',
    amount: 340000,
    currency: 'INR',
    paymentDate: '2026-05-22',
    dueDate: '2026-05-18',
    method: 'bank_transfer',
    status: 'failed',
    invoiceRefs: ['INV-2026-5682'],
    description: 'Electricity bill - April 2026',
    approver: 'Finance Manager',
    createdBy: 'Sneha Rao',
    createdAt: '2026-05-20T16:45:00Z',
  },
  {
    id: '5',
    paymentNumber: 'PAY-2026-001238',
    vendor: 'Fleet Management Services',
    vendorId: 'VEN-00567',
    amount: 125000,
    currency: 'INR',
    paymentDate: '2026-05-26',
    dueDate: '2026-05-30',
    method: 'check',
    status: 'draft',
    invoiceRefs: ['INV-2026-5683', 'INV-2026-5684'],
    description: 'Vehicle maintenance - May 2026',
    createdBy: 'Vikram Singh',
    createdAt: '2026-05-23T08:30:00Z',
  },
];

export function FinancePayments() {
  const [payments, setPayments] = useState<Payment[]>(SAMPLE_PAYMENTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPayments, setSelectedPayments] = useState<Set<string>>(new Set());
  const [showBatchActions, setShowBatchActions] = useState(false);

  const filteredPayments = payments.filter((payment) => {
    const matchesSearch =
      payment.paymentNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.vendor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = selectedStatus === 'all' || payment.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: payments.length,
    pending: payments.filter((p) => p.status === 'pending_approval').length,
    processed: payments.filter((p) => p.status === 'processed').length,
    overdue: payments.filter((p) => p.status !== 'processed' && new Date(p.dueDate) < new Date()).length,
    totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
  };

  const togglePaymentSelection = (id: string) => {
    const newSelected = new Set(selectedPayments);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedPayments(newSelected);
    setShowBatchActions(newSelected.size > 0);
  };

  const toggleSelectAll = () => {
    if (selectedPayments.size === filteredPayments.length) {
      setSelectedPayments(new Set());
      setShowBatchActions(false);
    } else {
      setSelectedPayments(new Set(filteredPayments.map((p) => p.id)));
      setShowBatchActions(true);
    }
  };

  const getStatusConfig = (status: Payment['status']) => {
    const configs = {
      draft: { label: 'Draft', variant: 'default' as const, icon: Clock },
      pending_approval: { label: 'Pending Approval', variant: 'warning' as const, icon: Clock },
      approved: { label: 'Approved', variant: 'info' as const, icon: CheckCircle },
      processed: { label: 'Processed', variant: 'success' as const, icon: CheckCircle },
      failed: { label: 'Failed', variant: 'danger' as const, icon: XCircle },
      cancelled: { label: 'Cancelled', variant: 'default' as const, icon: XCircle },
    };
    return configs[status];
  };

  const getMethodLabel = (method: Payment['method']) => {
    const labels = {
      bank_transfer: 'Bank Transfer',
      check: 'Check',
      upi: 'UPI',
      cash: 'Cash',
      card: 'Card',
    };
    return labels[method];
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Payments</h1>
          <p className="text-body-sm text-text-secondary">
            Manage vendor payments, approvals, and batch processing
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" leadingIcon={<Upload />}>
            Import
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Download />}>
            Export
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Plus />}>
            New Payment
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Payments</p>
                <p className="text-h2">{stats.total}</p>
              </div>
              <div className="size-12 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <DollarSign className="size-6 text-intent-info" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Pending Approval</p>
                <p className="text-h2">{stats.pending}</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <Clock className="size-6 text-intent-warning" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Processed</p>
                <p className="text-h2">{stats.processed}</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <CheckCircle className="size-6 text-intent-success" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Amount</p>
                <p className="text-h2">₹{(stats.totalAmount / 100000).toFixed(1)}L</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <DollarSign className="size-6 text-intent-primary" />
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Filters and Search */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                type="text"
                placeholder="Search by payment number, vendor, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_approval">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="processed">Processed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="md" leadingIcon={<Filter />}>
              More Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Batch Actions Bar */}
      <AnimatePresence>
        {showBatchActions && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card className="p-4 bg-intent-primary-bg border-2 border-intent-primary">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <p className="text-body-sm font-medium text-text-primary">
                    {selectedPayments.size} payment{selectedPayments.size !== 1 ? 's' : ''} selected
                  </p>
                  <Button variant="secondary" size="sm">
                    Approve Selected
                  </Button>
                  <Button variant="secondary" size="sm">
                    Process Batch
                  </Button>
                  <Button variant="tertiary" size="sm">
                    Export Selected
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedPayments(new Set());
                    setShowBatchActions(false);
                  }}
                >
                  Clear Selection
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payments Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                <th className="text-left p-4 w-12">
                  <Checkbox
                    checked={selectedPayments.size === filteredPayments.length && filteredPayments.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase tracking-wide">
                  Payment
                </th>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase tracking-wide">
                  Vendor
                </th>
                <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase tracking-wide">
                  Amount
                </th>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase tracking-wide">
                  Method
                </th>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase tracking-wide">
                  Due Date
                </th>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase tracking-wide">
                  Status
                </th>
                <th className="text-center p-4 text-caption font-semibold text-text-secondary uppercase tracking-wide w-12">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((payment, index) => {
                const statusConfig = getStatusConfig(payment.status);
                const StatusIcon = statusConfig.icon;
                const isOverdue = payment.status !== 'processed' && new Date(payment.dueDate) < new Date();

                return (
                  <motion.tr
                    key={payment.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="border-b border-border-subtle hover:bg-surface-sunken transition-colors"
                  >
                    <td className="p-4">
                      <Checkbox
                        checked={selectedPayments.has(payment.id)}
                        onChange={() => togglePaymentSelection(payment.id)}
                      />
                    </td>
                    <td className="p-4">
                      <div>
                        <p className="text-body-sm font-medium text-text-primary">{payment.paymentNumber}</p>
                        <p className="text-caption text-text-muted">{payment.description}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <div>
                        <p className="text-body-sm text-text-primary">{payment.vendor}</p>
                        <p className="text-caption text-text-muted">{payment.vendorId}</p>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <p className="text-body-sm font-semibold text-text-primary">
                        ₹{payment.amount.toLocaleString('en-IN')}
                      </p>
                      <p className="text-caption text-text-muted">
                        {payment.invoiceRefs.length} invoice{payment.invoiceRefs.length !== 1 ? 's' : ''}
                      </p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <CreditCard className="size-4 text-text-muted" />
                        <span className="text-body-sm text-text-primary">{getMethodLabel(payment.method)}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {isOverdue && <AlertTriangle className="size-4 text-intent-danger" />}
                        <div>
                          <p className={`text-body-sm ${isOverdue ? 'text-intent-danger' : 'text-text-primary'}`}>
                            {new Date(payment.dueDate).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </p>
                          {isOverdue && <p className="text-caption text-intent-danger">Overdue</p>}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={statusConfig.variant}>
                        <StatusIcon className="size-3" />
                        {statusConfig.label}
                      </Badge>
                    </td>
                    <td className="p-4 text-center">
                      <button className="p-2 hover:bg-surface-sunken rounded-lg transition-colors">
                        <MoreVertical className="size-4 text-text-muted" />
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredPayments.length === 0 && (
          <div className="p-12 text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <DollarSign className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No payments found</h3>
            <p className="text-body-sm text-text-secondary">
              {searchQuery || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first payment to get started'}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
