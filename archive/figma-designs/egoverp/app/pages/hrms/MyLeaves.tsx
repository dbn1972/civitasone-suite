import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import { Plus, Search, Download, X, Calendar, User, FileText, Clock } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';

interface LeaveApplication {
  id: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  appliedOn: string;
  approver?: string;
  approvedOn?: string;
  rejectedReason?: string;
  contactDuringLeave?: string;
  handoverTo?: string;
}

interface ApprovalHistory {
  id: string;
  action: string;
  by: string;
  timestamp: string;
  comment?: string;
}

const SAMPLE_LEAVES: LeaveApplication[] = [
  {
    id: '1',
    leaveType: 'Earned Leave',
    fromDate: '2024-07-15',
    toDate: '2024-07-19',
    days: 5,
    reason: 'Family vacation to Goa',
    status: 'approved',
    appliedOn: '2024-06-01T10:30:00',
    approver: 'Rajesh Sharma',
    approvedOn: '2024-06-02T14:20:00',
    handoverTo: 'Priya Singh',
  },
  {
    id: '2',
    leaveType: 'Sick Leave',
    fromDate: '2024-05-10',
    toDate: '2024-05-12',
    days: 3,
    reason: 'Fever and cold',
    status: 'approved',
    appliedOn: '2024-05-09T08:15:00',
    approver: 'Rajesh Sharma',
    approvedOn: '2024-05-09T09:30:00',
    contactDuringLeave: '+91 98765 43210',
  },
  {
    id: '3',
    leaveType: 'Casual Leave',
    fromDate: '2024-08-20',
    toDate: '2024-08-21',
    days: 2,
    reason: 'Personal work',
    status: 'pending',
    appliedOn: '2024-06-20T16:45:00',
    approver: 'Rajesh Sharma',
  },
  {
    id: '4',
    leaveType: 'Earned Leave',
    fromDate: '2024-04-05',
    toDate: '2024-04-06',
    days: 2,
    reason: 'Attending wedding',
    status: 'rejected',
    appliedOn: '2024-03-25T11:20:00',
    approver: 'Rajesh Sharma',
    approvedOn: '2024-03-26T10:15:00',
    rejectedReason: 'Critical project deadline during this period',
  },
  {
    id: '5',
    leaveType: 'Compensatory Off',
    fromDate: '2024-09-10',
    toDate: '2024-09-10',
    days: 1,
    reason: 'Comp-off for weekend work on 2024-09-01',
    status: 'draft',
    appliedOn: '2024-06-22T09:00:00',
  },
];

const APPROVAL_HISTORY: Record<string, ApprovalHistory[]> = {
  '1': [
    { id: '1', action: 'Approved', by: 'Rajesh Sharma', timestamp: '2024-06-02T14:20:00', comment: 'Approved. Have a great vacation!' },
    { id: '2', action: 'Submitted', by: 'Current User', timestamp: '2024-06-01T10:30:00' },
  ],
  '2': [
    { id: '1', action: 'Approved', by: 'Rajesh Sharma', timestamp: '2024-05-09T09:30:00', comment: 'Take care and get well soon.' },
    { id: '2', action: 'Submitted', by: 'Current User', timestamp: '2024-05-09T08:15:00' },
  ],
  '3': [
    { id: '1', action: 'Submitted', by: 'Current User', timestamp: '2024-06-20T16:45:00' },
  ],
  '4': [
    { id: '1', action: 'Rejected', by: 'Rajesh Sharma', timestamp: '2024-03-26T10:15:00', comment: 'Critical project deadline during this period' },
    { id: '2', action: 'Submitted', by: 'Current User', timestamp: '2024-03-25T11:20:00' },
  ],
  '5': [
    { id: '1', action: 'Draft Saved', by: 'Current User', timestamp: '2024-06-22T09:00:00' },
  ],
};

export function MyLeaves() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('2024');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedLeave, setSelectedLeave] = useState<LeaveApplication | null>(null);

  const getStatusBadge = (status: LeaveApplication['status']) => {
    const config = {
      draft: { intent: 'neutral' as const, label: 'Draft' },
      pending: { intent: 'warning' as const, label: 'Pending Approval' },
      approved: { intent: 'success' as const, label: 'Approved' },
      rejected: { intent: 'danger' as const, label: 'Rejected' },
      cancelled: { intent: 'neutral' as const, label: 'Cancelled' },
    };
    return config[status];
  };

  const filteredLeaves = SAMPLE_LEAVES.filter((leave) => {
    const matchesSearch = leave.leaveType.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         leave.reason.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || leave.status === statusFilter;
    const matchesYear = new Date(leave.fromDate).getFullYear().toString() === yearFilter;
    const matchesType = typeFilter === 'all' || leave.leaveType === typeFilter;
    return matchesSearch && matchesStatus && matchesYear && matchesType;
  });

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">My Leaves</h1>
          <p className="text-text-secondary">View and manage your leave applications</p>
        </div>
        <Button leadingIcon={<Plus />} onClick={() => navigate('/app/hrms/leave/apply')}>
          Apply Leave
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Total Applications</div>
          <div className="text-h2 font-bold text-text-primary">{SAMPLE_LEAVES.length}</div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Pending Approval</div>
          <div className="text-h2 font-bold text-intent-warning">
            {SAMPLE_LEAVES.filter((l) => l.status === 'pending').length}
          </div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Approved</div>
          <div className="text-h2 font-bold text-intent-success">
            {SAMPLE_LEAVES.filter((l) => l.status === 'approved').length}
          </div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Days Approved (2024)</div>
          <div className="text-h2 font-bold text-intent-primary">
            {SAMPLE_LEAVES.filter((l) => l.status === 'approved').reduce((sum, l) => sum + l.days, 0)}
          </div>
        </Card>
      </div>

      {/* Toolbar */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[250px] max-w-md">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                id="search-leaves"
                placeholder="Search by type or reason..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10"
              />
            </div>
          </div>

          {/* Filters */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>

          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2024">2024</SelectItem>
              <SelectItem value="2023">2023</SelectItem>
              <SelectItem value="2022">2022</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Earned Leave">Earned Leave</SelectItem>
              <SelectItem value="Casual Leave">Casual Leave</SelectItem>
              <SelectItem value="Sick Leave">Sick Leave</SelectItem>
              <SelectItem value="Compensatory Off">Comp-off</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="secondary" size="sm" leadingIcon={<Download />}>
            Export
          </Button>
        </div>
      </Card>

      {/* Leave Applications */}
      {filteredLeaves.length === 0 ? (
        <Card>
          <div className="text-center py-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="size-24 bg-gradient-to-br from-intent-primary to-intent-success rounded-2xl mx-auto flex items-center justify-center">
                <Calendar className="size-12 text-white" />
              </div>
              <h3 className="text-h3 text-text-primary">No leave applications</h3>
              <p className="text-text-secondary max-w-md mx-auto">
                You haven't applied for any leaves yet. Start by applying for your next leave.
              </p>
              <Button leadingIcon={<Plus />} onClick={() => navigate('/app/hrms/leave/apply')}>
                Apply Leave
              </Button>
            </motion.div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredLeaves.map((leave, index) => {
            const statusBadge = getStatusBadge(leave.status);
            return (
              <motion.div
                key={leave.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelectedLeave(leave)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-h4 text-text-primary">{leave.leaveType}</h3>
                        <Badge intent={statusBadge.intent}>{statusBadge.label}</Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                        <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                          <Calendar className="size-4" />
                          <span>
                            {new Date(leave.fromDate).toLocaleDateString('en-IN')} - {new Date(leave.toDate).toLocaleDateString('en-IN')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                          <Clock className="size-4" />
                          <span>{leave.days} {leave.days === 1 ? 'day' : 'days'}</span>
                        </div>
                        {leave.approver && (
                          <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                            <User className="size-4" />
                            <span>{leave.approver}</span>
                          </div>
                        )}
                      </div>
                      <p className="text-body-sm text-text-primary line-clamp-2">{leave.reason}</p>
                    </div>
                    <div className="text-end flex-shrink-0">
                      <div className="text-caption text-text-muted">Applied on</div>
                      <div className="text-body-sm text-text-primary">
                        {new Date(leave.appliedOn).toLocaleDateString('en-IN')}
                      </div>
                      {leave.status === 'draft' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-3"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/app/hrms/leave/apply');
                          }}
                        >
                          Continue Editing
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Detail Drawer */}
      <AnimatePresence>
        {selectedLeave && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLeave(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed top-0 end-0 bottom-0 w-full md:w-[600px] bg-surface-canvas z-50 overflow-y-auto shadow-2xl"
            >
              <div className="sticky top-0 bg-surface-raised border-b-2 border-border-subtle p-6 flex items-start justify-between gap-4 z-10">
                <div>
                  <h2 className="text-h2 mb-2">{selectedLeave.leaveType}</h2>
                  <Badge intent={getStatusBadge(selectedLeave.status).intent}>
                    {getStatusBadge(selectedLeave.status).label}
                  </Badge>
                </div>
                <button
                  onClick={() => setSelectedLeave(null)}
                  className="size-10 flex items-center justify-center rounded-lg hover:bg-surface-sunken transition-colors"
                  aria-label="Close drawer"
                >
                  <X className="size-5 text-text-primary" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Leave Details */}
                <Card>
                  <h3 className="text-h4 mb-4">Leave Details</h3>
                  <dl className="space-y-3">
                    <div>
                      <dt className="text-body-sm text-text-muted">From Date</dt>
                      <dd className="text-text-primary font-medium">
                        {new Date(selectedLeave.fromDate).toLocaleDateString('en-IN', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-text-muted">To Date</dt>
                      <dd className="text-text-primary font-medium">
                        {new Date(selectedLeave.toDate).toLocaleDateString('en-IN', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-text-muted">Duration</dt>
                      <dd className="text-text-primary font-medium">
                        {selectedLeave.days} {selectedLeave.days === 1 ? 'day' : 'days'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-text-muted">Reason</dt>
                      <dd className="text-text-primary">{selectedLeave.reason}</dd>
                    </div>
                    {selectedLeave.contactDuringLeave && (
                      <div>
                        <dt className="text-body-sm text-text-muted">Contact During Leave</dt>
                        <dd className="text-text-primary">{selectedLeave.contactDuringLeave}</dd>
                      </div>
                    )}
                    {selectedLeave.handoverTo && (
                      <div>
                        <dt className="text-body-sm text-text-muted">Handover To</dt>
                        <dd className="text-text-primary">{selectedLeave.handoverTo}</dd>
                      </div>
                    )}
                  </dl>
                </Card>

                {/* Approval Information */}
                {selectedLeave.status !== 'draft' && (
                  <Card>
                    <h3 className="text-h4 mb-4">Approval Information</h3>
                    <dl className="space-y-3">
                      <div>
                        <dt className="text-body-sm text-text-muted">Approver</dt>
                        <dd className="text-text-primary font-medium">{selectedLeave.approver}</dd>
                      </div>
                      {selectedLeave.approvedOn && (
                        <div>
                          <dt className="text-body-sm text-text-muted">
                            {selectedLeave.status === 'approved' ? 'Approved On' : 'Actioned On'}
                          </dt>
                          <dd className="text-text-primary">
                            {new Date(selectedLeave.approvedOn).toLocaleString('en-IN')}
                          </dd>
                        </div>
                      )}
                      {selectedLeave.rejectedReason && (
                        <div>
                          <dt className="text-body-sm text-text-muted">Rejection Reason</dt>
                          <dd className="text-intent-danger">{selectedLeave.rejectedReason}</dd>
                        </div>
                      )}
                    </dl>
                  </Card>
                )}

                {/* Approval History */}
                <Card>
                  <h3 className="text-h4 mb-4">Timeline</h3>
                  <div className="space-y-4">
                    {APPROVAL_HISTORY[selectedLeave.id]?.map((event, index) => (
                      <div key={event.id} className="flex gap-4">
                        <div className="flex-shrink-0">
                          <div className="size-10 rounded-full bg-intent-primary-bg flex items-center justify-center">
                            <FileText className="size-5 text-intent-primary" />
                          </div>
                          {index < (APPROVAL_HISTORY[selectedLeave.id]?.length || 0) - 1 && (
                            <div className="w-0.5 h-full bg-border-subtle mx-auto mt-2"></div>
                          )}
                        </div>
                        <div className="flex-1 pb-6">
                          <div className="flex items-start justify-between gap-4 mb-1">
                            <h4 className="font-medium text-text-primary">{event.action}</h4>
                            <time className="text-caption text-text-muted whitespace-nowrap">
                              {new Date(event.timestamp).toLocaleString('en-IN')}
                            </time>
                          </div>
                          <p className="text-body-sm text-text-secondary">by {event.by}</p>
                          {event.comment && (
                            <p className="text-body-sm text-text-primary mt-2 p-3 bg-surface-sunken rounded-lg">
                              "{event.comment}"
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
