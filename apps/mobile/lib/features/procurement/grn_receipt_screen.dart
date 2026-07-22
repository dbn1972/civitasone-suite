import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// GRN Receipt screen.
/// Warehouse officer scans delivery challan, matches with PO,
/// confirms quantities, and submits GRN.
class GrnReceiptScreen extends ConsumerStatefulWidget {
  const GrnReceiptScreen({super.key});

  @override
  ConsumerState<GrnReceiptScreen> createState() => _GrnReceiptScreenState();
}

enum _GrnStep { scan, review, confirm }

class _GrnReceiptScreenState extends ConsumerState<GrnReceiptScreen> {
  _GrnStep _step = _GrnStep.scan;
  bool _loading = false;
  bool _isOffline = false;
  String? _error;
  String? _scannedPoId;
  Map<String, dynamic>? _poData;
  final Map<String, TextEditingController> _qtyControllers = {};
  bool _submitting = false;

  Future<void> _onScan(String poId) async {
    setState(() {
      _scannedPoId = poId;
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/procurement/pos/$poId');
      final data = response.data is Map<String, dynamic>
          ? response.data as Map<String, dynamic>
          : (response.data['data'] as Map<String, dynamic>);

      // Init quantity controllers for each line item
      final items = (data['items'] as List?) ?? [];
      for (final item in items) {
        final id = item['id'] as String? ?? '';
        _qtyControllers[id] = TextEditingController(
          text: '${item['orderedQty'] ?? item['quantity'] ?? 0}',
        );
      }

      if (mounted) {
        setState(() {
          _poData = data;
          _loading = false;
          _step = _GrnStep.review;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _submitGrn() async {
    if (_poData == null) return;
    setState(() => _submitting = true);

    final items = (_poData!['items'] as List?) ?? [];
    final receivedItems = items.map((item) {
      final id = item['id'] as String? ?? '';
      final qty = int.tryParse(
        _qtyControllers[id]?.text ?? '0',
      ) ?? 0;
      return {
        'itemId': id,
        'itemName': item['name'] ?? item['itemName'],
        'receivedQty': qty,
      };
    }).toList();

    final grnPayload = {
      'poId': _scannedPoId,
      'items': receivedItems,
      'receivedAt': DateTime.now().toUtc().toIso8601String(),
    };

    // Queue via outbox for offline support
    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      final entityId = 'grn_${DateTime.now().millisecondsSinceEpoch}';
      await db.enqueueOutbox(
        mailbox: 'grn_receipts',
        operation: 'create',
        entityId: entityId,
        payload: grnPayload,
      );
    }

    ref.read(syncEngineProvider)?.syncMailbox('grn_receipts');

    setState(() => _submitting = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('GRN submitted — syncing to server'),
          backgroundColor: Color(0xFF15803D),
        ),
      );
      setState(() {
        _step = _GrnStep.scan;
        _poData = null;
        _scannedPoId = null;
        _qtyControllers.clear();
      });
    }
  }

  @override
  void dispose() {
    for (final c in _qtyControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('GRN Receipt'),
        actions: [
          if (_step != _GrnStep.scan)
            IconButton(
              tooltip: 'Start over',
              icon: const Icon(Icons.restart_alt),
              onPressed: () => setState(() {
                _step = _GrnStep.scan;
                _poData = null;
                _scannedPoId = null;
                _qtyControllers.clear();
              }),
            ),
        ],
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
                Text('Offline — GRN will sync when connected',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.orange.shade800)),
              ]),
            ),
          Expanded(child: _buildStep(context)),
        ],
      ),
    );
  }

  Widget _buildStep(BuildContext context) {
    switch (_step) {
      case _GrnStep.scan:
        return _buildScanStep(context);
      case _GrnStep.review:
        return _buildReviewStep(context);
      case _GrnStep.confirm:
        return _buildReviewStep(context);
    }
  }

  Widget _buildScanStep(BuildContext context) {
    final theme = Theme.of(context);
    final poIdCtrl = TextEditingController();

    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Camera scanner placeholder
        Semantics(
          label: 'Camera scanner area for delivery barcode',
          child: Container(
            height: 240,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.grey.shade400),
            ),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.qr_code_scanner,
                      size: 64, color: Colors.grey.shade600),
                  const SizedBox(height: 12),
                  Text('Point camera at delivery barcode/QR',
                      style: TextStyle(
                        color: Colors.grey.shade600)),
                  const SizedBox(height: 4),
                  Text('(Camera scanner placeholder)',
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.grey.shade500)),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 24),
        Text('Or enter PO number manually:',
            style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: Semantics(
                label: 'Purchase order number input',
                child: TextField(
                  controller: poIdCtrl,
                  decoration: const InputDecoration(
                    hintText: 'PO Number or ID',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Semantics(
              label: 'Fetch purchase order',
              child: FilledButton(
                onPressed: () {
                  final id = poIdCtrl.text.trim();
                  if (id.isNotEmpty) _onScan(id);
                },
                child: const Text('Fetch'),
              ),
            ),
          ],
        ),
        if (_error != null) ...[
          const SizedBox(height: 16),
          Text(_error!,
              style: const TextStyle(color: Color(0xFFEF4444))),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: () {
              if (_scannedPoId != null) _onScan(_scannedPoId!);
            },
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ],
    );
  }

  Widget _buildReviewStep(BuildContext context) {
    if (_poData == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final items = (_poData!['items'] as List?) ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // PO Summary
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('PO: ${_poData!['poNumber'] ?? _scannedPoId}',
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(
                  'Vendor: ${_poData!['vendor'] ?? '—'}',
                  style: TextStyle(
                    fontSize: 13,
                    color: theme.colorScheme.outline),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text('Confirm Received Quantities:',
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),

        // Item checklist
        ...items.asMap().entries.map((entry) {
          final item = entry.value as Map<String, dynamic>;
          final id = item['id'] as String? ?? '${entry.key}';
          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item['name'] as String? ??
                              item['itemName'] as String? ?? '—',
                          style: const TextStyle(
                            fontWeight: FontWeight.w500),
                        ),
                        Text(
                          'Ordered: ${item['orderedQty'] ?? item['quantity'] ?? 0} '
                          '${item['unit'] ?? ''}',
                          style: TextStyle(
                            fontSize: 12,
                            color: theme.colorScheme.outline),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(
                    width: 80,
                    child: Semantics(
                      label: 'Received quantity for ${item['name'] ?? 'item'}',
                      child: TextField(
                        controller: _qtyControllers[id],
                        keyboardType: TextInputType.number,
                        textAlign: TextAlign.center,
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 8, vertical: 8),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
        const SizedBox(height: 24),

        // Submit button
        SizedBox(
          height: 48,
          child: Semantics(
            label: 'Submit GRN',
            child: FilledButton.icon(
              onPressed: _submitting ? null : _submitGrn,
              icon: _submitting
                  ? const SizedBox(
                      width: 20, height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check_circle),
              label: Text(_submitting ? 'Submitting…' : 'Submit GRN'),
            ),
          ),
        ),
      ],
    );
  }
}
