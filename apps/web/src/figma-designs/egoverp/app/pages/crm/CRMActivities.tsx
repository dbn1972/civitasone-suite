import { useState } from 'react';
import { Card, Button, Badge } from '../../components/ui';
import {
  Calendar,
  Phone,
  Mail,
  Users,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Plus,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { motion } from 'motion/react';

interface Activity {
  id: string;
  type: 'call' | 'email' | 'meeting' | 'task' | 'note';
  title: string;
  description: string;
  contact: string;
  company: string;
  assignedTo: string;
  date: string;
  time: string;
  duration?: string;
  status: 'completed' | 'scheduled' | 'overdue' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
}

const SAMPLE_ACTIVITIES: Activity[] = [
  {
    id: '1',
    type: 'meeting',
    title: 'Product Demo - Tech Corp',
    description: 'Showcase new features and discuss implementation timeline',
    contact: 'Rajesh Kumar',
    company: 'Tech Corp India',
    assignedTo: 'Priya Sharma',
    date: '2026-05-24',
    time: '10:00',
    duration: '1h',
    status: 'scheduled',
    priority: 'high',
  },
  {
    id: '2',
    type: 'call',
    title: 'Follow-up Call - Global Enterprise',
    description: 'Discuss proposal feedback and next steps',
    contact: 'Anita Desai',
    company: 'Global Enterprise Solutions',
    assignedTo: 'Amit Patel',
    date: '2026-05-23',
    time: '14:30',
    duration: '30m',
    status: 'completed',
    priority: 'medium',
  },
  {
    id: '3',
    type: 'email',
    title: 'Send Proposal - Startup Ventures',
    description: 'Email comprehensive proposal with pricing details',
    contact: 'Vikram Singh',
    company: 'Startup Ventures',
    assignedTo: 'Sneha Rao',
    date: '2026-05-22',
    time: '16:00',
    status: 'overdue',
    priority: 'high',
  },
  {
    id: '4',
    type: 'task',
    title: 'Prepare Contract - HealthPlus',
    description: 'Draft and review partnership agreement',
    contact: 'Meera Reddy',
    company: 'HealthPlus Medical',
    assignedTo: 'Priya Sharma',
    date: '2026-05-25',
    time: '11:00',
    status: 'scheduled',
    priority: 'medium',
  },
  {
    id: '5',
    type: 'note',
    title: 'Meeting Notes - Retail Group',
    description: 'Discussion summary from quarterly review meeting',
    contact: 'Arjun Mehta',
    company: 'Retail Group India',
    assignedTo: 'Amit Patel',
    date: '2026-05-21',
    time: '15:00',
    status: 'completed',
    priority: 'low',
  },
];

export function CRMActivities() {
  const [activities, setActivities] = useState<Activity[]>(SAMPLE_ACTIVITIES);
  const [selectedView, setSelectedView] = useState<'timeline' | 'calendar'>('timeline');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const filteredActivities = activities.filter((activity) => {
    return selectedType === 'all' || activity.type === selectedType;
  });

  const stats = {
    total: activities.length,
    scheduled: activities.filter((a) => a.status === 'scheduled').length,
    completed: activities.filter((a) => a.status === 'completed').length,
    overdue: activities.filter((a) => a.status === 'overdue').length,
  };

  const getActivityIcon = (type: Activity['type']) => {
    const icons = {
      call: Phone,
      email: Mail,
      meeting: Users,
      task: CheckCircle,
      note: FileText,
    };
    return icons[type];
  };

  const getActivityColor = (type: Activity['type']) => {
    const colors = {
      call: 'intent-info',
      email: 'intent-warning',
      meeting: 'intent-primary',
      task: 'intent-success',
      note: 'text-secondary',
    };
    return colors[type];
  };

  const getStatusConfig = (status: Activity['status']) => {
    const configs = {
      completed: { label: 'Completed', variant: 'success' as const, icon: CheckCircle },
      scheduled: { label: 'Scheduled', variant: 'info' as const, icon: Clock },
      overdue: { label: 'Overdue', variant: 'danger' as const, icon: AlertCircle },
      cancelled: { label: 'Cancelled', variant: 'default' as const, icon: AlertCircle },
    };
    return configs[status];
  };

  const getPriorityBadge = (priority: Activity['priority']) => {
    const variants = {
      low: 'default' as const,
      medium: 'info' as const,
      high: 'danger' as const,
    };
    return variants[priority];
  };

  // Group activities by date for timeline view
  const groupedActivities = filteredActivities.reduce((acc, activity) => {
    const date = activity.date;
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(activity);
    return acc;
  }, {} as Record<string, Activity[]>);

  const sortedDates = Object.keys(groupedActivities).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Activities</h1>
          <p className="text-body-sm text-text-secondary">
            Track calls, meetings, emails, and tasks with your contacts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" leadingIcon={<Filter />}>
            Filter
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Plus />}>
            New Activity
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Activities</p>
                <p className="text-h2">{stats.total}</p>
              </div>
              <div className="size-12 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <Calendar className="size-6 text-intent-info" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Scheduled</p>
                <p className="text-h2">{stats.scheduled}</p>
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
                <p className="text-caption text-text-muted mb-1">Completed</p>
                <p className="text-h2">{stats.completed}</p>
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
                <p className="text-caption text-text-muted mb-1">Overdue</p>
                <p className="text-h2">{stats.overdue}</p>
              </div>
              <div className="size-12 bg-intent-danger-bg rounded-lg flex items-center justify-center">
                <AlertCircle className="size-6 text-intent-danger" />
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* View Toggle and Type Filter */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex bg-surface-sunken rounded-lg p-1">
            <button
              onClick={() => setSelectedView('timeline')}
              className={`px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
                selectedView === 'timeline'
                  ? 'bg-surface-raised text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Timeline
            </button>
            <button
              onClick={() => setSelectedView('calendar')}
              className={`px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
                selectedView === 'calendar'
                  ? 'bg-surface-raised text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Calendar
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-3 py-1.5 rounded-lg text-body-sm transition-colors ${
                selectedType === 'all'
                  ? 'bg-intent-primary text-white'
                  : 'bg-surface-sunken text-text-primary hover:bg-surface-raised'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSelectedType('call')}
              className={`px-3 py-1.5 rounded-lg text-body-sm transition-colors flex items-center gap-2 ${
                selectedType === 'call'
                  ? 'bg-intent-info text-white'
                  : 'bg-surface-sunken text-text-primary hover:bg-surface-raised'
              }`}
            >
              <Phone className="size-4" />
              Calls
            </button>
            <button
              onClick={() => setSelectedType('email')}
              className={`px-3 py-1.5 rounded-lg text-body-sm transition-colors flex items-center gap-2 ${
                selectedType === 'email'
                  ? 'bg-intent-warning text-white'
                  : 'bg-surface-sunken text-text-primary hover:bg-surface-raised'
              }`}
            >
              <Mail className="size-4" />
              Emails
            </button>
            <button
              onClick={() => setSelectedType('meeting')}
              className={`px-3 py-1.5 rounded-lg text-body-sm transition-colors flex items-center gap-2 ${
                selectedType === 'meeting'
                  ? 'bg-intent-primary text-white'
                  : 'bg-surface-sunken text-text-primary hover:bg-surface-raised'
              }`}
            >
              <Users className="size-4" />
              Meetings
            </button>
            <button
              onClick={() => setSelectedType('task')}
              className={`px-3 py-1.5 rounded-lg text-body-sm transition-colors flex items-center gap-2 ${
                selectedType === 'task'
                  ? 'bg-intent-success text-white'
                  : 'bg-surface-sunken text-text-primary hover:bg-surface-raised'
              }`}
            >
              <CheckCircle className="size-4" />
              Tasks
            </button>
          </div>
        </div>
      </Card>

      {/* Content */}
      {selectedView === 'timeline' ? (
        /* Timeline View */
        <div className="space-y-6">
          {sortedDates.map((date, dateIndex) => {
            const dateActivities = groupedActivities[date];
            const isToday = new Date(date).toDateString() === new Date().toDateString();

            return (
              <motion.div
                key={date}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: dateIndex * 0.1 }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <h3 className={`text-h4 ${isToday ? 'text-intent-primary' : 'text-text-primary'}`}>
                    {new Date(date).toLocaleDateString('en-IN', {
                      weekday: 'long',
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </h3>
                  {isToday && <Badge variant="primary">Today</Badge>}
                </div>
                <div className="space-y-3">
                  {dateActivities.map((activity, activityIndex) => {
                    const Icon = getActivityIcon(activity.type);
                    const color = getActivityColor(activity.type);
                    const statusConfig = getStatusConfig(activity.status);
                    const StatusIcon = statusConfig.icon;

                    return (
                      <motion.div
                        key={activity.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: activityIndex * 0.05 }}
                      >
                        <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
                          <div className="flex items-start gap-4">
                            <div className={`size-12 bg-${color}-bg rounded-lg flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`size-6 text-${color}`} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <h4 className="text-h4 mb-1">{activity.title}</h4>
                                  <p className="text-body-sm text-text-secondary">{activity.description}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={getPriorityBadge(activity.priority)}>
                                    {activity.priority}
                                  </Badge>
                                  <Badge variant={statusConfig.variant}>
                                    <StatusIcon className="size-3" />
                                    {statusConfig.label}
                                  </Badge>
                                </div>
                              </div>
                              <div className="flex items-center gap-6 text-caption text-text-muted">
                                <span className="flex items-center gap-1">
                                  <Clock className="size-3" />
                                  {activity.time}
                                  {activity.duration && ` (${activity.duration})`}
                                </span>
                                <span>•</span>
                                <span>{activity.contact}</span>
                                <span>•</span>
                                <span>{activity.company}</span>
                                <span>•</span>
                                <span>Assigned to: {activity.assignedTo}</span>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        /* Calendar View */
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-h2">
              {selectedDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setMonth(newDate.getMonth() - 1);
                  setSelectedDate(newDate);
                }}
              >
                <ChevronLeft />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSelectedDate(new Date())}>
                Today
              </Button>
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setMonth(newDate.getMonth() + 1);
                  setSelectedDate(newDate);
                }}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
          <div className="text-center py-12 text-text-muted">
            <Calendar className="size-16 mx-auto mb-4 opacity-50" />
            <p className="text-body-sm">Calendar view will display monthly schedule</p>
          </div>
        </Card>
      )}

      {filteredActivities.length === 0 && (
        <Card className="p-12">
          <div className="text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <Calendar className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No activities found</h3>
            <p className="text-body-sm text-text-secondary">
              {selectedType !== 'all'
                ? 'Try selecting a different activity type'
                : 'Create your first activity to get started'}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
