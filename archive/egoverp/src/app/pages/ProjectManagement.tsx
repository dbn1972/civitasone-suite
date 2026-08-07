import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import {
  FolderKanban,
  Plus,
  Search,
  Filter,
  Download,
  Calendar,
  Users,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  Eye,
  BarChart3,
} from 'lucide-react';
import { motion } from 'motion/react';

interface Project {
  id: string;
  projectCode: string;
  name: string;
  description: string;
  manager: string;
  team: string[];
  status: 'planning' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  startDate: string;
  endDate: string;
  budget: number;
  spent: number;
  progress: number;
  tasksTotal: number;
  tasksCompleted: number;
  department: string;
  health: 'on_track' | 'at_risk' | 'off_track';
}

const SAMPLE_PROJECTS: Project[] = [
  {
    id: '1',
    projectCode: 'PRJ-2026-001',
    name: 'Digital Transformation Initiative',
    description: 'Modernize legacy systems and migrate to cloud infrastructure',
    manager: 'Priya Sharma',
    team: ['Rajesh Kumar', 'Amit Patel', 'Sneha Rao'],
    status: 'in_progress',
    priority: 'critical',
    startDate: '2026-01-15',
    endDate: '2026-12-31',
    budget: 5000000,
    spent: 2100000,
    progress: 42,
    tasksTotal: 48,
    tasksCompleted: 20,
    department: 'IT',
    health: 'on_track',
  },
  {
    id: '2',
    projectCode: 'PRJ-2026-002',
    name: 'Office Expansion - Bangalore',
    description: 'Setup new office facility with 200 seating capacity',
    manager: 'Vikram Singh',
    team: ['Meera Reddy', 'Arjun Mehta'],
    status: 'in_progress',
    priority: 'high',
    startDate: '2026-03-01',
    endDate: '2026-08-31',
    budget: 12000000,
    spent: 7200000,
    progress: 65,
    tasksTotal: 32,
    tasksCompleted: 21,
    department: 'Admin',
    health: 'at_risk',
  },
  {
    id: '3',
    projectCode: 'PRJ-2026-003',
    name: 'Employee Wellness Program',
    description: 'Comprehensive health and wellness initiative for all employees',
    manager: 'Sneha Rao',
    team: ['Amit Patel'],
    status: 'planning',
    priority: 'medium',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    budget: 800000,
    spent: 0,
    progress: 0,
    tasksTotal: 15,
    tasksCompleted: 0,
    department: 'HR',
    health: 'on_track',
  },
  {
    id: '4',
    projectCode: 'PRJ-2025-045',
    name: 'Data Migration to New ERP',
    description: 'Migrate all legacy data to new ERP system',
    manager: 'Rajesh Kumar',
    team: ['Priya Sharma', 'Vikram Singh', 'Meera Reddy'],
    status: 'completed',
    priority: 'critical',
    startDate: '2025-09-01',
    endDate: '2026-03-31',
    budget: 3500000,
    spent: 3200000,
    progress: 100,
    tasksTotal: 56,
    tasksCompleted: 56,
    department: 'IT',
    health: 'on_track',
  },
  {
    id: '5',
    projectCode: 'PRJ-2026-004',
    name: 'Compliance Audit - ISO 27001',
    description: 'Prepare and execute ISO 27001 certification audit',
    manager: 'Meera Reddy',
    team: ['Arjun Mehta', 'Sneha Rao'],
    status: 'on_hold',
    priority: 'high',
    startDate: '2026-04-01',
    endDate: '2026-09-30',
    budget: 1500000,
    spent: 450000,
    progress: 25,
    tasksTotal: 28,
    tasksCompleted: 7,
    department: 'Compliance',
    health: 'off_track',
  },
];

export function ProjectManagement() {
  const [projects, setProjects] = useState<Project[]>(SAMPLE_PROJECTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedHealth, setSelectedHealth] = useState('all');

  const filteredProjects = projects.filter((project) => {
    const matchesSearch =
      project.projectCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.manager.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = selectedStatus === 'all' || project.status === selectedStatus;
    const matchesHealth = selectedHealth === 'all' || project.health === selectedHealth;

    return matchesSearch && matchesStatus && matchesHealth;
  });

  const stats = {
    total: projects.length,
    active: projects.filter((p) => p.status === 'in_progress').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    atRisk: projects.filter((p) => p.health === 'at_risk' || p.health === 'off_track').length,
    totalBudget: projects.reduce((sum, p) => sum + p.budget, 0),
    totalSpent: projects.reduce((sum, p) => sum + p.spent, 0),
  };

  const getStatusConfig = (status: Project['status']) => {
    const configs = {
      planning: { label: 'Planning', variant: 'default' as const, icon: Calendar },
      in_progress: { label: 'In Progress', variant: 'info' as const, icon: Clock },
      on_hold: { label: 'On Hold', variant: 'warning' as const, icon: AlertTriangle },
      completed: { label: 'Completed', variant: 'success' as const, icon: CheckCircle },
      cancelled: { label: 'Cancelled', variant: 'danger' as const, icon: AlertTriangle },
    };
    return configs[status];
  };

  const getHealthConfig = (health: Project['health']) => {
    const configs = {
      on_track: { label: 'On Track', variant: 'success' as const },
      at_risk: { label: 'At Risk', variant: 'warning' as const },
      off_track: { label: 'Off Track', variant: 'danger' as const },
    };
    return configs[health];
  };

  const getPriorityBadge = (priority: Project['priority']) => {
    const variants = {
      low: 'default' as const,
      medium: 'info' as const,
      high: 'warning' as const,
      critical: 'danger' as const,
    };
    return variants[priority];
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Project Management</h1>
          <p className="text-body-sm text-text-secondary">
            Track projects, tasks, budgets, and resource allocation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" leadingIcon={<BarChart3 />}>
            Reports
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Download />}>
            Export
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Plus />}>
            New Project
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Projects</p>
                <p className="text-h2">{stats.total}</p>
              </div>
              <div className="size-12 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <FolderKanban className="size-6 text-intent-info" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Active Projects</p>
                <p className="text-h2">{stats.active}</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <Clock className="size-6 text-intent-primary" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">At Risk</p>
                <p className="text-h2">{stats.atRisk}</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <AlertTriangle className="size-6 text-intent-warning" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Budget Utilization</p>
                <p className="text-h2">{((stats.totalSpent / stats.totalBudget) * 100).toFixed(0)}%</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <DollarSign className="size-6 text-intent-success" />
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
                placeholder="Search by project code, name, or manager..."
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
                <SelectItem value="planning">Planning</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedHealth} onValueChange={setSelectedHealth}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Health</SelectItem>
                <SelectItem value="on_track">On Track</SelectItem>
                <SelectItem value="at_risk">At Risk</SelectItem>
                <SelectItem value="off_track">Off Track</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="md" leadingIcon={<Filter />}>
              More Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Projects Grid */}
      <div className="space-y-4">
        {filteredProjects.map((project, index) => {
          const statusConfig = getStatusConfig(project.status);
          const healthConfig = getHealthConfig(project.health);
          const StatusIcon = statusConfig.icon;
          const budgetUtilization = (project.spent / project.budget) * 100;

          return (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
                <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                  {/* Left: Project Info */}
                  <div className="flex-1 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-h3">{project.name}</h3>
                          <Badge variant={getPriorityBadge(project.priority)}>
                            {project.priority}
                          </Badge>
                        </div>
                        <p className="text-body-sm text-text-secondary mb-2">{project.description}</p>
                        <p className="text-caption text-text-muted">{project.projectCode} • {project.department}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-caption text-text-muted mb-1">Project Manager</p>
                        <div className="flex items-center gap-2">
                          <Users className="size-4 text-text-muted" />
                          <p className="text-body-sm font-medium text-text-primary">{project.manager}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-caption text-text-muted mb-1">Team Size</p>
                        <p className="text-body-sm text-text-primary">{project.team.length} members</p>
                      </div>
                      <div>
                        <p className="text-caption text-text-muted mb-1">Timeline</p>
                        <div className="flex items-center gap-2">
                          <Calendar className="size-4 text-text-muted" />
                          <p className="text-body-sm text-text-primary">
                            {new Date(project.startDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} - {new Date(project.endDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className="text-caption text-text-muted mb-1">Tasks</p>
                        <p className="text-body-sm text-text-primary">
                          {project.tasksCompleted}/{project.tasksTotal} completed
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {/* Progress */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-caption text-text-muted">Progress</span>
                          <span className="text-caption font-semibold text-text-primary">{project.progress}%</span>
                        </div>
                        <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                          <div
                            className="h-full bg-intent-primary rounded-full"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                      </div>

                      {/* Budget */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-caption text-text-muted">Budget Utilization</span>
                          <span className="text-caption font-semibold text-text-primary">
                            ₹{(project.spent / 100000).toFixed(1)}L / ₹{(project.budget / 100000).toFixed(1)}L
                          </span>
                        </div>
                        <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              budgetUtilization > 90 ? 'bg-intent-danger' : budgetUtilization > 75 ? 'bg-intent-warning' : 'bg-intent-success'
                            }`}
                            style={{ width: `${Math.min(budgetUtilization, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: Status & Actions */}
                  <div className="flex lg:flex-col items-center gap-3">
                    <div className="flex flex-col items-center gap-2">
                      <Badge variant={statusConfig.variant}>
                        <StatusIcon className="size-3" />
                        {statusConfig.label}
                      </Badge>
                      <Badge variant={healthConfig.variant}>
                        {healthConfig.label}
                      </Badge>
                    </div>
                    <Button variant="primary" size="sm" leadingIcon={<Eye />}>
                      View Details
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {filteredProjects.length === 0 && (
        <Card className="p-12">
          <div className="text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <FolderKanban className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No projects found</h3>
            <p className="text-body-sm text-text-secondary">
              {searchQuery || selectedStatus !== 'all' || selectedHealth !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first project to get started'}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
