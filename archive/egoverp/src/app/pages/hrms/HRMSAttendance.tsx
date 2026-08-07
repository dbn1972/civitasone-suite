import { useState } from 'react';
import { Card, Button, Badge, Input } from '../../components/ui';
import {
  Clock,
  LogIn,
  LogOut,
  Calendar,
  Users,
  CheckCircle,
  XCircle,
  AlertCircle,
  Download,
  Upload,
  Filter,
  TrendingUp,
  MapPin,
} from 'lucide-react';
import { motion } from 'motion/react';

interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  shift: string;
  status: 'present' | 'absent' | 'half_day' | 'late' | 'on_leave' | 'weekend' | 'holiday';
  workHours?: number;
  location?: string;
}

interface MonthDay {
  date: Date;
  day: number;
  isToday: boolean;
  isWeekend: boolean;
  status?: 'present' | 'absent' | 'half_day' | 'late' | 'on_leave' | 'weekend' | 'holiday';
}

const SAMPLE_ATTENDANCE: AttendanceRecord[] = [
  {
    id: '1',
    employeeId: 'EMP-001',
    employeeName: 'Rajesh Kumar',
    department: 'Engineering',
    date: '2026-05-23',
    clockIn: '09:05',
    clockOut: '18:15',
    shift: 'General (9:00 - 18:00)',
    status: 'late',
    workHours: 9.17,
    location: 'Office - Mumbai',
  },
  {
    id: '2',
    employeeId: 'EMP-002',
    employeeName: 'Priya Sharma',
    department: 'Finance',
    date: '2026-05-23',
    clockIn: '08:55',
    clockOut: '18:05',
    shift: 'General (9:00 - 18:00)',
    status: 'present',
    workHours: 9.17,
    location: 'Office - Mumbai',
  },
  {
    id: '3',
    employeeId: 'EMP-003',
    employeeName: 'Amit Patel',
    department: 'HR',
    date: '2026-05-23',
    clockIn: '09:00',
    clockOut: '13:30',
    shift: 'General (9:00 - 18:00)',
    status: 'half_day',
    workHours: 4.5,
    location: 'Office - Mumbai',
  },
  {
    id: '4',
    employeeId: 'EMP-004',
    employeeName: 'Sneha Rao',
    department: 'Marketing',
    date: '2026-05-23',
    status: 'on_leave',
    shift: 'General (9:00 - 18:00)',
  },
  {
    id: '5',
    employeeId: 'EMP-005',
    employeeName: 'Vikram Singh',
    department: 'Operations',
    date: '2026-05-23',
    status: 'absent',
    shift: 'General (9:00 - 18:00)',
  },
];

const generateMonthCalendar = (): MonthDay[] => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: MonthDay[] = [];

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isToday = d === today.getDate();

    let status: MonthDay['status'] = isWeekend ? 'weekend' : undefined;
    if (isToday && !isWeekend) status = 'present';
    else if (d < today.getDate() && !isWeekend) {
      // Randomize past attendance for demo
      const rand = Math.random();
      if (rand < 0.85) status = 'present';
      else if (rand < 0.92) status = 'late';
      else if (rand < 0.96) status = 'on_leave';
      else status = 'absent';
    }

    days.push({ date, day: d, isToday, isWeekend, status });
  }

  return days;
};

export function HRMSAttendance() {
  const [view, setView] = useState<'daily' | 'calendar'>('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<string | null>(null);
  const monthDays = generateMonthCalendar();

  const stats = {
    present: SAMPLE_ATTENDANCE.filter((a) => a.status === 'present' || a.status === 'late').length,
    absent: SAMPLE_ATTENDANCE.filter((a) => a.status === 'absent').length,
    onLeave: SAMPLE_ATTENDANCE.filter((a) => a.status === 'on_leave').length,
    halfDay: SAMPLE_ATTENDANCE.filter((a) => a.status === 'half_day').length,
    avgHours: 8.7,
  };

  const getStatusConfig = (status: AttendanceRecord['status']) => {
    const configs = {
      present: { label: 'Present', variant: 'success' as const, icon: CheckCircle, color: 'intent-success' },
      absent: { label: 'Absent', variant: 'danger' as const, icon: XCircle, color: 'intent-danger' },
      half_day: { label: 'Half Day', variant: 'warning' as const, icon: AlertCircle, color: 'intent-warning' },
      late: { label: 'Late', variant: 'warning' as const, icon: Clock, color: 'intent-warning' },
      on_leave: { label: 'On Leave', variant: 'info' as const, icon: Calendar, color: 'intent-info' },
      weekend: { label: 'Weekend', variant: 'default' as const, icon: Calendar, color: 'text-muted' },
      holiday: { label: 'Holiday', variant: 'default' as const, icon: Calendar, color: 'text-muted' },
    };
    return configs[status];
  };

  const handleClockAction = () => {
    if (!isClockedIn) {
      const now = new Date();
      setClockInTime(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      setIsClockedIn(true);
    } else {
      setIsClockedIn(false);
      setClockInTime(null);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Attendance</h1>
          <p className="text-body-sm text-text-secondary">
            Track employee attendance, shifts, and working hours
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" leadingIcon={<Upload />}>
            Import
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Download />}>
            Export
          </Button>
          <div className="flex bg-surface-sunken rounded-lg p-1">
            <button
              onClick={() => setView('daily')}
              className={`px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
                view === 'daily'
                  ? 'bg-surface-raised text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Daily View
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
                view === 'calendar'
                  ? 'bg-surface-raised text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Calendar
            </button>
          </div>
        </div>
      </div>

      {/* Clock In/Out Card - Prominent */}
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
        <Card className="p-6 bg-gradient-to-br from-brand-primary to-brand-accent text-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-caption opacity-90 mb-2">Current Status</p>
              <h2 className="text-h1 mb-4">{isClockedIn ? 'Clocked In' : 'Not Clocked In'}</h2>
              {isClockedIn && clockInTime && (
                <div className="flex items-center gap-4 text-base">
                  <div className="flex items-center gap-2">
                    <LogIn className="size-5" />
                    <span>Clock In: {clockInTime}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="size-5" />
                    <span>Office - Mumbai</span>
                  </div>
                </div>
              )}
            </div>
            <Button
              variant="secondary"
              size="lg"
              leadingIcon={isClockedIn ? <LogOut /> : <LogIn />}
              onClick={handleClockAction}
              className="bg-white text-brand-primary hover:bg-white/90"
            >
              {isClockedIn ? 'Clock Out' : 'Clock In'}
            </Button>
          </div>
        </Card>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <CheckCircle className="size-5 text-intent-success" />
              </div>
              <div>
                <p className="text-caption text-text-muted">Present</p>
                <p className="text-h3">{stats.present}</p>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 bg-intent-danger-bg rounded-lg flex items-center justify-center">
                <XCircle className="size-5 text-intent-danger" />
              </div>
              <div>
                <p className="text-caption text-text-muted">Absent</p>
                <p className="text-h3">{stats.absent}</p>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <Calendar className="size-5 text-intent-info" />
              </div>
              <div>
                <p className="text-caption text-text-muted">On Leave</p>
                <p className="text-h3">{stats.onLeave}</p>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <AlertCircle className="size-5 text-intent-warning" />
              </div>
              <div>
                <p className="text-caption text-text-muted">Half Day</p>
                <p className="text-h3">{stats.halfDay}</p>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <TrendingUp className="size-5 text-intent-primary" />
              </div>
              <div>
                <p className="text-caption text-text-muted">Avg Hours</p>
                <p className="text-h3">{stats.avgHours}</p>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Main Content */}
      {view === 'daily' ? (
        /* Daily Attendance List */
        <Card>
          <div className="p-4 border-b-2 border-border-subtle flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h3 className="text-h3">Today's Attendance</h3>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <Button variant="secondary" size="sm" leadingIcon={<Filter />}>
              Filter
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-sunken border-b-2 border-border-subtle">
                <tr>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Employee</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Department</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Shift</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Clock In</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Clock Out</th>
                  <th className="text-center p-4 text-caption font-semibold text-text-secondary uppercase">Hours</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Location</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ATTENDANCE.map((record, index) => {
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
                          <p className="text-caption text-text-muted">{record.employeeId}</p>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="text-body-sm text-text-primary">{record.department}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-body-sm text-text-primary">{record.shift}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-body-sm text-text-primary">{record.clockIn || '—'}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-body-sm text-text-primary">{record.clockOut || '—'}</p>
                      </td>
                      <td className="p-4 text-center">
                        <p className="text-body-sm font-semibold text-text-primary">
                          {record.workHours ? `${record.workHours.toFixed(1)}h` : '—'}
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="text-body-sm text-text-primary">{record.location || '—'}</p>
                      </td>
                      <td className="p-4">
                        <Badge variant={statusConfig.variant}>
                          <StatusIcon className="size-3" />
                          {statusConfig.label}
                        </Badge>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* Calendar View */
        <Card className="p-6">
          <div className="mb-6">
            <h2 className="text-h2 mb-2">
              {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </h2>
            <p className="text-body-sm text-text-secondary">My attendance for the current month</p>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center p-2 text-caption font-semibold text-text-muted">
                {day}
              </div>
            ))}
            {/* Empty cells for offset */}
            {Array.from({ length: new Date(new Date().getFullYear(), new Date().getMonth(), 1).getDay() }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {/* Calendar days */}
            {monthDays.map((day, index) => {
              const statusConfig = day.status ? getStatusConfig(day.status) : null;
              return (
                <motion.div
                  key={day.day}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.01 }}
                  className={`
                    aspect-square p-2 rounded-lg flex flex-col items-center justify-center relative
                    ${day.isToday ? 'ring-2 ring-intent-primary' : ''}
                    ${statusConfig ? `bg-${statusConfig.color}-bg` : 'bg-surface-sunken'}
                    ${day.isWeekend ? 'opacity-60' : ''}
                    hover:shadow-md transition-all cursor-pointer
                  `}
                >
                  <span className={`text-body-sm font-medium ${day.isToday ? 'text-intent-primary' : 'text-text-primary'}`}>
                    {day.day}
                  </span>
                  {statusConfig && (
                    <div className="absolute bottom-1">
                      <div className={`size-1.5 rounded-full bg-${statusConfig.color}`} />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-full bg-intent-success" />
              <span className="text-caption text-text-muted">Present</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-full bg-intent-warning" />
              <span className="text-caption text-text-muted">Late/Half Day</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-full bg-intent-danger" />
              <span className="text-caption text-text-muted">Absent</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-full bg-intent-info" />
              <span className="text-caption text-text-muted">On Leave</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-full bg-text-muted" />
              <span className="text-caption text-text-muted">Weekend/Holiday</span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
