import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Card, Button, Badge, Textarea, Input } from '../../components/ui';
import {
  ArrowLeft,
  Send,
  Paperclip,
  Lock,
  User,
  Mail,
  Phone,
  MessageSquare,
  Star,
  Clock,
  AlertCircle,
  CheckCircle,
  Printer,
  MoreVertical,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  subcategory: string;
  source: string;
  type: string;
  tags: string[];
  assignee: string;
  team: string;
  queue: string;
  createdAt: string;
  updatedAt: string;
  firstResponseSLA: SLAStatus;
  resolutionSLA: SLAStatus;
  slaPolicy: string;
}

interface SLAStatus {
  target: string;
  timeRemaining: number; // in minutes
  percentRemaining: number;
  breached: boolean;
}

interface Message {
  id: string;
  sender: string;
  senderType: 'customer' | 'agent' | 'system';
  timestamp: string;
  channel: 'email' | 'web' | 'call' | 'chat';
  body: string;
  isInternal: boolean;
  attachments?: { name: string; url: string }[];
}

interface Requester {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  previousTickets: number;
  avgCSAT: number;
}

interface ActivityEvent {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  details: string;
}

const SAMPLE_TICKET: Ticket = {
  id: '1',
  ticketNumber: 'TKT-2024-00456',
  subject: 'Unable to access procurement module after recent update',
  status: 'open',
  priority: 'high',
  category: 'Technical Issue',
  subcategory: 'Module Access',
  source: 'Email',
  type: 'Incident',
  tags: ['Procurement', 'Access', 'Urgent'],
  assignee: 'Rajesh Kumar',
  team: 'Technical Support',
  queue: 'L2 - Application',
  createdAt: '2024-06-23T09:30:00',
  updatedAt: '2024-06-23T10:15:00',
  firstResponseSLA: {
    target: '1 hour',
    timeRemaining: 35,
    percentRemaining: 58,
    breached: false,
  },
  resolutionSLA: {
    target: '4 hours',
    timeRemaining: 195,
    percentRemaining: 81,
    breached: false,
  },
  slaPolicy: 'Standard Business Hours (9 AM - 6 PM)',
};

const SAMPLE_REQUESTER: Requester = {
  id: '1',
  name: 'Amit Patel',
  email: 'amit.patel@pmcgov.in',
  phone: '+91 98765 43210',
  avatar: 'AP',
  previousTickets: 12,
  avgCSAT: 4.5,
};

const SAMPLE_MESSAGES: Message[] = [
  {
    id: '1',
    sender: 'Amit Patel',
    senderType: 'customer',
    timestamp: '2024-06-23T09:30:00',
    channel: 'email',
    body: 'Hello, I am unable to access the procurement module since this morning. After logging in, when I click on "Purchase Orders", I get an error message saying "Access Denied - Contact Administrator". This is urgent as I need to approve pending POs today.',
    isInternal: false,
  },
  {
    id: '2',
    sender: 'Rajesh Kumar',
    senderType: 'agent',
    timestamp: '2024-06-23T09:45:00',
    channel: 'web',
    body: 'Hi Amit, thank you for reporting this. I can see you were able to access this module yesterday. Let me check the recent permission changes and system updates. I will get back to you within 30 minutes.',
    isInternal: false,
  },
  {
    id: '3',
    sender: 'Rajesh Kumar',
    senderType: 'agent',
    timestamp: '2024-06-23T10:00:00',
    channel: 'web',
    body: 'Internal note: Checked with DevOps - deployment happened at 8 AM today. Need to verify if role mappings were affected. Escalating to L3.',
    isInternal: true,
  },
  {
    id: '4',
    sender: 'Rajesh Kumar',
    senderType: 'agent',
    timestamp: '2024-06-23T10:15:00',
    channel: 'web',
    body: 'Update: I have identified the issue. During the deployment this morning, the role mapping cache was cleared. I am re-syncing your permissions now. You should be able to access the procurement module in the next 5 minutes. Please try logging out and logging back in.',
    isInternal: false,
  },
];

const SAMPLE_ACTIVITY: ActivityEvent[] = [
  { id: '5', timestamp: '2024-06-23T10:15:00', action: 'Reply Added', user: 'Rajesh Kumar', details: 'Agent replied to customer' },
  { id: '4', timestamp: '2024-06-23T10:00:00', action: 'Internal Note', user: 'Rajesh Kumar', details: 'Added internal note about investigation' },
  { id: '3', timestamp: '2024-06-23T09:50:00', action: 'Priority Changed', user: 'Rajesh Kumar', details: 'Changed from Medium to High' },
  { id: '2', timestamp: '2024-06-23T09:45:00', action: 'Reply Added', user: 'Rajesh Kumar', details: 'First response sent' },
  { id: '1', timestamp: '2024-06-23T09:30:00', action: 'Ticket Created', user: 'Amit Patel', details: 'Ticket created via email' },
];

const CANNED_RESPONSES = [
  { id: '1', title: 'Thank you for contacting', body: 'Thank you for contacting support. We are looking into your issue and will get back to you shortly.' },
  { id: '2', title: 'Issue resolved', body: 'Your issue has been resolved. Please verify and let us know if you need any further assistance.' },
  { id: '3', title: 'Escalating to L3', body: 'We are escalating your ticket to our specialist team for further investigation.' },
];

export function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ticket] = useState<Ticket>(SAMPLE_TICKET);
  const [messages] = useState<Message[]>(SAMPLE_MESSAGES);
  const [requester] = useState<Requester>(SAMPLE_REQUESTER);
  const [activity] = useState<ActivityEvent[]>(SAMPLE_ACTIVITY);
  const [replyMode, setReplyMode] = useState<'reply' | 'internal' | null>(null);
  const [replyText, setReplyText] = useState('');
  const [showCannedResponses, setShowCannedResponses] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [isSubjectEditing, setIsSubjectEditing] = useState(false);
  const [subject, setSubject] = useState(ticket.subject);

  const getStatusBadge = (status: Ticket['status']) => {
    const config = {
      open: { intent: 'primary' as const, label: 'Open' },
      pending: { intent: 'warning' as const, label: 'Pending' },
      on_hold: { intent: 'neutral' as const, label: 'On Hold' },
      resolved: { intent: 'success' as const, label: 'Resolved' },
      closed: { intent: 'neutral' as const, label: 'Closed' },
    };
    return config[status];
  };

  const getPriorityBadge = (priority: Ticket['priority']) => {
    const config = {
      low: { intent: 'neutral' as const, label: 'Low' },
      medium: { intent: 'info' as const, label: 'Medium' },
      high: { intent: 'warning' as const, label: 'High' },
      critical: { intent: 'danger' as const, label: 'Critical' },
    };
    return config[priority];
  };

  const getSLAIntent = (sla: SLAStatus): 'success' | 'warning' | 'danger' => {
    if (sla.breached) return 'danger';
    if (sla.percentRemaining < 10) return 'danger';
    if (sla.percentRemaining < 25) return 'warning';
    return 'success';
  };

  const formatTimeRemaining = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const handleSendReply = (closeTicket: boolean = false) => {
    console.log('Sending reply:', replyText, 'Close:', closeTicket, 'Internal:', replyMode === 'internal');
    setReplyText('');
    setReplyMode(null);
  };

  const statusBadge = getStatusBadge(ticket.status);
  const priorityBadge = getPriorityBadge(ticket.priority);

  return (
    <div className="h-screen flex bg-surface-canvas">
      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 p-6 md:p-8 bg-surface-raised border-b-2 border-border-subtle">
          <div className="flex items-start gap-4 mb-4">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<ArrowLeft />}
              onClick={() => navigate('/app/helpdesk/tickets')}
            >
              Back
            </Button>
            <div className="flex-1 min-w-0">
              {isSubjectEditing ? (
                <Input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  onBlur={() => setIsSubjectEditing(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setIsSubjectEditing(false);
                  }}
                  className="w-full text-h2 bg-transparent border-b-2 border-intent-primary"
                  autoFocus
                />
              ) : (
                <h1
                  className="text-h2 cursor-pointer hover:text-intent-primary transition-colors"
                  onClick={() => setIsSubjectEditing(true)}
                  title="Click to edit"
                >
                  {subject}
                </h1>
              )}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-body-sm text-text-muted font-mono">{ticket.ticketNumber}</span>
                <Badge intent={statusBadge.intent}>{statusBadge.label}</Badge>
                <Badge intent={priorityBadge.intent}>{priorityBadge.label}</Badge>
              </div>
            </div>
          </div>

          {/* SLA Badges */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-caption text-text-muted mb-1">First Response SLA</div>
                <div className="flex items-center gap-2">
                  <Badge
                    intent={getSLAIntent(ticket.firstResponseSLA)}
                    className="font-mono"
                  >
                    {ticket.firstResponseSLA.breached ? (
                      <>Breached</>
                    ) : (
                      <>{formatTimeRemaining(ticket.firstResponseSLA.timeRemaining)} left ({ticket.firstResponseSLA.percentRemaining}%)</>
                    )}
                  </Badge>
                  {!ticket.firstResponseSLA.breached && (
                    <div className="w-24 h-2 bg-surface-sunken rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full bg-intent-${getSLAIntent(ticket.firstResponseSLA)}`}
                        style={{ width: `${ticket.firstResponseSLA.percentRemaining}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div>
                <div className="text-caption text-text-muted mb-1">Resolution SLA</div>
                <div className="flex items-center gap-2">
                  <Badge
                    intent={getSLAIntent(ticket.resolutionSLA)}
                    className="font-mono"
                  >
                    {ticket.resolutionSLA.breached ? (
                      <>Breached</>
                    ) : (
                      <>{formatTimeRemaining(ticket.resolutionSLA.timeRemaining)} left ({ticket.resolutionSLA.percentRemaining}%)</>
                    )}
                  </Badge>
                  {!ticket.resolutionSLA.breached && (
                    <div className="w-24 h-2 bg-surface-sunken rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full bg-intent-${getSLAIntent(ticket.resolutionSLA)}`}
                        style={{ width: `${ticket.resolutionSLA.percentRemaining}%` }}
                        aria-live="polite"
                        aria-label={`${ticket.resolutionSLA.percentRemaining}% of resolution time remaining`}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={() => setReplyMode('reply')} leadingIcon={<Send />}>
              Reply
            </Button>
            <Button onClick={() => setReplyMode('internal')} variant="secondary" leadingIcon={<Lock />}>
              Internal Note
            </Button>
            <Button variant="secondary">
              Resolve
            </Button>
            <div className="relative ml-auto">
              <Button variant="secondary" size="sm" leadingIcon={<MoreVertical />}>
                More
              </Button>
            </div>
            <Button variant="secondary" size="sm" leadingIcon={<Printer />}>
              Print
            </Button>
          </div>
        </div>

        {/* Conversation Thread */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          {/* Reply Composer (at top, collapsible) */}
          <AnimatePresence>
            {replyMode && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Card className={replyMode === 'internal' ? 'bg-intent-warning-bg border-2 border-intent-warning-border' : ''}>
                  {replyMode === 'internal' && (
                    <div className="flex items-center gap-2 mb-4 text-intent-warning">
                      <Lock className="size-5" />
                      <span className="font-semibold">Internal Note (Not visible to customer)</span>
                    </div>
                  )}
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={replyMode === 'internal' ? 'Add internal note...' : 'Type your reply...'}
                    rows={6}
                    className="mb-4"
                  />
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <button className="p-2 hover:bg-surface-sunken rounded transition-colors" title="Attach files">
                        <Paperclip className="size-5 text-text-secondary" />
                      </button>
                      <div className="relative">
                        <button
                          onClick={() => setShowCannedResponses(!showCannedResponses)}
                          className="px-3 py-1.5 text-body-sm text-intent-primary hover:bg-intent-primary-bg rounded transition-colors"
                        >
                          Canned Responses
                        </button>
                        {showCannedResponses && (
                          <div className="absolute top-full left-0 mt-2 w-64 bg-surface-raised border-2 border-border-default rounded-lg shadow-lg p-2 z-10">
                            {CANNED_RESPONSES.map((response) => (
                              <button
                                key={response.id}
                                onClick={() => {
                                  setReplyText(response.body);
                                  setShowCannedResponses(false);
                                }}
                                className="w-full text-left px-3 py-2 text-body-sm text-text-primary hover:bg-surface-sunken rounded transition-colors"
                              >
                                {response.title}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button variant="secondary" onClick={() => setReplyMode(null)}>
                        Cancel
                      </Button>
                      <Button onClick={() => handleSendReply(false)}>
                        Send
                      </Button>
                      {replyMode === 'reply' && (
                        <Button onClick={() => handleSendReply(true)}>
                          Send + Close
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages */}
          {[...messages].reverse().map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className={message.isInternal ? 'bg-intent-warning-bg border-2 border-intent-warning-border' : ''}>
                <div className="flex items-start gap-4">
                  <div className="size-10 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold flex-shrink-0">
                    {message.sender.split(' ').map((n) => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4 mb-2">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-text-primary">{message.sender}</span>
                        <Badge intent={message.senderType === 'customer' ? 'info' : 'neutral'} size="sm">
                          {message.senderType}
                        </Badge>
                        {message.isInternal && (
                          <Badge intent="warning" size="sm">
                            <Lock className="size-3 mr-1" />
                            Internal
                          </Badge>
                        )}
                        <Badge intent="neutral" size="sm">{message.channel}</Badge>
                      </div>
                      <time className="text-caption text-text-muted whitespace-nowrap">
                        {new Date(message.timestamp).toLocaleString('en-IN')}
                      </time>
                    </div>
                    <div className="text-body-sm text-text-primary whitespace-pre-wrap">{message.body}</div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Right Sidebar - Metadata */}
      <div className="flex-shrink-0 w-full md:w-[400px] bg-surface-raised border-l-2 border-border-subtle overflow-y-auto p-6 space-y-6">
        {/* Requester */}
        <Card>
          <h3 className="text-h4 mb-4">Requester</h3>
          <div className="flex items-start gap-3 mb-4">
            <div className="size-12 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white font-semibold">
              {requester.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-text-primary">{requester.name}</h4>
              <div className="flex items-center gap-1 text-caption text-intent-warning">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={`size-3 ${i < Math.floor(requester.avgCSAT) ? 'fill-current' : ''}`} />
                ))}
                <span className="ml-1">{requester.avgCSAT}/5</span>
              </div>
            </div>
          </div>
          <dl className="space-y-2 text-body-sm">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-text-muted" />
              <a href={`mailto:${requester.email}`} className="text-intent-primary hover:underline">
                {requester.email}
              </a>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="size-4 text-text-muted" />
              <a href={`tel:${requester.phone}`} className="text-intent-primary hover:underline">
                {requester.phone}
              </a>
            </div>
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-text-muted" />
              <span className="text-text-secondary">{requester.previousTickets} previous tickets</span>
            </div>
          </dl>
        </Card>

        {/* Properties */}
        <Card>
          <h3 className="text-h4 mb-4">Properties</h3>
          <dl className="space-y-3">
            <div>
              <dt className="text-body-sm text-text-muted">Priority</dt>
              <dd className="mt-1">
                <Badge intent={priorityBadge.intent}>{priorityBadge.label}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">Category</dt>
              <dd className="text-text-primary">{ticket.category}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">Sub-category</dt>
              <dd className="text-text-primary">{ticket.subcategory}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">Source</dt>
              <dd className="text-text-primary">{ticket.source}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">Type</dt>
              <dd className="text-text-primary">{ticket.type}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">Tags</dt>
              <dd className="flex flex-wrap gap-2 mt-1">
                {ticket.tags.map((tag, index) => (
                  <Badge key={index} intent="neutral">{tag}</Badge>
                ))}
              </dd>
            </div>
          </dl>
        </Card>

        {/* Assignment */}
        <Card>
          <h3 className="text-h4 mb-4">Assignment</h3>
          <dl className="space-y-3">
            <div>
              <dt className="text-body-sm text-text-muted">Assignee</dt>
              <dd className="text-text-primary font-medium">{ticket.assignee}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">Team</dt>
              <dd className="text-text-primary">{ticket.team}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">Queue</dt>
              <dd className="text-text-primary">{ticket.queue}</dd>
            </div>
          </dl>
        </Card>

        {/* SLA Detail */}
        <Card>
          <h3 className="text-h4 mb-4">SLA Details</h3>
          <dl className="space-y-3">
            <div>
              <dt className="text-body-sm text-text-muted">SLA Policy</dt>
              <dd className="text-text-primary">{ticket.slaPolicy}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">First Response Target</dt>
              <dd className="text-text-primary">{ticket.firstResponseSLA.target}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-text-muted">Resolution Target</dt>
              <dd className="text-text-primary">{ticket.resolutionSLA.target}</dd>
            </div>
          </dl>
        </Card>

        {/* Activity Log */}
        <Card>
          <button
            onClick={() => setShowActivityLog(!showActivityLog)}
            className="w-full flex items-center justify-between text-h4 mb-4"
          >
            <span>Activity Log</span>
            {showActivityLog ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
          </button>
          <AnimatePresence>
            {showActivityLog && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-3 overflow-hidden"
              >
                {activity.map((event) => (
                  <div key={event.id} className="pb-3 border-b border-border-subtle last:border-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-body-sm font-medium text-text-primary">{event.action}</span>
                      <time className="text-caption text-text-muted whitespace-nowrap">
                        {new Date(event.timestamp).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </div>
                    <p className="text-caption text-text-secondary">{event.details}</p>
                    <p className="text-caption text-text-muted">by {event.user}</p>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>
    </div>
  );
}
