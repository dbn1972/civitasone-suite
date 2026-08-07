import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import {
  Building2,
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  TrendingDown,
  MapPin,
  Calendar,
  DollarSign,
  Eye,
  Edit,
  Wrench,
} from 'lucide-react';
import { motion } from 'motion/react';

interface Asset {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  location: string;
  assignedTo?: string;
  purchaseDate: string;
  purchaseCost: number;
  currentValue: number;
  depreciationRate: number;
  status: 'active' | 'maintenance' | 'retired' | 'disposed';
  condition: 'excellent' | 'good' | 'fair' | 'poor';
  warrantyExpiry?: string;
  lastMaintenance?: string;
  nextMaintenance?: string;
}

const SAMPLE_ASSETS: Asset[] = [
  {
    id: '1',
    assetTag: 'AST-2024-001',
    name: 'Dell Latitude 7420 Laptop',
    category: 'IT Equipment',
    location: 'Mumbai Office - 3rd Floor',
    assignedTo: 'Rajesh Kumar',
    purchaseDate: '2024-01-15',
    purchaseCost: 85000,
    currentValue: 59500,
    depreciationRate: 30,
    status: 'active',
    condition: 'good',
    warrantyExpiry: '2027-01-15',
    lastMaintenance: '2026-04-10',
    nextMaintenance: '2026-10-10',
  },
  {
    id: '2',
    assetTag: 'AST-2022-045',
    name: 'Toyota Innova - MH02AB1234',
    category: 'Vehicles',
    location: 'Mumbai Office - Parking',
    assignedTo: 'Transport Pool',
    purchaseDate: '2022-06-20',
    purchaseCost: 1800000,
    currentValue: 1080000,
    depreciationRate: 20,
    status: 'maintenance',
    condition: 'good',
    lastMaintenance: '2026-05-15',
    nextMaintenance: '2026-06-15',
  },
  {
    id: '3',
    assetTag: 'AST-2023-089',
    name: 'Conference Room Projector',
    category: 'Office Equipment',
    location: 'Bangalore Office - Conference Room A',
    purchaseDate: '2023-03-10',
    purchaseCost: 65000,
    currentValue: 45500,
    depreciationRate: 15,
    status: 'active',
    condition: 'excellent',
    warrantyExpiry: '2026-03-10',
    lastMaintenance: '2026-03-01',
    nextMaintenance: '2026-09-01',
  },
  {
    id: '4',
    assetTag: 'AST-2020-012',
    name: 'Server - IBM x3650',
    category: 'IT Infrastructure',
    location: 'Data Center - Mumbai',
    purchaseDate: '2020-08-15',
    purchaseCost: 450000,
    currentValue: 135000,
    depreciationRate: 35,
    status: 'active',
    condition: 'fair',
    lastMaintenance: '2026-05-01',
    nextMaintenance: '2026-08-01',
  },
  {
    id: '5',
    assetTag: 'AST-2019-078',
    name: 'Xerox Printer - WorkCentre 5875',
    category: 'Office Equipment',
    location: 'Delhi Office - Admin Block',
    purchaseDate: '2019-11-20',
    purchaseCost: 180000,
    currentValue: 36000,
    depreciationRate: 40,
    status: 'retired',
    condition: 'poor',
    lastMaintenance: '2025-11-20',
  },
];

export function AssetManagement() {
  const [assets, setAssets] = useState<Asset[]>(SAMPLE_ASSETS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      asset.assetTag.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (asset.assignedTo && asset.assignedTo.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === 'all' || asset.category === selectedCategory;
    const matchesStatus = selectedStatus === 'all' || asset.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const stats = {
    totalAssets: assets.length,
    totalValue: assets.reduce((sum, asset) => sum + asset.currentValue, 0),
    active: assets.filter((a) => a.status === 'active').length,
    maintenance: assets.filter((a) => a.status === 'maintenance').length,
  };

  const getStatusConfig = (status: Asset['status']) => {
    const configs = {
      active: { label: 'Active', variant: 'success' as const },
      maintenance: { label: 'Maintenance', variant: 'warning' as const },
      retired: { label: 'Retired', variant: 'default' as const },
      disposed: { label: 'Disposed', variant: 'danger' as const },
    };
    return configs[status];
  };

  const getConditionBadge = (condition: Asset['condition']) => {
    const variants = {
      excellent: 'success' as const,
      good: 'info' as const,
      fair: 'warning' as const,
      poor: 'danger' as const,
    };
    return variants[condition];
  };

  const calculateDepreciation = (purchaseCost: number, currentValue: number) => {
    const depreciation = purchaseCost - currentValue;
    const percentage = ((depreciation / purchaseCost) * 100).toFixed(1);
    return { amount: depreciation, percentage };
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Asset Management</h1>
          <p className="text-body-sm text-text-secondary">
            Track assets, depreciation, maintenance schedules, and compliance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" leadingIcon={<Wrench />}>
            Schedule Maintenance
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Upload />}>
            Import
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Download />}>
            Export
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Plus />}>
            Add Asset
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Assets</p>
                <p className="text-h2">{stats.totalAssets}</p>
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
                <p className="text-caption text-text-muted mb-1">Current Value</p>
                <p className="text-h2">₹{(stats.totalValue / 100000).toFixed(1)}L</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <DollarSign className="size-6 text-intent-primary" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Active Assets</p>
                <p className="text-h2">{stats.active}</p>
              </div>
              <div className="size-12 bg-intent-success-bg rounded-lg flex items-center justify-center">
                <Building2 className="size-6 text-intent-success" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">In Maintenance</p>
                <p className="text-h2">{stats.maintenance}</p>
              </div>
              <div className="size-12 bg-intent-warning-bg rounded-lg flex items-center justify-center">
                <Wrench className="size-6 text-intent-warning" />
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
                placeholder="Search by asset tag, name, or assignee..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="IT Equipment">IT Equipment</SelectItem>
                <SelectItem value="Vehicles">Vehicles</SelectItem>
                <SelectItem value="Office Equipment">Office Equipment</SelectItem>
                <SelectItem value="IT Infrastructure">IT Infrastructure</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
                <SelectItem value="disposed">Disposed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="md" leadingIcon={<Filter />}>
              More Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Assets Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredAssets.map((asset, index) => {
          const statusConfig = getStatusConfig(asset.status);
          const depreciation = calculateDepreciation(asset.purchaseCost, asset.currentValue);

          return (
            <motion.div
              key={asset.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="p-6 hover:shadow-[var(--shadow-md)] transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3">
                    <div className="size-12 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center text-white font-semibold flex-shrink-0">
                      <Building2 className="size-6" />
                    </div>
                    <div>
                      <h3 className="text-h4 mb-1">{asset.name}</h3>
                      <p className="text-caption text-text-muted">{asset.assetTag} • {asset.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                    <Badge variant={getConditionBadge(asset.condition)}>{asset.condition}</Badge>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                    <MapPin className="size-4" />
                    {asset.location}
                  </div>
                  {asset.assignedTo && (
                    <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                      Assigned to: {asset.assignedTo}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                    <Calendar className="size-4" />
                    Purchased: {new Date(asset.purchaseDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-border-subtle">
                  <div>
                    <p className="text-caption text-text-muted mb-1">Purchase Cost</p>
                    <p className="text-body-sm font-semibold text-text-primary">₹{asset.purchaseCost.toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <p className="text-caption text-text-muted mb-1">Current Value</p>
                    <p className="text-body-sm font-semibold text-text-primary">₹{asset.currentValue.toLocaleString('en-IN')}</p>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-caption text-text-muted">Depreciation</span>
                    <span className="text-caption font-semibold text-intent-danger flex items-center gap-1">
                      <TrendingDown className="size-3" />
                      {depreciation.percentage}%
                    </span>
                  </div>
                  <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                    <div
                      className="h-full bg-intent-danger rounded-full"
                      style={{ width: `${depreciation.percentage}%` }}
                    />
                  </div>
                </div>

                {asset.nextMaintenance && (
                  <div className="mb-4 p-3 bg-intent-warning-bg rounded-lg">
                    <div className="flex items-center gap-2">
                      <Wrench className="size-4 text-intent-warning" />
                      <div>
                        <p className="text-caption font-medium text-text-primary">Next Maintenance</p>
                        <p className="text-caption text-text-muted">
                          {new Date(asset.nextMaintenance).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
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

      {filteredAssets.length === 0 && (
        <Card className="p-12">
          <div className="text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <Building2 className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No assets found</h3>
            <p className="text-body-sm text-text-secondary">
              {searchQuery || selectedCategory !== 'all' || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Add your first asset to get started'}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
