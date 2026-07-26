import { useState } from 'react';
import { Card, Button, Input, FormField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, Label } from '../../components/ui';
import { ChevronRight, Plus, Trash2, GripVertical, Save, Send } from 'lucide-react';
import { motion } from 'motion/react';

interface POLine {
  id: string;
  item: string;
  itemName: string;
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  taxCode: string;
  lineTotal: number;
}

const ITEMS = [
  { code: 'ITM-001', name: 'Laptop Dell Latitude 5420' },
  { code: 'ITM-002', name: 'Office Chair Ergonomic' },
  { code: 'ITM-003', name: 'Printer HP LaserJet Pro' },
  { code: 'ITM-004', name: 'Desk Wooden 6ft' },
  { code: 'ITM-005', name: 'Whiteboard Magnetic 4x3' },
];

const VENDORS = [
  { id: 'VEN-001', name: 'Acme Supplies Ltd' },
  { id: 'VEN-002', name: 'Tech Equipment Co' },
  { id: 'VEN-003', name: 'Office Furniture Inc' },
];

export function PurchaseOrderCreate() {
  const [vendor, setVendor] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [project, setProject] = useState('');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<POLine[]>([
    { id: '1', item: '', itemName: '', description: '', qty: 0, uom: 'PCS', unitPrice: 0, taxCode: '', lineTotal: 0 },
  ]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addLine = () => {
    setLines([
      ...lines,
      { id: Date.now().toString(), item: '', itemName: '', description: '', qty: 0, uom: 'PCS', unitPrice: 0, taxCode: '', lineTotal: 0 },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 1) {
      setLines(lines.filter((line) => line.id !== id));
    }
  };

  const updateLine = (id: string, field: keyof POLine, value: any) => {
    setLines(
      lines.map((line) => {
        if (line.id === id) {
          const updated = { ...line, [field]: value };

          // Auto-fill item name when item is selected
          if (field === 'item') {
            const item = ITEMS.find((i) => i.code === value);
            updated.itemName = item?.name || '';
            updated.description = item?.name || '';
          }

          // Calculate line total
          const qty = field === 'qty' ? value : updated.qty;
          const unitPrice = field === 'unitPrice' ? value : updated.unitPrice;
          const taxRate = updated.taxCode === 'GST18' ? 0.18 : updated.taxCode === 'GST12' ? 0.12 : updated.taxCode === 'GST5' ? 0.05 : 0;
          const subtotal = qty * unitPrice;
          updated.lineTotal = subtotal + (subtotal * taxRate);

          return updated;
        }
        return line;
      })
    );
  };

  const subtotal = lines.reduce((sum, line) => sum + (line.qty * line.unitPrice), 0);
  const taxTotal = lines.reduce((sum, line) => {
    const taxRate = line.taxCode === 'GST18' ? 0.18 : line.taxCode === 'GST12' ? 0.12 : line.taxCode === 'GST5' ? 0.05 : 0;
    return sum + (line.qty * line.unitPrice * taxRate);
  }, 0);
  const grandTotal = subtotal + taxTotal;

  const validate = () => {
    const newErrors: { [key: string]: string } = {};

    if (!vendor) {
      newErrors.vendor = 'Vendor is required';
    }

    const validLines = lines.filter(line => line.item && line.qty > 0);
    if (validLines.length === 0) {
      newErrors.lines = 'At least one valid line is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveDraft = () => {
    console.log('Saving draft...');
    // Implement save draft logic
  };

  const handleSubmitForApproval = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setIsSubmitting(false);
    // Redirect to view page
    window.location.href = '/app/procurement/orders/PO-2024-046';
  };

  const isValid = vendor && lines.some(line => line.item && line.qty > 0);

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Breadcrumb */}
      <nav className="text-body-sm text-text-muted" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          <li><a href="/app/procurement" className="hover:text-text-primary">Procurement</a></li>
          <li><ChevronRight className="size-4" /></li>
          <li><a href="/app/procurement/orders" className="hover:text-text-primary">Purchase Orders</a></li>
          <li><ChevronRight className="size-4" /></li>
          <li className="text-text-primary">New</li>
        </ol>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-h1 mb-2">New Purchase Order</h1>
        <p className="text-text-secondary">Create a new purchase order for vendor</p>
      </div>

      {/* Header Fields */}
      <Card>
        <h3 className="text-h4 mb-6">Order Details</h3>
        <div className="grid md:grid-cols-2 gap-6">
          <FormField label="Vendor" htmlFor="vendor" required error={errors.vendor}>
            <Select value={vendor} onValueChange={setVendor}>
              <SelectTrigger id="vendor">
                <SelectValue placeholder="Select vendor..." />
              </SelectTrigger>
              <SelectContent>
                {VENDORS.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Expected Delivery Date" htmlFor="expected-date">
            <Input
              id="expected-date"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </FormField>

          <FormField label="Delivery Address" htmlFor="delivery-address">
            <Select value={deliveryAddress} onValueChange={setDeliveryAddress}>
              <SelectTrigger id="delivery-address">
                <SelectValue placeholder="Select address..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HQ">Headquarters - New Delhi</SelectItem>
                <SelectItem value="BR1">Branch 1 - Mumbai</SelectItem>
                <SelectItem value="BR2">Branch 2 - Bangalore</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Cost Center" htmlFor="cost-center">
            <Select value={costCenter} onValueChange={setCostCenter}>
              <SelectTrigger id="cost-center">
                <SelectValue placeholder="Select cost center..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HQ">Headquarters</SelectItem>
                <SelectItem value="IT">IT Department</SelectItem>
                <SelectItem value="HR">HR Department</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Project" htmlFor="project" className="md:col-span-2">
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger id="project">
                <SelectValue placeholder="Select project..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PROJ-001">Digital Transformation Initiative</SelectItem>
                <SelectItem value="PROJ-002">Infrastructure Upgrade</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Terms & Conditions" htmlFor="terms" className="md:col-span-2">
            <Textarea
              id="terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Enter payment terms, delivery conditions, etc..."
              rows={3}
              className="resize-none"
            />
          </FormField>
        </div>
      </Card>

      {/* Lines Table */}
      <Card padding="none">
        <div className="p-4 border-b-2 border-border-subtle flex items-center justify-between">
          <h3 className="text-h4">Order Lines</h3>
          <Button variant="secondary" size="sm" onClick={addLine} leadingIcon={<Plus />}>
            Add Line
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                <th className="w-12"></th>
                <th className="px-4 py-3 text-start text-body-sm font-semibold text-text-primary">Item</th>
                <th className="px-4 py-3 text-start text-body-sm font-semibold text-text-primary">Description</th>
                <th className="px-4 py-3 text-end text-body-sm font-semibold text-text-primary">Qty</th>
                <th className="px-4 py-3 text-start text-body-sm font-semibold text-text-primary">UOM</th>
                <th className="px-4 py-3 text-end text-body-sm font-semibold text-text-primary">Unit Price</th>
                <th className="px-4 py-3 text-start text-body-sm font-semibold text-text-primary">Tax</th>
                <th className="px-4 py-3 text-end text-body-sm font-semibold text-text-primary">Line Total</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-2">
                    <button className="p-2 text-text-muted hover:text-text-primary cursor-move">
                      <GripVertical className="size-4" />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={line.item}
                      onValueChange={(value) => updateLine(line.id, 'item', value)}
                    >
                      <SelectTrigger className="w-full font-mono text-body-sm">
                        <SelectValue placeholder="Select item..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ITEMS.map((item) => (
                          <SelectItem key={item.code} value={item.code}>
                            {item.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                      placeholder="Item description..."
                      className="text-body-sm"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      type="number"
                      value={line.qty || ''}
                      onChange={(e) => updateLine(line.id, 'qty', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-24 text-body-sm text-end"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={line.uom}
                      onValueChange={(value) => updateLine(line.id, 'uom', value)}
                    >
                      <SelectTrigger className="w-24 text-body-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PCS">PCS</SelectItem>
                        <SelectItem value="KG">KG</SelectItem>
                        <SelectItem value="LTR">LTR</SelectItem>
                        <SelectItem value="SET">SET</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      type="number"
                      value={line.unitPrice || ''}
                      onChange={(e) => updateLine(line.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      className="w-32 text-body-sm text-end font-mono"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={line.taxCode || "none"}
                      onValueChange={(value) => updateLine(line.id, 'taxCode', value === "none" ? "" : value)}
                    >
                      <SelectTrigger className="w-28 text-body-sm">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="GST18">GST 18%</SelectItem>
                        <SelectItem value="GST12">GST 12%</SelectItem>
                        <SelectItem value="GST5">GST 5%</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <span className="font-mono font-semibold text-text-primary">
                      ₹{line.lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length <= 1}
                      className="p-2 text-intent-danger hover:bg-intent-danger-bg rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-sunken border-t-2 border-border-subtle">
              <tr>
                <td colSpan={7} className="px-4 py-4 text-end font-semibold text-text-primary">
                  Subtotal
                </td>
                <td className="px-4 py-4 text-end font-mono font-semibold text-text-primary">
                  ₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={7} className="px-4 py-2 text-end font-semibold text-text-primary">
                  Tax Total
                </td>
                <td className="px-4 py-2 text-end font-mono font-semibold text-text-primary">
                  ₹{taxTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
              <tr className="border-t-2 border-border-subtle">
                <td colSpan={7} className="px-4 py-4 text-end font-bold text-text-primary text-base">
                  Grand Total
                </td>
                <td className="px-4 py-4 text-end font-mono font-bold text-text-primary text-base">
                  ₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Sticky Save Bar */}
      <motion.div
        className="fixed bottom-0 start-0 end-0 bg-surface-raised border-t-2 border-border-subtle shadow-lg z-30"
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', damping: 20 }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="text-body-sm text-text-muted">Grand Total:</div>
            <div className="px-4 py-2 rounded-lg font-mono font-bold text-h4 text-text-primary">
              ₹{grandTotal.toLocaleString('en-IN')}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="tertiary"
              onClick={() => window.history.back()}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleSaveDraft}
              leadingIcon={<Save />}
            >
              Save Draft
            </Button>
            <Button
              onClick={handleSubmitForApproval}
              disabled={!isValid}
              loading={isSubmitting}
              leadingIcon={<Send />}
            >
              {isSubmitting ? 'Submitting...' : 'Submit for Approval'}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Spacer for sticky save bar */}
      <div className="h-20" />
    </div>
  );
}
