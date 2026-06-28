import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Digital Visiting Card — beautiful business card with QR + vCard + share.
/// GET /v1/hrms/visiting-card/me
/// POST /v1/hrms/visiting-card/me/share
class VisitingCardScreen extends ConsumerStatefulWidget {
  const VisitingCardScreen({super.key});
  @override
  ConsumerState<VisitingCardScreen> createState() => _State();
}

class _State extends ConsumerState<VisitingCardScreen> {
  bool _loading = true;
  Map<String, dynamic>? _card;
  bool _showQr = false;
  bool _flipped = false; // front/back card flip

  @override
  void initState() { super.initState(); _fetch(); }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/hrms/visiting-card/me');
      _card = res.data?['data'] as Map<String, dynamic>?;
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _share(String method) async {
    final api = ref.read(apiClientProvider);
    await api.post<Map<String, dynamic>>('/v1/hrms/visiting-card/me/share', data: {'method': method});
    HapticFeedback.mediumImpact();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Card shared via $method'), backgroundColor: const Color(0xFF15803D)));
    }
  }

  // Tier-based gradient colors
  List<Color> _tierGradient(String tier) {
    switch (tier) {
      case 'gold': return [const Color(0xFFD4AF37), const Color(0xFFF5E6A3)];
      case 'silver': return [const Color(0xFF8B8B8B), const Color(0xFFD4D4D4)];
      case 'blue': return [const Color(0xFF1E40AF), const Color(0xFF3B82F6)];
      case 'emerald': return [const Color(0xFF065F46), const Color(0xFF10B981)];
      default: return [const Color(0xFF4338CA), const Color(0xFF6366F1)];
    }
  }

  Color _tierTextColor(String tier) {
    if (tier == 'gold' || tier == 'silver') return Colors.black87;
    return Colors.white;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('My Visiting Card'), actions: [
        IconButton(icon: const Icon(Icons.edit), tooltip: 'Edit Card', onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Edit coming soon — customize from web')));
        }),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _card == null
              ? _buildEmpty(theme)
              : SingleChildScrollView(padding: const EdgeInsets.all(16), child: Column(children: [
                  // THE CARD
                  GestureDetector(
                    onTap: () => setState(() => _flipped = !_flipped),
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 400),
                      child: _flipped ? _buildCardBack(theme) : _buildCardFront(theme),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text('Tap card to flip', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
                  const SizedBox(height: 24),

                  // QR Section
                  _buildQrSection(theme),
                  const SizedBox(height: 16),

                  // Share Options
                  _buildShareSection(theme),
                  const SizedBox(height: 16),

                  // Analytics
                  _buildAnalytics(theme),
                ])),
    );
  }

  Widget _buildCardFront(ThemeData theme) {
    final c = _card!;
    final name = c['name'] as String? ?? '';
    final suffix = c['suffix'] as String? ?? '';
    final designation = c['designation'] as String? ?? '';
    final department = c['department'] as String? ?? '';
    final tier = c['cardTier'] as String? ?? 'indigo';
    final gradient = _tierGradient(tier);
    final textColor = _tierTextColor(tier);

    return Container(
      key: const ValueKey('front'),
      width: double.infinity,
      height: 220,
      decoration: BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: gradient[0].withOpacity(0.4), blurRadius: 20, offset: const Offset(0, 8))],
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // Org branding
          Row(children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(color: textColor.withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
              child: Icon(Icons.account_balance, size: 16, color: textColor),
            ),
            const SizedBox(width: 8),
            Text('CivitasOne', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: textColor.withOpacity(0.7))),
            const Spacer(),
            // Tier badge
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(color: textColor.withOpacity(0.1), borderRadius: BorderRadius.circular(10)),
              child: Text(tier.toUpperCase(), style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: textColor.withOpacity(0.6), letterSpacing: 1)),
            ),
          ]),
          const Spacer(),
          // Name
          Text(
            suffix.isNotEmpty ? '$name, $suffix' : name,
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: textColor, letterSpacing: -0.5),
          ),
          const SizedBox(height: 4),
          Text(designation, style: TextStyle(fontSize: 14, color: textColor.withOpacity(0.8))),
          const SizedBox(height: 2),
          Text(department, style: TextStyle(fontSize: 12, color: textColor.withOpacity(0.6))),
          if ((c['tagline'] as String?)?.isNotEmpty == true) ...[
            const SizedBox(height: 6),
            Text(c['tagline'] as String, style: TextStyle(fontSize: 10, color: textColor.withOpacity(0.5), fontStyle: FontStyle.italic)),
          ],
        ]),
      ),
    );
  }

  Widget _buildCardBack(ThemeData theme) {
    final c = _card!;
    final tier = c['cardTier'] as String? ?? 'indigo';
    final gradient = _tierGradient(tier);
    final textColor = _tierTextColor(tier);

    return Container(
      key: const ValueKey('back'),
      width: double.infinity,
      height: 220,
      decoration: BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topRight, end: Alignment.bottomLeft, colors: gradient),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: gradient[0].withOpacity(0.4), blurRadius: 20, offset: const Offset(0, 8))],
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          if ((c['phone'] as String?)?.isNotEmpty == true)
            _ContactRow(icon: Icons.phone, value: c['phone'] as String, color: textColor),
          if ((c['altPhone'] as String?)?.isNotEmpty == true)
            _ContactRow(icon: Icons.smartphone, value: c['altPhone'] as String, color: textColor),
          if ((c['email'] as String?)?.isNotEmpty == true)
            _ContactRow(icon: Icons.email, value: c['email'] as String, color: textColor),
          if ((c['website'] as String?)?.isNotEmpty == true)
            _ContactRow(icon: Icons.language, value: c['website'] as String, color: textColor),
          if ((c['linkedIn'] as String?)?.isNotEmpty == true)
            _ContactRow(icon: Icons.link, value: 'LinkedIn', color: textColor),
          if ((c['address'] as String?)?.isNotEmpty == true)
            _ContactRow(icon: Icons.location_on, value: c['address'] as String, color: textColor),
        ]),
      ),
    );
  }

  Widget _buildQrSection(ThemeData theme) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(padding: const EdgeInsets.all(20), child: Column(children: [
        Row(children: [
          Icon(Icons.qr_code_2, color: theme.colorScheme.primary, size: 28),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Share via QR', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            Text('Others scan → your contact saves to their phone', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
          ])),
          FilledButton.tonal(onPressed: () => setState(() => _showQr = !_showQr), child: Text(_showQr ? 'Hide' : 'Show')),
        ]),
        if (_showQr) ...[
          const SizedBox(height: 20),
          Container(
            width: 180, height: 180,
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: theme.colorScheme.outlineVariant)),
            child: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(Icons.qr_code_2, size: 100, color: theme.colorScheme.onSurface),
              const SizedBox(height: 8),
              Text(_card!['qrUrl'] as String? ?? '', style: TextStyle(fontSize: 9, color: theme.colorScheme.outline)),
            ])),
          ),
          const SizedBox(height: 12),
          Text('Scan to save contact (vCard)', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
        ],
      ])),
    );
  }

  Widget _buildShareSection(ThemeData theme) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Share Card', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text('Send your digital visiting card', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
        const SizedBox(height: 16),
        Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
          _ShareBtn(icon: Icons.message, label: 'WhatsApp', color: const Color(0xFF25D366), onTap: () => _share('whatsapp')),
          _ShareBtn(icon: Icons.email, label: 'Email', color: theme.colorScheme.error, onTap: () => _share('email')),
          _ShareBtn(icon: Icons.contact_page, label: 'VCF File', color: theme.colorScheme.primary, onTap: () {
            // Copy vCard text for sharing
            final vcf = _card!['vcardText'] as String? ?? '';
            Clipboard.setData(ClipboardData(text: vcf));
            _share('vcf');
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('vCard copied — paste in any app')));
          }),
          _ShareBtn(icon: Icons.image, label: 'Image', color: theme.colorScheme.tertiary, onTap: () => _share('image')),
          _ShareBtn(icon: Icons.copy, label: 'Copy', color: theme.colorScheme.outline, onTap: () {
            final c = _card!;
            final text = '${c['name']}\n${c['designation']}\n${c['department']}\n📱 ${c['phone'] ?? ''}\n✉️ ${c['email'] ?? ''}';
            Clipboard.setData(ClipboardData(text: text));
            HapticFeedback.lightImpact();
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Contact details copied')));
          }),
        ]),
      ])),
    );
  }

  Widget _buildAnalytics(ThemeData theme) {
    final shares = (_card!['shareCount'] as num?)?.toInt() ?? 0;
    final scans = (_card!['scanCount'] as num?)?.toInt() ?? 0;
    return Row(children: [
      Expanded(child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: theme.colorScheme.primaryContainer.withOpacity(0.3), borderRadius: BorderRadius.circular(12)),
        child: Column(children: [
          Text('$shares', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: theme.colorScheme.primary)),
          Text('Times Shared', style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
        ]),
      )),
      const SizedBox(width: 12),
      Expanded(child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: theme.colorScheme.tertiaryContainer.withOpacity(0.3), borderRadius: BorderRadius.circular(12)),
        child: Column(children: [
          Text('$scans', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: theme.colorScheme.tertiary)),
          Text('QR Scans', style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
        ]),
      )),
    ]);
  }

  Widget _buildEmpty(ThemeData theme) {
    return Center(child: Padding(padding: const EdgeInsets.all(32), child: Column(mainAxisSize: MainAxisSize.min, children: [
      Icon(Icons.contact_page, size: 72, color: theme.colorScheme.outlineVariant),
      const SizedBox(height: 24),
      Text('No visiting card yet', style: theme.textTheme.titleMedium),
      const SizedBox(height: 8),
      Text('Your card will be generated from your employee profile.', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline)),
    ])));
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({required this.icon, required this.value, required this.color});
  final IconData icon; final String value; final Color color;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(children: [
      Icon(icon, size: 16, color: color.withOpacity(0.7)),
      const SizedBox(width: 10),
      Flexible(child: Text(value, style: TextStyle(fontSize: 13, color: color), overflow: TextOverflow.ellipsis)),
    ]),
  );
}

class _ShareBtn extends StatelessWidget {
  const _ShareBtn({required this.icon, required this.label, required this.color, required this.onTap});
  final IconData icon; final String label; final Color color; final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(12),
    child: SizedBox(width: 56, child: Column(mainAxisSize: MainAxisSize.min, children: [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: color.withOpacity(0.1), shape: BoxShape.circle),
        child: Icon(icon, color: color, size: 20),
      ),
      const SizedBox(height: 6),
      Text(label, style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w500)),
    ])),
  );
}
