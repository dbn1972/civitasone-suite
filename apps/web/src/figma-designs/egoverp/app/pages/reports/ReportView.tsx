import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  ArrowLeft,
  Edit,
  Play,
  Calendar,
  Share2,
  Download,
  Bell,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  BarChart3,
  Table as TableIcon,
  RefreshCw,
} from 'lucide-react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'motion/react';

interface ReportData {
  id: string;
  name: string;
  module: string;
  type: 'chart' | 'table' | 'kpi' | 'dashboard';
  lastRun: string;
  rowCount: number;
  sourceServices: string[];
}

const SAMPLE_REPORT: ReportData = {
  id: '2',
  name: 'Budget vs Actuals - Finance',
  module: 'Finance',
  type: 'chart',
  lastRun: '2024-06-23T10:30:00',
  rowCount: 156,
  sourceServices: ['finance-service', 'budget-service'],
};

const BUDGET_DATA = [
  { department: 'Administration', budget: 12500000, actual: 11800000, variance: -700000 },
  { department: 'Public Works', budget: 45000000, actual: 48200000, variance: 3200000 },
  { department: 'Health', budget: 28000000, actual: 26500000, variance: -1500000 },
  { department: 'Education', budget: 35000000, actual: 34100000, variance: -900000 },
  { department: 'Transport', budget: 22000000, actual: 23500000, variance: 1500000 },
  { department: 'Utilities', budget: 18000000, actual: 17200000, variance: -800000 },
];

const TREND_DATA = [
  { month: 'Jan', budget: 25000000, actual: 24500000 },
  { month: 'Feb', budget: 25000000, actual: 26100000 },
  { month: 'Mar', budget: 25000000, actual: 24800000 },
  { month: 'Apr', budget: 25000000, actual: 25600000 },
  { month: 'May', budget: 25000000, actual: 25200000 },
  { month: 'Jun', budget: 25000000, actual: 26300000 },
];

const VARIANCE_BREAKDOWN = [
  { category: 'Under Budget', value: 3900000, color: '#10b981' },
  { category: 'Over Budget', value: 4700000, color: '#ef4444' },
];

export function ReportView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report] = useState<ReportData>(SAMPLE_REPORT);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [dateRange, setDateRange] = useState('current-year');
  const [showInsights, setShowInsights] = useState(true);

  const totalBudget = BUDGET_DATA.reduce((sum, item) => sum + item.budget, 0);
  const totalActual = BUDGET_DATA.reduce((sum, item) => sum + item.actual, 0);
  const totalVariance = totalActual - totalBudget;
  const variancePercent = ((totalVariance / totalBudget) * 100).toFixed(2);

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<ArrowLeft />}
            onClick={() => navigate('/app/reports')}
          >
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-h1">{report.name}</h1>
              <Badge intent="success">{report.module}</Badge>
            </div>
            <p className="text-text-secondary">
              Last refreshed: {new Date(report.lastRun).toLocaleString('en-IN')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="secondary" size="sm" leadingIcon={<Edit />} onClick={() => navigate('/app/reports/builder')}>
            Edit
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<Play />}>
            Run
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<Calendar />}>
            Schedule
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<Share2 />}>
            Share
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<Download />}>
            Export
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<Bell />}>
            Subscribe
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <label htmlFor="date-range" className="text-body-sm font-medium text-text-primary">
              Period:
            </label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger id="date-range" className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current-month">Current Month</SelectItem>
                <SelectItem value="current-quarter">Current Quarter</SelectItem>
                <SelectItem value="current-year">Current Year (FY 2024-25)</SelectItem>
                <SelectItem value="last-year">Last Year (FY 2023-24)</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 ms-auto">
            <button
              onClick={() => setViewMode('chart')}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'chart'
                  ? 'bg-intent-primary-bg text-intent-primary'
                  : 'text-text-secondary hover:bg-surface-sunken'
              }`}
              aria-label="Chart view"
            >
              <BarChart3 className="size-5" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'table'
                  ? 'bg-intent-primary-bg text-intent-primary'
                  : 'text-text-secondary hover:bg-surface-sunken'
              }`}
              aria-label="Table view"
            >
              <TableIcon className="size-5" />
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-3 space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <Card>
              <div className="text-body-sm text-text-muted mb-2">Total Budget</div>
              <div className="text-h2 font-bold text-text-primary">
                {totalBudget.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
              </div>
            </Card>
            <Card>
              <div className="text-body-sm text-text-muted mb-2">Actual Spending</div>
              <div className="text-h2 font-bold text-text-primary">
                {totalActual.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
              </div>
            </Card>
            <Card className={totalVariance < 0 ? 'bg-intent-success-bg' : 'bg-intent-danger-bg'}>
              <div className="text-body-sm text-text-muted mb-2">Variance</div>
              <div className={`text-h2 font-bold flex items-center gap-2 ${totalVariance < 0 ? 'text-intent-success' : 'text-intent-danger'}`}>
                {totalVariance < 0 ? <TrendingDown className="size-6" /> : <TrendingUp className="size-6" />}
                {Math.abs(totalVariance).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
                <span className="text-body-sm">({variancePercent}%)</span>
              </div>
            </Card>
          </div>

          {/* Chart View */}
          {viewMode === 'chart' && (
            <>
              <Card>
                <h3 className="text-h4 mb-6">Budget vs Actual by Department</h3>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={BUDGET_DATA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="department" tick={{ fill: '#6b7280', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '2px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) =>
                        value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
                      }
                    />
                    <Legend />
                    <Bar dataKey="budget" fill="#3b82f6" name="Budget" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="actual" fill="#10b981" name="Actual" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <h3 className="text-h4 mb-6">Monthly Trend</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={TREND_DATA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '2px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) =>
                        value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
                      }
                    />
                    <Legend />
                    <Line type="monotone" dataKey="budget" stroke="#3b82f6" strokeWidth={2} name="Budget" />
                    <Line type="monotone" dataKey="actual" stroke="#10b981" strokeWidth={2} name="Actual" />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <h3 className="text-h4 mb-6">Variance Distribution</h3>
                <div className="flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={VARIANCE_BREAKDOWN}
                        dataKey="value"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={(entry) =>
                          `${entry.category}: ${entry.value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}`
                        }
                      >
                        {VARIANCE_BREAKDOWN.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) =>
                          value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </>
          )}

          {/* Table View */}
          {viewMode === 'table' && (
            <Card padding="none">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface-sunken border-b-2 border-border-subtle">
                    <tr>
                      <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Department</th>
                      <th className="px-4 py-4 text-end text-body-sm font-semibold text-text-primary">Budget</th>
                      <th className="px-4 py-4 text-end text-body-sm font-semibold text-text-primary">Actual</th>
                      <th className="px-4 py-4 text-end text-body-sm font-semibold text-text-primary">Variance</th>
                      <th className="px-4 py-4 text-end text-body-sm font-semibold text-text-primary">% Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {BUDGET_DATA.map((row, index) => {
                      const variancePct = ((row.variance / row.budget) * 100).toFixed(1);
                      return (
                        <tr key={index} className="hover:bg-surface-sunken transition-colors">
                          <td className="px-4 py-4 text-text-primary font-medium">{row.department}</td>
                          <td className="px-4 py-4 text-end font-mono text-text-primary">
                            {row.budget.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                          </td>
                          <td className="px-4 py-4 text-end font-mono text-text-primary">
                            {row.actual.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                          </td>
                          <td className={`px-4 py-4 text-end font-mono font-semibold ${row.variance < 0 ? 'text-intent-success' : 'text-intent-danger'}`}>
                            {row.variance < 0 ? '' : '+'}
                            {row.variance.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                          </td>
                          <td className={`px-4 py-4 text-end font-mono ${row.variance < 0 ? 'text-intent-success' : 'text-intent-danger'}`}>
                            {row.variance < 0 ? '' : '+'}{variancePct}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-surface-sunken border-t-2 border-border-default">
                    <tr>
                      <td className="px-4 py-4 text-start font-bold text-text-primary">Total</td>
                      <td className="px-4 py-4 text-end font-mono font-bold text-text-primary">
                        {totalBudget.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                      </td>
                      <td className="px-4 py-4 text-end font-mono font-bold text-text-primary">
                        {totalActual.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                      </td>
                      <td className={`px-4 py-4 text-end font-mono font-bold ${totalVariance < 0 ? 'text-intent-success' : 'text-intent-danger'}`}>
                        {totalVariance < 0 ? '' : '+'}
                        {totalVariance.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                      </td>
                      <td className={`px-4 py-4 text-end font-mono font-bold ${totalVariance < 0 ? 'text-intent-success' : 'text-intent-danger'}`}>
                        {totalVariance < 0 ? '' : '+'}{variancePercent}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
        </div>

        {/* Insights Panel */}
        {showInsights && (
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-h4">Insights</h3>
                <button
                  onClick={() => setShowInsights(false)}
                  className="text-text-muted hover:text-text-primary"
                  aria-label="Hide insights"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-3 bg-intent-success-bg border border-intent-success-border rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <TrendingDown className="size-4 text-intent-success flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-body-sm font-semibold text-intent-success">Top Saver</div>
                      <div className="text-caption text-text-primary">
                        Health dept saved ₹1.5M (5.4% under budget)
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-intent-danger-bg border border-intent-danger-border rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <TrendingUp className="size-4 text-intent-danger flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-body-sm font-semibold text-intent-danger">Over Budget</div>
                      <div className="text-caption text-text-primary">
                        Public Works exceeded by ₹3.2M (7.1% over)
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-intent-warning-bg border border-intent-warning-border rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertCircle className="size-4 text-intent-warning flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-body-sm font-semibold text-intent-warning">Trend Alert</div>
                      <div className="text-caption text-text-primary">
                        Spending increased 4.2% vs last month
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-intent-info-bg border border-intent-info-border rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <RefreshCw className="size-4 text-intent-info flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-body-sm font-semibold text-intent-info">Period Over Period</div>
                      <div className="text-caption text-text-primary">
                        Overall spending up 0.4% vs same period last year
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Footer */}
      <Card className="bg-surface-sunken">
        <div className="flex items-center justify-between text-body-sm text-text-secondary">
          <div>
            {report.rowCount.toLocaleString()} rows • Data sources: {report.sourceServices.join(', ')}
          </div>
          <div>
            Last refreshed: {new Date(report.lastRun).toLocaleString('en-IN')}
          </div>
        </div>
      </Card>
    </div>
  );
}
