import { useState } from 'react';
import { Card, Button, Badge, Input, Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  FileText,
  Search,
  Filter,
  Plus,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  User,
  Calendar,
  MoreVertical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';

interface HelpdeskTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  requester: string;
  assignee: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed';
  createdDate: string;
  updatedDate: string;
  slaBreached: boolean;
  slaTimeRemaining: number; // minutes
}

const SAMPLE_TICKETS: HelpdeskTicket[] = [
  {
    id: '1',
    ticketNumber: 'TKT-2026-001234',
    subject: 'Unable to access payroll system',
    requester: 'Rajesh Kumar',
    assignee: 'IT Support Team',
    category: 'System Access',
    priority: 'high',
    status: 'in_progress',
    createdDate: '2026-05-23T09:30:00Z',
    updatedDate: '2026-05-23T10:15:00Z',
    slaBreached: false,
    slaTimeRemaining: 180,
  },
  {
    id: '2',
    ticketNumber: 'TKT-2026-001235',
    subject: 'Printer not working in Admin block',
    requester: 'Priya Sharma',
    assignee: 'Hardware Support',
    category: 'Hardware',
    priority: 'medium',
    status: 'open',
    createdDate: '2026-05-23T08:00:00Z',
    updatedDate: '2026-05-23T08:00:00Z',
    slaBreached: false,
    slaTimeRemaining: 420,
  },
  {
    id: '3',
    ticketNumber: 'TKT-2026-001236',
    subject: 'Request for new software license',
    requester: 'Amit Patel',
    assignee: 'Procurement Team',
    category: 'Software',
    priority: 'low',
    status: 'pending',
    createdDate: '2026-05-22T14:30:00Z',
    updatedDate: '2026-05-23T09:00:00Z',
    slaBreached: false,
    slaTimeRemaining: 1200,
  },
  {
    id: '4',
    ticketNumber: 'TKT-2026-001237',
    subject: 'Email server down - urgent',
    requester: 'Sneha Rao',
    assignee: 'Network Team',
    category: 'Infrastructure',
    priority: 'urgent',
    status: 'resolved',
    createdDate: '2026-05-22T11:00:00Z',
    updatedDate: '2026-05-22T12:30:00Z',
    slaBreached: false,
    slaTimeRemaining: 0,
  },
  {
    id: '5',
    ticketNumber: 'TKT-2026-001238',
    subject: 'Account locked after password reset',
    requester: 'Vikram Singh',
    assignee: 'Security Team',
    category: 'Security',
    priority: 'high',
    status: 'open',
    createdDate: '2026-05-21T16:00:00Z',
    updatedDate: '2026-05-21T16:00:00Z',
    slaBreached: true,
    slaTimeRemaining: -60,
  },
];

export function HelpdeskTickets() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<HelpdeskTicket[]>(SAMPLE_TICKETS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());

  const filteredTickets = tickets.filter((ticket) => {
    const matchesSearch =
      ticket.ticketNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.requester.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPriority = selectedPriority === 'all' || ticket.priority === selectedPriority;
    const matchesStatus = selectedStatus === 'all' || ticket.status === selectedStatus;

    return matchesSearch && matchesPriority && matchesStatus;
  });

  const stats = {
    total: tickets.length,
    open: tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
    pending: tickets.filter((t) => t.status === 'pending').length,
    breached: tickets.filter((t) => t.slaBreached).length,
  };

  const getPriorityConfig = (priority: HelpdeskTicket['priority']) => {
    const configs = {
      low: { label: 'Low', variant: 'default' as const },
      medium: { label: 'Medium', variant: 'info' as const },
      high: { label: 'High', variant: 'warning' as const },
      urgent: { label: 'Urgent', variant: 'danger' as const },
    };
    return configs[priority];
  };

  const getStatusConfig = (status: HelpdeskTicket['status']) => {
    const configs = {
      open: { label: 'Open', variant: 'info' as const, icon: AlertTriangle },
      in_progress: { label: 'In Progress', variant: 'warning' as const, icon: Clock },
      pending: { label: 'Pending', variant: 'default' as const, icon: Clock },
      resolved: { label: 'Resolved', variant: 'success' as const, icon: CheckCircle },
      closed: { label: 'Closed', variant: 'default' as const, icon: CheckCircle },
    };
    return configs[status];
  };

  const getSLAColor = (slaTimeRemaining: number, breached: boolean) => {
    if (breached) return 'intent-danger';
    if (slaTimeRemaining < 60) return 'intent-danger';
    if (slaTimeRemaining < 180) return 'intent-warning';
    return 'intent-success';
  };

  const formatSLATime = (minutes: number) => {
    if (minutes < 0) return `Breached ${Math.abs(minutes)}m ago`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const toggleTicketSelection = (id: string) => {
    const newSelected = new Set(selectedTickets);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTickets(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedTickets.size === filteredTickets.length) {
      setSelectedTickets(new Set());
    } else {
      setSelectedTickets(new Set(filteredTickets.map((t) => t.id)));
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Helpdesk Tickets</h1>
          <p className="text-body-sm text-text-secondary">
            Manage and resolve support tickets with SLA tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" leadingIcon={<Filter />}>
            Advanced Filters
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Plus />}>
            New Ticket
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Tickets</p>
                <p className="text-h2">{stats.total}</p>
              </div>
              <div className="size-12 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <FileText className="size-6 text-intent-info" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Open/In Progress</p>
                <p className="text-h2">{stats.open}</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <Clock className="size-6 text-intent-warning" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Pending</p>
                <p className="text-h2">{stats.pending}</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <AlertTriangle className="size-6 text-intent-primary" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">SLA Breached</p>
                <p className="text-h2">{stats.breached}</p>
              </div>
              <div className="size-12 bg-intent-danger-bg rounded-lg flex items-center justify-center">
                <XCircle className="size-6 text-intent-danger" />
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
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                type="text"
                placeholder="Search by ticket number, subject, or requester..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10"
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
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedPriority} onValueChange={setSelectedPriority}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Bulk Actions */}
      <AnimatePresence>
        {selectedTickets.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card className="p-4 bg-intent-primary-bg border-2 border-intent-primary">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <p className="text-body-sm font-medium text-text-primary">
                    {selectedTickets.size} ticket{selectedTickets.size !== 1 ? 's' : ''} selected
                  </p>
                  <Button variant="secondary" size="sm">
                    Assign
                  </Button>
                  <Button variant="secondary" size="sm">
                    Change Status
                  </Button>
                  <Button variant="secondary" size="sm">
                    Bulk Close
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedTickets(new Set())}>
                  Clear Selection
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tickets Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                <th className="text-start p-4 w-12">
                  <Checkbox
                    checked={selectedTickets.size === filteredTickets.length && filteredTickets.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Ticket</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Requester</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Assignee</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Category</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Priority</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Status</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">SLA</th>
                <th className="text-center p-4 text-caption font-semibold text-text-secondary uppercase w-12">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map((ticket, index) => {
                const priorityConfig = getPriorityConfig(ticket.priority);
                const statusConfig = getStatusConfig(ticket.status);
                const StatusIcon = statusConfig.icon;
                const slaColor = getSLAColor(ticket.slaTimeRemaining, ticket.slaBreached);

                return (
                  <motion.tr
                    key={ticket.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="border-b border-border-subtle hover:bg-surface-sunken transition-colors cursor-pointer"
                    onClick={() => navigate(`/app/helpdesk/tickets/${ticket.id}`)}
                  >
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedTickets.has(ticket.id)}
                        onChange={() => toggleTicketSelection(ticket.id)}
                      />
                    </td>
                    <td className="p-4">
                      <div>
                        <p className="text-body-sm font-medium text-text-primary">{ticket.ticketNumber}</p>
                        <p className="text-caption text-text-muted">{ticket.subject}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <User className="size-4 text-text-muted" />
                        <p className="text-body-sm text-text-primary">{ticket.requester}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-body-sm text-text-primary">{ticket.assignee}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-body-sm text-text-primary">{ticket.category}</p>
                    </td>
                    <td className="p-4">
                      <Badge variant={priorityConfig.variant}>{priorityConfig.label}</Badge>
                    </td>
                    <td className="p-4">
                      <Badge variant={statusConfig.variant}>
                        <StatusIcon className="size-3" />
                        {statusConfig.label}
                      </Badge>
                    </td>
                    <td className="p-4">
                      {ticket.status !== 'resolved' && ticket.status !== 'closed' ? (
                        <div className="flex items-center gap-2">
                          <div className={`size-2 rounded-full bg-${slaColor}`} />
                          <span className={`text-caption font-medium text-${slaColor}`}>
                            {formatSLATime(ticket.slaTimeRemaining)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-caption text-text-muted">—</span>
                      )}
                    </td>
                    <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button className="p-2 hover:bg-surface-sunken rounded-lg transition-colors">
                        <MoreVertical className="size-4 text-text-muted" />
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredTickets.length === 0 && (
          <div className="p-12 text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <FileText className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No tickets found</h3>
            <p className="text-body-sm text-text-secondary">
              {searchQuery || selectedPriority !== 'all' || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first ticket to get started'}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
