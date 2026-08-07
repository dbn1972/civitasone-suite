import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  Users,
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  Mail,
  Phone,
  MapPin,
  Building2,
  Star,
  Calendar,
  DollarSign,
  Eye,
  Edit,
  MoreVertical,
} from 'lucide-react';
import { motion } from 'motion/react';

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  designation: string;
  location: string;
  status: 'lead' | 'prospect' | 'customer' | 'partner' | 'inactive';
  tags: string[];
  dealValue: number;
  lastContact: string;
  source: string;
  rating: number;
  assignedTo: string;
  createdDate: string;
}

const SAMPLE_CONTACTS: Contact[] = [
  {
    id: '1',
    name: 'Rajesh Kumar',
    email: 'rajesh.kumar@techcorp.in',
    phone: '+91-98765-43210',
    company: 'Tech Corp India',
    designation: 'CTO',
    location: 'Mumbai, Maharashtra',
    status: 'customer',
    tags: ['Enterprise', 'IT Services'],
    dealValue: 2500000,
    lastContact: '2026-05-22T14:30:00Z',
    source: 'Referral',
    rating: 5,
    assignedTo: 'Priya Sharma',
    createdDate: '2025-08-15',
  },
  {
    id: '2',
    name: 'Anita Desai',
    email: 'anita.d@globalenterprise.com',
    phone: '+91-99887-76654',
    company: 'Global Enterprise Solutions',
    designation: 'VP Operations',
    location: 'Bangalore, Karnataka',
    status: 'prospect',
    tags: ['Manufacturing', 'Large Enterprise'],
    dealValue: 5000000,
    lastContact: '2026-05-20T10:15:00Z',
    source: 'Website',
    rating: 4,
    assignedTo: 'Amit Patel',
    createdDate: '2026-04-10',
  },
  {
    id: '3',
    name: 'Vikram Singh',
    email: 'vikram@startupventures.in',
    phone: '+91-97654-32100',
    company: 'Startup Ventures',
    designation: 'Founder & CEO',
    location: 'Gurgaon, Haryana',
    status: 'lead',
    tags: ['Startup', 'Technology'],
    dealValue: 750000,
    lastContact: '2026-05-18T16:45:00Z',
    source: 'LinkedIn',
    rating: 3,
    assignedTo: 'Sneha Rao',
    createdDate: '2026-05-15',
  },
  {
    id: '4',
    name: 'Meera Reddy',
    email: 'meera.reddy@healthplus.org',
    phone: '+91-96543-21000',
    company: 'HealthPlus Medical',
    designation: 'Director of IT',
    location: 'Hyderabad, Telangana',
    status: 'partner',
    tags: ['Healthcare', 'Government'],
    dealValue: 1800000,
    lastContact: '2026-05-21T09:00:00Z',
    source: 'Conference',
    rating: 5,
    assignedTo: 'Priya Sharma',
    createdDate: '2024-11-20',
  },
  {
    id: '5',
    name: 'Arjun Mehta',
    email: 'arjun.mehta@retailgroup.co.in',
    phone: '+91-95432-10987',
    company: 'Retail Group India',
    designation: 'Head of Digital',
    location: 'Delhi, Delhi',
    status: 'inactive',
    tags: ['Retail', 'E-commerce'],
    dealValue: 0,
    lastContact: '2025-12-10T11:30:00Z',
    source: 'Cold Call',
    rating: 2,
    assignedTo: 'Amit Patel',
    createdDate: '2025-09-05',
  },
];

export function CRMContacts() {
  const [contacts, setContacts] = useState<Contact[]>(SAMPLE_CONTACTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const filteredContacts = contacts.filter((contact) => {
    const matchesSearch =
      contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.company.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = selectedStatus === 'all' || contact.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: contacts.length,
    leads: contacts.filter((c) => c.status === 'lead').length,
    customers: contacts.filter((c) => c.status === 'customer').length,
    partners: contacts.filter((c) => c.status === 'partner').length,
    totalValue: contacts.reduce((sum, c) => sum + c.dealValue, 0),
  };

  const getStatusConfig = (status: Contact['status']) => {
    const configs = {
      lead: { label: 'Lead', variant: 'info' as const, color: 'intent-info' },
      prospect: { label: 'Prospect', variant: 'warning' as const, color: 'intent-warning' },
      customer: { label: 'Customer', variant: 'success' as const, color: 'intent-success' },
      partner: { label: 'Partner', variant: 'default' as const, color: 'intent-primary' },
      inactive: { label: 'Inactive', variant: 'default' as const, color: 'text-muted' },
    };
    return configs[status];
  };

  const getRatingStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        className={`size-4 ${i < rating ? 'fill-intent-warning text-intent-warning' : 'text-text-muted'}`}
      />
    ));
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Contacts</h1>
          <p className="text-body-sm text-text-secondary">
            Manage customer relationships, leads, and business contacts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" leadingIcon={<Upload />}>
            Import
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Download />}>
            Export
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Plus />}>
            Add Contact
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Contacts</p>
                <p className="text-h2">{stats.total}</p>
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
                <p className="text-caption text-text-muted mb-1">Active Leads</p>
                <p className="text-h2">{stats.leads}</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <Users className="size-6 text-intent-warning" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Customers</p>
                <p className="text-h2">{stats.customers}</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <Users className="size-6 text-intent-success" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Partners</p>
                <p className="text-h2">{stats.partners}</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <Users className="size-6 text-intent-primary" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Pipeline Value</p>
                <p className="text-h2">₹{(stats.totalValue / 100000).toFixed(1)}L</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <DollarSign className="size-6 text-intent-success" />
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Filters and View Toggle */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                type="text"
                placeholder="Search by name, email, or company..."
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
                <SelectItem value="lead">Leads</SelectItem>
                <SelectItem value="prospect">Prospects</SelectItem>
                <SelectItem value="customer">Customers</SelectItem>
                <SelectItem value="partner">Partners</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="md" leadingIcon={<Filter />}>
              More Filters
            </Button>
            <div className="flex bg-surface-sunken rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded-lg text-body-sm font-medium transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-surface-raised text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-lg text-body-sm font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-surface-raised text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                List
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Contacts Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContacts.map((contact, index) => {
            const statusConfig = getStatusConfig(contact.status);

            return (
              <motion.div
                key={contact.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3">
                      <div className="size-12 bg-gradient-to-br from-brand-primary to-brand-accent rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
                        {contact.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-h4 mb-1">{contact.name}</h3>
                        <p className="text-caption text-text-muted">{contact.designation}</p>
                      </div>
                    </div>
                    <button className="p-2 hover:bg-surface-sunken rounded-lg transition-colors">
                      <MoreVertical className="size-4 text-text-muted" />
                    </button>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                      <Building2 className="size-4" />
                      {contact.company}
                    </div>
                    <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                      <Mail className="size-4" />
                      {contact.email}
                    </div>
                    <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                      <Phone className="size-4" />
                      {contact.phone}
                    </div>
                    <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                      <MapPin className="size-4" />
                      {contact.location}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                    {contact.tags.map((tag) => (
                      <Badge key={tag} variant="default">{tag}</Badge>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 mb-4">
                    {getRatingStars(contact.rating)}
                  </div>

                  {contact.dealValue > 0 && (
                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-border-subtle">
                      <span className="text-caption text-text-muted">Deal Value</span>
                      <span className="text-body-sm font-semibold text-text-primary">₹{(contact.dealValue / 100000).toFixed(1)}L</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button variant="primary" size="sm" leadingIcon={<Eye />} className="flex-1">
                      View
                    </Button>
                    <Button variant="secondary" size="sm" iconOnly>
                      <Edit />
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-sunken border-b-2 border-border-subtle">
                <tr>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Contact</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Company</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Email</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Phone</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Status</th>
                  <th className="text-left p-4 text-caption font-semibold text-text-secondary uppercase">Rating</th>
                  <th className="text-right p-4 text-caption font-semibold text-text-secondary uppercase">Deal Value</th>
                  <th className="text-center p-4 text-caption font-semibold text-text-secondary uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((contact, index) => {
                  const statusConfig = getStatusConfig(contact.status);

                  return (
                    <motion.tr
                      key={contact.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="border-b border-border-subtle hover:bg-surface-sunken transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="size-10 bg-gradient-to-br from-brand-primary to-brand-accent rounded-full flex items-center justify-center text-white font-semibold text-caption">
                            {contact.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </div>
                          <div>
                            <p className="text-body-sm font-medium text-text-primary">{contact.name}</p>
                            <p className="text-caption text-text-muted">{contact.designation}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="text-body-sm text-text-primary">{contact.company}</p>
                        <p className="text-caption text-text-muted">{contact.location}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-body-sm text-text-primary">{contact.email}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-body-sm text-text-primary">{contact.phone}</p>
                      </td>
                      <td className="p-4">
                        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1">
                          {getRatingStars(contact.rating)}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <p className="text-body-sm font-semibold text-text-primary">
                          {contact.dealValue > 0 ? `₹${(contact.dealValue / 100000).toFixed(1)}L` : '—'}
                        </p>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          <Button variant="secondary" size="sm" iconOnly>
                            <Eye />
                          </Button>
                          <Button variant="secondary" size="sm" iconOnly>
                            <Edit />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {filteredContacts.length === 0 && (
        <Card className="p-12">
          <div className="text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <Users className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No contacts found</h3>
            <p className="text-body-sm text-text-secondary">
              {searchQuery || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Add your first contact to get started'}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
