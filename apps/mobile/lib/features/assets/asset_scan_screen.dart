import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../core/providers.dart';

/// Asset verification — live camera QR/barcode scan, view details, mark condition.
/// Uses mobile_scanner for real-time camera scanning.
/// GET /v1/assets/scan/:barcode
/// POST /v1/assets/:id/verify
class AssetScanScreen extends ConsumerStatefulWidget {
  const AssetScanScreen({super.key});
  @override
  ConsumerState<AssetScanScreen> createState() => _AssetScanScreenState();
}

class _AssetScanScreenState extends ConsumerState<AssetScanScreen> {
  final _searchCtrl = TextEditingController();
  final _scannerController = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    facing: CameraFacing.back,
    torchEnabled: false,
  );
  bool _loading = false;
  bool _showScanner = false;
  Map<String, dynamic>? _asset;
  String? _condition;

  @override
  void dispose() {
    _scannerController.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _lookupByBarcode(String barcode) async {
    if (barcode.trim().isEmpty) return;
    setState(() { _loading = true; _asset = null; _showScanner = false; });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/assets/scan/$barcode');
      if (res.data != null) {
        setState(() => _asset = res.data);
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Asset not found for this barcode'), backgroundColor: Colors.orange),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Lookup failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onBarcodeDetected(BarcodeCapture capture) {
    final barcode = capture.barcodes.firstOrNull?.rawValue;
    if (barcode == null || barcode.isEmpty) return;
    // Pause scanner to avoid multiple rapid scans
    _scannerController.stop();
    _searchCtrl.text = barcode;
    _lookupByBarcode(barcode);
  }

  Future<void> _markVerified() async {
    if (_asset == null || _condition == null) return;
    setState(() => _loading = true);
    try {
      final api = ref.read(apiClientProvider);
      await api.post<Map<String, dynamic>>('/v1/assets/${_asset!['id']}/verify', data: {
        'condition': _condition,
        'verifiedAt': DateTime.now().toUtc().toIso8601String(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Asset verified ✓'), backgroundColor: Color(0xFF15803D)),
        );
        setState(() { _asset = null; _condition = null; _searchCtrl.clear(); });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Asset Verification'),
        actions: [
          IconButton(
            icon: Icon(_showScanner ? Icons.keyboard : Icons.qr_code_scanner),
            tooltip: _showScanner ? 'Manual entry' : 'Scan QR/Barcode',
            onPressed: () {
              setState(() => _showScanner = !_showScanner);
              if (_showScanner) _scannerController.start();
            },
          ),
          if (_showScanner)
            IconButton(
              icon: const Icon(Icons.flash_on),
              tooltip: 'Toggle flash',
              onPressed: () => _scannerController.toggleTorch(),
            ),
        ],
      ),
      body: Column(children: [
        // Camera scanner area
        if (_showScanner)
          SizedBox(
            height: 250,
            child: Stack(children: [
              MobileScanner(
                controller: _scannerController,
                onDetect: _onBarcodeDetected,
              ),
              // Scanning overlay
              Center(
                child: Container(
                  width: 200, height: 200,
                  decoration: BoxDecoration(
                    border: Border.all(color: theme.colorScheme.primary, width: 2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              Positioned(
                bottom: 8, left: 0, right: 0,
                child: Text(
                  'Point camera at QR code or barcode',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white, fontSize: 12, shadows: [Shadow(blurRadius: 4)]),
                ),
              ),
            ]),
          ),

        // Manual search bar
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            controller: _searchCtrl,
            decoration: InputDecoration(
              hintText: 'Enter asset code or scan barcode',
              prefixIcon: const Icon(Icons.search),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              suffixIcon: IconButton(
                icon: const Icon(Icons.arrow_forward),
                onPressed: () => _lookupByBarcode(_searchCtrl.text),
              ),
            ),
            onSubmitted: _lookupByBarcode,
          ),
        ),

        if (_loading)
          const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),

        // Asset details + verification
        if (_asset != null)
          Expanded(child: ListView(padding: const EdgeInsets.symmetric(horizontal: 16), children: [
            Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(Icons.inventory_2, color: theme.colorScheme.primary, size: 28),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_asset!['name'] as String? ?? 'Asset', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  Text(_asset!['code'] as String? ?? _asset!['assetCode'] as String? ?? '', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
                ])),
              ]),
              const SizedBox(height: 12),
              _InfoTile(label: 'Barcode', value: _asset!['barcode'] as String? ?? '—'),
              _InfoTile(label: 'Status', value: _asset!['status'] as String? ?? '—'),
              _InfoTile(label: 'Book Value', value: '₹${((_asset!['bookValue'] as num?) ?? 0).toStringAsFixed(0)}'),
            ]))),
            const SizedBox(height: 16),

            // Condition selection
            Text('Mark Condition', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final c in ['good', 'fair', 'poor', 'damaged', 'missing'])
                ChoiceChip(label: Text(c[0].toUpperCase() + c.substring(1)), selected: _condition == c, onSelected: (_) => setState(() => _condition = c)),
            ]),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _condition == null ? null : _markVerified,
              icon: const Icon(Icons.check_circle),
              label: const Text('Mark as Verified'),
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            ),
          ])),
      ]),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(children: [
      SizedBox(width: 110, child: Text(label, style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.outline))),
      Expanded(child: Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
    ]),
  );
}
