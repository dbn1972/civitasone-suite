import { useState } from 'react';
import { Card, Button, Badge, Input, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  ShoppingCart,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  User,
  Calendar,
  DollarSign,
  Building2,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Forward,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ApprovalRequest {
  id: string;
  poNumber: string;
  vendor: string;
  requestedBy: string;
  department: string;
  amount: number;
  currency: string;
  items: number;
  description: string;
  createdDate: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'approved' | 'rejected' | 'delegated';
  attachments: number;
  approvalLevel: string;
  nextApprover?: string;
}

const SAMPLE_APPROVALS: ApprovalRequest[] = [
  {
    id: '1',
    poNumber: 'PO-2026-001245',
    vendor: 'Acme Office Supplies Pvt Ltd',
    requestedBy: 'Rajesh Kumar',
    department: 'Engineering',
    amount: 245000,
    currency: 'INR',
    items: 12,
    description: 'Office furniture and supplies for new workspace setup',
    createdDate: '2026-05-22T10:30:00Z',
    dueDate: '2026-05-25T17:00:00Z',
    priority: 'high',
    status: 'pending',
    attachments: 3,
    approvalLevel: 'L1 - Department Head',
    nextApprover: 'Finance Manager',
  },
  {
    id: '2',
    poNumber: 'PO-2026-001246',
    vendor: 'Tech Solutions India Ltd',
    requestedBy: 'Priya Sharma',
    department: 'IT',
    amount: 1250000,
    currency: 'INR',
    items: 5,
    description: 'Enterprise software licenses and cloud infrastructure',
    createdDate: '2026-05-21T14:15:00Z',
    dueDate: '2026-05-24T17:00:00Z',
    priority: 'urgent',
    status: 'pending',
    attachments: 7,
    approvalLevel: 'L2 - Finance Manager',
    nextApprover: 'CFO',
  },
  {
    id: '3',
    poNumber: 'PO-2026-001247',
    vendor: 'Green Energy Solutions',
    requestedBy: 'Amit Patel',
    department: 'Admin',
    amount: 85000,
    currency: 'INR',
    items: 2,
    description: 'Quarterly electricity and maintenance services',
    createdDate: '2026-05-20T09:00:00Z',
    dueDate: '2026-05-26T17:00:00Z',
    priority: 'medium',
    status: 'approved',
    attachments: 2,
    approvalLevel: 'L1 - Department Head',
  },
  {
    id: '4',
    poNumber: 'PO-2026-001248',
    vendor: 'Fleet Management Services',
    requestedBy: 'Sneha Rao',
    department: 'Operations',
    amount: 340000,
    currency: 'INR',
    items: 8,
    description: 'Vehicle maintenance and fuel for company fleet',
    createdDate: '2026-05-19T16:20:00Z',
    dueDate: '2026-05-23T17:00:00Z',
    priority: 'low',
    status: 'rejected',
    attachments: 1,
    approvalLevel: 'L1 - Department Head',
  },
];

export function ProcurementApprovals() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>(SAMPLE_APPROVALS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('pending');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'delegate' | null>(null);
  const [comments, setComments] = useState('');
  const [delegateTo, setDelegateTo] = useState('');

  const filteredApprovals = approvals.filter((approval) => {
    const matchesSearch =
      approval.poNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      approval.vendor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      approval.requestedBy.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPriority = selectedPriority === 'all' || approval.priority === selectedPriority;
    const matchesStatus = selectedStatus === 'all' || approval.status === selectedStatus;

    return matchesSearch && matchesPriority && matchesStatus;
  });

  const stats = {
    pending: approvals.filter((a) => a.status === 'pending').length,
    approved: approvals.filter((a) => a.status === 'approved').length,
    rejected: approvals.filter((a) => a.status === 'rejected').length,
    totalValue: approvals.filter((a) => a.status === 'pending').reduce((sum, a) => sum + a.amount, 0),
  };

  const getPriorityConfig = (priority: ApprovalRequest['priority']) => {
    const configs = {
      low: { label: 'Low', variant: 'default' as const, color: 'text-muted' },
      medium: { label: 'Medium', variant: 'info' as const, color: 'intent-info' },
      high: { label: 'High', variant: 'warning' as const, color: 'intent-warning' },
      urgent: { label: 'Urgent', variant: 'danger' as const, color: 'intent-danger' },
    };
    return configs[priority];
  };

  const getStatusConfig = (status: ApprovalRequest['status']) => {
    const configs = {
      pending: { label: 'Pending', variant: 'warning' as const, icon: Clock },
      approved: { label: 'Approved', variant: 'success' as const, icon: CheckCircle },
      rejected: { label: 'Rejected', variant: 'danger' as const, icon: XCircle },
      delegated: { label: 'Delegated', variant: 'info' as const, icon: Forward },
    };
    return configs[status];
  };

  const openApprovalModal = (request: ApprovalRequest, action: 'approve' | 'reject' | 'delegate') => {
    setSelectedRequest(request);
    setActionType(action);
    setShowApprovalModal(true);
    setComments('');
    setDelegateTo('');
  };

  const handleSubmitAction = () => {
    if (!selectedRequest || !actionType) return;

    // Update the approval status
    setApprovals((prev) =>
      prev.map((a) =>
        a.id === selectedRequest.id
          ? { ...a, status: actionType === 'delegate' ? 'delegated' : actionType === 'approve' ? 'approved' : 'rejected' }
          : a
      )
    );

    setShowApprovalModal(false);
    setSelectedRequest(null);
    setActionType(null);
  };

  const isOverdue = (dueDate: string) => {
    return new Date(dueDate) < new Date();
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Purchase Order Approvals</h1>
          <p className="text-body-sm text-text-secondary">
            Review and approve pending purchase orders and requisitions
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
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

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Approved</p>
                <p className="text-h2">{stats.approved}</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <CheckCircle className="size-6 text-intent-success" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Rejected</p>
                <p className="text-h2">{stats.rejected}</p>
              </div>
              <div className="size-12 bg-intent-danger-bg rounded-lg flex items-center justify-center">
                <XCircle className="size-6 text-intent-danger" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Value</p>
                <p className="text-h2">₹{(stats.totalValue / 100000).toFixed(1)}L</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <DollarSign className="size-6 text-intent-primary" />
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                type="text"
                placeholder="Search by PO number, vendor, or requester..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="delegated">Delegated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedPriority} onValueChange={setSelectedPriority}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="md" leadingIcon={<Filter />}>
              More Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Approval Requests */}
      <div className="space-y-4">
        {filteredApprovals.map((request, index) => {
          const priorityConfig = getPriorityConfig(request.priority);
          const statusConfig = getStatusConfig(request.status);
          const StatusIcon = statusConfig.icon;
          const overdue = isOverdue(request.dueDate);

          return (
            <motion.div
              key={request.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className={`p-6 ${overdue && request.status === 'pending' ? 'border-2 border-intent-danger' : ''}`}>
                <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                  {/* Left: Request Info */}
                  <div className="flex-1 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-h4">{request.poNumber}</h3>
                          <Badge variant={priorityConfig.variant}>{priorityConfig.label}</Badge>
                          <Badge variant={statusConfig.variant}>
                            <StatusIcon className="size-3" />
                            {statusConfig.label}
                          </Badge>
                          {overdue && request.status === 'pending' && (
                            <Badge variant="danger">
                              <AlertTriangle className="size-3" />
                              Overdue
                            </Badge>
                          )}
                        </div>
                        <p className="text-body-sm text-text-secondary mb-1">{request.description}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-caption text-text-muted mb-1">Vendor</p>
                        <div className="flex items-center gap-2">
                          <Building2 className="size-4 text-text-muted" />
                          <p className="text-body-sm font-medium text-text-primary">{request.vendor}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-caption text-text-muted mb-1">Requested By</p>
                        <div className="flex items-center gap-2">
                          <User className="size-4 text-text-muted" />
                          <p className="text-body-sm text-text-primary">{request.requestedBy}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-caption text-text-muted mb-1">Amount</p>
                        <div className="flex items-center gap-2">
                          <DollarSign className="size-4 text-text-muted" />
                          <p className="text-body-sm font-semibold text-text-primary">₹{request.amount.toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-caption text-text-muted mb-1">Due Date</p>
                        <div className="flex items-center gap-2">
                          <Calendar className="size-4 text-text-muted" />
                          <p className={`text-body-sm ${overdue ? 'text-intent-danger font-semibold' : 'text-text-primary'}`}>
                            {new Date(request.dueDate).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-caption text-text-muted">
                      <span>{request.items} items</span>
                      <span>•</span>
                      <span>{request.department}</span>
                      <span>•</span>
                      <span>{request.approvalLevel}</span>
                      {request.attachments > 0 && (
                        <>
                          <span>•</span>
                          <span>{request.attachments} attachments</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  {request.status === 'pending' && (
                    <div className="flex lg:flex-col items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        leadingIcon={<ThumbsUp />}
                        onClick={() => openApprovalModal(request, 'approve')}
                        className="flex-1 lg:flex-none lg:w-32"
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        leadingIcon={<ThumbsDown />}
                        onClick={() => openApprovalModal(request, 'reject')}
                        className="flex-1 lg:flex-none lg:w-32"
                      >
                        Reject
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        leadingIcon={<Forward />}
                        onClick={() => openApprovalModal(request, 'delegate')}
                        className="flex-1 lg:flex-none lg:w-32"
                      >
                        Delegate
                      </Button>
                      <Button variant="secondary" size="sm" iconOnly>
                        <Eye />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {filteredApprovals.length === 0 && (
        <Card className="p-12">
          <div className="text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <ShoppingCart className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No approvals found</h3>
            <p className="text-body-sm text-text-secondary">
              {searchQuery || selectedPriority !== 'all' || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'All caught up! No pending approvals at the moment.'}
            </p>
          </div>
        </Card>
      )}

      {/* Approval Modal */}
      <AnimatePresence>
        {showApprovalModal && selectedRequest && actionType && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowApprovalModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-raised rounded-lg shadow-lg max-w-lg w-full"
            >
              <div className="p-6 border-b-2 border-border-subtle">
                <h2 className="text-h2">
                  {actionType === 'approve' && 'Approve Purchase Order'}
                  {actionType === 'reject' && 'Reject Purchase Order'}
                  {actionType === 'delegate' && 'Delegate Approval'}
                </h2>
                <p className="text-body-sm text-text-secondary mt-1">{selectedRequest.poNumber}</p>
              </div>

              <div className="p-6 space-y-4">
                <div className="p-4 bg-surface-sunken rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-caption text-text-muted">Vendor</span>
                    <span className="text-body-sm font-medium text-text-primary">{selectedRequest.vendor}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-caption text-text-muted">Amount</span>
                    <span className="text-body-sm font-semibold text-text-primary">₹{selectedRequest.amount.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-caption text-text-muted">Requested By</span>
                    <span className="text-body-sm text-text-primary">{selectedRequest.requestedBy}</span>
                  </div>
                </div>

                {actionType === 'delegate' && (
                  <div>
                    <label className="block text-body-sm font-medium text-text-primary mb-2">
                      Delegate To
                    </label>
                    <Select value={delegateTo} onValueChange={setDelegateTo}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select approver..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Finance Manager">Finance Manager</SelectItem>
                        <SelectItem value="CFO">CFO</SelectItem>
                        <SelectItem value="Department Head">Department Head</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div>
                  <label className="block text-body-sm font-medium text-text-primary mb-2">
                    Comments {actionType === 'reject' && <span className="text-intent-danger">*</span>}
                  </label>
                  <Textarea
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder={
                      actionType === 'approve'
                        ? 'Optional comments about this approval...'
                        : actionType === 'reject'
                        ? 'Please provide a reason for rejection...'
                        : 'Optional notes for the delegated approver...'
                    }
                    rows={4}
                  />
                </div>
              </div>

              <div className="p-6 border-t-2 border-border-subtle flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setShowApprovalModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant={actionType === 'approve' ? 'primary' : actionType === 'reject' ? 'danger' : 'primary'}
                  onClick={handleSubmitAction}
                  disabled={actionType === 'reject' && !comments.trim()}
                >
                  {actionType === 'approve' && 'Approve'}
                  {actionType === 'reject' && 'Reject'}
                  {actionType === 'delegate' && 'Delegate'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
