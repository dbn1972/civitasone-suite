import { useState, useEffect } from 'react';
import { Card, Button, Input, FormField, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, Label } from '../../components/ui';
import { ChevronRight, Plus, Trash2, GripVertical, Save, Send, X, Printer, Download, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';

interface JournalLine {
  id: string;
  account: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  taxCode: string;
}

const ACCOUNTS = [
  { code: '1110', name: 'Cash and Bank' },
  { code: '1120', name: 'Accounts Receivable' },
  { code: '2110', name: 'Accounts Payable' },
  { code: '2120', name: 'Tax Payable' },
  { code: '4100', name: 'Revenue' },
  { code: '5110', name: 'Salaries' },
  { code: '5120', name: 'Utilities' },
  { code: '5130', name: 'Office Supplies' },
];

export function JournalEntry({ mode = 'create' }: { mode?: 'create' | 'view' }) {
  const [postingDate, setPostingDate] = useState(new Date().toISOString().split('T')[0]);
  const [refNumber, setRefNumber] = useState(mode === 'create' ? 'Auto-generated on save' : 'JE-2024-045');
  const [refType, setRefType] = useState('manual');
  const [costCenter, setCostCenter] = useState('');
  const [project, setProject] = useState('');
  const [narration, setNarration] = useState('');
  const [status, setStatus] = useState<'draft' | 'posted' | 'cancelled'>(mode === 'view' ? 'posted' : 'draft');
  const [isPosting, setIsPosting] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const [lines, setLines] = useState<JournalLine[]>([
    { id: '1', account: '', accountName: '', description: '', debit: 0, credit: 0, taxCode: '' },
    { id: '2', account: '', accountName: '', description: '', debit: 0, credit: 0, taxCode: '' },
  ]);

  const addLine = () => {
    setLines([
      ...lines,
      { id: Date.now().toString(), account: '', accountName: '', description: '', debit: 0, credit: 0, taxCode: '' },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 2) {
      setLines(lines.filter((line) => line.id !== id));
    }
  };

  const updateLine = (id: string, field: keyof JournalLine, value: any) => {
    setLines(
      lines.map((line) => {
        if (line.id === id) {
          const updated = { ...line, [field]: value };

          // Auto-fill account name when account is selected
          if (field === 'account') {
            const account = ACCOUNTS.find((acc) => acc.code === value);
            updated.accountName = account?.name || '';
          }

          // Ensure only one of debit/credit is filled
          if (field === 'debit' && value > 0) {
            updated.credit = 0;
          } else if (field === 'credit' && value > 0) {
            updated.debit = 0;
          }

          return updated;
        }
        return line;
      })
    );
  };

  const totalDebit = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const difference = totalDebit - totalCredit;
  const isBalanced = Math.abs(difference) < 0.01 && totalDebit > 0;

  const validate = () => {
    const newErrors: { [key: string]: string } = {};

    if (!narration || narration.length < 5) {
      newErrors.narration = 'Narration must be at least 5 characters';
    }

    if (lines.length < 2) {
      newErrors.lines = 'At least 2 lines are required';
    }

    lines.forEach((line, index) => {
      if (!line.account) {
        newErrors[`line-${index}-account`] = 'Account is required';
      }
      if (line.debit === 0 && line.credit === 0) {
        newErrors[`line-${index}-amount`] = 'Either debit or credit must be greater than 0';
      }
    });

    if (!isBalanced) {
      newErrors.balance = 'Debits must equal credits';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveDraft = () => {
    console.log('Saving draft...');
    // Implement save draft logic
  };

  const handlePost = async () => {
    if (!validate()) return;

    setIsPosting(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setIsPosting(false);
    setStatus('posted');
    // Redirect to view mode
  };

  const isReadOnly = status === 'posted' || status === 'cancelled';

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Breadcrumb */}
      <nav className="text-body-sm text-text-muted" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          <li><a href="/app/finance" className="hover:text-text-primary">Finance</a></li>
          <li><ChevronRight className="size-4" /></li>
          <li><a href="/app/finance/journals" className="hover:text-text-primary">Journals</a></li>
          <li><ChevronRight className="size-4" /></li>
          <li className="text-text-primary">{mode === 'create' ? 'New' : refNumber}</li>
        </ol>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-h1">{mode === 'create' ? 'New Journal Entry' : `Journal Entry ${refNumber}`}</h1>
            {mode === 'view' && (
              <Badge
                intent={
                  status === 'posted' ? 'success' :
                  status === 'cancelled' ? 'danger' : 'warning'
                }
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Badge>
            )}
          </div>
          <p className="text-text-secondary">Record double-entry accounting transaction</p>
        </div>
        {mode === 'view' && status === 'posted' && (
          <div className="flex gap-3">
            <Button variant="secondary" leadingIcon={<Printer />} size="sm">Print</Button>
            <Button variant="secondary" leadingIcon={<Download />} size="sm">Export PDF</Button>
            <Button variant="danger" leadingIcon={<RotateCcw />} size="sm">Reverse</Button>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {errors.balance && (
        <Card className="border-2 border-intent-danger bg-intent-danger-bg">
          <div className="flex items-start gap-3">
            <div className="size-5 rounded-full bg-intent-danger flex items-center justify-center flex-shrink-0 mt-0.5">
              <X className="size-3 text-white" strokeWidth={3} />
            </div>
            <div>
              <h3 className="font-medium text-intent-danger mb-1">Journal Entry Unbalanced</h3>
              <p className="text-body-sm text-text-primary">
                Total debits must equal total credits. Current difference: ₹{Math.abs(difference).toLocaleString('en-IN')}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Form Fields */}
      <Card>
        <div className="grid md:grid-cols-2 gap-6">
          <FormField label="Posting Date" htmlFor="posting-date" required>
            <Input
              id="posting-date"
              type="date"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
              disabled={isReadOnly}
            />
          </FormField>

          <FormField label="Reference Number" htmlFor="ref-number">
            <Input
              id="ref-number"
              value={refNumber}
              disabled
              className="bg-surface-sunken"
            />
          </FormField>

          <FormField label="Reference Type" htmlFor="ref-type" required>
            <Select value={refType} onValueChange={setRefType} disabled={isReadOnly}>
              <SelectTrigger id="ref-type">
                <SelectValue placeholder="Select reference type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="invoice">Invoice</SelectItem>
                <SelectItem value="payment">Payment</SelectItem>
                <SelectItem value="payroll">Payroll</SelectItem>
                <SelectItem value="adjustment">Adjustment</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Cost Center" htmlFor="cost-center">
            <Select value={costCenter} onValueChange={setCostCenter} disabled={isReadOnly}>
              <SelectTrigger id="cost-center">
                <SelectValue placeholder="Select cost center..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HQ">Headquarters</SelectItem>
                <SelectItem value="BR1">Branch 1</SelectItem>
                <SelectItem value="BR2">Branch 2</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Project" htmlFor="project" className="md:col-span-2">
            <Select value={project} onValueChange={setProject} disabled={isReadOnly}>
              <SelectTrigger id="project">
                <SelectValue placeholder="Select project..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PROJ-001">Digital Transformation Initiative</SelectItem>
                <SelectItem value="PROJ-002">Infrastructure Upgrade</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField
            label="Narration"
            htmlFor="narration"
            required
            error={errors.narration}
            className="md:col-span-2"
          >
            <Textarea
              id="narration"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              disabled={isReadOnly}
              placeholder="Describe the transaction..."
              rows={3}
              className="resize-none"
            />
          </FormField>
        </div>
      </Card>

      {/* Journal Lines Table */}
      <Card padding="none">
        <div className="p-4 border-b-2 border-border-subtle flex items-center justify-between">
          <h3 className="text-h4">Journal Lines</h3>
          {!isReadOnly && (
            <Button variant="secondary" size="sm" onClick={addLine} leadingIcon={<Plus />}>
              Add Line
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken border-b-2 border-border-subtle">
              <tr>
                {!isReadOnly && <th className="w-12"></th>}
                <th className="px-4 py-3 text-start text-body-sm font-semibold text-text-primary">Account</th>
                <th className="px-4 py-3 text-start text-body-sm font-semibold text-text-primary">Description</th>
                <th className="px-4 py-3 text-end text-body-sm font-semibold text-text-primary">Debit (₹)</th>
                <th className="px-4 py-3 text-end text-body-sm font-semibold text-text-primary">Credit (₹)</th>
                <th className="px-4 py-3 text-start text-body-sm font-semibold text-text-primary">Tax Code</th>
                {!isReadOnly && <th className="w-12"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {lines.map((line, index) => (
                <tr key={line.id} role="row" aria-rowindex={index + 1}>
                  {!isReadOnly && (
                    <td className="px-2">
                      <button className="p-2 text-text-muted hover:text-text-primary cursor-move">
                        <GripVertical className="size-4" />
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Select
                      value={line.account}
                      onValueChange={(value) => updateLine(line.id, 'account', value)}
                      disabled={isReadOnly}
                    >
                      <SelectTrigger className="w-full font-mono text-body-sm">
                        <SelectValue placeholder="Select account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNTS.map((acc) => (
                          <SelectItem key={acc.code} value={acc.code}>
                            {acc.code} - {acc.name}
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
                      disabled={isReadOnly}
                      placeholder="Line description..."
                      className="text-body-sm"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      type="number"
                      value={line.debit || ''}
                      onChange={(e) => updateLine(line.id, 'debit', parseFloat(e.target.value) || 0)}
                      disabled={isReadOnly}
                      placeholder="0.00"
                      className="text-body-sm text-end font-mono"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      type="number"
                      value={line.credit || ''}
                      onChange={(e) => updateLine(line.id, 'credit', parseFloat(e.target.value) || 0)}
                      disabled={isReadOnly}
                      placeholder="0.00"
                      className="text-body-sm text-end font-mono"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={line.taxCode || "none"}
                      onValueChange={(value) => updateLine(line.id, 'taxCode', value === "none" ? "" : value)}
                      disabled={isReadOnly}
                    >
                      <SelectTrigger className="w-full text-body-sm">
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
                  {!isReadOnly && (
                    <td className="px-2">
                      <button
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length <= 2}
                        className="p-2 text-intent-danger hover:bg-intent-danger-bg rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-sunken border-t-2 border-border-subtle">
              <tr>
                {!isReadOnly && <td></td>}
                <td colSpan={2} className="px-4 py-4 font-semibold text-text-primary">
                  Totals
                </td>
                <td className="px-4 py-4 text-end font-mono font-semibold text-text-primary">
                  ₹{totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-4 text-end font-mono font-semibold text-text-primary">
                  ₹{totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td colSpan={2} className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-body-sm text-text-muted">Difference:</span>
                    <span
                      className={`font-mono font-semibold ${
                        isBalanced ? 'text-intent-success' : 'text-intent-danger'
                      }`}
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      ₹{Math.abs(difference).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {isBalanced && ' ✓'}
                    </span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Sticky Save Bar */}
      {!isReadOnly && (
        <motion.div
          className="fixed bottom-0 start-0 end-0 bg-surface-raised border-t-2 border-border-subtle shadow-lg z-30"
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          transition={{ type: 'spring', damping: 20 }}
        >
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-body-sm text-text-muted">Balance Status:</div>
              <div
                className={`px-4 py-2 rounded-lg font-mono font-semibold ${
                  isBalanced
                    ? 'bg-intent-success-bg text-intent-success'
                    : 'bg-intent-danger-bg text-intent-danger'
                }`}
              >
                {isBalanced ? 'Balanced ✓' : `Difference: ₹${Math.abs(difference).toLocaleString('en-IN')}`}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="tertiary"
                onClick={() => window.history.back()}
                aria-label="Cancel and return to journal list"
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={handleSaveDraft}
                leadingIcon={<Save />}
                aria-label="Save journal as draft"
              >
                Save Draft
              </Button>
              <Button
                onClick={handlePost}
                disabled={!isBalanced}
                loading={isPosting}
                leadingIcon={<Send />}
                aria-label={isBalanced ? 'Post journal entry' : 'Cannot post - journal is unbalanced'}
              >
                {isPosting ? 'Posting...' : 'Post Journal'}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Spacer for sticky save bar */}
      {!isReadOnly && <div className="h-20" />}
    </div>
  );
}
