import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import { Plus, Search, Filter, Star, Calendar, TrendingUp, DollarSign, Users, Package, FileText, Clock } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';

interface Report {
  id: string;
  name: string;
  module: string;
  description: string;
  owner: string;
  lastRun?: string;
  scheduled: boolean;
  favorite: boolean;
  category: 'tabular' | 'pivot' | 'chart' | 'kpi' | 'dashboard';
  icon: any;
}

const SAMPLE_REPORTS: Report[] = [
  {
    id: '1',
    name: 'Monthly Procurement Summary',
    module: 'Procurement',
    description: 'Comprehensive overview of all procurement activities, PO values, and vendor performance',
    owner: 'Rajesh Kumar',
    lastRun: '2024-06-23T08:30:00',
    scheduled: true,
    favorite: true,
    category: 'dashboard',
    icon: Package,
  },
  {
    id: '2',
    name: 'Budget vs Actuals - Finance',
    module: 'Finance',
    description: 'Compare budgeted amounts against actual spending across all departments',
    owner: 'Priya Singh',
    lastRun: '2024-06-22T18:00:00',
    scheduled: true,
    favorite: true,
    category: 'chart',
    icon: DollarSign,
  },
  {
    id: '3',
    name: 'Employee Headcount by Department',
    module: 'HRMS',
    description: 'Current headcount distribution across departments with trend analysis',
    owner: 'Amit Patel',
    lastRun: '2024-06-20T10:15:00',
    scheduled: false,
    favorite: false,
    category: 'chart',
    icon: Users,
  },
  {
    id: '4',
    name: 'Leave Balance Report',
    module: 'HRMS',
    description: 'All employees leave balances by type with pending applications',
    owner: 'HR Team',
    lastRun: '2024-06-23T07:00:00',
    scheduled: true,
    favorite: false,
    category: 'tabular',
    icon: Calendar,
  },
  {
    id: '5',
    name: 'Sales Pipeline Forecast',
    module: 'CRM',
    description: 'Weighted revenue forecast based on deal stages and probabilities',
    owner: 'Sales Team',
    lastRun: '2024-06-21T16:45:00',
    scheduled: false,
    favorite: true,
    category: 'chart',
    icon: TrendingUp,
  },
  {
    id: '6',
    name: 'Helpdesk SLA Compliance',
    module: 'Helpdesk',
    description: 'Track first response and resolution SLA compliance rates by team',
    owner: 'Support Manager',
    lastRun: '2024-06-23T09:00:00',
    scheduled: true,
    favorite: false,
    category: 'kpi',
    icon: Clock,
  },
  {
    id: '7',
    name: 'Vendor Payment Analysis',
    module: 'Finance',
    description: 'Payment cycle analysis for all vendors with aging details',
    owner: 'Finance Team',
    lastRun: '2024-06-19T14:30:00',
    scheduled: false,
    favorite: false,
    category: 'pivot',
    icon: DollarSign,
  },
  {
    id: '8',
    name: 'Asset Utilization Report',
    module: 'Assets',
    description: 'Track asset allocation, depreciation, and maintenance schedules',
    owner: 'Asset Manager',
    lastRun: '2024-06-18T11:20:00',
    scheduled: false,
    favorite: false,
    category: 'tabular',
    icon: Package,
  },
];

export function ReportCenter() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'all' | 'my-reports' | 'scheduled' | 'favorites' | 'templates'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [favorites, setFavorites] = useState(new Set(SAMPLE_REPORTS.filter((r) => r.favorite).map((r) => r.id)));

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredReports = SAMPLE_REPORTS.filter((report) => {
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'my-reports' && report.owner === 'Rajesh Kumar') ||
      (activeTab === 'scheduled' && report.scheduled) ||
      (activeTab === 'favorites' && favorites.has(report.id)) ||
      (activeTab === 'templates' && false);
    const matchesSearch = report.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         report.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesModule = moduleFilter === 'all' || report.module === moduleFilter;
    return matchesTab && matchesSearch && matchesModule;
  });

  const getModuleBadgeIntent = (module: string) => {
    const config: Record<string, 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
      Finance: 'success',
      HRMS: 'info',
      Procurement: 'warning',
      CRM: 'primary',
      Helpdesk: 'danger',
      Assets: 'neutral',
    };
    return config[module] || 'neutral';
  };

  const getCategoryLabel = (category: Report['category']) => {
    const labels = {
      tabular: 'Table',
      pivot: 'Pivot',
      chart: 'Chart',
      kpi: 'KPI',
      dashboard: 'Dashboard',
    };
    return labels[category];
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Reports</h1>
          <p className="text-text-secondary">Access and manage all your business reports</p>
        </div>
        <Button leadingIcon={<Plus />} onClick={() => navigate('/app/reports/builder')}>
          New Report
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Total Reports</div>
          <div className="text-h2 font-bold text-text-primary">{SAMPLE_REPORTS.length}</div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Scheduled</div>
          <div className="text-h2 font-bold text-intent-primary">
            {SAMPLE_REPORTS.filter((r) => r.scheduled).length}
          </div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Favorites</div>
          <div className="text-h2 font-bold text-intent-warning">
            {favorites.size}
          </div>
        </Card>
        <Card>
          <div className="text-body-sm text-text-muted mb-2">Run Today</div>
          <div className="text-h2 font-bold text-intent-success">
            {SAMPLE_REPORTS.filter((r) => r.lastRun && new Date(r.lastRun).toDateString() === new Date().toDateString()).length}
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Card>
        <div className="flex items-center gap-2 border-b-2 border-border-subtle -mx-6 px-6 pb-4 overflow-x-auto">
          {(['all', 'my-reports', 'scheduled', 'favorites', 'templates'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-body-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? 'bg-intent-primary text-white'
                  : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
              }`}
            >
              {tab === 'all' && 'All Reports'}
              {tab === 'my-reports' && 'My Reports'}
              {tab === 'scheduled' && 'Scheduled'}
              {tab === 'favorites' && 'Favorites'}
              {tab === 'templates' && 'Templates'}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-4 mt-4">
          {/* Search */}
          <div className="flex-1 min-w-[250px] max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                id="search-reports"
                placeholder="Search reports..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Module Filter */}
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              <SelectItem value="Finance">Finance</SelectItem>
              <SelectItem value="HRMS">HRMS</SelectItem>
              <SelectItem value="Procurement">Procurement</SelectItem>
              <SelectItem value="CRM">CRM</SelectItem>
              <SelectItem value="Helpdesk">Helpdesk</SelectItem>
              <SelectItem value="Assets">Assets</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="secondary" size="sm" leadingIcon={<Filter />}>
            More Filters
          </Button>
        </div>
      </Card>

      {/* Report Tiles */}
      {filteredReports.length === 0 ? (
        <Card>
          <div className="text-center py-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="size-24 bg-gradient-to-br from-intent-primary to-intent-success rounded-2xl mx-auto flex items-center justify-center">
                <FileText className="size-12 text-white" />
              </div>
              <h3 className="text-h3 text-text-primary">
                {activeTab === 'templates' ? 'Start with a template' : 'No reports found'}
              </h3>
              <p className="text-text-secondary max-w-md mx-auto">
                {activeTab === 'templates'
                  ? 'Choose from our pre-built report templates to get started quickly'
                  : 'Try adjusting your filters or create a new report'}
              </p>
              <Button leadingIcon={<Plus />} onClick={() => navigate('/app/reports/builder')}>
                {activeTab === 'templates' ? 'Browse Templates' : 'Create Report'}
              </Button>
            </motion.div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredReports.map((report, index) => {
            const Icon = report.icon;
            return (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card
                  className="cursor-pointer hover:shadow-md transition-shadow relative"
                  onClick={() => navigate(`/app/reports/${report.id}`)}
                >
                  {/* Favorite Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(report.id);
                    }}
                    className="absolute top-4 right-4 size-8 flex items-center justify-center rounded-lg hover:bg-surface-sunken transition-colors"
                    aria-label={favorites.has(report.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      className={`size-5 ${
                        favorites.has(report.id)
                          ? 'fill-intent-warning text-intent-warning'
                          : 'text-text-muted'
                      }`}
                    />
                  </button>

                  {/* Icon */}
                  <div className="size-12 rounded-lg bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center mb-4">
                    <Icon className="size-6 text-white" />
                  </div>

                  {/* Title */}
                  <h3 className="text-h4 text-text-primary mb-2 pr-8 line-clamp-2">
                    {report.name}
                  </h3>

                  {/* Badges */}
                  <div className="flex items-center gap-2 mb-3">
                    <Badge intent={getModuleBadgeIntent(report.module)}>{report.module}</Badge>
                    <Badge intent="neutral" size="sm">{getCategoryLabel(report.category)}</Badge>
                    {report.scheduled && (
                      <Badge intent="primary" size="sm">
                        <Clock className="size-3 mr-1" />
                        Scheduled
                      </Badge>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-body-sm text-text-secondary mb-4 line-clamp-2">
                    {report.description}
                  </p>

                  {/* Footer */}
                  <div className="pt-4 border-t border-border-subtle">
                    <div className="flex items-center justify-between text-caption text-text-muted">
                      <span>{report.owner}</span>
                      {report.lastRun && (
                        <span title={new Date(report.lastRun).toLocaleString('en-IN')}>
                          {new Date(report.lastRun).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
