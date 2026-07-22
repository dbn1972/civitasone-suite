import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// Inventory Issue/Receipt screen.
/// Storekeepers issue items and record receipts from mobile.
/// Tab 1: Stock on Hand. Tab 2: Issue. Tab 3: Receipt.
class InventoryScreen extends ConsumerStatefulWidget {
  const InventoryScreen({super.key});

  @override
  ConsumerState<InventoryScreen> createState() =>
      _InventoryScreenState();
}

class _InventoryScreenState extends ConsumerState<InventoryScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _stockItems = [];

  // Issue form state
  String? _issueItemId;
  final _issueQtyCtrl = TextEditingController();
  final _issueDeptCtrl = TextEditingController();
  bool _issuingItem = false;

  // Receipt form state
  final _receiptItemCtrl = TextEditingController();
  final _receiptQtyCtrl = TextEditingController();
  final _receiptSourceCtrl = TextEditingController();
  bool _receivingItem = false;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
    _loadStock();
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    _issueQtyCtrl.dispose();
    _issueDeptCtrl.dispose();
    _receiptItemCtrl.dispose();
    _receiptQtyCtrl.dispose();
    _receiptSourceCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadStock() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/inventory/items');
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _stockItems = list.cast<Map<String, dynamic>>();
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (e) {
      // Try local cache
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities('inventory_stock');
        if (cached.isNotEmpty && mounted) {
          setState(() {
            _stockItems = cached
                .map((e) => e['data'] as Map<String, dynamic>)
                .toList();
            _isOffline = true;
            _loading = false;
          });
          return;
        }
      }
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
          _isOffline = true;
        });
      }
    }
  }

  Future<void> _submitIssue() async {
    if (_issueItemId == null || _issueQtyCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select item and enter quantity')),
      );
      return;
    }
    setState(() => _issuingItem = true);

    final payload = {
      'itemId': _issueItemId,
      'quantity': int.tryParse(_issueQtyCtrl.text.trim()) ?? 0,
      'recipientDepartment': _issueDeptCtrl.text.trim(),
      'issuedAt': DateTime.now().toUtc().toIso8601String(),
    };

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'inventory_issues',
        operation: 'create',
        entityId: 'issue_${DateTime.now().millisecondsSinceEpoch}',
        payload: payload,
      );
    }
    ref.read(syncEngineProvider)?.syncMailbox('inventory_issues');

    setState(() {
      _issuingItem = false;
      _issueItemId = null;
      _issueQtyCtrl.clear();
      _issueDeptCtrl.clear();
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Issue recorded — syncing'),
          backgroundColor: Color(0xFF15803D)),
      );
    }
  }

  Future<void> _submitReceipt() async {
    if (_receiptItemCtrl.text.trim().isEmpty ||
        _receiptQtyCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter item and quantity')),
      );
      return;
    }
    setState(() => _receivingItem = true);

    final payload = {
      'itemName': _receiptItemCtrl.text.trim(),
      'quantity': int.tryParse(_receiptQtyCtrl.text.trim()) ?? 0,
      'source': _receiptSourceCtrl.text.trim(),
      'receivedAt': DateTime.now().toUtc().toIso8601String(),
    };

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'inventory_receipts',
        operation: 'create',
        entityId: 'receipt_${DateTime.now().millisecondsSinceEpoch}',
        payload: payload,
      );
    }
    ref.read(syncEngineProvider)?.syncMailbox('inventory_receipts');

    setState(() {
      _receivingItem = false;
      _receiptItemCtrl.clear();
      _receiptQtyCtrl.clear();
      _receiptSourceCtrl.clear();
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Receipt recorded — syncing'),
          backgroundColor: Color(0xFF15803D)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Inventory'),
        actions: [
          Semantics(
            label: 'Refresh inventory',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadStock,
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tabCtrl,
          tabs: const [
            Tab(text: 'Stock'),
            Tab(text: 'Issue'),
            Tab(text: 'Receipt'),
          ],
        ),
      ),
      body: Column(
        children: [
          if (_isOffline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: 16, vertical: 8),
              color: Colors.orange.shade100,
              child: Row(children: [
                Icon(Icons.cloud_off,
                    size: 16, color: Colors.orange.shade800),
                const SizedBox(width: 8),
                Text('Offline — transactions queued',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.orange.shade800)),
              ]),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabCtrl,
              children: [
                _buildStockTab(context),
                _buildIssueTab(context),
                _buildReceiptTab(context),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStockTab(BuildContext context) {
    if (_loading) return const SkeletonList();
    if (_error != null && _stockItems.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _loadStock);
    }
    if (_stockItems.isEmpty) {
      return const _EmptyState(
        icon: Icons.inventory_2_outlined,
        message: 'No stock items found',
      );
    }

    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _loadStock,
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 16, top: 8),
        itemCount: _stockItems.length,
        itemBuilder: (ctx, i) {
          final item = _stockItems[i];
          return Card(
            margin: const EdgeInsets.symmetric(
              horizontal: 16, vertical: 4),
            child: ListTile(
              title: Text(
                item['name'] as String? ??
                    item['itemName'] as String? ?? '—',
                style: const TextStyle(fontWeight: FontWeight.w500),
              ),
              subtitle: Text(
                'Bin: ${item['binLocation'] ?? '—'} · '
                '${item['unit'] ?? 'units'}',
                style: TextStyle(
                  fontSize: 12,
                  color: theme.colorScheme.outline),
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '${item['quantity'] ?? item['currentQty'] ?? 0}',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                  Text(item['unit'] as String? ?? 'qty',
                      style: TextStyle(
                        fontSize: 10,
                        color: theme.colorScheme.outline)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildIssueTab(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Issue Item',
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        // Item selector
        Semantics(
          label: 'Select item to issue',
          child: DropdownButtonFormField<String>(
            value: _issueItemId,
            decoration: const InputDecoration(
              labelText: 'Item',
              border: OutlineInputBorder(),
            ),
            items: _stockItems.map((item) {
              final id = item['id'] as String? ?? '';
              final name = item['name'] as String? ??
                  item['itemName'] as String? ?? '—';
              return DropdownMenuItem(
                value: id, child: Text(name));
            }).toList(),
            onChanged: (v) => setState(() => _issueItemId = v),
          ),
        ),
        const SizedBox(height: 12),
        Semantics(
          label: 'Quantity to issue',
          child: TextField(
            controller: _issueQtyCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Quantity',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Semantics(
          label: 'Recipient department',
          child: TextField(
            controller: _issueDeptCtrl,
            decoration: const InputDecoration(
              labelText: 'Recipient Department',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: Semantics(
            label: 'Submit issue',
            child: FilledButton.icon(
              onPressed: _issuingItem ? null : _submitIssue,
              icon: _issuingItem
                  ? const SizedBox(
                      width: 20, height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.output),
              label: Text(
                _issuingItem ? 'Issuing…' : 'Issue Item'),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildReceiptTab(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Receive Item',
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        // Barcode scanner placeholder
        Semantics(
          label: 'Scan barcode area',
          child: Container(
            height: 120,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.grey.shade400),
            ),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.qr_code_scanner,
                      size: 40, color: Colors.grey.shade600),
                  const SizedBox(height: 4),
                  Text('Tap to scan barcode',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey.shade600)),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Semantics(
          label: 'Item name or code',
          child: TextField(
            controller: _receiptItemCtrl,
            decoration: const InputDecoration(
              labelText: 'Item Name / Code',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Semantics(
          label: 'Quantity received',
          child: TextField(
            controller: _receiptQtyCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Quantity',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Semantics(
          label: 'Source or supplier',
          child: TextField(
            controller: _receiptSourceCtrl,
            decoration: const InputDecoration(
              labelText: 'Source / Supplier',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: Semantics(
            label: 'Submit receipt',
            child: FilledButton.icon(
              onPressed: _receivingItem ? null : _submitReceipt,
              icon: _receivingItem
                  ? const SizedBox(
                      width: 20, height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.input),
              label: Text(
                _receivingItem ? 'Recording…' : 'Record Receipt'),
            ),
          ),
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.message});
  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon,
            size: 64,
            color: Theme.of(context).colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text(message,
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(
                  color: Theme.of(context).colorScheme.outline)),
        const SizedBox(height: 8),
        const Text('Pull down to refresh',
            style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
      ]),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load inventory',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 12, color: Color(0xFF94A3B8))),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ]),
      ),
    );
  }
}
