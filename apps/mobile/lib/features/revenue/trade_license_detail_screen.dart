import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/error_utils.dart';
import '../../core/widgets/status_pill.dart';
import 'models.dart';

/// Trade license detail — full record for one business's license, fetched
/// directly by id so this screen also works from a deep link / QR scan at
/// the business premises.
///
/// GET /v1/revenue/trade-licenses/:id
class TradeLicenseDetailScreen extends ConsumerStatefulWidget {
  const TradeLicenseDetailScreen({super.key, required this.licenseId});

  final String licenseId;

  @override
  ConsumerState<TradeLicenseDetailScreen> createState() =>
      _TradeLicenseDetailScreenState();
}

class _TradeLicenseDetailScreenState
    extends ConsumerState<TradeLicenseDetailScreen> {
  bool _loading = true;
  String? _error;
  TradeLicense? _license;

  @override
  void initState() {
    super.initState();
    _fetchLicense();
  }

  Future<void> _fetchLicense() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/revenue/trade-licenses/${widget.licenseId}',
      );
      final data = res.data?['data'] as Map<String, dynamic>?;
      _license = data == null ? null : TradeLicense.fromJson(data);
    } catch (e) {
      _error = userFriendlyError(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _formatDate(DateTime? d) {
    if (d == null) return '—';
    return '${d.day.toString().padLeft(2, '0')}/'
        '${d.month.toString().padLeft(2, '0')}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_license?.licenseNo ?? 'License'),
        actions: [
          if (!_loading)
            IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
              onPressed: _fetchLicense,
            ),
        ],
      ),
      body: _buildBody(theme),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.error_outline, size: 64, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text('Unable to load this license', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchLicense,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ]),
        ),
      );
    }
    final license = _license;
    if (license == null) {
      return const Center(child: Text('License not found'));
    }

    final due = license.dueMinor;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(license.businessName,
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w600)),
                    ),
                    StatusPill(status: license.status.name),
                  ],
                ),
                const SizedBox(height: 4),
                Text(license.proprietorName,
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(color: theme.colorScheme.outline)),
                const Divider(height: 24),
                _DetailRow('License No.', license.licenseNo),
                _DetailRow('Business Type',
                    license.businessType.isEmpty
                        ? '—'
                        : license.businessType[0].toUpperCase() +
                            license.businessType.substring(1)),
                _DetailRow('Category', license.category),
                if (license.wardNo != null)
                  _DetailRow('Ward', license.wardNo!),
                _DetailRow('Address', license.address.isEmpty ? '—' : license.address),
                _DetailRow('Issued', _formatDate(license.issuedDate)),
                _DetailRow('Expires', _formatDate(license.expiryDate)),
                _DetailRow('Renewals', '${license.renewalCount}'),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Fees',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                _DetailRow('Annual Fee', formatTradeLicenseAmount(license.feeMinor)),
                _DetailRow('Paid', formatTradeLicenseAmount(license.feePaidMinor)),
                const Divider(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Balance Due',
                        style: theme.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    Text(
                      formatTradeLicenseAmount(due),
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: due == null
                            ? theme.colorScheme.outline
                            : due == BigInt.zero
                                ? const Color(0xFF15803D)
                                : theme.colorScheme.error,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        if (license.isExpiringSoon) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.orange.shade100,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(children: [
              Icon(Icons.schedule, color: Colors.orange.shade800),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'This license expires within 30 days.',
                  style: TextStyle(color: Colors.orange.shade800),
                ),
              ),
            ]),
          ),
        ],
      ],
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label,
                style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
          ),
        ],
      ),
    );
  }
}
