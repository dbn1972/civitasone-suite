import { useState } from 'react';
import { Card, Button, Badge, Input, Textarea } from '../components/ui';
import {
  Filter,
  CheckCircle,
  XCircle,
  FileText,
  Calendar,
  DollarSign,
  Package,
  UserPlus,
  Clock,
  MoreVertical,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'motion/react';

interface Approval {
  id: string;
  module: 'leave' | 'expense' | 'po' | 'payment' | 'helpdesk';
  requester: string;
  requesterRole: string;
  requesterAvatar: string;
  summary: string;
  details: string;
  amount?: number;
  currency?: string;
  dates?: string;
  slaMinutes: number;
  attachments?: number;
  createdAt: string;
}

const SAMPLE_APPROVALS: Approval[] = [
  {
    id: '1',
    module: 'leave',
    requester: 'Amit Patel',
    requesterRole: 'Senior Developer',
    requesterAvatar: 'AP',
    summary: 'Earned Leave for 5 days on Jun 30 - Jul 5',
    details: 'Planning a family trip to Manali. Will be completely disconnected from work.',
    dates: 'Jun 30 - Jul 5, 2024',
    slaMinutes: 45,
    createdAt: '2024-06-23T10:15:00',
  },
  {
    id: '2',
    module: 'expense',
    requester: 'Priya Singh',
    requesterRole: 'Team Lead',
    requesterAvatar: 'PS',
    summary: 'Travel Expense for ₹12,450 on Jun 15-18',
    details: 'Client visit to Mumbai - flight, hotel, and local transport expenses.',
    amount: 12450,
    currency: 'INR',
    dates: 'Jun 15-18, 2024',
    slaMinutes: 120,
    attachments: 3,
    createdAt: '2024-06-20T14:30:00',
  },
  {
    id: '3',
    module: 'po',
    requester: 'Rajesh Kumar',
    requesterRole: 'Procurement Officer',
    requesterAvatar: 'RK',
    summary: 'Purchase Order for ₹2,50,000',
    details: 'Office furniture for new wing - 20 desks, 20 chairs, and accessories.',
    amount: 250000,
    currency: 'INR',
    slaMinutes: 15,
    attachments: 2,
    createdAt: '2024-06-23T11:00:00',
  },
  {
    id: '4',
    module: 'payment',
    requester: 'Sneha Kumar',
    requesterRole: 'Accounts Manager',
    requesterAvatar: 'SK',
    summary: 'Vendor Payment for ₹1,85,000',
    details: 'Payment to Tech Supplies Co for Invoice INV-2024-456.',
    amount: 185000,
    currency: 'INR',
    slaMinutes: 240,
    createdAt: '2024-06-22T09:45:00',
  },
  {
    id: '5',
    module: 'helpdesk',
    requester: 'Karthik Reddy',
    requesterRole: 'Support Manager',
    requesterAvatar: 'KR',
    summary: 'Ticket Reassignment - High Priority',
    details: 'Critical server issue ticket needs L3 team assignment.',
    slaMinutes: 5,
    createdAt: '2024-06-23T11:30:00',
  },
];

export function ApprovalInbox() {
  const [approvals, setApprovals] = useState<Approval[]>(SAMPLE_APPROVALS);
  const [segmentFilter, setSegmentFilter] = useState<'all' | 'today' | 'overdue'>('all');
  const [moduleFilter, setModuleFilter] = useState<'all' | 'leave' | 'expense' | 'po' | 'payment' | 'helpdesk'>('all');
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [showRejectSheet, setShowRejectSheet] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const getModuleConfig = (module: Approval['module']) => {
    const config = {
      leave: { label: 'Leave', icon: Calendar, color: 'bg-blue-500', intent: 'info' as const },
      expense: { label: 'Expense', icon: DollarSign, color: 'bg-green-500', intent: 'success' as const },
      po: { label: 'Purchase Order', icon: Package, color: 'bg-purple-500', intent: 'primary' as const },
      payment: { label: 'Payment', icon: DollarSign, color: 'bg-yellow-500', intent: 'warning' as const },
      helpdesk: { label: 'Helpdesk', icon: UserPlus, color: 'bg-red-500', intent: 'danger' as const },
    };
    return config[module];
  };

  const getSLAColor = (minutes: number) => {
    if (minutes < 0) return { color: 'text-intent-danger', bg: 'bg-intent-danger-bg', label: 'Overdue' };
    if (minutes < 30) return { color: 'text-intent-danger', bg: 'bg-intent-danger-bg', label: `${minutes}m` };
    if (minutes < 120) return { color: 'text-intent-warning', bg: 'bg-intent-warning-bg', label: `${Math.floor(minutes / 60)}h ${minutes % 60}m` };
    return { color: 'text-intent-success', bg: 'bg-intent-success-bg', label: `${Math.floor(minutes / 60)}h` };
  };

  const handleApprove = (id: string) => {
    console.log('Approving:', id);
    setApprovals((prev) => prev.filter((a) => a.id !== id));
  };

  const handleReject = (id: string) => {
    console.log('Rejecting:', id, 'Comment:', rejectComment);
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    setShowRejectSheet(false);
    setRejectComment('');
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setRefreshing(false);
  };

  const filteredApprovals = approvals.filter((approval) => {
    const matchesModule = moduleFilter === 'all' || approval.module === moduleFilter;
    const now = new Date();
    const createdAt = new Date(approval.createdAt);
    const isToday = createdAt.toDateString() === now.toDateString();
    const isOverdue = approval.slaMinutes < 0;

    const matchesSegment =
      segmentFilter === 'all' ||
      (segmentFilter === 'today' && isToday) ||
      (segmentFilter === 'overdue' && isOverdue);

    return matchesModule && matchesSegment;
  });

  const overdueCount = approvals.filter((a) => a.slaMinutes < 0).length;

  return (
    <div className="min-h-screen bg-surface-canvas">
      {/* App Bar */}
      <div className="sticky top-0 z-30 bg-surface-raised border-b-2 border-border-subtle">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h1 className="text-h2 font-bold text-text-primary">Approvals</h1>
              {approvals.length > 0 && (
                <Badge intent="primary">{approvals.length}</Badge>
              )}
              {overdueCount > 0 && (
                <Badge intent="danger">{overdueCount} overdue</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                className="p-2 hover:bg-surface-sunken rounded-lg transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw className={`size-5 text-text-secondary ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button className="p-2 hover:bg-surface-sunken rounded-lg transition-colors" aria-label="Filter">
                <Filter className="size-5 text-text-secondary" />
              </button>
            </div>
          </div>

          {/* Segmented Control */}
          <div className="flex items-center gap-2 p-1 bg-surface-sunken rounded-lg mb-4">
            {(['all', 'today', 'overdue'] as const).map((segment) => (
              <button
                key={segment}
                onClick={() => setSegmentFilter(segment)}
                className={`flex-1 px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
                  segmentFilter === segment
                    ? 'bg-surface-raised text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {segment === 'all' && 'All'}
                {segment === 'today' && 'Today'}
                {segment === 'overdue' && 'Overdue'}
              </button>
            ))}
          </div>

          {/* Module Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
            {(['all', 'leave', 'expense', 'po', 'payment', 'helpdesk'] as const).map((module) => {
              const config = module !== 'all' ? getModuleConfig(module) : null;
              return (
                <button
                  key={module}
                  onClick={() => setModuleFilter(module)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-body-sm font-medium whitespace-nowrap transition-colors ${
                    moduleFilter === module
                      ? 'bg-intent-primary text-white'
                      : 'bg-surface-sunken text-text-secondary hover:bg-surface-raised'
                  }`}
                >
                  {config && <config.icon className="size-4" />}
                  {module === 'all' && 'All'}
                  {module === 'leave' && 'Leave'}
                  {module === 'expense' && 'Expense'}
                  {module === 'po' && 'PO'}
                  {module === 'payment' && 'Payment'}
                  {module === 'helpdesk' && 'Helpdesk'}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {filteredApprovals.length === 0 ? (
          <div className="text-center py-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="size-24 bg-gradient-to-br from-intent-success to-intent-primary rounded-full mx-auto flex items-center justify-center">
                <CheckCircle className="size-12 text-white" />
              </div>
              <h3 className="text-h3 text-text-primary">All caught up!</h3>
              <p className="text-text-secondary max-w-md mx-auto">
                You don't have any pending approvals. Great job staying on top of things!
              </p>
            </motion.div>
          </div>
        ) : (
          <AnimatePresence>
            {filteredApprovals.map((approval, index) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                index={index}
                onApprove={() => handleApprove(approval.id)}
                onReject={() => {
                  setSelectedApproval(approval);
                  setShowRejectSheet(true);
                }}
                onReview={() => setSelectedApproval(approval)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Detail Drawer */}
      <AnimatePresence>
        {selectedApproval && !showRejectSheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedApproval(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed bottom-0 left-0 right-0 max-h-[85vh] bg-surface-canvas rounded-t-2xl z-50 overflow-y-auto shadow-2xl"
            >
              <div className="sticky top-0 bg-surface-raised p-6 border-b-2 border-border-subtle">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge intent={getModuleConfig(selectedApproval.module).intent}>
                        {getModuleConfig(selectedApproval.module).label}
                      </Badge>
                      <Badge intent={getSLAColor(selectedApproval.slaMinutes).color === 'text-intent-danger' ? 'danger' : getSLAColor(selectedApproval.slaMinutes).color === 'text-intent-warning' ? 'warning' : 'success'}>
                        {getSLAColor(selectedApproval.slaMinutes).label}
                      </Badge>
                    </div>
                    <h2 className="text-h3 text-text-primary mb-2">{selectedApproval.summary}</h2>
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white text-caption font-semibold">
                        {selectedApproval.requesterAvatar}
                      </div>
                      <div>
                        <div className="text-body-sm font-medium text-text-primary">{selectedApproval.requester}</div>
                        <div className="text-caption text-text-muted">{selectedApproval.requesterRole}</div>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedApproval(null)}
                    className="p-2 hover:bg-surface-sunken rounded-lg transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <Card>
                  <h3 className="text-h4 mb-3">Details</h3>
                  <p className="text-text-primary mb-4">{selectedApproval.details}</p>
                  {selectedApproval.dates && (
                    <div className="text-body-sm text-text-secondary">
                      <strong>Dates:</strong> {selectedApproval.dates}
                    </div>
                  )}
                  {selectedApproval.amount && (
                    <div className="text-body-sm text-text-secondary">
                      <strong>Amount:</strong> {selectedApproval.amount.toLocaleString('en-IN', { style: 'currency', currency: selectedApproval.currency })}
                    </div>
                  )}
                  {selectedApproval.attachments && (
                    <div className="text-body-sm text-text-secondary">
                      <strong>Attachments:</strong> {selectedApproval.attachments} file(s)
                    </div>
                  )}
                </Card>

                <Card>
                  <h3 className="text-h4 mb-3">Timeline</h3>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="size-8 rounded-full bg-intent-primary-bg flex items-center justify-center flex-shrink-0">
                        <Clock className="size-4 text-intent-primary" />
                      </div>
                      <div>
                        <p className="text-body-sm font-medium text-text-primary">Submitted for approval</p>
                        <p className="text-caption text-text-muted">
                          {new Date(selectedApproval.createdAt).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Sticky Action Buttons */}
              <div className="sticky bottom-0 bg-surface-raised border-t-2 border-border-subtle p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="secondary"
                    intent="danger"
                    leadingIcon={<XCircle />}
                    onClick={() => {
                      setShowRejectSheet(true);
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    leadingIcon={<CheckCircle />}
                    onClick={() => {
                      handleApprove(selectedApproval.id);
                      setSelectedApproval(null);
                    }}
                  >
                    Approve
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reject Comment Sheet */}
      <AnimatePresence>
        {showRejectSheet && selectedApproval && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRejectSheet(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed bottom-0 left-0 right-0 bg-surface-canvas rounded-t-2xl z-50 shadow-2xl"
            >
              <div className="p-6">
                <h3 className="text-h3 mb-4">Reject Approval</h3>
                <p className="text-text-secondary mb-4">
                  Please provide a reason for rejecting this request.
                </p>
                <Textarea
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder="Enter rejection reason..."
                  rows={4}
                  className="resize-none mb-4"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowRejectSheet(false);
                      setRejectComment('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    intent="danger"
                    onClick={() => handleReject(selectedApproval.id)}
                    disabled={!rejectComment.trim()}
                  >
                    Confirm Reject
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ApprovalCard({
  approval,
  index,
  onApprove,
  onReject,
  onReview,
}: {
  approval: Approval;
  index: number;
  onApprove: () => void;
  onReject: () => void;
  onReview: () => void;
}) {
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-150, 0, 150], [0.5, 1, 0.5]);
  const moduleConfig = getModuleConfig(approval.module);
  const ModuleIcon = moduleConfig.icon;
  const slaConfig = getSLAColor(approval.slaMinutes);

  function getModuleConfig(module: Approval['module']) {
    const config = {
      leave: { label: 'Leave', icon: Calendar, color: 'bg-blue-500', intent: 'info' as const },
      expense: { label: 'Expense', icon: DollarSign, color: 'bg-green-500', intent: 'success' as const },
      po: { label: 'Purchase Order', icon: Package, color: 'bg-purple-500', intent: 'primary' as const },
      payment: { label: 'Payment', icon: DollarSign, color: 'bg-yellow-500', intent: 'warning' as const },
      helpdesk: { label: 'Helpdesk', icon: UserPlus, color: 'bg-red-500', intent: 'danger' as const },
    };
    return config[module];
  }

  function getSLAColor(minutes: number) {
    if (minutes < 0) return { color: 'text-intent-danger', bg: 'bg-intent-danger-bg', label: 'Overdue' };
    if (minutes < 30) return { color: 'text-intent-danger', bg: 'bg-intent-danger-bg', label: `${minutes}m` };
    if (minutes < 120) return { color: 'text-intent-warning', bg: 'bg-intent-warning-bg', label: `${Math.floor(minutes / 60)}h ${minutes % 60}m` };
    return { color: 'text-intent-success', bg: 'bg-intent-success-bg', label: `${Math.floor(minutes / 60)}h` };
  }

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x > 150) {
      onApprove();
    } else if (info.offset.x < -150) {
      onReject();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: index * 0.05 }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.2}
      onDragEnd={handleDragEnd}
      style={{ x, opacity }}
      className="cursor-grab active:cursor-grabbing"
    >
      <Card className="hover:shadow-md transition-shadow" onClick={onReview}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <div className={`size-8 ${moduleConfig.color} rounded-lg flex items-center justify-center`}>
              <ModuleIcon className="size-4 text-white" />
            </div>
            <Badge intent={moduleConfig.intent}>{moduleConfig.label}</Badge>
          </div>
          <div className={`px-3 py-1 ${slaConfig.bg} rounded-full`}>
            <span className={`text-caption font-semibold ${slaConfig.color}`}>{slaConfig.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className="size-10 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold">
            {approval.requesterAvatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-body-sm font-semibold text-text-primary">{approval.requester}</div>
            <div className="text-caption text-text-muted">{approval.requesterRole}</div>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-body-sm font-medium text-text-primary mb-1">{approval.summary}</div>
          <div className="text-caption text-text-secondary line-clamp-2">{approval.details}</div>
        </div>

        <div className="grid grid-cols-3 gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            leadingIcon={<CheckCircle />}
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            className="touch-target"
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="secondary"
            intent="danger"
            leadingIcon={<XCircle />}
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
            className="touch-target"
          >
            Reject
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<FileText />}
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            className="touch-target"
          >
            Review
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
