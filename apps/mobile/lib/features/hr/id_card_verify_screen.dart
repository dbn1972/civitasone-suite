import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// ID Card Verification — security guard scans QR to verify identity at gate.
/// POST /v1/hrms/id-cards/verify { qrPayload, location }
class IdCardVerifyScreen extends ConsumerStatefulWidget {
  const IdCardVerifyScreen({super.key});
  @override
  ConsumerState<IdCardVerifyScreen> createState() => _State();
}

class _State extends ConsumerState<IdCardVerifyScreen> {
  final _qrCtrl = TextEditingController();
  bool _verifying = false;
  Map<String, dynamic>? _result;
  String? _resultStatus;

  Future<void> _verify() async {
    final payload = _qrCtrl.text.trim();
    if (payload.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Scan or enter card code')));
      return;
    }
    setState(() { _verifying = true; _result = null; _resultStatus = null; });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.post<Map<String, dynamic>>('/v1/hrms/id-cards/verify', data: {
        'qrPayload': payload,
        'location': 'main_gate',
      });
      _resultStatus = res.data?['result'] as String? ?? 'unknown';
      _result = res.data?['card'] as Map<String, dynamic>?;
      HapticFeedback.mediumImpact();
    } catch (e) {
      _resultStatus = 'error';
      HapticFeedback.heavyImpact();
    }
    finally { if (mounted) setState(() => _verifying = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Verify ID Card')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        // Scanner input
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [
          Icon(Icons.qr_code_scanner, size: 48, color: theme.colorScheme.primary),
          const SizedBox(height: 12),
          Text('Scan QR Code', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text('Point camera at employee ID card QR or enter code manually', textAlign: TextAlign.center, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
          const SizedBox(height: 16),
          TextField(
            controller: _qrCtrl,
            decoration: InputDecoration(
              hintText: 'Enter card code (CVO1:...)',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              prefixIcon: const Icon(Icons.badge),
              suffixIcon: IconButton(icon: const Icon(Icons.camera_alt), onPressed: () {
                // TODO: barcode_scan package integration
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Camera scanner coming soon')));
              }),
            ),
            onSubmitted: (_) => _verify(),
          ),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, child: FilledButton.icon(
            onPressed: _verifying ? null : _verify,
            icon: _verifying ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.verified_user),
            label: Text(_verifying ? 'Verifying…' : 'Verify Card'),
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
          )),
        ]))),
        const SizedBox(height: 24),

        // Result
        if (_resultStatus != null) _buildResult(theme),
      ]),
    );
  }

  Widget _buildResult(ThemeData theme) {
    final isValid = _resultStatus == 'valid';
    final color = isValid ? const Color(0xFF22C55E) : theme.colorScheme.error;
    final icon = isValid ? Icons.check_circle : _resultStatus == 'expired' ? Icons.timer_off : Icons.cancel;
    final label = switch (_resultStatus) {
      'valid' => 'VERIFIED — Access Granted',
      'expired' => 'EXPIRED — Access Denied',
      'suspended' => 'SUSPENDED — Contact HR',
      'revoked' => 'REVOKED — Access Denied',
      'unknown' => 'UNKNOWN CARD',
      _ => 'ERROR',
    };

    return Card(
      color: color.withOpacity(0.05),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: color.withOpacity(0.3))),
      child: Padding(padding: const EdgeInsets.all(24), child: Column(children: [
        Icon(icon, color: color, size: 56),
        const SizedBox(height: 12),
        Text(label, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: color), textAlign: TextAlign.center),

        if (_result != null) ...[
          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 16),
          // Person details
          Row(children: [
            CircleAvatar(radius: 28, backgroundColor: theme.colorScheme.primaryContainer,
              child: Text((_result!['holderName'] as String? ?? '?')[0], style: TextStyle(fontSize: 22, color: theme.colorScheme.primary))),
            const SizedBox(width: 16),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_result!['holderName'] as String? ?? '', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              Text(_result!['designation'] as String? ?? '', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
              Text(_result!['department'] as String? ?? '', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
            ])),
          ]),
          const SizedBox(height: 16),
          // Details grid
          Row(children: [
            _DetailChip(icon: Icons.badge, label: _result!['cardNumber'] as String? ?? ''),
            const SizedBox(width: 8),
            _DetailChip(icon: Icons.category, label: _result!['cardType'] as String? ?? ''),
          ]),
          if (_result!['vendorName'] != null) ...[
            const SizedBox(height: 8),
            _DetailChip(icon: Icons.business, label: 'Vendor: ${_result!['vendorName']}'),
          ],
          const SizedBox(height: 8),
          _DetailChip(icon: Icons.calendar_today, label: 'Valid until: ${_result!['validUntil'] ?? '—'}'),
        ],
      ])),
    );
  }
}

class _DetailChip extends StatelessWidget {
  const _DetailChip({required this.icon, required this.label});
  final IconData icon; final String label;
  @override
  Widget build(BuildContext context) => Expanded(child: Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(8)),
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, size: 14, color: Theme.of(context).colorScheme.outline),
      const SizedBox(width: 6),
      Flexible(child: Text(label, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurface), overflow: TextOverflow.ellipsis)),
    ]),
  ));
}
