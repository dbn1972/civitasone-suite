import { useState } from 'react';
import { Card, Button, Input, Textarea, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Label } from '../../components/ui';
import { Calendar, Upload, ArrowLeft, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';

interface LeaveBalance {
  type: string;
  entitlement: number;
  used: number;
  pending: number;
  available: number;
}

const LEAVE_TYPES = [
  { value: 'earned', label: 'Earned Leave (EL)' },
  { value: 'casual', label: 'Casual Leave (CL)' },
  { value: 'sick', label: 'Sick Leave (SL)' },
  { value: 'comp-off', label: 'Compensatory Off' },
  { value: 'maternity', label: 'Maternity Leave' },
  { value: 'paternity', label: 'Paternity Leave' },
  { value: 'lwp', label: 'Leave Without Pay (LWP)' },
];

const LEAVE_BALANCES: Record<string, LeaveBalance> = {
  earned: { type: 'Earned Leave', entitlement: 20, used: 8, pending: 2, available: 10 },
  casual: { type: 'Casual Leave', entitlement: 10, used: 4, pending: 0, available: 6 },
  sick: { type: 'Sick Leave', entitlement: 12, used: 3, pending: 0, available: 9 },
  'comp-off': { type: 'Compensatory Off', entitlement: 0, used: 0, pending: 0, available: 4 },
  maternity: { type: 'Maternity Leave', entitlement: 180, used: 0, pending: 0, available: 180 },
  paternity: { type: 'Paternity Leave', entitlement: 15, used: 0, pending: 0, available: 15 },
  lwp: { type: 'Leave Without Pay', entitlement: 999, used: 0, pending: 0, available: 999 },
};

const HOLIDAYS = ['2024-06-01', '2024-06-15', '2024-08-15'];
const EXISTING_LEAVES = [
  { from: '2024-07-10', to: '2024-07-12' },
  { from: '2024-09-05', to: '2024-09-06' },
];

const EMPLOYEES = [
  { id: '1', name: 'Rajesh Sharma', designation: 'Senior Manager' },
  { id: '2', name: 'Priya Singh', designation: 'Team Lead' },
  { id: '3', name: 'Amit Patel', designation: 'Project Manager' },
];

export function LeaveApply() {
  const navigate = useNavigate();
  const [leaveType, setLeaveType] = useState('earned');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [halfDayFirst, setHalfDayFirst] = useState(false);
  const [halfDayLast, setHalfDayLast] = useState(false);
  const [reason, setReason] = useState('');
  const [contactDuringLeave, setContactDuringLeave] = useState('');
  const [handoverTo, setHandoverTo] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const balance = LEAVE_BALANCES[leaveType];

  const calculateDays = () => {
    if (!fromDate || !toDate) return 0;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const diff = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    let days = diff;
    if (halfDayFirst) days -= 0.5;
    if (halfDayLast) days -= 0.5;
    return Math.max(0, days);
  };

  const leaveDays = calculateDays();

  const checkOverlap = () => {
    if (!fromDate || !toDate) return false;
    const from = new Date(fromDate);
    const to = new Date(toDate);

    return EXISTING_LEAVES.some((leave) => {
      const existingFrom = new Date(leave.from);
      const existingTo = new Date(leave.to);
      return (from <= existingTo && to >= existingFrom);
    });
  };

  const hasOverlap = checkOverlap();
  const insufficientBalance = leaveDays > balance.available;
  const needsAttachment = leaveType === 'sick' && leaveDays > 2 && !attachment;

  const canSubmit = fromDate && toDate && reason && !insufficientBalance && !needsAttachment;

  const handleSubmit = (saveAsDraft: boolean) => {
    if (!canSubmit && !saveAsDraft) return;
    console.log('Submitting leave application:', {
      leaveType,
      fromDate,
      toDate,
      halfDayFirst,
      halfDayLast,
      leaveDays,
      reason,
      contactDuringLeave,
      handoverTo,
      attachment,
      saveAsDraft,
    });
    navigate('/app/hrms/leave/my');
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<ArrowLeft />}
            onClick={() => navigate('/app/hrms/leave/my')}
          >
            Back
          </Button>
          <div>
            <h1 className="text-h1 mb-2">Apply Leave</h1>
            <p className="text-text-secondary">Submit your leave application for approval</p>
          </div>
        </div>
      </div>

      {/* Validation Banners */}
      {insufficientBalance && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 bg-intent-danger-bg border-2 border-intent-danger-border rounded-lg"
          role="alert"
        >
          <AlertCircle className="size-5 text-intent-danger flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-intent-danger mb-1">Insufficient Leave Balance</div>
            <div className="text-body-sm text-text-primary">
              You are requesting {leaveDays} days but only have {balance.available} days available.
            </div>
          </div>
        </motion.div>
      )}

      {hasOverlap && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 bg-intent-warning-bg border-2 border-intent-warning-border rounded-lg"
          role="alert"
        >
          <AlertCircle className="size-5 text-intent-warning flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-intent-warning mb-1">Overlapping Leave Detected</div>
            <div className="text-body-sm text-text-primary">
              This leave application overlaps with your existing approved leave.
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h2 className="text-h3 mb-6">Leave Details</h2>

            {/* Leave Type */}
            <div className="mb-6">
              <label htmlFor="leave-type" className="block text-body-sm font-medium text-text-primary mb-2">
                Leave Type <span className="text-intent-danger">*</span>
              </label>
              <Select value={leaveType} onValueChange={setLeaveType}>
                <SelectTrigger id="leave-type">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label htmlFor="from-date" className="block text-body-sm font-medium text-text-primary mb-2">
                  From Date <span className="text-intent-danger">*</span>
                </label>
                <div className="relative">
                  <Input
                    id="from-date"
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                  />
                  <Calendar className="absolute end-3 top-1/2 -translate-y-1/2 size-5 text-text-muted pointer-events-none" />
                </div>
                {fromDate && (
                  <div className="mt-2">
                    <label className="flex items-center gap-2 text-body-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={halfDayFirst}
                        onChange={(e) => setHalfDayFirst(e.target.checked)}
                        className="size-4 text-intent-primary border-border-default rounded"
                      />
                      Half day (first day)
                    </label>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="to-date" className="block text-body-sm font-medium text-text-primary mb-2">
                  To Date <span className="text-intent-danger">*</span>
                </label>
                <div className="relative">
                  <Input
                    id="to-date"
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    min={fromDate || new Date().toISOString().split('T')[0]}
                  />
                  <Calendar className="absolute end-3 top-1/2 -translate-y-1/2 size-5 text-text-muted pointer-events-none" />
                </div>
                {toDate && fromDate !== toDate && (
                  <div className="mt-2">
                    <label className="flex items-center gap-2 text-body-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={halfDayLast}
                        onChange={(e) => setHalfDayLast(e.target.checked)}
                        className="size-4 text-intent-primary border-border-default rounded"
                      />
                      Half day (last day)
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* Duration Display */}
            {fromDate && toDate && (
              <div className="mb-6 p-4 bg-surface-sunken rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-body-sm text-text-muted">Total Leave Duration:</span>
                  <span className="text-h4 font-bold text-intent-primary">
                    {leaveDays} {leaveDays === 1 ? 'day' : 'days'}
                  </span>
                </div>
              </div>
            )}

            {/* Reason */}
            <div className="mb-6">
              <label htmlFor="reason" className="block text-body-sm font-medium text-text-primary mb-2">
                Reason <span className="text-intent-danger">*</span>
              </label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Please provide the reason for your leave application..."
                rows={4}
              />
            </div>

            {/* Optional Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label htmlFor="contact" className="block text-body-sm font-medium text-text-primary mb-2">
                  Contact During Leave
                </label>
                <Input
                  id="contact"
                  type="text"
                  value={contactDuringLeave}
                  onChange={(e) => setContactDuringLeave(e.target.value)}
                  placeholder="Phone number or email"
                />
              </div>

              <div>
                <label htmlFor="handover" className="block text-body-sm font-medium text-text-primary mb-2">
                  Handover To
                </label>
                <Select value={handoverTo} onValueChange={setHandoverTo}>
                  <SelectTrigger id="handover">
                    <SelectValue placeholder="Select employee..." />
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
            </div>

            {/* Attachment */}
            <div>
              <label htmlFor="attachment" className="block text-body-sm font-medium text-text-primary mb-2">
                Attachment {leaveType === 'sick' && leaveDays > 2 && <span className="text-intent-danger">*</span>}
              </label>
              {leaveType === 'sick' && leaveDays > 2 && (
                <p className="text-caption text-text-muted mb-2">
                  Medical certificate required for sick leave exceeding 2 days
                </p>
              )}
              <div className="border-2 border-dashed border-border-default rounded-lg p-6 text-center hover:border-intent-primary transition-colors">
                <input
                  id="attachment"
                  type="file"
                  onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                />
                <label htmlFor="attachment" className="cursor-pointer">
                  <Upload className="size-8 text-text-muted mx-auto mb-2" />
                  <div className="text-body-sm text-text-primary font-medium mb-1">
                    {attachment ? attachment.name : 'Click to upload or drag and drop'}
                  </div>
                  <div className="text-caption text-text-muted">
                    PDF, JPG, PNG (max 5MB)
                  </div>
                </label>
              </div>
            </div>
          </Card>
        </div>

        {/* Live Balance Widget */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <h3 className="text-h4 mb-4">Leave Balance</h3>
            <div className="space-y-4">
              <div className="p-4 bg-surface-sunken rounded-lg">
                <div className="text-body-sm text-text-muted mb-1">Leave Type</div>
                <div className="font-semibold text-text-primary">{balance.type}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-surface-raised rounded-lg">
                  <div className="text-caption text-text-muted mb-1">Entitlement</div>
                  <div className="text-h4 font-bold text-text-primary">{balance.entitlement}</div>
                </div>
                <div className="p-3 bg-surface-raised rounded-lg">
                  <div className="text-caption text-text-muted mb-1">Used</div>
                  <div className="text-h4 font-bold text-intent-danger">{balance.used}</div>
                </div>
                <div className="p-3 bg-surface-raised rounded-lg">
                  <div className="text-caption text-text-muted mb-1">Pending</div>
                  <div className="text-h4 font-bold text-intent-warning">{balance.pending}</div>
                </div>
                <div className="p-3 bg-intent-success-bg border-2 border-intent-success-border rounded-lg">
                  <div className="text-caption text-intent-success mb-1">Available</div>
                  <div className="text-h4 font-bold text-intent-success">{balance.available}</div>
                </div>
              </div>

              {leaveDays > 0 && (
                <div className="p-4 bg-intent-primary-bg border-2 border-intent-primary-border rounded-lg">
                  <div className="text-body-sm text-text-primary mb-2">After this application:</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-caption text-text-muted">Remaining:</span>
                    <span className="text-h3 font-bold text-intent-primary">
                      {Math.max(0, balance.available - leaveDays)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Calendar Legend */}
            <div className="mt-6 pt-6 border-t-2 border-border-subtle">
              <div className="text-body-sm font-medium text-text-primary mb-3">Calendar Legend</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="size-4 bg-intent-danger-bg border border-intent-danger-border rounded"></div>
                  <span className="text-caption text-text-secondary">Holidays</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-4 bg-intent-warning-bg border border-intent-warning-border rounded"></div>
                  <span className="text-caption text-text-secondary">Existing Leave</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Sticky Save Bar */}
      <div className="fixed bottom-0 start-0 end-0 bg-surface-raised border-t-2 border-border-subtle p-4 shadow-lg z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="text-body-sm text-text-secondary">
            {fromDate && toDate ? (
              <>Applying for {leaveDays} days of {balance.type}</>
            ) : (
              <>Fill in the required fields to continue</>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => handleSubmit(true)}>
              Save Draft
            </Button>
            <Button
              onClick={() => handleSubmit(false)}
              disabled={!canSubmit}
            >
              Submit for Approval
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom Spacer */}
      <div className="h-20"></div>
    </div>
  );
}
