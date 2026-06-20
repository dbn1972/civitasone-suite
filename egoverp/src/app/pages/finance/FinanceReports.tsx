import { useState } from 'react';
import { Card, Button, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  FileText,
  Download,
  Calendar,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  PieChart,
  FileBarChart,
  Clock,
  CheckCircle,
  Play,
} from 'lucide-react';
import { motion } from 'motion/react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface FinanceReport {
  id: string;
  name: string;
  type: 'balance_sheet' | 'profit_loss' | 'cash_flow' | 'trial_balance' | 'ledger' | 'budget_variance';
  description: string;
  lastGenerated?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'on_demand';
  icon: any;
  color: string;
}

const REPORT_TEMPLATES: FinanceReport[] = [
  {
    id: '1',
    name: 'Profit & Loss Statement',
    type: 'profit_loss',
    description: 'Revenue, expenses, and net income/loss for a period',
    lastGenerated: '2026-05-23T09:00:00Z',
    frequency: 'monthly',
    icon: TrendingUp,
    color: 'intent-success',
  },
  {
    id: '2',
    name: 'Balance Sheet',
    type: 'balance_sheet',
    description: 'Assets, liabilities, and equity at a point in time',
    lastGenerated: '2026-05-23T09:00:00Z',
    frequency: 'monthly',
    icon: BarChart3,
    color: 'intent-primary',
  },
  {
    id: '3',
    name: 'Cash Flow Statement',
    type: 'cash_flow',
    description: 'Cash inflows and outflows from operations, investing, and financing',
    lastGenerated: '2026-05-22T16:30:00Z',
    frequency: 'monthly',
    icon: DollarSign,
    color: 'intent-info',
  },
  {
    id: '4',
    name: 'Trial Balance',
    type: 'trial_balance',
    description: 'Debit and credit balances for all ledger accounts',
    lastGenerated: '2026-05-23T08:00:00Z',
    frequency: 'monthly',
    icon: FileBarChart,
    color: 'intent-warning',
  },
  {
    id: '5',
    name: 'General Ledger',
    type: 'ledger',
    description: 'Complete transaction history by account',
    lastGenerated: '2026-05-23T07:30:00Z',
    frequency: 'on_demand',
    icon: FileText,
    color: 'text-secondary',
  },
  {
    id: '6',
    name: 'Budget vs Actual Variance',
    type: 'budget_variance',
    description: 'Comparison of budgeted vs actual figures',
    lastGenerated: '2026-05-20T10:00:00Z',
    frequency: 'monthly',
    icon: PieChart,
    color: 'brand-primary',
  },
];

const REVENUE_DATA = [
  { month: 'Jan', revenue: 1200000, expense: 800000 },
  { month: 'Feb', revenue: 1350000, expense: 850000 },
  { month: 'Mar', revenue: 1450000, expense: 900000 },
  { month: 'Apr', revenue: 1600000, expense: 950000 },
  { month: 'May', revenue: 1550000, expense: 920000 },
];

const CATEGORY_DATA = [
  { category: 'Personnel', amount: 3200000 },
  { category: 'Operations', amount: 1800000 },
  { category: 'Infrastructure', amount: 1200000 },
  { category: 'Services', amount: 900000 },
  { category: 'Others', amount: 500000 },
];

export function FinanceReports() {
  const [selectedPeriod, setSelectedPeriod] = useState('current_month');

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Financial Reports</h1>
          <p className="text-body-sm text-text-secondary">
            Generate and view standard financial statements and analysis reports
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current_month">Current Month</SelectItem>
              <SelectItem value="last_month">Last Month</SelectItem>
              <SelectItem value="current_quarter">Current Quarter</SelectItem>
              <SelectItem value="last_quarter">Last Quarter</SelectItem>
              <SelectItem value="current_year">Current FY</SelectItem>
              <SelectItem value="last_year">Last FY</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="primary" size="md" leadingIcon={<Download />}>
            Export All
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Revenue (May)</p>
                <p className="text-h2">₹15.5L</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <TrendingUp className="size-6 text-intent-success" />
              </div>
            </div>
            <div className="flex items-center gap-2 text-caption">
              <Badge variant="success">
                <TrendingUp className="size-3" />
                +12.5%
              </Badge>
              <span className="text-text-muted">vs last month</span>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Expenses (May)</p>
                <p className="text-h2">₹9.2L</p>
              </div>
              <div className="size-12 bg-intent-danger-bg rounded-lg flex items-center justify-center">
                <TrendingDown className="size-6 text-intent-danger" />
              </div>
            </div>
            <div className="flex items-center gap-2 text-caption">
              <Badge variant="success">
                <TrendingDown className="size-3" />
                -3.2%
              </Badge>
              <span className="text-text-muted">vs last month</span>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-caption text-text-muted mb-1">Net Profit (May)</p>
                <p className="text-h2">₹6.3L</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <DollarSign className="size-6 text-intent-primary" />
              </div>
            </div>
            <div className="flex items-center gap-2 text-caption">
              <Badge variant="success">
                <TrendingUp className="size-3" />
                +18.9%
              </Badge>
              <span className="text-text-muted">vs last month</span>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue vs Expense Trend */}
        <Card className="p-6">
          <h3 className="text-h3 mb-4">Revenue vs Expense Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={REVENUE_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={12} />
              <YAxis stroke="var(--text-muted)" fontSize={12} tickFormatter={(value) => `₹${value / 100000}L`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-raised)',
                  border: '2px solid var(--border-default)',
                  borderRadius: '0.5rem',
                }}
                formatter={(value: any) => `₹${value.toLocaleString('en-IN')}`}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="var(--intent-success)"
                strokeWidth={2}
                name="Revenue"
                dot={{ fill: 'var(--intent-success)', r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="expense"
                stroke="var(--intent-danger)"
                strokeWidth={2}
                name="Expense"
                dot={{ fill: 'var(--intent-danger)', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Expense by Category */}
        <Card className="p-6">
          <h3 className="text-h3 mb-4">Expense by Category (YTD)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={CATEGORY_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="category" stroke="var(--text-muted)" fontSize={12} />
              <YAxis stroke="var(--text-muted)" fontSize={12} tickFormatter={(value) => `₹${value / 100000}L`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-raised)',
                  border: '2px solid var(--border-default)',
                  borderRadius: '0.5rem',
                }}
                formatter={(value: any) => `₹${value.toLocaleString('en-IN')}`}
              />
              <Bar dataKey="amount" fill="var(--intent-primary)" name="Amount" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Report Templates */}
      <div>
        <h2 className="text-h2 mb-4">Standard Financial Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORT_TEMPLATES.map((report, index) => {
            const Icon = report.icon;
            return (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow cursor-pointer">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`size-12 bg-${report.color}-bg rounded-lg flex items-center justify-center`}>
                      <Icon className={`size-6 text-${report.color}`} />
                    </div>
                    {report.frequency !== 'on_demand' && (
                      <Badge variant="default">
                        <Clock className="size-3" />
                        {report.frequency}
                      </Badge>
                    )}
                  </div>
                  <h3 className="text-h4 mb-2">{report.name}</h3>
                  <p className="text-body-sm text-text-secondary mb-4">{report.description}</p>
                  {report.lastGenerated && (
                    <div className="flex items-center gap-2 text-caption text-text-muted mb-4">
                      <CheckCircle className="size-3 text-intent-success" />
                      Last: {new Date(report.lastGenerated).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button variant="primary" size="sm" leadingIcon={<Play />} className="flex-1">
                      Generate
                    </Button>
                    <Button variant="secondary" size="sm" iconOnly>
                      <Download />
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Scheduled Reports */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-h3">Scheduled Reports</h3>
          <Button variant="secondary" size="sm">
            Manage Schedule
          </Button>
        </div>
        <div className="space-y-3">
          {[
            {
              name: 'Monthly P&L Statement',
              schedule: 'Every 1st of month at 09:00',
              recipients: 'CFO, Finance Team',
              nextRun: '2026-06-01T09:00:00Z',
            },
            {
              name: 'Weekly Cash Flow Summary',
              schedule: 'Every Monday at 08:00',
              recipients: 'Finance Manager',
              nextRun: '2026-05-26T08:00:00Z',
            },
            {
              name: 'Quarterly Balance Sheet',
              schedule: 'Quarterly on 5th at 10:00',
              recipients: 'Board of Directors, CFO',
              nextRun: '2026-07-05T10:00:00Z',
            },
          ].map((schedule, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex items-center justify-between p-4 bg-surface-sunken rounded-lg"
            >
              <div className="flex-1">
                <p className="text-body-sm font-medium text-text-primary mb-1">{schedule.name}</p>
                <div className="flex items-center gap-4 text-caption text-text-muted">
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3" />
                    {schedule.schedule}
                  </span>
                  <span>→ {schedule.recipients}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-caption text-text-muted mb-1">Next Run</p>
                <p className="text-body-sm font-medium text-text-primary">
                  {new Date(schedule.nextRun).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>
    </div>
  );
}
