import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Asset verification — scan barcode/QR, view details, mark condition.
/// GET /v1/assets?search=
/// POST /v1/assets/:id/verify
class AssetScanScreen extends ConsumerStatefulWidget {
  const AssetScanScreen({super.key});
  @override
  ConsumerState<AssetScanScreen> createState() => _AssetScanScreenState();
}

class _AssetScanScreenState extends ConsumerState<AssetScanScreen> {
  final _searchCtrl = TextEditingController();
  bool _loading = false;
  Map<String, dynamic>? _asset;
  String? _condition;

  Future<void> _searchAsset(String query) async {
    if (query.trim().isEmpty) return;
    setState(() { _loading = true; _asset = null; });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/assets', params: {'search': query, 'limit': '1'});
      final items = (res.data?['data'] as List<dynamic>?) ?? [];
      if (items.isNotEmpty) _asset = items.first as Map<String, dynamic>;
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
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
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Asset verified ✓'), backgroundColor: Color(0xFF15803D)));
        setState(() { _asset = null; _condition = null; _searchCtrl.clear(); });
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red));
    } finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Asset Verification')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        // Search / scan
        TextField(
          controller: _searchCtrl,
          decoration: InputDecoration(
            hintText: 'Enter asset code or scan barcode',
            prefixIcon: const Icon(Icons.qr_code_scanner),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            suffixIcon: IconButton(icon: const Icon(Icons.search), onPressed: () => _searchAsset(_searchCtrl.text)),
          ),
          onSubmitted: _searchAsset,
        ),
        const SizedBox(height: 16),

        if (_loading) const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),

        if (_asset != null) ...[
          // Asset details card
          Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(Icons.inventory_2, color: theme.colorScheme.primary, size: 28),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_asset!['name'] as String? ?? 'Asset', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                Text(_asset!['assetCode'] as String? ?? '', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
              ])),
            ]),
            const SizedBox(height: 12),
            _InfoTile(label: 'Category', value: _asset!['category'] as String? ?? '—'),
            _InfoTile(label: 'Location', value: _asset!['location'] as String? ?? '—'),
            _InfoTile(label: 'Custodian', value: _asset!['custodian'] as String? ?? '—'),
            _InfoTile(label: 'Purchase Date', value: _asset!['purchaseDate'] as String? ?? '—'),
            _InfoTile(label: 'Value', value: '₹${((_asset!['value'] as num?) ?? 0) ~/ 100}'),
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
        ],
      ]),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({required this.label, required this.value});
  final String label; final String value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(children: [
      SizedBox(width: 110, child: Text(label, style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.outline))),
      Expanded(child: Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
    ]),
  );
}
