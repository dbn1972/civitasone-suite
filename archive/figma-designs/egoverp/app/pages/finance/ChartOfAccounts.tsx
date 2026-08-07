import { useState } from 'react';
import { Card, Button, Input, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import { Plus, Download, Upload, Search, ChevronRight, ChevronDown, Eye, Edit, PlusCircle, Ban } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Account {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  currency: string;
  balance: number;
  isGroup: boolean;
  status: 'active' | 'inactive';
  children?: Account[];
  level: number;
}

const SAMPLE_ACCOUNTS: Account[] = [
  {
    id: '1',
    code: '1000',
    name: 'Assets',
    type: 'asset',
    currency: 'INR',
    balance: 12500000,
    isGroup: true,
    status: 'active',
    level: 0,
    children: [
      {
        id: '1-1',
        code: '1100',
        name: 'Current Assets',
        type: 'asset',
        currency: 'INR',
        balance: 8500000,
        isGroup: true,
        status: 'active',
        level: 1,
        children: [
          { id: '1-1-1', code: '1110', name: 'Cash and Bank', type: 'asset', currency: 'INR', balance: 5000000, isGroup: false, status: 'active', level: 2 },
          { id: '1-1-2', code: '1120', name: 'Accounts Receivable', type: 'asset', currency: 'INR', balance: 3500000, isGroup: false, status: 'active', level: 2 },
        ],
      },
      {
        id: '1-2',
        code: '1200',
        name: 'Fixed Assets',
        type: 'asset',
        currency: 'INR',
        balance: 4000000,
        isGroup: true,
        status: 'active',
        level: 1,
        children: [
          { id: '1-2-1', code: '1210', name: 'Land and Buildings', type: 'asset', currency: 'INR', balance: 3000000, isGroup: false, status: 'active', level: 2 },
          { id: '1-2-2', code: '1220', name: 'Equipment', type: 'asset', currency: 'INR', balance: 1000000, isGroup: false, status: 'active', level: 2 },
        ],
      },
    ],
  },
  {
    id: '2',
    code: '2000',
    name: 'Liabilities',
    type: 'liability',
    currency: 'INR',
    balance: 3500000,
    isGroup: true,
    status: 'active',
    level: 0,
    children: [
      {
        id: '2-1',
        code: '2100',
        name: 'Current Liabilities',
        type: 'liability',
        currency: 'INR',
        balance: 2000000,
        isGroup: true,
        status: 'active',
        level: 1,
        children: [
          { id: '2-1-1', code: '2110', name: 'Accounts Payable', type: 'liability', currency: 'INR', balance: 1500000, isGroup: false, status: 'active', level: 2 },
          { id: '2-1-2', code: '2120', name: 'Tax Payable', type: 'liability', currency: 'INR', balance: 500000, isGroup: false, status: 'active', level: 2 },
        ],
      },
    ],
  },
  {
    id: '3',
    code: '3000',
    name: 'Equity',
    type: 'equity',
    currency: 'INR',
    balance: 9000000,
    isGroup: true,
    status: 'active',
    level: 0,
    children: [
      { id: '3-1', code: '3100', name: 'Capital', type: 'equity', currency: 'INR', balance: 9000000, isGroup: false, status: 'active', level: 1 },
    ],
  },
  {
    id: '4',
    code: '4000',
    name: 'Income',
    type: 'income',
    currency: 'INR',
    balance: 15000000,
    isGroup: true,
    status: 'active',
    level: 0,
    children: [
      { id: '4-1', code: '4100', name: 'Revenue', type: 'income', currency: 'INR', balance: 15000000, isGroup: false, status: 'active', level: 1 },
    ],
  },
  {
    id: '5',
    code: '5000',
    name: 'Expenses',
    type: 'expense',
    currency: 'INR',
    balance: 6000000,
    isGroup: true,
    status: 'active',
    level: 0,
    children: [
      {
        id: '5-1',
        code: '5100',
        name: 'Operating Expenses',
        type: 'expense',
        currency: 'INR',
        balance: 6000000,
        isGroup: true,
        status: 'active',
        level: 1,
        children: [
          { id: '5-1-1', code: '5110', name: 'Salaries', type: 'expense', currency: 'INR', balance: 4000000, isGroup: false, status: 'active', level: 2 },
          { id: '5-1-2', code: '5120', name: 'Utilities', type: 'expense', currency: 'INR', balance: 500000, isGroup: false, status: 'active', level: 2 },
          { id: '5-1-3', code: '5130', name: 'Office Supplies', type: 'expense', currency: 'INR', balance: 1500000, isGroup: false, status: 'active', level: 2 },
        ],
      },
    ],
  },
];

export function ChartOfAccounts() {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set(['1', '2', '3', '4', '5']));
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const renderAccountRows = (accounts: Account[]): React.ReactNode => {
    return accounts.map((account) => {
      const isExpanded = expandedRows.has(account.id);
      const hasChildren = account.children && account.children.length > 0;

      return (
        <React.Fragment key={account.id}>
          <AccountRow
            account={account}
            isExpanded={isExpanded}
            hasChildren={hasChildren}
            onToggle={() => toggleRow(account.id)}
            onView={() => setSelectedAccount(account)}
            density={density}
          />
          {hasChildren && isExpanded && renderAccountRows(account.children!)}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Breadcrumb */}
      <nav className="text-body-sm text-text-muted" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          <li><a href="/app/finance" className="hover:text-text-primary">Finance</a></li>
          <li><ChevronRight className="size-4" /></li>
          <li className="text-text-primary">Chart of Accounts</li>
        </ol>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 mb-2">Chart of Accounts</h1>
          <p className="text-text-secondary">Hierarchical view of all financial accounts</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" leadingIcon={<Upload />}>
            Import
          </Button>
          <Button leadingIcon={<Plus />}>
            New Account
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <Card>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[250px] max-w-md">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
                <Input
                  id="search-accounts"
                  placeholder="Search by code or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                />
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="asset">Asset</SelectItem>
                  <SelectItem value="liability">Liability</SelectItem>
                  <SelectItem value="equity">Equity</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 px-1 py-1 bg-surface-sunken rounded-lg">
                <Button
                  onClick={() => setDensity('comfortable')}
                  variant={density === 'comfortable' ? 'default' : 'ghost'}
                  size="sm"
                >
                  Comfortable
                </Button>
                <Button
                  onClick={() => setDensity('compact')}
                  variant={density === 'compact' ? 'default' : 'ghost'}
                  size="sm"
                >
                  Compact
                </Button>
              </div>

              <Button variant="secondary" size="sm" leadingIcon={<Download />}>
                Export
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Tree Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full" role="treegrid">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                <th className={`px-4 text-start text-body-sm font-semibold text-text-primary ${density === 'comfortable' ? 'py-4' : 'py-2'}`}>
                  Code
                </th>
                <th className={`px-4 text-start text-body-sm font-semibold text-text-primary ${density === 'comfortable' ? 'py-4' : 'py-2'}`}>
                  Name
                </th>
                <th className={`px-4 text-start text-body-sm font-semibold text-text-primary ${density === 'comfortable' ? 'py-4' : 'py-2'}`}>
                  Type
                </th>
                <th className={`px-4 text-start text-body-sm font-semibold text-text-primary ${density === 'comfortable' ? 'py-4' : 'py-2'}`}>
                  Currency
                </th>
                <th className={`px-4 text-end text-body-sm font-semibold text-text-primary ${density === 'comfortable' ? 'py-4' : 'py-2'}`}>
                  Balance
                </th>
                <th className={`px-4 text-start text-body-sm font-semibold text-text-primary ${density === 'comfortable' ? 'py-4' : 'py-2'}`}>
                  Status
                </th>
                <th className={`px-4 text-start text-body-sm font-semibold text-text-primary ${density === 'comfortable' ? 'py-4' : 'py-2'}`}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {renderAccountRows(SAMPLE_ACCOUNTS)}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail Drawer */}
      <AnimatePresence>
        {selectedAccount && (
          <AccountDetailDrawer account={selectedAccount} onClose={() => setSelectedAccount(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function AccountRow({
  account,
  isExpanded,
  hasChildren,
  onToggle,
  onView,
  density,
}: {
  account: Account;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onView: () => void;
  density: 'comfortable' | 'compact';
}) {
  const padding = density === 'comfortable' ? 'py-4' : 'py-2';
  const indentSize = account.level * 24;

  const typeColors = {
    asset: 'intent-info',
    liability: 'intent-danger',
    equity: 'intent-primary',
    income: 'intent-success',
    expense: 'intent-warning',
  };

  return (
    <tr
      className="hover:bg-surface-sunken transition-colors"
      role="row"
      aria-level={account.level + 1}
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <td className={`px-4 ${padding}`}>
        <div className="flex items-center" style={{ paddingLeft: `${indentSize}px` }}>
          {hasChildren && (
            <Button
              onClick={onToggle}
              variant="ghost"
              size="icon"
              className="me-2 size-6 p-0"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronDown className="size-4 text-text-primary" />
              ) : (
                <ChevronRight className="size-4 text-text-primary" />
              )}
            </Button>
          )}
          <span className={`font-mono text-text-primary ${hasChildren ? 'font-semibold' : ''}`}>
            {account.code}
          </span>
        </div>
      </td>
      <td className={`px-4 ${padding}`}>
        <span className={`text-text-primary ${hasChildren ? 'font-semibold' : ''}`}>
          {account.name}
        </span>
      </td>
      <td className={`px-4 ${padding}`}>
        <Badge intent={typeColors[account.type] as any} size="sm">
          {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
        </Badge>
      </td>
      <td className={`px-4 ${padding}`}>
        <span className="font-mono text-text-secondary text-body-sm">{account.currency}</span>
      </td>
      <td className={`px-4 ${padding} text-end`}>
        <span className="font-mono text-text-primary">
          {account.balance.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
        </span>
      </td>
      <td className={`px-4 ${padding}`}>
        <Badge intent={account.status === 'active' ? 'success' : 'neutral'} size="sm">
          {account.status}
        </Badge>
      </td>
      <td className={`px-4 ${padding}`}>
        <div className="flex items-center gap-2">
          <Button
            onClick={onView}
            variant="ghost"
            size="icon"
            className="size-7"
            title="View details"
          >
            <Eye className="size-4 text-text-secondary" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" title="Edit account">
            <Edit className="size-4 text-text-secondary" />
          </Button>
          {account.isGroup && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title="Add child account"
            >
              <PlusCircle className="size-4 text-text-secondary" />
            </Button>
          )}
          {!account.isGroup && (
            <Button variant="ghost" size="icon" className="size-7" title="Deactivate">
              <Ban className="size-4 text-intent-danger" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function AccountDetailDrawer({ account, onClose }: { account: Account; onClose: () => void }) {
  const recentEntries = [
    { date: '2024-05-23', ref: 'JE-2024-045', description: 'Payment received from vendor', debit: 50000, credit: 0 },
    { date: '2024-05-22', ref: 'JE-2024-044', description: 'Office supplies purchase', debit: 0, credit: 15000 },
    { date: '2024-05-21', ref: 'JE-2024-043', description: 'Salary payment', debit: 0, credit: 200000 },
  ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25 }}
        className="fixed top-0 end-0 bottom-0 w-full max-w-2xl bg-surface-raised shadow-2xl z-50 overflow-y-auto"
      >
        <div className="sticky top-0 bg-surface-raised border-b-2 border-border-subtle p-6 flex items-center justify-between">
          <div>
            <h2 className="text-h3">{account.name}</h2>
            <p className="text-body-sm font-mono text-text-muted">{account.code}</p>
          </div>
          <Button
            onClick={onClose}
            variant="ghost"
            size="icon"
            className="size-8"
          >
            ×
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Account Details */}
          <Card>
            <h3 className="text-h4 mb-4">Account Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-body-sm text-text-muted mb-1">Account Type</div>
                <Badge intent="info">{account.type}</Badge>
              </div>
              <div>
                <div className="text-body-sm text-text-muted mb-1">Status</div>
                <Badge intent={account.status === 'active' ? 'success' : 'neutral'}>{account.status}</Badge>
              </div>
              <div>
                <div className="text-body-sm text-text-muted mb-1">Currency</div>
                <div className="text-base font-mono text-text-primary">{account.currency}</div>
              </div>
              <div>
                <div className="text-body-sm text-text-muted mb-1">Current Balance</div>
                <div className="text-base font-mono font-semibold text-text-primary">
                  {account.balance.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                </div>
              </div>
              <div>
                <div className="text-body-sm text-text-muted mb-1">Account Nature</div>
                <div className="text-base text-text-primary">{account.isGroup ? 'Group Account' : 'Leaf Account'}</div>
              </div>
            </div>
          </Card>

          {/* Recent GL Entries */}
          {!account.isGroup && (
            <Card>
              <h3 className="text-h4 mb-4">Recent GL Entries</h3>
              <div className="space-y-3">
                {recentEntries.map((entry, index) => (
                  <div key={index} className="p-3 bg-surface-sunken rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-base text-text-primary mb-1">{entry.description}</div>
                        <div className="flex items-center gap-2 text-body-sm text-text-muted">
                          <span>{entry.date}</span>
                          <span>•</span>
                          <span className="font-mono">{entry.ref}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-body-sm">
                      <div>
                        <span className="text-text-muted">Debit: </span>
                        <span className="font-mono text-text-primary">
                          {entry.debit > 0 ? `₹${entry.debit.toLocaleString('en-IN')}` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted">Credit: </span>
                        <span className="font-mono text-text-primary">
                          {entry.credit > 0 ? `₹${entry.credit.toLocaleString('en-IN')}` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="link" className="mt-4 w-full">View All Entries</Button>
            </Card>
          )}
        </div>
      </motion.div>
    </>
  );
}
