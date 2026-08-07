import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Card, Button, Badge, RadixTabs as Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui';
import {
  ArrowLeft,
  Download,
  Printer,
  CheckCircle,
  XCircle,
  FileText,
  Package,
  Receipt,
  FileCheck,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { motion } from 'motion/react';

interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendor: string;
  vendorAddress: string;
  deliveryAddress: string;
  expectedDeliveryDate: string;
  costCenter?: string;
  project?: string;
  terms: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'partially_received' | 'received' | 'cancelled';
  total: number;
  subtotal: number;
  taxTotal: number;
  currency: string;
  approver: string;
  createdBy: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

interface POLine {
  id: string;
  item: string;
  description: string;
  qty: number;
  receivedQty: number;
  uom: string;
  unitPrice: number;
  taxCode: string;
  lineTotal: number;
}

interface GRN {
  id: string;
  grnNumber: string;
  date: string;
  receivedBy: string;
  items: number;
  totalQty: number;
  status: 'draft' | 'posted';
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  matchStatus: 'matched' | 'variance' | 'unmatched';
  varianceAmount?: number;
}

interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  details: string;
}

const SAMPLE_PO: PurchaseOrder = {
  id: '1',
  poNumber: 'PO-2024-045',
  vendor: 'Acme Supplies Ltd',
  vendorAddress: '123 Industrial Area, Phase 2, Noida, UP 201301',
  deliveryAddress: 'Central Stores, Government Building, Sector 5, Dwarka, New Delhi 110075',
  expectedDeliveryDate: '2024-06-15',
  costCenter: 'CC-ADM-001',
  project: 'Office Renovation 2024',
  terms: 'Payment within 30 days of delivery. Quality inspection required before acceptance.',
  status: 'approved',
  total: 250000,
  subtotal: 211864,
  taxTotal: 38136,
  currency: 'INR',
  approver: 'Alice Kumar',
  createdBy: 'Rajesh Sharma',
  createdAt: '2024-05-23T10:30:00',
  approvedAt: '2024-05-23T14:45:00',
  approvedBy: 'Alice Kumar',
};

const SAMPLE_LINES: POLine[] = [
  { id: '1', item: 'DESK-ERG-001', description: 'Ergonomic Office Desk (1.5m x 0.75m)', qty: 20, receivedQty: 20, uom: 'Units', unitPrice: 8500, taxCode: 'GST18', lineTotal: 170000 },
  { id: '2', item: 'CHAIR-EXE-002', description: 'Executive Chair with Lumbar Support', qty: 20, receivedQty: 20, uom: 'Units', unitPrice: 6500, taxCode: 'GST18', lineTotal: 130000 },
  { id: '3', item: 'LAMP-LED-003', description: 'LED Desk Lamp (Adjustable)', qty: 15, receivedQty: 15, uom: 'Units', unitPrice: 1200, taxCode: 'GST12', lineTotal: 18000 },
];

const SAMPLE_GRNS: GRN[] = [
  { id: '1', grnNumber: 'GRN-2024-0089', date: '2024-06-10', receivedBy: 'Stores Manager', items: 3, totalQty: 55, status: 'posted' },
];

const SAMPLE_INVOICES: Invoice[] = [
  { id: '1', invoiceNumber: 'INV-ACM-2024-456', invoiceDate: '2024-06-12', dueDate: '2024-07-12', amount: 250000, matchStatus: 'matched' },
];

const SAMPLE_AUDIT: AuditEvent[] = [
  { id: '5', timestamp: '2024-06-12T09:30:00', action: 'Invoice Matched', user: 'System', details: 'Three-way match completed for INV-ACM-2024-456' },
  { id: '4', timestamp: '2024-06-10T11:20:00', action: 'Goods Received', user: 'Stores Manager', details: 'GRN-2024-0089 posted - 55 items received' },
  { id: '3', timestamp: '2024-05-23T14:45:00', action: 'PO Approved', user: 'Alice Kumar', details: 'Approved for procurement' },
  { id: '2', timestamp: '2024-05-23T14:30:00', action: 'Submitted for Approval', user: 'Rajesh Sharma', details: 'Submitted to Alice Kumar for review' },
  { id: '1', timestamp: '2024-05-23T10:30:00', action: 'PO Created', user: 'Rajesh Sharma', details: 'Draft purchase order created' },
];

export function PurchaseOrderView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const po = SAMPLE_PO;
  const lines = SAMPLE_LINES;
  const grns = SAMPLE_GRNS;
  const invoices = SAMPLE_INVOICES;
  const auditEvents = SAMPLE_AUDIT;

  const getStatusBadge = (status: PurchaseOrder['status']) => {
    const config = {
      draft: { intent: 'neutral' as const, label: 'Draft' },
      pending_approval: { intent: 'warning' as const, label: 'Pending Approval' },
      approved: { intent: 'success' as const, label: 'Approved' },
      partially_received: { intent: 'info' as const, label: 'Partially Received' },
      received: { intent: 'success' as const, label: 'Received' },
      cancelled: { intent: 'danger' as const, label: 'Cancelled' },
    };
    return config[status];
  };

  const getMatchStatusConfig = (status: Invoice['matchStatus']) => {
    const config = {
      matched: { intent: 'success' as const, label: 'Matched', icon: CheckCircle },
      variance: { intent: 'warning' as const, label: 'Variance Detected', icon: AlertCircle },
      unmatched: { intent: 'danger' as const, label: 'Unmatched', icon: XCircle },
    };
    return config[status];
  };

  const statusBadge = getStatusBadge(po.status);
  const canApprove = po.status === 'pending_approval';
  const canCancel = po.status !== 'received' && po.status !== 'cancelled' && !grns.length;
  const canCreateGRN = po.status === 'approved' || po.status === 'partially_received';

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<ArrowLeft />}
            onClick={() => navigate('/app/procurement/orders')}
          >
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-h1">{po.poNumber}</h1>
              <Badge intent={statusBadge.intent} size="lg">{statusBadge.label}</Badge>
            </div>
            <p className="text-text-secondary">{po.vendor}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {canApprove && (
            <>
              <Button
                leadingIcon={<CheckCircle />}
                onClick={() => setShowApproveDialog(true)}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<XCircle />}
                onClick={() => setShowRejectDialog(true)}
              >
                Reject
              </Button>
            </>
          )}
          {canCreateGRN && (
            <Button
              variant="secondary"
              leadingIcon={<Package />}
              onClick={() => navigate(`/app/procurement/grn/new?po=${po.id}`)}
            >
              Create GRN
            </Button>
          )}
          {canCancel && (
            <Button
              variant="secondary"
              intent="danger"
              onClick={() => setShowCancelDialog(true)}
            >
              Cancel PO
            </Button>
          )}
          <Button variant="secondary" size="sm" leadingIcon={<Printer />}>
            Print
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<Download />}>
            Export PDF
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <FileText className="size-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="lines">
            <FileCheck className="size-4" />
            Lines
          </TabsTrigger>
          <TabsTrigger value="receipts">
            <Package className="size-4" />
            Receipts ({grns.length})
          </TabsTrigger>
          <TabsTrigger value="invoices">
            <Receipt className="size-4" />
            Invoices ({invoices.length})
          </TabsTrigger>
          <TabsTrigger value="audit">
            <Clock className="size-4" />
            Audit Trail
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <h3 className="text-h4 mb-4">Vendor Details</h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-body-sm text-text-muted">Vendor Name</dt>
                  <dd className="text-text-primary font-medium">{po.vendor}</dd>
                </div>
                <div>
                  <dt className="text-body-sm text-text-muted">Vendor Address</dt>
                  <dd className="text-text-primary">{po.vendorAddress}</dd>
                </div>
              </dl>
            </Card>

            <Card>
              <h3 className="text-h4 mb-4">Delivery Details</h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-body-sm text-text-muted">Delivery Address</dt>
                  <dd className="text-text-primary">{po.deliveryAddress}</dd>
                </div>
                <div>
                  <dt className="text-body-sm text-text-muted">Expected Delivery Date</dt>
                  <dd className="text-text-primary">{new Date(po.expectedDeliveryDate).toLocaleDateString('en-IN')}</dd>
                </div>
              </dl>
            </Card>

            <Card>
              <h3 className="text-h4 mb-4">Financial Details</h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-body-sm text-text-muted">Cost Center</dt>
                  <dd className="text-text-primary">{po.costCenter || '-'}</dd>
                </div>
                <div>
                  <dt className="text-body-sm text-text-muted">Project</dt>
                  <dd className="text-text-primary">{po.project || '-'}</dd>
                </div>
                <div>
                  <dt className="text-body-sm text-text-muted">Currency</dt>
                  <dd className="text-text-primary">{po.currency}</dd>
                </div>
              </dl>
            </Card>

            <Card>
              <h3 className="text-h4 mb-4">Approval Details</h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-body-sm text-text-muted">Created By</dt>
                  <dd className="text-text-primary">{po.createdBy}</dd>
                </div>
                <div>
                  <dt className="text-body-sm text-text-muted">Created At</dt>
                  <dd className="text-text-primary">{new Date(po.createdAt).toLocaleString('en-IN')}</dd>
                </div>
                {po.approvedBy && (
                  <>
                    <div>
                      <dt className="text-body-sm text-text-muted">Approved By</dt>
                      <dd className="text-text-primary">{po.approvedBy}</dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-text-muted">Approved At</dt>
                      <dd className="text-text-primary">{po.approvedAt ? new Date(po.approvedAt).toLocaleString('en-IN') : '-'}</dd>
                    </div>
                  </>
                )}
              </dl>
            </Card>

            <Card className="lg:col-span-2">
              <h3 className="text-h4 mb-4">Terms & Conditions</h3>
              <p className="text-text-primary whitespace-pre-wrap">{po.terms}</p>
            </Card>

            <Card className="lg:col-span-2 bg-surface-sunken">
              <div className="flex items-end justify-between">
                <div className="space-y-2">
                  <div className="flex items-baseline gap-3">
                    <span className="text-body-sm text-text-muted">Subtotal:</span>
                    <span className="text-h4 font-mono text-text-primary">
                      {po.subtotal.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-body-sm text-text-muted">Tax:</span>
                    <span className="text-h4 font-mono text-text-primary">
                      {po.taxTotal.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-body-sm text-text-muted mb-1">Grand Total</div>
                  <div className="text-h2 font-bold font-mono text-intent-primary">
                    {po.total.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* Lines Tab */}
        <TabsContent value="lines">
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-sunken border-b-2 border-border-subtle">
                  <tr>
                    <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Item Code</th>
                    <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Description</th>
                    <th className="px-4 py-4 text-right text-body-sm font-semibold text-text-primary">Ordered</th>
                    <th className="px-4 py-4 text-right text-body-sm font-semibold text-text-primary">Received</th>
                    <th className="px-4 py-4 text-center text-body-sm font-semibold text-text-primary">UOM</th>
                    <th className="px-4 py-4 text-right text-body-sm font-semibold text-text-primary">Unit Price</th>
                    <th className="px-4 py-4 text-center text-body-sm font-semibold text-text-primary">Tax</th>
                    <th className="px-4 py-4 text-right text-body-sm font-semibold text-text-primary">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {lines.map((line) => {
                    const receivedPct = (line.receivedQty / line.qty) * 100;
                    return (
                      <tr key={line.id} className="hover:bg-surface-sunken transition-colors">
                        <td className="px-4 py-4">
                          <span className="font-mono text-text-primary font-medium">{line.item}</span>
                        </td>
                        <td className="px-4 py-4 text-text-primary">{line.description}</td>
                        <td className="px-4 py-4 text-right font-mono text-text-primary">{line.qty}</td>
                        <td className="px-4 py-4 text-right">
                          <div className="space-y-1">
                            <span className="font-mono text-text-primary">{line.receivedQty}</span>
                            {line.receivedQty < line.qty && (
                              <div className="w-24 ml-auto">
                                <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-intent-info rounded-full"
                                    style={{ width: `${receivedPct}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center text-text-secondary">{line.uom}</td>
                        <td className="px-4 py-4 text-right font-mono text-text-primary">
                          {line.unitPrice.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="text-caption font-mono text-text-secondary">{line.taxCode}</span>
                        </td>
                        <td className="px-4 py-4 text-right font-mono text-text-primary font-medium">
                          {line.lineTotal.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-surface-sunken border-t-2 border-border-default">
                  <tr>
                    <td colSpan={7} className="px-4 py-4 text-right font-semibold text-text-primary">
                      Subtotal:
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-bold text-text-primary">
                      {po.subtotal.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={7} className="px-4 py-3 text-right font-semibold text-text-primary">
                      Tax Total:
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-text-primary">
                      {po.taxTotal.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={7} className="px-4 py-4 text-right font-bold text-h4 text-text-primary">
                      Grand Total:
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-bold text-h3 text-intent-primary">
                      {po.total.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Receipts Tab */}
        <TabsContent value="receipts">
          {grns.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <Package className="size-12 text-text-muted mx-auto mb-4" />
                <h3 className="text-h4 text-text-primary mb-2">No Goods Receipts</h3>
                <p className="text-text-secondary mb-6">No items have been received against this PO yet.</p>
                {canCreateGRN && (
                  <Button leadingIcon={<Package />} onClick={() => navigate(`/app/procurement/grn/new?po=${po.id}`)}>
                    Create GRN
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            <Card padding="none">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface-sunken border-b-2 border-border-subtle">
                    <tr>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">GRN Number</th>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Date</th>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Received By</th>
                      <th className="px-4 py-4 text-right text-body-sm font-semibold text-text-primary">Items</th>
                      <th className="px-4 py-4 text-right text-body-sm font-semibold text-text-primary">Total Qty</th>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Status</th>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {grns.map((grn) => (
                      <tr key={grn.id} className="hover:bg-surface-sunken transition-colors cursor-pointer"
                          onClick={() => navigate(`/app/procurement/grn/${grn.id}`)}>
                        <td className="px-4 py-4">
                          <span className="font-mono text-intent-primary font-medium hover:underline">{grn.grnNumber}</span>
                        </td>
                        <td className="px-4 py-4 text-text-secondary">{new Date(grn.date).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-4 text-text-primary">{grn.receivedBy}</td>
                        <td className="px-4 py-4 text-right font-mono text-text-primary">{grn.items}</td>
                        <td className="px-4 py-4 text-right font-mono text-text-primary">{grn.totalQty}</td>
                        <td className="px-4 py-4">
                          <Badge intent={grn.status === 'posted' ? 'success' : 'neutral'}>
                            {grn.status === 'posted' ? 'Posted' : 'Draft'}
                          </Badge>
                        </td>
                        <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate(`/app/procurement/grn/${grn.id}`)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices">
          {invoices.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <Receipt className="size-12 text-text-muted mx-auto mb-4" />
                <h3 className="text-h4 text-text-primary mb-2">No Invoices</h3>
                <p className="text-text-secondary">No supplier invoices have been matched to this PO yet.</p>
              </div>
            </Card>
          ) : (
            <Card padding="none">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface-sunken border-b-2 border-border-subtle">
                    <tr>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Invoice Number</th>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Invoice Date</th>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Due Date</th>
                      <th className="px-4 py-4 text-right text-body-sm font-semibold text-text-primary">Amount</th>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Match Status</th>
                      <th className="px-4 py-4 text-right text-body-sm font-semibold text-text-primary">Variance</th>
                      <th className="px-4 py-4 text-left text-body-sm font-semibold text-text-primary">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {invoices.map((invoice) => {
                      const matchConfig = getMatchStatusConfig(invoice.matchStatus);
                      const MatchIcon = matchConfig.icon;
                      return (
                        <tr key={invoice.id} className="hover:bg-surface-sunken transition-colors cursor-pointer"
                            onClick={() => navigate(`/app/finance/invoices/${invoice.id}`)}>
                          <td className="px-4 py-4">
                            <span className="font-mono text-intent-primary font-medium hover:underline">{invoice.invoiceNumber}</span>
                          </td>
                          <td className="px-4 py-4 text-text-secondary">{new Date(invoice.invoiceDate).toLocaleDateString('en-IN')}</td>
                          <td className="px-4 py-4 text-text-secondary">{new Date(invoice.dueDate).toLocaleDateString('en-IN')}</td>
                          <td className="px-4 py-4 text-right font-mono text-text-primary">
                            {invoice.amount.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <MatchIcon className={`size-4 text-intent-${matchConfig.intent}`} />
                              <Badge intent={matchConfig.intent}>{matchConfig.label}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            {invoice.varianceAmount ? (
                              <span className={`font-mono font-medium ${invoice.varianceAmount > 0 ? 'text-intent-danger' : 'text-intent-success'}`}>
                                {invoice.varianceAmount > 0 ? '+' : ''}
                                {invoice.varianceAmount.toLocaleString('en-IN', { style: 'currency', currency: po.currency })}
                              </span>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </td>
                          <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/app/finance/invoices/${invoice.id}`)}
                            >
                              View
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Audit Trail Tab */}
        <TabsContent value="audit">
          <Card>
            <div className="space-y-6">
              {auditEvents.map((event, index) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex gap-4"
                >
                  <div className="flex-shrink-0">
                    <div className="size-10 rounded-full bg-intent-primary-bg flex items-center justify-center">
                      <Clock className="size-5 text-intent-primary" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 mb-1">
                      <h4 className="font-medium text-text-primary">{event.action}</h4>
                      <time className="text-caption text-text-muted whitespace-nowrap">
                        {new Date(event.timestamp).toLocaleString('en-IN')}
                      </time>
                    </div>
                    <p className="text-body-sm text-text-secondary mb-1">{event.details}</p>
                    <p className="text-caption text-text-muted">by {event.user}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialogs */}
      {showApproveDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-md">
            <h3 className="text-h3 mb-4">Approve Purchase Order</h3>
            <p className="text-text-secondary mb-6">
              Are you sure you want to approve PO {po.poNumber}? This will authorize procurement.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowApproveDialog(false)}>Cancel</Button>
              <Button onClick={() => { setShowApproveDialog(false); }}>
                Approve
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
