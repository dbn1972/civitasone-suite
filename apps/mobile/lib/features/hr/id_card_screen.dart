import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/screen_security.dart';

/// Digital ID Card — employee self-service view + QR for gate verification.
/// GET /v1/hrms/id-cards/me — my active card
/// Security guards: POST /v1/hrms/id-cards/verify { qrPayload }
class IdCardScreen extends ConsumerStatefulWidget {
  const IdCardScreen({super.key});
  @override
  ConsumerState<IdCardScreen> createState() => _IdCardScreenState();
}

class _IdCardScreenState extends ConsumerState<IdCardScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _card;
  bool _showQr = false;

  @override
  void initState() { super.initState(); ScreenSecurity.enableProtection(); _fetchCard(); }

  @override
  void dispose() { ScreenSecurity.disableProtection(); super.dispose(); }

  Future<void> _fetchCard() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/hrms/id-cards/me');
      _card = res.data?['data'] as Map<String, dynamic>?;
    } catch (e) {
      final msg = e.toString();
      _error = msg.contains('NO_CARD') ? 'no_card' : msg;
    }
    finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('My ID Card')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error == 'no_card'
              ? _buildNoCard(theme)
              : _error != null
                  ? _buildError(theme)
                  : _buildCard(theme),
    );
  }

  Widget _buildCard(ThemeData theme) {
    final c = _card!;
    final name = c['holder_name'] as String? ?? '';
    final designation = c['designation'] as String? ?? '';
    final department = c['department'] as String? ?? '';
    final cardNumber = c['card_number'] as String? ?? '';
    final cardType = c['card_type'] as String? ?? 'employee';
    final validUntil = c['valid_until'] as String? ?? '';
    final employeeCode = c['employee_code'] as String? ?? '';
    final status = c['status'] as String? ?? 'active';
    final qrPayload = c['qr_payload'] as String? ?? '';
    final accessZones = (c['access_zones'] as List<dynamic>?)?.cast<String>() ?? [];
    final photoUrl = c['holder_photo_url'] as String?;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(children: [
        // The ID Card
        Container(
          width: double.infinity,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [theme.colorScheme.primary, theme.colorScheme.tertiary],
            ),
            borderRadius: BorderRadius.circular(20),
            boxShadow: [BoxShadow(color: theme.colorScheme.primary.withOpacity(0.3), blurRadius: 20, offset: const Offset(0, 10))],
          ),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // Header
              Row(children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(8)),
                  child: const Icon(Icons.account_balance, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('CivitasOne', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                  Text('Digital Identity Card', style: TextStyle(color: Colors.white70, fontSize: 11)),
                ])),
                // Status badge
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: status == 'active' ? Colors.white.withOpacity(0.2) : Colors.red.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(status.toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: status == 'active' ? Colors.white : Colors.red.shade100)),
                ),
              ]),
              const SizedBox(height: 24),

              // Photo + details
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                // Photo
                Container(
                  width: 72, height: 88,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.white.withOpacity(0.3), width: 2),
                  ),
                  child: photoUrl != null
                      ? ClipRRect(borderRadius: BorderRadius.circular(6), child: Image.network(photoUrl, fit: BoxFit.cover))
                      : Center(child: Text(name.isNotEmpty ? name[0] : '?', style: const TextStyle(fontSize: 28, color: Colors.white, fontWeight: FontWeight.bold))),
                ),
                const SizedBox(width: 16),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(name, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  Text(designation, style: const TextStyle(color: Colors.white70, fontSize: 13)),
                  Text(department, style: const TextStyle(color: Colors.white60, fontSize: 12)),
                  const SizedBox(height: 8),
                  if (employeeCode.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(color: Colors.white.withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
                      child: Text(employeeCode, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1)),
                    ),
                ])),
              ]),
              const SizedBox(height: 20),

              // Card details row
              Row(children: [
                _CardDetail(label: 'Card No', value: cardNumber),
                _CardDetail(label: 'Type', value: _typeLabel(cardType)),
                _CardDetail(label: 'Valid Until', value: validUntil),
              ]),
            ]),
          ),
        ),
        const SizedBox(height: 24),

        // QR Code section
        Card(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: Padding(padding: const EdgeInsets.all(20), child: Column(children: [
            Row(children: [
              Icon(Icons.qr_code_2, color: theme.colorScheme.primary, size: 28),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Verification QR', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                Text('Show this at the gate for entry', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
              ])),
              FilledButton.tonal(
                onPressed: () => setState(() => _showQr = !_showQr),
                child: Text(_showQr ? 'Hide' : 'Show QR'),
              ),
            ]),
            if (_showQr) ...[
              const SizedBox(height: 20),
              // QR representation (text-based — in production use qr_flutter package)
              Container(
                width: 200, height: 200,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: theme.colorScheme.outlineVariant, width: 2),
                ),
                child: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(Icons.qr_code_2, size: 100, color: theme.colorScheme.onSurface),
                  const SizedBox(height: 8),
                  Text(cardNumber, style: TextStyle(fontSize: 11, color: theme.colorScheme.outline, fontWeight: FontWeight.w600)),
                ])),
              ),
              const SizedBox(height: 12),
              // Copy QR payload for NFC/manual entry
              OutlinedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: qrPayload));
                  HapticFeedback.mediumImpact();
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Card code copied')));
                },
                icon: const Icon(Icons.copy, size: 16),
                label: const Text('Copy Card Code'),
              ),
            ],
          ])),
        ),
        const SizedBox(height: 16),

        // Access zones
        if (accessZones.isNotEmpty)
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Access Zones', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: accessZones.map((z) => Chip(
                avatar: Icon(Icons.location_on, size: 16, color: theme.colorScheme.primary),
                label: Text(z.replaceAll('_', ' ')),
              )).toList()),
            ])),
          ),
      ]),
    );
  }

  Widget _buildNoCard(ThemeData theme) {
    return Center(child: Padding(padding: const EdgeInsets.all(32), child: Column(mainAxisSize: MainAxisSize.min, children: [
      Icon(Icons.badge, size: 72, color: theme.colorScheme.outlineVariant),
      const SizedBox(height: 24),
      Text('No ID Card Issued', style: theme.textTheme.titleMedium),
      const SizedBox(height: 8),
      Text('Please contact HR to get your digital ID card issued.', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline)),
    ])));
  }

  Widget _buildError(ThemeData theme) {
    return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Icon(Icons.wifi_off, size: 64, color: theme.colorScheme.error),
      const SizedBox(height: 16),
      FilledButton.icon(onPressed: _fetchCard, icon: const Icon(Icons.refresh), label: const Text('Retry')),
    ]));
  }

  String _typeLabel(String type) {
    switch (type) {
      case 'employee': return 'Employee';
      case 'contractual': return 'Contractual';
      case 'vendor_staff': return 'Vendor Staff';
      case 'project_team': return 'Project Team';
      case 'intern': return 'Intern';
      case 'visitor': return 'Visitor';
      default: return type;
    }
  }
}

class _CardDetail extends StatelessWidget {
  const _CardDetail({required this.label, required this.value});
  final String label; final String value;
  @override
  Widget build(BuildContext context) => Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(label, style: const TextStyle(color: Colors.white60, fontSize: 10)),
    const SizedBox(height: 2),
    Text(value, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
  ]));
}
