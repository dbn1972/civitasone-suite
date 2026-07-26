import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import {
  Building2,
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  Star,
  TrendingUp,
  TrendingDown,
  MapPin,
  Phone,
  Mail,
  Calendar,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  Edit,
} from 'lucide-react';
import { motion } from 'motion/react';

interface Vendor {
  id: string;
  vendorCode: string;
  name: string;
  category: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  gstin: string;
  pan: string;
  status: 'active' | 'inactive' | 'pending' | 'blacklisted';
  rating: number;
  totalOrders: number;
  totalValue: number;
  onTimeDelivery: number;
  qualityScore: number;
  paymentTerms: string;
  registeredDate: string;
}

const SAMPLE_VENDORS: Vendor[] = [
  {
    id: '1',
    vendorCode: 'VEN-00123',
    name: 'Acme Office Supplies Pvt Ltd',
    category: 'Office Supplies',
    contactPerson: 'Rajesh Kumar',
    email: 'rajesh@acmeoffice.com',
    phone: '+91-98765-43210',
    address: '123, Business Park, Andheri East',
    city: 'Mumbai',
    state: 'Maharashtra',
    gstin: '27AAACC1234A1Z5',
    pan: 'AAACC1234A',
    status: 'active',
    rating: 4.5,
    totalOrders: 145,
    totalValue: 18500000,
    onTimeDelivery: 92,
    qualityScore: 88,
    paymentTerms: 'Net 30',
    registeredDate: '2024-01-15',
  },
  {
    id: '2',
    vendorCode: 'VEN-00456',
    name: 'Tech Solutions India Ltd',
    category: 'IT Services',
    contactPerson: 'Priya Sharma',
    email: 'priya@techsolutions.in',
    phone: '+91-98123-45678',
    address: '45, Tech Park, Whitefield',
    city: 'Bangalore',
    state: 'Karnataka',
    gstin: '29BBBCC5678B2Y6',
    pan: 'BBBCC5678B',
    status: 'active',
    rating: 4.8,
    totalOrders: 67,
    totalValue: 45000000,
    onTimeDelivery: 95,
    qualityScore: 94,
    paymentTerms: 'Net 45',
    registeredDate: '2023-06-20',
  },
  {
    id: '3',
    vendorCode: 'VEN-00789',
    name: 'Green Energy Solutions',
    category: 'Utilities',
    contactPerson: 'Amit Patel',
    email: 'amit@greenenergy.co.in',
    phone: '+91-99887-76654',
    address: '789, Industrial Area, Sector 18',
    city: 'Gurgaon',
    state: 'Haryana',
    gstin: '06CCCCC9012C3X7',
    pan: 'CCCCC9012C',
    status: 'active',
    rating: 4.2,
    totalOrders: 234,
    totalValue: 32000000,
    onTimeDelivery: 88,
    qualityScore: 85,
    paymentTerms: 'Net 15',
    registeredDate: '2022-11-10',
  },
  {
    id: '4',
    vendorCode: 'VEN-00234',
    name: 'Fleet Management Services',
    category: 'Transportation',
    contactPerson: 'Sneha Rao',
    email: 'sneha@fleetmgmt.com',
    phone: '+91-97654-32100',
    address: '34, Transport Nagar',
    city: 'Delhi',
    state: 'Delhi',
    gstin: '07DDDCC3456D4W8',
    pan: 'DDDCC3456D',
    status: 'pending',
    rating: 0,
    totalOrders: 0,
    totalValue: 0,
    onTimeDelivery: 0,
    qualityScore: 0,
    paymentTerms: 'Net 30',
    registeredDate: '2026-05-20',
  },
  {
    id: '5',
    vendorCode: 'VEN-00111',
    name: 'Supply Chain Corp',
    category: 'Logistics',
    contactPerson: 'Vikram Singh',
    email: 'vikram@supplychain.in',
    phone: '+91-96543-21000',
    address: '12, Logistics Hub, MIDC',
    city: 'Pune',
    state: 'Maharashtra',
    gstin: '27EEECC7890E5V9',
    pan: 'EEECC7890E',
    status: 'blacklisted',
    rating: 2.1,
    totalOrders: 89,
    totalValue: 12000000,
    onTimeDelivery: 65,
    qualityScore: 58,
    paymentTerms: 'Net 30',
    registeredDate: '2023-03-25',
  },
];

export function ProcurementVendors() {
  const [vendors, setVendors] = useState<Vendor[]>(SAMPLE_VENDORS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const filteredVendors = vendors.filter((vendor) => {
    const matchesSearch =
      vendor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.vendorCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.contactPerson.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'all' || vendor.category === selectedCategory;
    const matchesStatus = selectedStatus === 'all' || vendor.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const stats = {
    total: vendors.length,
    active: vendors.filter((v) => v.status === 'active').length,
    pending: vendors.filter((v) => v.status === 'pending').length,
    avgRating: vendors.filter((v) => v.rating > 0).reduce((sum, v) => sum + v.rating, 0) / vendors.filter((v) => v.rating > 0).length,
  };

  const getStatusConfig = (status: Vendor['status']) => {
    const configs = {
      active: { label: 'Active', variant: 'success' as const, icon: CheckCircle },
      inactive: { label: 'Inactive', variant: 'default' as const, icon: XCircle },
      pending: { label: 'Pending', variant: 'warning' as const, icon: AlertCircle },
      blacklisted: { label: 'Blacklisted', variant: 'danger' as const, icon: XCircle },
    };
    return configs[status];
  };

  const getRatingStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        className={`size-4 ${i < Math.floor(rating) ? 'fill-intent-warning text-intent-warning' : 'text-text-muted'}`}
      />
    ));
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Vendors</h1>
          <p className="text-body-sm text-text-secondary">
            Manage vendor relationships, performance metrics, and onboarding
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
            Add Vendor
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Vendors</p>
                <p className="text-h2">{stats.total}</p>
              </div>
              <div className="size-12 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <Building2 className="size-6 text-intent-info" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Active Vendors</p>
                <p className="text-h2">{stats.active}</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <CheckCircle className="size-6 text-intent-success" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Pending Approval</p>
                <p className="text-h2">{stats.pending}</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <AlertCircle className="size-6 text-intent-warning" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Avg Rating</p>
                <p className="text-h2">{stats.avgRating.toFixed(1)}</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <Star className="size-6 text-intent-warning" />
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
                placeholder="Search by name, code, or contact person..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="Office Supplies">Office Supplies</SelectItem>
                <SelectItem value="IT Services">IT Services</SelectItem>
                <SelectItem value="Utilities">Utilities</SelectItem>
                <SelectItem value="Transportation">Transportation</SelectItem>
                <SelectItem value="Logistics">Logistics</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="blacklisted">Blacklisted</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="md" leadingIcon={<Filter />}>
              More Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Vendors Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredVendors.map((vendor, index) => {
          const statusConfig = getStatusConfig(vendor.status);
          const StatusIcon = statusConfig.icon;

          return (
            <motion.div
              key={vendor.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4">
                    <div className="size-12 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center flex-shrink-0">
                      <Building2 className="size-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-h4 mb-1">{vendor.name}</h3>
                      <p className="text-caption text-text-muted mb-2">{vendor.vendorCode} • {vendor.category}</p>
                      {vendor.rating > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-0.5">{getRatingStars(vendor.rating)}</div>
                          <span className="text-caption text-text-muted">{vendor.rating.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant={statusConfig.variant}>
                    <StatusIcon className="size-3" />
                    {statusConfig.label}
                  </Badge>
                </div>

                <div className="space-y-3 mb-4">
                  <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                    <Phone className="size-4" />
                    {vendor.phone}
                  </div>
                  <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                    <Mail className="size-4" />
                    {vendor.email}
                  </div>
                  <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                    <MapPin className="size-4" />
                    {vendor.city}, {vendor.state}
                  </div>
                </div>

                {vendor.totalOrders > 0 && (
                  <div className="grid grid-cols-3 gap-4 mb-4 pb-4 border-b border-border-subtle">
                    <div>
                      <p className="text-caption text-text-muted mb-1">Total Orders</p>
                      <p className="text-body-sm font-semibold text-text-primary">{vendor.totalOrders}</p>
                    </div>
                    <div>
                      <p className="text-caption text-text-muted mb-1">Total Value</p>
                      <p className="text-body-sm font-semibold text-text-primary">₹{(vendor.totalValue / 100000).toFixed(1)}L</p>
                    </div>
                    <div>
                      <p className="text-caption text-text-muted mb-1">On-Time %</p>
                      <p className="text-body-sm font-semibold text-text-primary">{vendor.onTimeDelivery}%</p>
                    </div>
                  </div>
                )}

                {vendor.status === 'active' && vendor.totalOrders > 0 && (
                  <div className="space-y-2 mb-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-caption text-text-muted">On-Time Delivery</span>
                        <span className="text-caption font-semibold text-text-primary">{vendor.onTimeDelivery}%</span>
                      </div>
                      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            vendor.onTimeDelivery >= 90 ? 'bg-intent-success' : vendor.onTimeDelivery >= 70 ? 'bg-intent-warning' : 'bg-intent-danger'
                          }`}
                          style={{ width: `${vendor.onTimeDelivery}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-caption text-text-muted">Quality Score</span>
                        <span className="text-caption font-semibold text-text-primary">{vendor.qualityScore}%</span>
                      </div>
                      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            vendor.qualityScore >= 90 ? 'bg-intent-success' : vendor.qualityScore >= 70 ? 'bg-intent-warning' : 'bg-intent-danger'
                          }`}
                          style={{ width: `${vendor.qualityScore}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" leadingIcon={<Eye />} className="flex-1">
                    View Details
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

      {filteredVendors.length === 0 && (
        <Card className="p-12">
          <div className="text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <Building2 className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No vendors found</h3>
            <p className="text-body-sm text-text-secondary">
              {searchQuery || selectedCategory !== 'all' || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Add your first vendor to get started'}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
