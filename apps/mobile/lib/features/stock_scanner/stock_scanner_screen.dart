import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../../core/providers.dart';
import 'models.dart';

/// Stock scanner screen with camera viewfinder, mode chips, and scan result.
class StockScannerScreen extends ConsumerStatefulWidget {
  const StockScannerScreen({super.key, this.connectivityOverride});

  final bool? connectivityOverride;

  @override
  ConsumerState<StockScannerScreen> createState() =>
      _StockScannerScreenState();
}

class _StockScannerScreenState extends ConsumerState<StockScannerScreen> {
  ScannerMode _mode = ScannerMode.lookup;
  bool _isOffline = false;
  bool _scanning = true;
  StockItem? _scannedItem;
  String? _scanError;

  // Goods receipt fields
  final _qtyController = TextEditingController(text: '1');
  final _batchController = TextEditingController();

  // Adjustment fields
  final _adjustQtyController = TextEditingController();
  AdjustmentReason _adjustReason = AdjustmentReason.correction;

  @override
  void initState() {
    super.initState();
    _checkConnectivity();
  }

  @override
  void dispose() {
    _qtyController.dispose();
    _batchController.dispose();
    _adjustQtyController.dispose();
    super.dispose();
  }

  Future<void> _checkConnectivity() async {
    final override = widget.connectivityOverride;
    if (override != null) {
      if (mounted) setState(() => _isOffline = !override);
      return;
    }
    try {
      final result = await Connectivity().checkConnectivity();
      if (mounted) {
        setState(() {
          _isOffline =
              result.isEmpty || result.first == ConnectivityResult.none;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isOffline = false);
    }
  }

  Future<void> _simulateScan() async {
    setState(() {
      _scanning = true;
      _scannedItem = null;
      _scanError = null;
    });
    await Future.delayed(const Duration(milliseconds: 1200));
    if (mounted) {
      setState(() {
        _scanning = false;
        _scannedItem = const StockItem(
          id: 'demo-item-1',
          tenantId: 'tenant-1',
          sku: 'SKU-001',
          name: 'A4 Paper Ream',
          currentQty: 150,
          unit: 'pcs',
          barcode: '8901234567890',
          category: 'Stationery',
          location: 'Shelf A-3',
          minQty: 50,
          maxQty: 500,
        );
      });
    }
  }

  Future<void> _submitGoodsReceipt() async {
    if (_scannedItem == null) return;
    final qty = int.tryParse(_qtyController.text) ?? 0;
    if (qty <= 0) return;

    final receipt = GoodsReceiptRecord(
      id: const Uuid().v4(),
      tenantId: '',
      itemId: _scannedItem!.id,
      itemName: _scannedItem!.name,
      receivedQty: qty,
      receivedAt: DateTime.now().toUtc(),
      receivedBy: 'current-user',
      batchNo:
          _batchController.text.trim().isEmpty ? null : _batchController.text.trim(),
    );

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'goods_receipts',
        operation: 'create',
        entityId: receipt.id,
        payload: receipt.toJson(),
      );
    }
    ref.read(syncEngineProvider)?.syncMailbox('goods_receipts');

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Received $qty ${_scannedItem!.unit} of ${_scannedItem!.name}')),
      );
      _resetScan();
    }
  }

  Future<void> _submitAdjustment() async {
    if (_scannedItem == null) return;
    final newQty = int.tryParse(_adjustQtyController.text) ?? 0;
    if (newQty < 0) return;

    final adjustment = StockAdjustment(
      id: const Uuid().v4(),
      tenantId: '',
      itemId: _scannedItem!.id,
      itemName: _scannedItem!.name,
      previousQty: _scannedItem!.currentQty,
      adjustedQty: newQty,
      reason: _adjustReason,
      adjustedAt: DateTime.now().toUtc(),
      adjustedBy: 'current-user',
    );

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'stock_adjustments',
        operation: 'create',
        entityId: adjustment.id,
        payload: adjustment.toJson(),
      );
    }
    ref.read(syncEngineProvider)?.syncMailbox('stock_adjustments');

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                'Adjusted ${_scannedItem!.name}: ${_scannedItem!.currentQty} → $newQty')),
      );
      _resetScan();
    }
  }

  void _resetScan() {
    setState(() {
      _scannedItem = null;
      _scanning = true;
      _qtyController.text = '1';
      _batchController.clear();
      _adjustQtyController.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Ensure dbProvider resolves before submit.
    ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Stock Scanner'),
        centerTitle: false,
      ),
      body: Column(
        children: [
          if (_isOffline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.orange.shade100,
              child: Row(
                children: [
                  Icon(Icons.cloud_off,
                      size: 16, color: Colors.orange.shade800),
                  const SizedBox(width: 8),
                  Text(
                    'Offline — changes will sync later',
                    style:
                        TextStyle(fontSize: 12, color: Colors.orange.shade800),
                  ),
                ],
              ),
            ),

          // Mode chips
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: ScannerMode.values.map((mode) {
                final selected = _mode == mode;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(_modeLabel(mode)),
                    selected: selected,
                    onSelected: (_) => setState(() => _mode = mode),
                  ),
                );
              }).toList(),
            ),
          ),

          // Scanner viewfinder or result
          Expanded(
            child: _scannedItem == null
                ? _buildScannerView(theme)
                : _buildResultView(theme),
          ),
        ],
      ),
    );
  }

  Widget _buildScannerView(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 240,
            height: 240,
            decoration: BoxDecoration(
              border: Border.all(color: theme.colorScheme.primary, width: 2),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Center(
              child: _scanning
                  ? Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.qr_code_scanner,
                            size: 64, color: theme.colorScheme.primary),
                        const SizedBox(height: 8),
                        const Text('Point at barcode'),
                      ],
                    )
                  : _scanError != null
                      ? Text(_scanError!,
                          style: const TextStyle(color: Colors.red))
                      : const CircularProgressIndicator(),
            ),
          ),
          const SizedBox(height: 16),
          // Manual scan trigger for demo
          FilledButton.icon(
            onPressed: _simulateScan,
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('Scan'),
            style: FilledButton.styleFrom(
              padding:
                  const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildResultView(ThemeData theme) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Item info card
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_scannedItem!.name,
                    style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                _InfoRow('SKU', _scannedItem!.sku),
                _InfoRow('Current Qty',
                    '${_scannedItem!.currentQty} ${_scannedItem!.unit}'),
                if (_scannedItem!.location != null)
                  _InfoRow('Location', _scannedItem!.location!),
                if (_scannedItem!.category != null)
                  _InfoRow('Category', _scannedItem!.category!),
                if (_scannedItem!.isBelowMin)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.red.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text('LOW STOCK',
                          style: TextStyle(
                              color: Colors.red,
                              fontSize: 11,
                              fontWeight: FontWeight.bold)),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Mode-specific actions
        if (_mode == ScannerMode.goodsReceipt) ...[
          Text('Goods Receipt', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          TextField(
            controller: _qtyController,
            decoration: const InputDecoration(
              labelText: 'Quantity received',
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _batchController,
            decoration: const InputDecoration(
              labelText: 'Batch No. (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 52,
            width: double.infinity,
            child: FilledButton(
              onPressed: _submitGoodsReceipt,
              child: const Text('Confirm Receipt'),
            ),
          ),
        ] else if (_mode == ScannerMode.adjustment) ...[
          Text('Stock Adjustment', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          TextField(
            controller: _adjustQtyController,
            decoration: InputDecoration(
              labelText: 'New quantity',
              border: const OutlineInputBorder(),
              helperText: 'Current: ${_scannedItem!.currentQty}',
            ),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<AdjustmentReason>(
            value: _adjustReason,
            decoration: const InputDecoration(
              labelText: 'Reason',
              border: OutlineInputBorder(),
            ),
            items: AdjustmentReason.values
                .map((r) => DropdownMenuItem(
                    value: r, child: Text(r.name)))
                .toList(),
            onChanged: (v) =>
                setState(() => _adjustReason = v ?? AdjustmentReason.correction),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 52,
            width: double.infinity,
            child: FilledButton(
              onPressed: _submitAdjustment,
              child: const Text('Submit Adjustment'),
            ),
          ),
        ],

        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: _resetScan,
          icon: const Icon(Icons.qr_code_scanner),
          label: const Text('Scan Another'),
        ),
      ],
    );
  }

  String _modeLabel(ScannerMode mode) => switch (mode) {
        ScannerMode.lookup => 'Lookup',
        ScannerMode.goodsReceipt => 'Receive',
        ScannerMode.adjustment => 'Adjust',
      };
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(color: Theme.of(context).colorScheme.outline)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}
