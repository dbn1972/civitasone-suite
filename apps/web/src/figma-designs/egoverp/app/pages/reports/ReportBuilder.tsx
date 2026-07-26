import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  ArrowLeft,
  Save,
  Play,
  BarChart3,
  Table as TableIcon,
  PieChart as PieChartIcon,
  TrendingUp,
  Plus,
  X,
  GripVertical,
  RefreshCw,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'motion/react';

const REPORT_TYPES = [
  { id: 'tabular', label: 'Tabular', icon: TableIcon },
  { id: 'pivot', label: 'Pivot Table', icon: TableIcon },
  { id: 'chart', label: 'Chart', icon: BarChart3 },
  { id: 'kpi', label: 'KPI Dashboard', icon: TrendingUp },
  { id: 'composite', label: 'Composite Dashboard', icon: PieChartIcon },
];

const DATA_SOURCES = [
  {
    id: 'finance',
    name: 'Finance',
    endpoints: [
      { id: 'gl_entries', name: 'General Ledger Entries' },
      { id: 'chart_of_accounts', name: 'Chart of Accounts' },
      { id: 'invoices', name: 'Invoices' },
      { id: 'payments', name: 'Payments' },
    ],
  },
  {
    id: 'procurement',
    name: 'Procurement',
    endpoints: [
      { id: 'purchase_orders', name: 'Purchase Orders' },
      { id: 'vendors', name: 'Vendors' },
      { id: 'grn', name: 'Goods Receipt Notes' },
    ],
  },
  {
    id: 'hrms',
    name: 'HRMS',
    endpoints: [
      { id: 'employees', name: 'Employees' },
      { id: 'attendance', name: 'Attendance' },
      { id: 'leaves', name: 'Leave Applications' },
      { id: 'payroll', name: 'Payroll' },
    ],
  },
  {
    id: 'crm',
    name: 'CRM',
    endpoints: [
      { id: 'deals', name: 'Deals' },
      { id: 'contacts', name: 'Contacts' },
      { id: 'activities', name: 'Activities' },
    ],
  },
  {
    id: 'helpdesk',
    name: 'Helpdesk',
    endpoints: [
      { id: 'tickets', name: 'Tickets' },
      { id: 'sla_tracking', name: 'SLA Tracking' },
    ],
  },
];

const AVAILABLE_FIELDS = [
  { id: 'department', name: 'Department', type: 'dimension' },
  { id: 'category', name: 'Category', type: 'dimension' },
  { id: 'month', name: 'Month', type: 'dimension' },
  { id: 'amount', name: 'Amount', type: 'measure' },
  { id: 'count', name: 'Record Count', type: 'measure' },
  { id: 'variance', name: 'Variance', type: 'measure' },
];

const CHART_TYPES = [
  { id: 'bar', name: 'Bar Chart' },
  { id: 'line', name: 'Line Chart' },
  { id: 'pie', name: 'Pie Chart' },
  { id: 'area', name: 'Area Chart' },
  { id: 'heatmap', name: 'Heatmap' },
];

const SAMPLE_PREVIEW_DATA = [
  { department: 'Administration', amount: 11800000 },
  { department: 'Public Works', amount: 48200000 },
  { department: 'Health', amount: 26500000 },
  { department: 'Education', amount: 34100000 },
];

export function ReportBuilder() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [reportName, setReportName] = useState('');
  const [reportType, setReportType] = useState('chart');
  const [selectedService, setSelectedService] = useState('');
  const [selectedEndpoint, setSelectedEndpoint] = useState('');
  const [selectedFields, setSelectedFields] = useState<{
    rows: string[];
    columns: string[];
    values: string[];
    filters: string[];
  }>({
    rows: [],
    columns: [],
    values: [],
    filters: [],
  });
  const [chartType, setChartType] = useState('bar');
  const [scheduleFrequency, setScheduleFrequency] = useState('none');
  const [showPreview, setShowPreview] = useState(true);

  const handleDragField = (fieldId: string, targetZone: 'rows' | 'columns' | 'values' | 'filters') => {
    setSelectedFields((prev) => ({
      ...prev,
      [targetZone]: [...prev[targetZone], fieldId],
    }));
  };

  const handleRemoveField = (fieldId: string, zone: 'rows' | 'columns' | 'values' | 'filters') => {
    setSelectedFields((prev) => ({
      ...prev,
      [zone]: prev[zone].filter((id) => id !== fieldId),
    }));
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return reportType !== '';
      case 2:
        return selectedService !== '' && selectedEndpoint !== '';
      case 3:
        return selectedFields.values.length > 0;
      case 4:
        return reportType !== 'chart' || chartType !== '';
      default:
        return true;
    }
  };

  const handleSave = () => {
    console.log('Saving report:', {
      reportName,
      reportType,
      selectedService,
      selectedEndpoint,
      selectedFields,
      chartType,
      scheduleFrequency,
    });
    navigate('/app/reports');
  };

  return (
    <div className="h-screen flex flex-col bg-surface-canvas">
      {/* Header */}
      <div className="flex-shrink-0 p-6 md:p-8 bg-surface-raised border-b-2 border-border-subtle">
        <div className="flex items-start justify-between gap-4">
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
              <h1 className="text-h1 mb-2">Report Builder</h1>
              <p className="text-text-secondary">Create custom reports with visual builder</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => handleSave()}>
              Save Draft
            </Button>
            <Button onClick={() => handleSave()} leadingIcon={<Save />}>
              Save & Run
            </Button>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 mt-6 overflow-x-auto">
          {['Type', 'Data Source', 'Fields', 'Visualization', 'Filters', 'Schedule', 'Permissions'].map((label, index) => (
            <div key={index} className="flex items-center gap-2">
              <button
                onClick={() => setCurrentStep(index + 1)}
                className={`px-4 py-2 rounded-lg text-body-sm font-medium whitespace-nowrap transition-colors ${
                  currentStep === index + 1
                    ? 'bg-intent-primary text-white'
                    : currentStep > index + 1
                    ? 'bg-intent-success-bg text-intent-success'
                    : 'bg-surface-sunken text-text-secondary'
                }`}
              >
                {index + 1}. {label}
              </button>
              {index < 6 && <div className="w-8 h-0.5 bg-border-subtle"></div>}
            </div>
          ))}
        </div>
      </div>

      {/* Content - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane - Configuration */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          {/* Report Name */}
          <Card>
            <label htmlFor="report-name" className="block text-body-sm font-medium text-text-primary mb-2">
              Report Name
            </label>
            <Input
              id="report-name"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Enter report name..."
            />
          </Card>

          {/* Step 1: Report Type */}
          {currentStep === 1 && (
            <Card>
              <h2 className="text-h3 mb-4">Step 1: Select Report Type</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {REPORT_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.id}
                      onClick={() => setReportType(type.id)}
                      className={`p-6 rounded-lg border-2 transition-all ${
                        reportType === type.id
                          ? 'border-intent-primary bg-intent-primary-bg'
                          : 'border-border-default hover:border-intent-primary hover:bg-surface-sunken'
                      }`}
                    >
                      <Icon className={`size-8 mb-3 mx-auto ${reportType === type.id ? 'text-intent-primary' : 'text-text-muted'}`} />
                      <div className="text-body-sm font-medium text-text-primary text-center">{type.label}</div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Step 2: Data Source */}
          {currentStep === 2 && (
            <Card>
              <h2 className="text-h3 mb-4">Step 2: Select Data Source</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="service" className="block text-body-sm font-medium text-text-primary mb-2">
                    Service
                  </label>
                  <Select
                    value={selectedService}
                    onValueChange={(value) => {
                      setSelectedService(value);
                      setSelectedEndpoint('');
                    }}
                  >
                    <SelectTrigger id="service">
                      <SelectValue placeholder="Select a service..." />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_SOURCES.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedService && (
                  <div>
                    <label htmlFor="endpoint" className="block text-body-sm font-medium text-text-primary mb-2">
                      Data Endpoint
                    </label>
                    <Select value={selectedEndpoint} onValueChange={setSelectedEndpoint}>
                      <SelectTrigger id="endpoint">
                        <SelectValue placeholder="Select an endpoint..." />
                      </SelectTrigger>
                      <SelectContent>
                        {DATA_SOURCES.find((s) => s.id === selectedService)?.endpoints.map((endpoint) => (
                          <SelectItem key={endpoint.id} value={endpoint.id}>
                            {endpoint.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Step 3: Fields */}
          {currentStep === 3 && (
            <Card>
              <h2 className="text-h3 mb-4">Step 3: Configure Fields</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Available Fields */}
                <div>
                  <h3 className="text-h4 mb-3">Available Fields</h3>
                  <div className="space-y-2">
                    {AVAILABLE_FIELDS.map((field) => (
                      <div
                        key={field.id}
                        className="flex items-center gap-3 p-3 bg-surface-raised border-2 border-border-default rounded-lg hover:border-intent-primary cursor-grab transition-colors"
                        draggable
                      >
                        <GripVertical className="size-4 text-text-muted" />
                        <div className="flex-1">
                          <div className="text-body-sm font-medium text-text-primary">{field.name}</div>
                          <div className="text-caption text-text-muted">{field.type}</div>
                        </div>
                        <div className="flex gap-2">
                          {reportType === 'pivot' && (
                            <button
                              onClick={() => handleDragField(field.id, 'rows')}
                              className="px-2 py-1 text-caption bg-surface-sunken rounded hover:bg-intent-primary-bg"
                            >
                              + Row
                            </button>
                          )}
                          <button
                            onClick={() => handleDragField(field.id, 'values')}
                            className="px-2 py-1 text-caption bg-surface-sunken rounded hover:bg-intent-primary-bg"
                          >
                            + Value
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Drop Zones */}
                <div className="space-y-4">
                  {reportType === 'pivot' && (
                    <div>
                      <h4 className="text-body-sm font-semibold text-text-primary mb-2">Rows</h4>
                      <div className="min-h-[80px] p-3 bg-surface-sunken border-2 border-dashed border-border-default rounded-lg">
                        {selectedFields.rows.length === 0 ? (
                          <p className="text-caption text-text-muted text-center py-4">Drag fields here</p>
                        ) : (
                          <div className="space-y-2">
                            {selectedFields.rows.map((fieldId) => {
                              const field = AVAILABLE_FIELDS.find((f) => f.id === fieldId);
                              return (
                                <div key={fieldId} className="flex items-center justify-between p-2 bg-surface-raised rounded">
                                  <span className="text-body-sm text-text-primary">{field?.name}</span>
                                  <button onClick={() => handleRemoveField(fieldId, 'rows')}>
                                    <X className="size-4 text-text-muted hover:text-intent-danger" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <h4 className="text-body-sm font-semibold text-text-primary mb-2">Values</h4>
                    <div className="min-h-[80px] p-3 bg-surface-sunken border-2 border-dashed border-border-default rounded-lg">
                      {selectedFields.values.length === 0 ? (
                        <p className="text-caption text-text-muted text-center py-4">Drag fields here</p>
                      ) : (
                        <div className="space-y-2">
                          {selectedFields.values.map((fieldId) => {
                            const field = AVAILABLE_FIELDS.find((f) => f.id === fieldId);
                            return (
                              <div key={fieldId} className="flex items-center justify-between p-2 bg-surface-raised rounded">
                                <span className="text-body-sm text-text-primary">{field?.name}</span>
                                <button onClick={() => handleRemoveField(fieldId, 'values')}>
                                  <X className="size-4 text-text-muted hover:text-intent-danger" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-body-sm font-semibold text-text-primary mb-2">Filters</h4>
                    <div className="min-h-[80px] p-3 bg-surface-sunken border-2 border-dashed border-border-default rounded-lg">
                      {selectedFields.filters.length === 0 ? (
                        <p className="text-caption text-text-muted text-center py-4">Drag fields here</p>
                      ) : (
                        <div className="space-y-2">
                          {selectedFields.filters.map((fieldId) => {
                            const field = AVAILABLE_FIELDS.find((f) => f.id === fieldId);
                            return (
                              <div key={fieldId} className="flex items-center justify-between p-2 bg-surface-raised rounded">
                                <span className="text-body-sm text-text-primary">{field?.name}</span>
                                <button onClick={() => handleRemoveField(fieldId, 'filters')}>
                                  <X className="size-4 text-text-muted hover:text-intent-danger" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Step 4: Visualization */}
          {currentStep === 4 && reportType === 'chart' && (
            <Card>
              <h2 className="text-h3 mb-4">Step 4: Select Visualization Type</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {CHART_TYPES.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setChartType(type.id)}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      chartType === type.id
                        ? 'border-intent-primary bg-intent-primary-bg'
                        : 'border-border-default hover:border-intent-primary hover:bg-surface-sunken'
                    }`}
                  >
                    <div className={`text-body-sm font-medium text-center ${chartType === type.id ? 'text-intent-primary' : 'text-text-primary'}`}>
                      {type.name}
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Step 6: Schedule */}
          {currentStep === 6 && (
            <Card>
              <h2 className="text-h3 mb-4">Step 6: Schedule Report</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="frequency" className="block text-body-sm font-medium text-text-primary mb-2">
                    Frequency
                  </label>
                  <Select value={scheduleFrequency} onValueChange={setScheduleFrequency}>
                    <SelectTrigger id="frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (Run manually)</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {scheduleFrequency !== 'none' && (
                  <>
                    <div>
                      <label htmlFor="time" className="block text-body-sm font-medium text-text-primary mb-2">
                        Time
                      </label>
                      <Input id="time" type="time" defaultValue="09:00" />
                    </div>
                    <div>
                      <label htmlFor="recipients" className="block text-body-sm font-medium text-text-primary mb-2">
                        Email Recipients
                      </label>
                      <Input id="recipients" placeholder="email@example.com, email2@example.com" />
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
              disabled={currentStep === 1}
            >
              Previous
            </Button>
            <Button
              onClick={() => setCurrentStep(Math.min(7, currentStep + 1))}
              disabled={!canProceed() || currentStep === 7}
            >
              Next
            </Button>
          </div>
        </div>

        {/* Right Pane - Live Preview */}
        {showPreview && (
          <div className="flex-shrink-0 w-full md:w-[500px] lg:w-[600px] bg-surface-raised border-s-2 border-border-subtle overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-h3">Preview</h3>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" leadingIcon={<RefreshCw />}>
                  Refresh
                </Button>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-text-muted hover:text-text-primary"
                  aria-label="Hide preview"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {selectedFields.values.length === 0 ? (
              <div className="text-center py-20">
                <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
                  <BarChart3 className="size-8 text-text-muted" />
                </div>
                <h4 className="text-h4 text-text-primary mb-2">No Data Selected</h4>
                <p className="text-body-sm text-text-secondary">
                  Drag fields to the configuration panel to see preview
                </p>
              </div>
            ) : (
              <Card>
                <div className="mb-4">
                  <Badge intent="info">Sample Data</Badge>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={SAMPLE_PREVIEW_DATA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="department" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '2px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
