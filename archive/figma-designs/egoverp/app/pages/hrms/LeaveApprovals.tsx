import { useState } from 'react';
import { Card, Button, Badge, Input, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Label } from '../../components/ui';
import { Search, CheckCircle, XCircle, UserPlus, Calendar, Clock, User, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LeaveApproval {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar: string;
  designation: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  appliedOn: string;
  contactDuringLeave?: string;
  handoverTo?: string;
  remainingBalance: number;
}

const SAMPLE_APPROVALS: LeaveApproval[] = [
  {
    id: '1',
    employeeId: 'EMP001',
    employeeName: 'Amit Patel',
    employeeAvatar: 'AP',
    designation: 'Senior Developer',
    leaveType: 'Earned Leave',
    fromDate: '2024-06-30',
    toDate: '2024-07-05',
    days: 6,
    reason: 'Planning a family trip to Manali. Will be completely disconnected from work during this period.',
    appliedOn: '2024-06-15T10:30:00',
    contactDuringLeave: '+91 98765 43210',
    handoverTo: 'Priya Singh',
    remainingBalance: 14,
  },
  {
    id: '2',
    employeeId: 'EMP002',
    employeeName: 'Sneha Kumar',
    employeeAvatar: 'SK',
    designation: 'UX Designer',
    leaveType: 'Casual Leave',
    fromDate: '2024-06-25',
    toDate: '2024-06-26',
    days: 2,
    reason: 'Need to attend cousin\'s wedding in Pune.',
    appliedOn: '2024-06-18T14:20:00',
    remainingBalance: 4,
  },
  {
    id: '3',
    employeeId: 'EMP003',
    employeeName: 'Rahul Verma',
    employeeAvatar: 'RV',
    designation: 'QA Engineer',
    leaveType: 'Sick Leave',
    fromDate: '2024-06-22',
    toDate: '2024-06-24',
    days: 3,
    reason: 'Diagnosed with viral fever. Doctor has advised complete bed rest for 3 days.',
    appliedOn: '2024-06-21T08:45:00',
    contactDuringLeave: '+91 87654 32109',
    remainingBalance: 6,
  },
  {
    id: '4',
    employeeId: 'EMP004',
    employeeName: 'Priya Singh',
    employeeAvatar: 'PS',
    designation: 'Team Lead',
    leaveType: 'Compensatory Off',
    fromDate: '2024-06-28',
    toDate: '2024-06-28',
    days: 1,
    reason: 'Comp-off for working on weekend (2024-06-15) for deployment.',
    appliedOn: '2024-06-20T11:15:00',
    handoverTo: 'Amit Patel',
    remainingBalance: 2,
  },
  {
    id: '5',
    employeeId: 'EMP005',
    employeeName: 'Karthik Reddy',
    employeeAvatar: 'KR',
    designation: 'DevOps Engineer',
    leaveType: 'Earned Leave',
    fromDate: '2024-07-10',
    toDate: '2024-07-12',
    days: 3,
    reason: 'Personal work - house hunting in Bangalore.',
    appliedOn: '2024-06-22T16:30:00',
    remainingBalance: 12,
  },
];

const EMPLOYEES = [
  { id: '1', name: 'Alice Kumar', designation: 'Senior Manager' },
  { id: '2', name: 'Bob Smith', designation: 'Department Head' },
  { id: '3', name: 'Carol Chen', designation: 'HR Manager' },
];

export function LeaveApprovals() {
  const [searchTerm, setSearchTerm] = useState('');
  const [queueFilter, setQueueFilter] = useState('my-queue');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedApprovals, setSelectedApprovals] = useState<Set<string>>(new Set());
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [action, setAction] = useState<'approve' | 'reject' | 'reassign' | null>(null);
  const [comment, setComment] = useState('');
  const [reassignTo, setReassignTo] = useState('');

  const getLeaveTypeBadge = (type: string) => {
    const config: Record<string, { intent: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string }> = {
      'Earned Leave': { intent: 'primary', label: 'EL' },
      'Casual Leave': { intent: 'info', label: 'CL' },
      'Sick Leave': { intent: 'warning', label: 'SL' },
      'Compensatory Off': { intent: 'success', label: 'Comp-off' },
      'Maternity Leave': { intent: 'primary', label: 'ML' },
      'Paternity Leave': { intent: 'primary', label: 'PL' },
      'Leave Without Pay': { intent: 'neutral', label: 'LWP' },
    };
    return config[type] || { intent: 'neutral' as const, label: type };
  };

  const filteredApprovals = SAMPLE_APPROVALS.filter((approval) => {
    const matchesSearch = approval.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         approval.reason.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || approval.leaveType === typeFilter;
    return matchesSearch && matchesType;
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedApprovals(new Set(filteredApprovals.map((a) => a.id)));
    } else {
      setSelectedApprovals(new Set());
    }
  };

  const handleSelect = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedApprovals);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedApprovals(newSelected);
  };

  const handleBulkApprove = () => {
    console.log('Bulk approving:', Array.from(selectedApprovals));
    setSelectedApprovals(new Set());
  };

  const handleAction = () => {
    if (!actioningId || !action) return;
    console.log('Action:', action, 'ID:', actioningId, 'Comment:', comment, 'Reassign to:', reassignTo);
    setActioningId(null);
    setAction(null);
    setComment('');
    setReassignTo('');
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Leave Approvals</h1>
          <p className="text-text-secondary">Review and approve leave requests from your team</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Pending Approvals</div>
          <div className="text-h2 font-bold text-intent-warning">{SAMPLE_APPROVALS.length}</div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Approved Today</div>
          <div className="text-h2 font-bold text-intent-success">8</div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Rejected Today</div>
          <div className="text-h2 font-bold text-intent-danger">2</div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Avg Response Time</div>
          <div className="text-h2 font-bold text-text-primary">4.2h</div>
        </Card>
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
                  id="search-approvals"
                  placeholder="Search by employee or reason..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                />
              </div>
            </div>

            {/* Filters */}
            <Select value={queueFilter} onValueChange={setQueueFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select queue" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="my-queue">My Queue</SelectItem>
                <SelectItem value="my-team">My Team</SelectItem>
                <SelectItem value="all">All (Manager)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Earned Leave">Earned Leave</SelectItem>
                <SelectItem value="Casual Leave">Casual Leave</SelectItem>
                <SelectItem value="Sick Leave">Sick Leave</SelectItem>
                <SelectItem value="Compensatory Off">Comp-off</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bulk Actions */}
          {selectedApprovals.size > 0 && (
            <div className="flex items-center gap-4 p-3 bg-intent-primary-bg border border-intent-primary-border rounded-lg">
              <span className="text-body-sm text-intent-primary font-medium">
                {selectedApprovals.size} application{selectedApprovals.size > 1 ? 's' : ''} selected
              </span>
              <Button size="sm" onClick={handleBulkApprove} leadingIcon={<CheckCircle />}>
                Bulk Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSelectedApprovals(new Set())}>
                Clear Selection
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Approval Cards */}
      {filteredApprovals.length === 0 ? (
        <Card>
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
                There are no pending leave approvals in your queue. Great job staying on top of things!
              </p>
            </motion.div>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Select All */}
          <div className="flex items-center gap-3 px-2">
            <input
              type="checkbox"
              checked={selectedApprovals.size === filteredApprovals.length}
              onChange={(e) => handleSelectAll(e.target.checked)}
              className="size-4 text-intent-primary border-border-default rounded"
            />
            <span className="text-body-sm text-text-secondary">Select all</span>
          </div>

          {/* Cards */}
          {filteredApprovals.map((approval, index) => {
            const typeBadge = getLeaveTypeBadge(approval.leaveType);
            return (
              <motion.div
                key={approval.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedApprovals.has(approval.id)}
                      onChange={(e) => handleSelect(approval.id, e.target.checked)}
                      className="size-4 text-intent-primary border-border-default rounded mt-1"
                    />

                    {/* Avatar */}
                    <div className="flex-shrink-0">
                      <div className="size-12 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold">
                        {approval.employeeAvatar}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <h3 className="text-h4 text-text-primary mb-1">{approval.employeeName}</h3>
                          <p className="text-body-sm text-text-muted">{approval.designation}</p>
                        </div>
                        <Badge intent={typeBadge.intent}>{typeBadge.label}</Badge>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                        <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                          <Calendar className="size-4" />
                          <span>
                            {new Date(approval.fromDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} - {new Date(approval.toDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                          <Clock className="size-4" />
                          <span>{approval.days} {approval.days === 1 ? 'day' : 'days'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                          <FileText className="size-4" />
                          <span>Balance: {approval.remainingBalance} days</span>
                        </div>
                      </div>

                      <div className="p-3 bg-surface-sunken rounded-lg mb-4">
                        <p className="text-body-sm text-text-primary">{approval.reason}</p>
                      </div>

                      {(approval.contactDuringLeave || approval.handoverTo) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-body-sm">
                          {approval.contactDuringLeave && (
                            <div>
                              <span className="text-text-muted">Contact: </span>
                              <span className="text-text-primary">{approval.contactDuringLeave}</span>
                            </div>
                          )}
                          {approval.handoverTo && (
                            <div>
                              <span className="text-text-muted">Handover to: </span>
                              <span className="text-text-primary">{approval.handoverTo}</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <Button
                          size="sm"
                          leadingIcon={<CheckCircle />}
                          onClick={() => {
                            setActioningId(approval.id);
                            setAction('approve');
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          intent="danger"
                          leadingIcon={<XCircle />}
                          onClick={() => {
                            setActioningId(approval.id);
                            setAction('reject');
                          }}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          leadingIcon={<UserPlus />}
                          onClick={() => {
                            setActioningId(approval.id);
                            setAction('reassign');
                          }}
                        >
                          Reassign
                        </Button>
                        <div className="ms-auto text-caption text-text-muted">
                          Applied {new Date(approval.appliedOn).toLocaleDateString('en-IN')}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Action Dialog */}
      <AnimatePresence>
        {actioningId && action && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setActioningId(null);
                setAction(null);
                setComment('');
                setReassignTo('');
              }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50"
            >
              <Card>
                <h3 className="text-h3 mb-4">
                  {action === 'approve' && 'Approve Leave Application'}
                  {action === 'reject' && 'Reject Leave Application'}
                  {action === 'reassign' && 'Reassign to Another Approver'}
                </h3>

                {action === 'reassign' && (
                  <div className="mb-4">
                    <label htmlFor="reassign-to" className="block text-body-sm font-medium text-text-primary mb-2">
                      Reassign to <span className="text-intent-danger">*</span>
                    </label>
                    <Select value={reassignTo} onValueChange={setReassignTo}>
                      <SelectTrigger id="reassign-to">
                        <SelectValue placeholder="Select approver..." />
                      </SelectTrigger>
                      <SelectContent>
                        {EMPLOYEES.map((emp) => (
                          <SelectItem key={emp.id} value={emp.id}>
                            {emp.name} - {emp.designation}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="mb-6">
                  <label htmlFor="action-comment" className="block text-body-sm font-medium text-text-primary mb-2">
                    Comment {action === 'reject' && <span className="text-intent-danger">*</span>}
                  </label>
                  <Textarea
                    id="action-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={
                      action === 'approve'
                        ? 'Add an optional comment...'
                        : action === 'reject'
                        ? 'Please provide a reason for rejection...'
                        : 'Add an optional note...'
                    }
                    rows={4}
                  />
                </div>

                <div className="flex gap-3 justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setActioningId(null);
                      setAction(null);
                      setComment('');
                      setReassignTo('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAction}
                    disabled={
                      (action === 'reject' && !comment) || (action === 'reassign' && !reassignTo)
                    }
                    intent={action === 'reject' ? 'danger' : 'primary'}
                  >
                    {action === 'approve' && 'Approve'}
                    {action === 'reject' && 'Reject'}
                    {action === 'reassign' && 'Reassign'}
                  </Button>
                </div>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
