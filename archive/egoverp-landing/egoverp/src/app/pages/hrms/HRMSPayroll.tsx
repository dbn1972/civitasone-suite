import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  DollarSign,
  Download,
  Upload,
  Calendar,
  Users,
  TrendingUp,
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  Play,
  Search,
  Filter,
  Eye,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  designation: string;
  month: string;
  basicSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: 'draft' | 'processed' | 'approved' | 'paid' | 'on_hold';
  paymentDate?: string;
}

interface DeductionBreakdown {
  providentFund: number;
  esi: number;
  tds: number;
  professionalTax: number;
  other: number;
}

interface AllowanceBreakdown {
  hra: number;
  transport: number;
  medical: number;
  special: number;
}

const SAMPLE_PAYROLL: PayrollRecord[] = [
  {
    id: '1',
    employeeId: 'EMP-001',
    employeeName: 'Rajesh Kumar',
    department: 'Engineering',
    designation: 'Senior Engineer',
    month: 'May 2026',
    basicSalary: 60000,
    allowances: 35000,
    deductions: 12500,
    netSalary: 82500,
    status: 'processed',
    paymentDate: '2026-05-30',
  },
  {
    id: '2',
    employeeId: 'EMP-002',
    employeeName: 'Priya Sharma',
    department: 'Finance',
    designation: 'Finance Manager',
    month: 'May 2026',
    basicSalary: 75000,
    allowances: 42000,
    deductions: 18000,
    netSalary: 99000,
    status: 'approved',
    paymentDate: '2026-05-30',
  },
  {
    id: '3',
    employeeId: 'EMP-003',
    employeeName: 'Amit Patel',
    department: 'HR',
    designation: 'HR Executive',
    month: 'May 2026',
    basicSalary: 45000,
    allowances: 22000,
    deductions: 9000,
    netSalary: 58000,
    status: 'processed',
    paymentDate: '2026-05-30',
  },
  {
    id: '4',
    employeeId: 'EMP-004',
    employeeName: 'Sneha Rao',
    department: 'Marketing',
    designation: 'Marketing Lead',
    month: 'May 2026',
    basicSalary: 55000,
    allowances: 28000,
    deductions: 11500,
    netSalary: 71500,
    status: 'draft',
  },
  {
    id: '5',
    employeeId: 'EMP-005',
    employeeName: 'Vikram Singh',
    department: 'Operations',
    designation: 'Operations Manager',
    month: 'May 2026',
    basicSalary: 70000,
    allowances: 38000,
    deductions: 16000,
    netSalary: 92000,
    status: 'on_hold',
  },
];

export function HRMSPayroll() {
  const [selectedMonth, setSelectedMonth] = useState('2026-05');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [showPayslipModal, setShowPayslipModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<PayrollRecord | null>(null);

  const filteredPayroll = SAMPLE_PAYROLL.filter((record) => {
    const matchesSearch =
      record.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      record.employeeId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      record.department.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = selectedStatus === 'all' || record.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  const stats = {
    totalEmployees: SAMPLE_PAYROLL.length,
    totalPayroll: SAMPLE_PAYROLL.reduce((sum, r) => sum + r.netSalary, 0),
    processed: SAMPLE_PAYROLL.filter((r) => r.status === 'processed' || r.status === 'approved').length,
    pending: SAMPLE_PAYROLL.filter((r) => r.status === 'draft' || r.status === 'on_hold').length,
    avgSalary: SAMPLE_PAYROLL.reduce((sum, r) => sum + r.netSalary, 0) / SAMPLE_PAYROLL.length,
  };

  const getStatusConfig = (status: PayrollRecord['status']) => {
    const configs = {
      draft: { label: 'Draft', variant: 'default' as const, icon: FileText },
      processed: { label: 'Processed', variant: 'info' as const, icon: CheckCircle },
      approved: { label: 'Approved', variant: 'success' as const, icon: CheckCircle },
      paid: { label: 'Paid', variant: 'success' as const, icon: CheckCircle },
      on_hold: { label: 'On Hold', variant: 'warning' as const, icon: AlertTriangle },
    };
    return configs[status];
  };

  const viewPayslip = (record: PayrollRecord) => {
    setSelectedEmployee(record);
    setShowPayslipModal(true);
  };

  // Sample detailed breakdown for payslip
  const allowances: AllowanceBreakdown = {
    hra: selectedEmployee ? selectedEmployee.allowances * 0.5 : 0,
    transport: selectedEmployee ? selectedEmployee.allowances * 0.2 : 0,
    medical: selectedEmployee ? selectedEmployee.allowances * 0.15 : 0,
    special: selectedEmployee ? selectedEmployee.allowances * 0.15 : 0,
  };

  const deductions: DeductionBreakdown = {
    providentFund: selectedEmployee ? selectedEmployee.deductions * 0.35 : 0,
    esi: selectedEmployee ? selectedEmployee.deductions * 0.15 : 0,
    tds: selectedEmployee ? selectedEmployee.deductions * 0.40 : 0,
    professionalTax: selectedEmployee ? selectedEmployee.deductions * 0.08 : 0,
    other: selectedEmployee ? selectedEmployee.deductions * 0.02 : 0,
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Payroll</h1>
          <p className="text-body-sm text-text-secondary">
            Process salaries, generate payslips, and manage statutory compliance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-[180px]"
          />
          <Button variant="secondary" size="md" leadingIcon={<Upload />}>
            Import
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Download />}>
            Export
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Play />}>
            Process Payroll
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Employees</p>
                <p className="text-h2">{stats.totalEmployees}</p>
              </div>
              <div className="size-12 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <Users className="size-6 text-intent-info" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Payroll</p>
                <p className="text-h2">₹{(stats.totalPayroll / 100000).toFixed(1)}L</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <DollarSign className="size-6 text-intent-primary" />
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
                <p className="text-caption text-text-muted mb-1">Avg Salary</p>
                <p className="text-h2">₹{(stats.avgSalary / 1000).toFixed(0)}K</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <TrendingUp className="size-6 text-intent-warning" />
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                type="text"
                placeholder="Search by name, employee ID, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
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
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="processed">Processed</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="md" leadingIcon={<Filter />}>
              More Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Payroll Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Employee</th>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Department</th>
                <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase">Basic</th>
                <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase">Allowances</th>
                <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase">Deductions</th>
                <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase">Net Salary</th>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Payment Date</th>
                <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Status</th>
                <th className="text-center p-4 text-caption font-semibold text-text-secondary uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayroll.map((record, index) => {
                const statusConfig = getStatusConfig(record.status);
                const StatusIcon = statusConfig.icon;

                return (
                  <motion.tr
                    key={record.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="border-b border-border-subtle hover:bg-surface-sunken transition-colors"
                  >
                    <td className="p-4">
                      <div>
                        <p className="text-body-sm font-medium text-text-primary">{record.employeeName}</p>
                        <p className="text-caption text-text-muted">{record.employeeId} • {record.designation}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-body-sm text-text-primary">{record.department}</p>
                    </td>
                    <td className="p-4 text-right">
                      <p className="text-body-sm text-text-primary">₹{record.basicSalary.toLocaleString('en-IN')}</p>
                    </td>
                    <td className="p-4 text-right">
                      <p className="text-body-sm text-intent-success">+₹{record.allowances.toLocaleString('en-IN')}</p>
                    </td>
                    <td className="p-4 text-right">
                      <p className="text-body-sm text-intent-danger">-₹{record.deductions.toLocaleString('en-IN')}</p>
                    </td>
                    <td className="p-4 text-right">
                      <p className="text-body-sm font-semibold text-text-primary">₹{record.netSalary.toLocaleString('en-IN')}</p>
                    </td>
                    <td className="p-4">
                      {record.paymentDate ? (
                        <div className="flex items-center gap-2">
                          <Calendar className="size-4 text-text-muted" />
                          <p className="text-body-sm text-text-primary">
                            {new Date(record.paymentDate).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </p>
                        </div>
                      ) : (
                        <p className="text-body-sm text-text-muted">—</p>
                      )}
                    </td>
                    <td className="p-4">
                      <Badge variant={statusConfig.variant}>
                        <StatusIcon className="size-3" />
                        {statusConfig.label}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        iconOnly
                        onClick={() => viewPayslip(record)}
                      >
                        <Eye />
                      </Button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Payslip Modal */}
      <AnimatePresence>
        {showPayslipModal && selectedEmployee && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowPayslipModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-raised rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b-2 border-border-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-h2">Payslip - {selectedEmployee.month}</h2>
                  <p className="text-body-sm text-text-secondary">{selectedEmployee.employeeName} ({selectedEmployee.employeeId})</p>
                </div>
                <Button variant="secondary" size="sm" leadingIcon={<Download />}>
                  Download PDF
                </Button>
              </div>

              <div className="p-6 space-y-6">
                {/* Earnings */}
                <div>
                  <h3 className="text-h3 mb-4">Earnings</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">Basic Salary</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{selectedEmployee.basicSalary.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">House Rent Allowance (HRA)</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{allowances.hra.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">Transport Allowance</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{allowances.transport.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">Medical Allowance</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{allowances.medical.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">Special Allowance</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{allowances.special.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-3 bg-intent-success-bg rounded-lg px-4">
                      <span className="text-body-sm font-semibold text-text-primary">Total Earnings</span>
                      <span className="text-h4 text-intent-success">₹{(selectedEmployee.basicSalary + selectedEmployee.allowances).toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </div>

                {/* Deductions */}
                <div>
                  <h3 className="text-h3 mb-4">Deductions</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">Provident Fund (PF)</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{deductions.providentFund.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">ESI</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{deductions.esi.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">TDS (Tax Deducted at Source)</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{deductions.tds.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">Professional Tax</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{deductions.professionalTax.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border-subtle">
                      <span className="text-body-sm text-text-secondary">Other Deductions</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{deductions.other.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between py-3 bg-intent-danger-bg rounded-lg px-4">
                      <span className="text-body-sm font-semibold text-text-primary">Total Deductions</span>
                      <span className="text-h4 text-intent-danger">₹{selectedEmployee.deductions.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </div>

                {/* Net Salary */}
                <div className="p-6 bg-gradient-to-br from-brand-primary to-brand-accent text-white rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-caption opacity-90 mb-1">Net Salary</p>
                      <p className="text-display font-bold">₹{selectedEmployee.netSalary.toLocaleString('en-IN')}</p>
                    </div>
                    <DollarSign className="size-16 opacity-20" />
                  </div>
                  <p className="text-caption opacity-75 mt-2">
                    Payment Date: {selectedEmployee.paymentDate ? new Date(selectedEmployee.paymentDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    }) : 'Not scheduled'}
                  </p>
                </div>
              </div>

              <div className="p-6 border-t-2 border-border-subtle flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setShowPayslipModal(false)}>
                  Close
                </Button>
                <Button variant="primary" leadingIcon={<Download />}>
                  Download PDF
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
