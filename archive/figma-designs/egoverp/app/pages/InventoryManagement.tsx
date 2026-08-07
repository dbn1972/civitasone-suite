import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import {
  Package,
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  MapPin,
  ArrowRight,
  Eye,
  Edit,
  BarChart3,
} from 'lucide-react';
import { motion } from 'motion/react';

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  warehouse: string;
  quantity: number;
  reorderPoint: number;
  unitCost: number;
  totalValue: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'discontinued';
  lastRestocked: string;
  supplier: string;
}

const SAMPLE_INVENTORY: InventoryItem[] = [
  {
    id: '1',
    sku: 'OFF-001-2024',
    name: 'Office Chair - Ergonomic',
    category: 'Furniture',
    warehouse: 'Main Warehouse - Mumbai',
    quantity: 45,
    reorderPoint: 20,
    unitCost: 8500,
    totalValue: 382500,
    status: 'in_stock',
    lastRestocked: '2026-05-15',
    supplier: 'Acme Office Supplies',
  },
  {
    id: '2',
    sku: 'STA-045-2024',
    name: 'A4 Paper - 500 Sheets',
    category: 'Stationery',
    warehouse: 'Main Warehouse - Mumbai',
    quantity: 12,
    reorderPoint: 25,
    unitCost: 250,
    totalValue: 3000,
    status: 'low_stock',
    lastRestocked: '2026-04-10',
    supplier: 'Paper Supplies Co',
  },
  {
    id: '3',
    sku: 'IT-102-2024',
    name: 'Laptop - Dell Latitude',
    category: 'IT Equipment',
    warehouse: 'IT Storage - Bangalore',
    quantity: 0,
    reorderPoint: 5,
    unitCost: 65000,
    totalValue: 0,
    status: 'out_of_stock',
    lastRestocked: '2026-03-20',
    supplier: 'Tech Solutions India',
  },
  {
    id: '4',
    sku: 'CLN-023-2024',
    name: 'Sanitizer - 5L',
    category: 'Cleaning Supplies',
    warehouse: 'Main Warehouse - Mumbai',
    quantity: 78,
    reorderPoint: 30,
    unitCost: 450,
    totalValue: 35100,
    status: 'in_stock',
    lastRestocked: '2026-05-20',
    supplier: 'Clean Pro Industries',
  },
  {
    id: '5',
    sku: 'PRN-007-2024',
    name: 'Printer Toner - HP 305A',
    category: 'IT Consumables',
    warehouse: 'IT Storage - Bangalore',
    quantity: 18,
    reorderPoint: 15,
    unitCost: 3200,
    totalValue: 57600,
    status: 'in_stock',
    lastRestocked: '2026-05-18',
    supplier: 'Office Depot India',
  },
];

export function InventoryManagement() {
  const [inventory, setInventory] = useState<InventoryItem[]>(SAMPLE_INVENTORY);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const filteredInventory = inventory.filter((item) => {
    const matchesSearch =
      item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.supplier.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesStatus = selectedStatus === 'all' || item.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const stats = {
    totalItems: inventory.length,
    totalValue: inventory.reduce((sum, item) => sum + item.totalValue, 0),
    lowStock: inventory.filter((item) => item.status === 'low_stock').length,
    outOfStock: inventory.filter((item) => item.status === 'out_of_stock').length,
  };

  const getStatusConfig = (status: InventoryItem['status']) => {
    const configs = {
      in_stock: { label: 'In Stock', variant: 'success' as const, color: 'intent-success' },
      low_stock: { label: 'Low Stock', variant: 'warning' as const, color: 'intent-warning' },
      out_of_stock: { label: 'Out of Stock', variant: 'danger' as const, color: 'intent-danger' },
      discontinued: { label: 'Discontinued', variant: 'default' as const, color: 'text-muted' },
    };
    return configs[status];
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Inventory Management</h1>
          <p className="text-body-sm text-text-secondary">
            Track stock levels, warehouses, and inventory transfers
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" leadingIcon={<ArrowRight />}>
            Stock Transfer
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Upload />}>
            Import
          </Button>
          <Button variant="secondary" size="md" leadingIcon={<Download />}>
            Export
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Plus />}>
            Add Item
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Items</p>
                <p className="text-h2">{stats.totalItems}</p>
              </div>
              <div className="size-12 bg-intent-info-bg rounded-lg flex items-center justify-center">
                <Package className="size-6 text-intent-info" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Total Value</p>
                <p className="text-h2">₹{(stats.totalValue / 100000).toFixed(1)}L</p>
              </div>
              <div className="size-12 bg-intent-primary-bg rounded-lg flex items-center justify-center">
                <BarChart3 className="size-6 text-intent-primary" />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-caption text-text-muted mb-1">Low Stock</p>
                <p className="text-h2">{stats.lowStock}</p>
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
                <p className="text-caption text-text-muted mb-1">Out of Stock</p>
                <p className="text-h2">{stats.outOfStock}</p>
              </div>
              <div className="size-12 bg-intent-danger-bg rounded-lg flex items-center justify-center">
                <AlertTriangle className="size-6 text-intent-danger" />
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
                placeholder="Search by SKU, name, or supplier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10"
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
                <SelectItem value="Furniture">Furniture</SelectItem>
                <SelectItem value="Stationery">Stationery</SelectItem>
                <SelectItem value="IT Equipment">IT Equipment</SelectItem>
                <SelectItem value="Cleaning Supplies">Cleaning Supplies</SelectItem>
                <SelectItem value="IT Consumables">IT Consumables</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="in_stock">In Stock</SelectItem>
                <SelectItem value="low_stock">Low Stock</SelectItem>
                <SelectItem value="out_of_stock">Out of Stock</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="md" leadingIcon={<Filter />}>
              More Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Inventory Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Item</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Category</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Warehouse</th>
                <th className="text-end p-4 text-caption font-semibold text-text-secondary uppercase">Quantity</th>
                <th className="text-end p-4 text-caption font-semibold text-text-secondary uppercase">Reorder Point</th>
                <th className="text-end p-4 text-caption font-semibold text-text-secondary uppercase">Unit Cost</th>
                <th className="text-end p-4 text-caption font-semibold text-text-secondary uppercase">Total Value</th>
                <th className="text-start p-4 text-caption font-semibold text-text-secondary uppercase">Status</th>
                <th className="text-center p-4 text-caption font-semibold text-text-secondary uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.map((item, index) => {
                const statusConfig = getStatusConfig(item.status);
                const needsReorder = item.quantity <= item.reorderPoint;

                return (
                  <motion.tr
                    key={item.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="border-b border-border-subtle hover:bg-surface-sunken transition-colors"
                  >
                    <td className="p-4">
                      <div>
                        <p className="text-body-sm font-medium text-text-primary">{item.name}</p>
                        <p className="text-caption text-text-muted">{item.sku}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-body-sm text-text-primary">{item.category}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <MapPin className="size-4 text-text-muted" />
                        <p className="text-body-sm text-text-primary">{item.warehouse}</p>
                      </div>
                    </td>
                    <td className="p-4 text-end">
                      <p className={`text-body-sm font-semibold ${needsReorder ? 'text-intent-danger' : 'text-text-primary'}`}>
                        {item.quantity}
                      </p>
                    </td>
                    <td className="p-4 text-end">
                      <p className="text-body-sm text-text-muted">{item.reorderPoint}</p>
                    </td>
                    <td className="p-4 text-end">
                      <p className="text-body-sm text-text-primary">₹{item.unitCost.toLocaleString('en-IN')}</p>
                    </td>
                    <td className="p-4 text-end">
                      <p className="text-body-sm font-semibold text-text-primary">₹{item.totalValue.toLocaleString('en-IN')}</p>
                    </td>
                    <td className="p-4">
                      <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
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

        {filteredInventory.length === 0 && (
          <div className="p-12 text-center">
            <div className="size-16 bg-surface-sunken rounded-full mx-auto mb-4 flex items-center justify-center">
              <Package className="size-8 text-text-muted" />
            </div>
            <h3 className="text-h3 mb-2">No items found</h3>
            <p className="text-body-sm text-text-secondary">
              {searchQuery || selectedCategory !== 'all' || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Add your first inventory item to get started'}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
