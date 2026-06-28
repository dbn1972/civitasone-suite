import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';
import '../../core/widgets/status_pill.dart';

/// Expense claims with photo receipt capture.
/// POST /v1/hrms/expenses (via outbox for offline)
/// GET /v1/hrms/expenses — list my claims
class ExpenseClaimScreen extends ConsumerStatefulWidget {
  const ExpenseClaimScreen({super.key});

  @override
  ConsumerState<ExpenseClaimScreen> createState() =>
      _ExpenseClaimScreenState();
}

class _ExpenseClaimScreenState extends ConsumerState<ExpenseClaimScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _claims = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _fetchClaims();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchClaims() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient
          .get<Map<String, dynamic>>('/v1/hrms/expenses');
      _claims = ((res.data?['data'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();
    } catch (e) {
      // Try offline cache
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities('expenses');
        if (cached.isNotEmpty) {
          _claims = cached
              .map((e) => e['data'] as Map<String, dynamic>)
              .toList();
          if (mounted) setState(() => _loading = false);
          return;
        }
      }
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _fmt(num paise) => '₹${(paise / 100).toStringAsFixed(0)}';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Expense Claims'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchClaims,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'My Claims'),
            Tab(text: 'New Claim'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError()
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildClaimsList(),
                    const _NewClaimTab(),
                  ],
                ),
    );
  }

  Widget _buildClaimsList() {
    final theme = Theme.of(context);

    if (_claims.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt, size: 64,
                color: theme.colorScheme.outlineVariant),
            const SizedBox(height: 16),
            Text('No expense claims', style: theme.textTheme.bodyLarge),
            const SizedBox(height: 8),
            Text('Submit a claim to get reimbursed',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.outline)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchClaims,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Summary
          _buildSummary(theme),
          const SizedBox(height: 16),
          ..._claims.map((c) => _ClaimCard(claim: c, fmt: _fmt)),
        ],
      ),
    );
  }

  Widget _buildSummary(ThemeData theme) {
    final total = _claims.fold<num>(
        0, (sum, c) => sum + ((c['amount'] as num?) ?? 0));
    final pending = _claims
        .where((c) => c['status'] == 'pending')
        .fold<num>(0, (sum, c) => sum + ((c['amount'] as num?) ?? 0));
    final approved = _claims
        .where((c) => c['status'] == 'approved')
        .fold<num>(0, (sum, c) => sum + ((c['amount'] as num?) ?? 0));

    return Row(
      children: [
        Expanded(
          child: _SummaryChip(
              label: 'Total', value: _fmt(total), color: const Color(0xFF6366F1)),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _SummaryChip(
              label: 'Pending', value: _fmt(pending), color: const Color(0xFFF59E0B)),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _SummaryChip(
              label: 'Approved', value: _fmt(approved), color: const Color(0xFF22C55E)),
        ),
      ],
    );
  }

  Widget _buildError() {
    final theme = Theme.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load claims', style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _fetchClaims,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _SummaryChip extends StatelessWidget {
  const _SummaryChip(
      {required this.label, required this.value, required this.color});
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.05),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        children: [
          Text(value,
              style: TextStyle(
                  fontSize: 16, fontWeight: FontWeight.bold, color: color)),
          Text(label, style: TextStyle(fontSize: 10, color: color)),
        ],
      ),
    );
  }
}

class _ClaimCard extends StatelessWidget {
  const _ClaimCard({required this.claim, required this.fmt});
  final Map<String, dynamic> claim;
  final String Function(num) fmt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final category = claim['category'] as String? ?? '';
    final amount = (claim['amount'] as num?) ?? 0;
    final status = claim['status'] as String? ?? 'pending';
    final date = claim['date'] as String? ?? '';
    final description = claim['description'] as String? ?? '';
    final hasReceipt = claim['receiptKey'] != null;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: _categoryColor(category).withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(_categoryIcon(category),
                  color: _categoryColor(category), size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(category.isNotEmpty ? category : 'Expense',
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600)),
                      if (hasReceipt) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.attach_file, size: 14,
                            color: Color(0xFF22C55E)),
                      ],
                    ],
                  ),
                  if (description.isNotEmpty)
                    Text(description,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.outline)),
                  Text(date,
                      style: TextStyle(
                          fontSize: 11, color: theme.colorScheme.outline)),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(fmt(amount),
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                StatusPill(status: status),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Color _categoryColor(String cat) {
    switch (cat.toLowerCase()) {
      case 'travel':
        return const Color(0xFF6366F1);
      case 'food':
        return const Color(0xFFF59E0B);
      case 'accommodation':
        return const Color(0xFF8B5CF6);
      case 'transport':
        return const Color(0xFF06B6D4);
      case 'medical':
        return const Color(0xFFEF4444);
      case 'stationery':
        return const Color(0xFF22C55E);
      default:
        return const Color(0xFF64748B);
    }
  }

  IconData _categoryIcon(String cat) {
    switch (cat.toLowerCase()) {
      case 'travel':
        return Icons.flight;
      case 'food':
        return Icons.restaurant;
      case 'accommodation':
        return Icons.hotel;
      case 'transport':
        return Icons.directions_car;
      case 'medical':
        return Icons.medical_services;
      case 'stationery':
        return Icons.edit;
      default:
        return Icons.receipt;
    }
  }
}

/// New expense claim form with receipt photo capture.
class _NewClaimTab extends ConsumerStatefulWidget {
  const _NewClaimTab();

  @override
  ConsumerState<_NewClaimTab> createState() => _NewClaimTabState();
}

class _NewClaimTabState extends ConsumerState<_NewClaimTab> {
  final _formKey = GlobalKey<FormState>();
  final _amountCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  String _category = 'travel';
  DateTime? _expenseDate;
  String? _receiptKey;
  bool _submitting = false;

  static const _categories = [
    ('travel', 'Travel (TA/DA)'),
    ('food', 'Food & Meals'),
    ('accommodation', 'Accommodation'),
    ('transport', 'Local Transport'),
    ('medical', 'Medical'),
    ('stationery', 'Stationery & Supplies'),
    ('communication', 'Communication (Phone/Internet)'),
    ('other', 'Other'),
  ];

  @override
  void dispose() {
    _amountCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _expenseDate ?? DateTime.now(),
      firstDate: DateTime(DateTime.now().year - 1),
      lastDate: DateTime.now(),
    );
    if (picked != null) setState(() => _expenseDate = picked);
  }

  Future<void> _captureReceipt() async {
    // TODO(image_picker): Use image_picker to capture receipt photo
    // Then upload to S3 presigned URL and store the key
    await Future.delayed(const Duration(milliseconds: 500));
    setState(() {
      _receiptKey = 'receipt_${DateTime.now().millisecondsSinceEpoch}.jpg';
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Receipt photo captured'),
          backgroundColor: Color(0xFF15803D),
          duration: Duration(seconds: 1),
        ),
      );
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_expenseDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select expense date')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final db = ref.read(dbProvider).valueOrNull;
      if (db == null) throw Exception('Database not ready');

      final entityId = const Uuid().v4();
      final now = DateTime.now().toUtc().toIso8601String();
      final amountPaise =
          ((double.tryParse(_amountCtrl.text) ?? 0) * 100).toInt();
      final dateStr =
          '${_expenseDate!.year}-${_expenseDate!.month.toString().padLeft(2, '0')}-${_expenseDate!.day.toString().padLeft(2, '0')}';

      final payload = {
        'entityId': entityId,
        'category': _category,
        'amount': amountPaise,
        'description': _descCtrl.text.trim(),
        'date': dateStr,
        'receiptKey': _receiptKey,
        'status': 'pending',
        'submittedAt': now,
      };

      await db.enqueueOutbox(
        mailbox: 'expenses',
        operation: 'create',
        entityId: entityId,
        payload: payload,
      );

      await db.upsertEntity(
        id: entityId,
        mailbox: 'expenses',
        data: payload,
        updatedAt: now,
        syncState: 'queued',
      );

      ref.read(syncEngineProvider)?.syncMailbox('expenses');

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Expense claim submitted for approval'),
            backgroundColor: Color(0xFF15803D),
          ),
        );
        _formKey.currentState?.reset();
        _amountCtrl.clear();
        _descCtrl.clear();
        setState(() {
          _category = 'travel';
          _expenseDate = null;
          _receiptKey = null;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          // Category
          DropdownButtonFormField<String>(
            value: _category,
            decoration: const InputDecoration(
              labelText: 'Expense Category *',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.category),
            ),
            items: _categories
                .map((c) =>
                    DropdownMenuItem(value: c.$1, child: Text(c.$2)))
                .toList(),
            onChanged: (v) => setState(() => _category = v!),
          ),
          const SizedBox(height: 16),

          // Amount
          TextFormField(
            controller: _amountCtrl,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Amount (₹) *',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.currency_rupee),
              hintText: '0.00',
            ),
            validator: (v) {
              if (v == null || v.isEmpty) return 'Amount is required';
              final num = double.tryParse(v);
              if (num == null || num <= 0) return 'Enter a valid amount';
              return null;
            },
          ),
          const SizedBox(height: 16),

          // Date
          InkWell(
            onTap: _pickDate,
            child: InputDecorator(
              decoration: const InputDecoration(
                labelText: 'Expense Date *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.calendar_today),
              ),
              child: Text(
                _expenseDate == null
                    ? 'Select date'
                    : '${_expenseDate!.day.toString().padLeft(2, '0')}/${_expenseDate!.month.toString().padLeft(2, '0')}/${_expenseDate!.year}',
                style: TextStyle(
                  color: _expenseDate == null
                      ? theme.colorScheme.outline
                      : theme.colorScheme.onSurface,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Description
          TextFormField(
            controller: _descCtrl,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Description',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
              hintText: 'Purpose, vendor name, details…',
            ),
          ),
          const SizedBox(height: 20),

          // Receipt capture
          Card(
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)),
            child: InkWell(
              onTap: _captureReceipt,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _receiptKey != null
                            ? const Color(0xFF22C55E).withOpacity(0.1)
                            : theme.colorScheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        _receiptKey != null
                            ? Icons.check_circle
                            : Icons.camera_alt,
                        color: _receiptKey != null
                            ? const Color(0xFF22C55E)
                            : theme.colorScheme.outline,
                        size: 28,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _receiptKey != null
                                ? 'Receipt captured ✓'
                                : 'Attach Receipt Photo',
                            style: theme.textTheme.titleSmall,
                          ),
                          Text(
                            _receiptKey != null
                                ? 'Tap to retake'
                                : 'Take a photo of your bill/receipt',
                            style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.outline),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right, color: Color(0xFF94A3B8)),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Submit
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.send),
            label:
                Text(_submitting ? 'Submitting…' : 'Submit Expense Claim'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
        ],
      ),
    );
  }
}
