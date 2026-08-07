import { useState } from 'react';
import { Card, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import { Plus, Search, Filter, List, LayoutGrid, User, Calendar, TrendingUp, Tag, MessageSquare, ChevronRight, X } from 'lucide-react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { motion, AnimatePresence } from 'motion/react';

interface Deal {
  id: string;
  name: string;
  value: number;
  currency: string;
  organization: string;
  orgAvatar: string;
  contact: string;
  owner: string;
  ownerAvatar: string;
  expectedCloseDate: string;
  tags: string[];
  lastActivity: string;
  activityCount: number;
  probability: number;
  stageId: string;
}

interface Stage {
  id: string;
  name: string;
  winProbability: number;
  order: number;
}

const STAGES: Stage[] = [
  { id: 'lead', name: 'Lead', winProbability: 10, order: 1 },
  { id: 'qualified', name: 'Qualified', winProbability: 25, order: 2 },
  { id: 'proposal', name: 'Proposal', winProbability: 50, order: 3 },
  { id: 'negotiation', name: 'Negotiation', winProbability: 75, order: 4 },
  { id: 'won', name: 'Won', winProbability: 100, order: 5 },
];

const SAMPLE_DEALS: Deal[] = [
  {
    id: '1',
    name: 'Municipal ERP Implementation',
    value: 12500000,
    currency: 'INR',
    organization: 'Pune Municipal Corporation',
    orgAvatar: 'PM',
    contact: 'Dr. Sharma',
    owner: 'Rajesh Kumar',
    ownerAvatar: 'RK',
    expectedCloseDate: '2024-08-15',
    tags: ['Enterprise', 'High Priority'],
    lastActivity: '2 hours ago',
    activityCount: 14,
    probability: 50,
    stageId: 'proposal',
  },
  {
    id: '2',
    name: 'HRMS Suite for State Govt',
    value: 8750000,
    currency: 'INR',
    organization: 'Maharashtra State Administration',
    orgAvatar: 'MS',
    contact: 'Mr. Patel',
    owner: 'Priya Singh',
    ownerAvatar: 'PS',
    expectedCloseDate: '2024-07-30',
    tags: ['Government', 'HRMS'],
    lastActivity: '1 day ago',
    activityCount: 22,
    probability: 75,
    stageId: 'negotiation',
  },
  {
    id: '3',
    name: 'Asset Management System',
    value: 3200000,
    currency: 'INR',
    organization: 'Nashik City Corporation',
    orgAvatar: 'NC',
    contact: 'Ms. Desai',
    owner: 'Amit Patel',
    ownerAvatar: 'AP',
    expectedCloseDate: '2024-06-30',
    tags: ['Asset', 'Medium'],
    lastActivity: '3 hours ago',
    activityCount: 8,
    probability: 25,
    stageId: 'qualified',
  },
  {
    id: '4',
    name: 'Procurement Portal POC',
    value: 1500000,
    currency: 'INR',
    organization: 'Nagpur Municipal Council',
    orgAvatar: 'NM',
    contact: 'Mr. Mehta',
    owner: 'Sneha Kumar',
    ownerAvatar: 'SK',
    expectedCloseDate: '2024-09-15',
    tags: ['POC', 'Procurement'],
    lastActivity: '5 days ago',
    activityCount: 3,
    probability: 10,
    stageId: 'lead',
  },
  {
    id: '5',
    name: 'Finance Module Upgrade',
    value: 5400000,
    currency: 'INR',
    organization: 'Thane Municipal Corporation',
    orgAvatar: 'TM',
    contact: 'Dr. Kulkarni',
    owner: 'Rajesh Kumar',
    ownerAvatar: 'RK',
    expectedCloseDate: '2024-07-20',
    tags: ['Finance', 'Upgrade'],
    lastActivity: '6 hours ago',
    activityCount: 18,
    probability: 75,
    stageId: 'negotiation',
  },
  {
    id: '6',
    name: 'Helpdesk System Implementation',
    value: 2100000,
    currency: 'INR',
    organization: 'Aurangabad City',
    orgAvatar: 'AC',
    contact: 'Ms. Joshi',
    owner: 'Amit Patel',
    ownerAvatar: 'AP',
    expectedCloseDate: '2024-08-30',
    tags: ['Helpdesk', 'Support'],
    lastActivity: '1 hour ago',
    activityCount: 11,
    probability: 50,
    stageId: 'proposal',
  },
];

const ItemTypes = {
  DEAL: 'deal',
};

function DealCard({ deal, onDragStart, onDragEnd, onClick }: {
  deal: Deal;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onClick: () => void;
}) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.DEAL,
    item: { id: deal.id, stageId: deal.stageId },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: () => {
      onDragEnd?.();
    },
  }));

  const isOverdue = new Date(deal.expectedCloseDate) < new Date();

  return (
    <motion.div
      ref={drag}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: isDragging ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className={`bg-surface-raised border-2 border-border-default rounded-lg p-4 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
        isDragging ? 'opacity-50' : ''
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick();
        }
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <h4 className="text-body-sm font-semibold text-text-primary line-clamp-2 flex-1">
          {deal.name}
        </h4>
        <div className="size-8 rounded-full bg-gradient-to-br from-brand-primary to-brand-accent flex items-center justify-center text-white text-caption font-semibold flex-shrink-0">
          {deal.ownerAvatar}
        </div>
      </div>

      {/* Value */}
      <div className="text-h4 font-bold text-intent-primary mb-3">
        {deal.value.toLocaleString('en-IN', { style: 'currency', currency: deal.currency, maximumFractionDigits: 0 })}
      </div>

      {/* Organization */}
      <div className="flex items-center gap-2 mb-3">
        <div className="size-6 rounded bg-surface-sunken flex items-center justify-center text-caption font-semibold text-text-primary">
          {deal.orgAvatar}
        </div>
        <span className="text-body-sm text-text-secondary line-clamp-1">{deal.organization}</span>
      </div>

      {/* Expected Close Date */}
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="size-4 text-text-muted" />
        <span className={`text-caption ${isOverdue ? 'text-intent-danger font-medium' : 'text-text-secondary'}`}>
          {isOverdue && '⚠️ '}
          {new Date(deal.expectedCloseDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* Tags */}
      {deal.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {deal.tags.map((tag, index) => (
            <span
              key={index}
              className="px-2 py-0.5 bg-surface-sunken text-caption text-text-primary rounded border border-border-subtle"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
        <span className="text-caption text-text-muted">{deal.lastActivity}</span>
        <div className="flex items-center gap-1 text-caption text-text-muted">
          <MessageSquare className="size-3" />
          <span>{deal.activityCount}</span>
        </div>
      </div>
    </motion.div>
  );
}

function StageColumn({ stage, deals, onDrop, onCardClick }: {
  stage: Stage;
  deals: Deal[];
  onDrop: (dealId: string, targetStageId: string) => void;
  onCardClick: (deal: Deal) => void;
}) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ItemTypes.DEAL,
    drop: (item: { id: string; stageId: string }) => {
      if (item.stageId !== stage.id) {
        onDrop(item.id, stage.id);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }));

  const totalValue = deals.reduce((sum, deal) => sum + deal.value, 0);
  const weightedValue = deals.reduce((sum, deal) => sum + (deal.value * (stage.winProbability / 100)), 0);

  return (
    <div
      ref={drop}
      className={`flex-shrink-0 w-[320px] flex flex-col ${isOver ? 'bg-intent-primary-bg/50' : ''}`}
      role="region"
      aria-label={`${stage.name} stage with ${deals.length} deals`}
    >
      {/* Column Header */}
      <div className="p-4 bg-surface-raised border-b-2 border-border-subtle sticky top-0 z-10">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-h4 font-semibold text-text-primary">{stage.name}</h3>
          <Badge intent="neutral">{deals.length}</Badge>
        </div>
        <div className="text-body-sm text-text-secondary mb-1">
          Total: {totalValue.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
        </div>
        <div className="text-caption text-text-muted">
          Weighted ({stage.winProbability}%): {weightedValue.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 p-4 space-y-3 overflow-y-auto min-h-[200px]">
        {deals.length === 0 ? (
          <div
            className={`border-2 border-dashed ${
              isOver ? 'border-intent-primary bg-intent-primary-bg' : 'border-border-subtle'
            } rounded-lg p-6 text-center`}
          >
            <p className="text-body-sm text-text-muted">
              {isOver ? 'Drop here' : 'No deals'}
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} onClick={() => onCardClick(deal)} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Add Deal Button */}
      <div className="p-4 border-t border-border-subtle">
        <button className="w-full py-2 px-3 text-body-sm text-intent-primary hover:bg-intent-primary-bg rounded-lg transition-colors flex items-center justify-center gap-2">
          <Plus className="size-4" />
          Add Deal
        </button>
      </div>
    </div>
  );
}

function DealPipelineInner() {
  const [deals, setDeals] = useState<Deal[]>(SAMPLE_DEALS);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);

  const handleDrop = (dealId: string, targetStageId: string) => {
    setDeals((prevDeals) =>
      prevDeals.map((deal) =>
        deal.id === dealId
          ? { ...deal, stageId: targetStageId, probability: STAGES.find((s) => s.id === targetStageId)?.winProbability || deal.probability }
          : deal
      )
    );
  };

  const filteredDeals = deals.filter((deal) =>
    deal.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    deal.organization.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const dealsByStage = STAGES.reduce((acc, stage) => {
    acc[stage.id] = filteredDeals.filter((deal) => deal.stageId === stage.id);
    return acc;
  }, {} as Record<string, Deal[]>);

  return (
    <div className="h-screen flex flex-col bg-surface-canvas">
      {/* Header */}
      <div className="flex-shrink-0 p-6 md:p-8 bg-surface-canvas border-b-2 border-border-subtle">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-h1 mb-2">Pipeline</h1>
            <p className="text-text-secondary">Manage your sales pipeline and track deals</p>
          </div>
          <Button leadingIcon={<Plus />}>
            New Deal
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Pipeline Selector */}
          <Select defaultValue="primary">
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="primary">Sales Pipeline (Primary)</SelectItem>
              <SelectItem value="enterprise">Enterprise Deals</SelectItem>
              <SelectItem value="government">Government Projects</SelectItem>
            </SelectContent>
          </Select>

          {/* Search */}
          <div className="flex-1 min-w-[250px] max-w-md">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
              <Input
                id="search-deals"
                placeholder="Search deals or organizations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10"
              />
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-2 p-1 bg-surface-raised border-2 border-border-default rounded-lg">
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1.5 rounded ${
                viewMode === 'kanban'
                  ? 'bg-intent-primary-bg text-intent-primary'
                  : 'text-text-secondary hover:text-text-primary'
              } transition-colors`}
              aria-label="Kanban view"
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded ${
                viewMode === 'list'
                  ? 'bg-intent-primary-bg text-intent-primary'
                  : 'text-text-secondary hover:text-text-primary'
              } transition-colors`}
              aria-label="List view"
            >
              <List className="size-4" />
            </button>
          </div>

          <Button variant="secondary" size="sm" leadingIcon={<Filter />}>
            Filters
          </Button>
        </div>
      </div>

      {/* Kanban Board */}
      {viewMode === 'kanban' && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-4 p-6 h-full">
            {STAGES.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                deals={dealsByStage[stage.id] || []}
                onDrop={handleDrop}
                onCardClick={setSelectedDeal}
              />
            ))}
          </div>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-auto p-6">
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-sunken border-b-2 border-border-subtle">
                  <tr>
                    <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Deal Name</th>
                    <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Organization</th>
                    <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Stage</th>
                    <th className="px-4 py-4 text-end text-body-sm font-semibold text-text-primary">Value</th>
                    <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Owner</th>
                    <th className="px-4 py-4 text-start text-body-sm font-semibold text-text-primary">Close Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {filteredDeals.map((deal) => (
                    <tr
                      key={deal.id}
                      className="hover:bg-surface-sunken transition-colors cursor-pointer"
                      onClick={() => setSelectedDeal(deal)}
                    >
                      <td className="px-4 py-4 text-text-primary font-medium">{deal.name}</td>
                      <td className="px-4 py-4 text-text-secondary">{deal.organization}</td>
                      <td className="px-4 py-4">
                        <Badge intent="primary">{STAGES.find((s) => s.id === deal.stageId)?.name}</Badge>
                      </td>
                      <td className="px-4 py-4 text-end font-mono text-text-primary">
                        {deal.value.toLocaleString('en-IN', { style: 'currency', currency: deal.currency })}
                      </td>
                      <td className="px-4 py-4 text-text-secondary">{deal.owner}</td>
                      <td className="px-4 py-4 text-text-secondary">
                        {new Date(deal.expectedCloseDate).toLocaleDateString('en-IN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Deal Detail Drawer */}
      <AnimatePresence>
        {selectedDeal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDeal(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed top-0 end-0 bottom-0 w-full md:w-[600px] bg-surface-canvas z-50 overflow-y-auto shadow-2xl"
            >
              <div className="sticky top-0 bg-surface-raised border-b-2 border-border-subtle p-6 flex items-start justify-between gap-4 z-10">
                <div className="flex-1">
                  <h2 className="text-h2 mb-2">{selectedDeal.name}</h2>
                  <div className="flex items-center gap-3">
                    <Badge intent="primary">{STAGES.find((s) => s.id === selectedDeal.stageId)?.name}</Badge>
                    <span className="text-h3 font-bold text-intent-primary">
                      {selectedDeal.value.toLocaleString('en-IN', { style: 'currency', currency: selectedDeal.currency })}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedDeal(null)}
                  className="size-10 flex items-center justify-center rounded-lg hover:bg-surface-sunken transition-colors"
                  aria-label="Close drawer"
                >
                  <X className="size-5 text-text-primary" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <Card>
                  <h3 className="text-h4 mb-4">Deal Information</h3>
                  <dl className="space-y-3">
                    <div>
                      <dt className="text-body-sm text-text-muted">Organization</dt>
                      <dd className="text-text-primary font-medium">{selectedDeal.organization}</dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-text-muted">Contact</dt>
                      <dd className="text-text-primary">{selectedDeal.contact}</dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-text-muted">Owner</dt>
                      <dd className="text-text-primary">{selectedDeal.owner}</dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-text-muted">Expected Close Date</dt>
                      <dd className="text-text-primary">
                        {new Date(selectedDeal.expectedCloseDate).toLocaleDateString('en-IN', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-text-muted">Win Probability</dt>
                      <dd className="text-text-primary font-semibold">{selectedDeal.probability}%</dd>
                    </div>
                  </dl>
                </Card>

                <Card>
                  <h3 className="text-h4 mb-4">Recent Activity</h3>
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <div className="size-8 rounded-full bg-intent-success-bg flex items-center justify-center flex-shrink-0">
                        <TrendingUp className="size-4 text-intent-success" />
                      </div>
                      <div>
                        <p className="text-body-sm text-text-primary font-medium">Moved to {STAGES.find((s) => s.id === selectedDeal.stageId)?.name}</p>
                        <p className="text-caption text-text-muted">2 hours ago by {selectedDeal.owner}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="size-8 rounded-full bg-intent-primary-bg flex items-center justify-center flex-shrink-0">
                        <MessageSquare className="size-4 text-intent-primary" />
                      </div>
                      <div>
                        <p className="text-body-sm text-text-primary font-medium">Call with {selectedDeal.contact}</p>
                        <p className="text-caption text-text-muted">1 day ago</p>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DealPipeline() {
  return (
    <DndProvider backend={HTML5Backend}>
      <DealPipelineInner />
    </DndProvider>
  );
}
