import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';
import 'invoice_model.dart';

/// Single-screen invoice creation with zero clutter.
/// One clear action: create an invoice. Large tap targets, thumb-friendly.
class InvoiceCreateScreen extends ConsumerStatefulWidget {
  const InvoiceCreateScreen({super.key});

  @override
  ConsumerState<InvoiceCreateScreen> createState() =>
      _InvoiceCreateScreenState();
}

class _InvoiceCreateScreenState extends ConsumerState<InvoiceCreateScreen> {
  final _customerController = TextEditingController();
  final _items = <InvoiceItem>[];
  bool _saving = false;
  bool _saved = false;

  static const _recentCustomers = [
    'Sharma Traders',
    'Patel Enterprises',
    'Gupta & Sons',
  ];

  @override
  void dispose() {
    _customerController.dispose();
    super.dispose();
  }

  int get _subtotal => _items.fold(0, (sum, i) => sum + i.amount);
  int get _gstTotal => _items.fold(0, (sum, i) => sum + i.gstAmount);
  int get _grandTotal => _subtotal + _gstTotal;

  String _formatAmount(int paise) {
    final rupees = paise / 100;
    return '₹${rupees.toStringAsFixed(2)}';
  }

  String _generateInvoiceNo() {
    final year = DateTime.now().year;
    final seq = DateTime.now().millisecondsSinceEpoch % 1000;
    return 'INV-$year-${seq.toString().padLeft(3, '0')}';
  }

  Future<void> _createInvoice() async {
    if (_customerController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a customer name')),
      );
      return;
    }
    if (_items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please add at least one item')),
      );
      return;
    }

    setState(() => _saving = true);

    final invoice = Invoice(
      id: const Uuid().v4(),
      tenantId: '',
      invoiceNo: _generateInvoiceNo(),
      customerId: const Uuid().v4(),
      customerName: _customerController.text.trim(),
      items: List.unmodifiable(_items),
      status: InvoiceStatus.unpaid,
      createdAt: DateTime.now().toUtc(),
      dueDate: DateTime.now().toUtc().add(const Duration(days: 30)),
    );

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'invoices',
        operation: 'create',
        entityId: invoice.id,
        payload: invoice.toJson(),
      );
      await db.upsertEntity(
        id: invoice.id,
        mailbox: 'invoices',
        data: invoice.toJson(),
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        syncState: 'pending',
      );
    }

    // Trigger sync if online
    ref.read(syncEngineProvider)?.syncMailbox('invoices');

    setState(() {
      _saving = false;
      _saved = true;
    });

    if (mounted) {
      _showShareSheet(invoice);
    }
  }

  void _showShareSheet(Invoice invoice) {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.check_circle, color: Colors.green, size: 56),
              const SizedBox(height: 12),
              Text(
                'Invoice ${invoice.invoiceNo} created!',
                style: Theme.of(ctx).textTheme.titleMedium,
              ),
              Text(
                _formatAmount(invoice.total),
                style: Theme.of(ctx).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _ShareButton(
                    icon: Icons.chat,
                    label: 'WhatsApp',
                    color: const Color(0xFF25D366),
                    onTap: () => Navigator.pop(ctx),
                  ),
                  _ShareButton(
                    icon: Icons.email,
                    label: 'Email',
                    color: Colors.blue,
                    onTap: () => Navigator.pop(ctx),
                  ),
                  _ShareButton(
                    icon: Icons.picture_as_pdf,
                    label: 'PDF',
                    color: Colors.red,
                    onTap: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    Navigator.pop(context);
                  },
                  child: const Text('Done'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showAddItemSheet() {
    final nameCtrl = TextEditingController();
    final qtyCtrl = TextEditingController(text: '1');
    final rateCtrl = TextEditingController();
    double gstPercent = 18;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            24,
            24,
            24,
            MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Add Item',
                  style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: 16),
              TextField(
                controller: nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Item name',
                  border: OutlineInputBorder(),
                ),
                textCapitalization: TextCapitalization.words,
                autofocus: true,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: qtyCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Qty',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: rateCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Rate (₹)',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<double>(
                value: gstPercent,
                decoration: const InputDecoration(
                  labelText: 'GST %',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 0, child: Text('0%')),
                  DropdownMenuItem(value: 5, child: Text('5%')),
                  DropdownMenuItem(value: 12, child: Text('12%')),
                  DropdownMenuItem(value: 18, child: Text('18%')),
                  DropdownMenuItem(value: 28, child: Text('28%')),
                ],
                onChanged: (v) => setSheetState(() => gstPercent = v ?? 18),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () {
                  final name = nameCtrl.text.trim();
                  final qty = int.tryParse(qtyCtrl.text) ?? 0;
                  final rateRupees = double.tryParse(rateCtrl.text) ?? 0;
                  final ratePaise = (rateRupees * 100).round();
                  if (name.isEmpty || qty <= 0 || ratePaise <= 0) return;

                  setState(() {
                    _items.add(InvoiceItem(
                      name: name,
                      qty: qty,
                      rate: ratePaise,
                      gstPercent: gstPercent,
                    ));
                  });
                  Navigator.pop(ctx);
                },
                icon: const Icon(Icons.add),
                label: const Text('Add Item'),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('New Invoice'),
        centerTitle: false,
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Customer field
                TextField(
                  controller: _customerController,
                  decoration: InputDecoration(
                    labelText: 'Customer',
                    hintText: 'Search or enter customer name',
                    prefixIcon: const Icon(Icons.person),
                    border: const OutlineInputBorder(),
                    suffixIcon: _customerController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () {
                              _customerController.clear();
                              setState(() {});
                            },
                          )
                        : null,
                  ),
                  textCapitalization: TextCapitalization.words,
                  onChanged: (_) => setState(() {}),
                ),
                // Recent customers suggestion
                if (_customerController.text.isEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: _recentCustomers
                        .map((c) => ActionChip(
                              label: Text(c),
                              onPressed: () {
                                _customerController.text = c;
                                setState(() {});
                              },
                            ))
                        .toList(),
                  ),
                ],
                const SizedBox(height: 20),

                // Items section
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Items', style: theme.textTheme.titleSmall),
                    TextButton.icon(
                      onPressed: _showAddItemSheet,
                      icon: const Icon(Icons.add, size: 20),
                      label: const Text('Add item'),
                    ),
                  ],
                ),
                if (_items.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32),
                    child: Center(
                      child: Column(
                        children: [
                          Icon(Icons.receipt_long,
                              size: 48, color: theme.colorScheme.outline),
                          const SizedBox(height: 8),
                          Text('No items yet',
                              style: TextStyle(
                                  color: theme.colorScheme.outline)),
                        ],
                      ),
                    ),
                  ),
                ..._items.asMap().entries.map((entry) {
                  final i = entry.key;
                  final item = entry.value;
                  return Dismissible(
                    key: ValueKey('item_$i'),
                    direction: DismissDirection.endToStart,
                    background: Container(
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.only(right: 16),
                      color: Colors.red,
                      child:
                          const Icon(Icons.delete, color: Colors.white),
                    ),
                    onDismissed: (_) => setState(() => _items.removeAt(i)),
                    child: Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment.start,
                                children: [
                                  Text(item.name,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w500)),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${item.qty} × ${_formatAmount(item.rate)} • GST ${item.gstPercent.toStringAsFixed(0)}%',
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: theme.colorScheme.outline,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              _formatAmount(item.totalWithGst),
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600, fontSize: 15),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                }),
              ],
            ),
          ),

          // Sticky bottom bar
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.05),
                  blurRadius: 8,
                  offset: const Offset(0, -2),
                ),
              ],
            ),
            child: SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_items.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Total',
                              style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600)),
                          Text(
                            _formatAmount(_grandTotal),
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                              color: theme.colorScheme.primary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: FilledButton(
                      onPressed: _saving ? null : _createInvoice,
                      child: _saving
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Create Invoice',
                              style: TextStyle(fontSize: 16)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ShareButton extends StatelessWidget {
  const _ShareButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              backgroundColor: color.withOpacity(0.1),
              radius: 24,
              child: Icon(icon, color: color),
            ),
            const SizedBox(height: 6),
            Text(label, style: const TextStyle(fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
