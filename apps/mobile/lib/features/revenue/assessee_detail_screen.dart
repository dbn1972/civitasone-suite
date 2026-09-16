import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/error_utils.dart';
import '../../core/widgets/status_pill.dart';
import 'assessee_models.dart';

/// Assessee detail — full record for one ratepayer, fetched directly by id
/// so this screen also works from a deep link / QR scan at the property or
/// water connection.
///
/// GET /v1/revenue/assessees/:id
class AssesseeDetailScreen extends ConsumerStatefulWidget {
  const AssesseeDetailScreen({super.key, required this.assesseeId});

  final String assesseeId;

  @override
  ConsumerState<AssesseeDetailScreen> createState() => _AssesseeDetailScreenState();
}

class _AssesseeDetailScreenState extends ConsumerState<AssesseeDetailScreen> {
  bool _loading = true;
  String? _error;
  Assessee? _assessee;

  @override
  void initState() {
    super.initState();
    _fetchAssessee();
  }

  Future<void> _fetchAssessee() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/revenue/assessees/${widget.assesseeId}',
      );
      final data = res.data?['data'] as Map<String, dynamic>?;
      _assessee = data == null ? null : Assessee.fromJson(data);
    } catch (e) {
      _error = userFriendlyError(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_assessee?.identifierNo ?? 'Assessee'),
        actions: [
          if (!_loading)
            IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
              onPressed: _fetchAssessee,
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
            Text('Unable to load this assessee', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchAssessee,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ]),
        ),
      );
    }
    final assessee = _assessee;
    if (assessee == null) {
      return const Center(child: Text('Assessee not found'));
    }

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
                      child: Text(assessee.ownerName,
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w600)),
                    ),
                    StatusPill(status: assesseeTypeLabel(assessee.assesseeType)),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    StatusPill(status: assessee.isActive ? 'active' : 'inactive'),
                  ],
                ),
                const Divider(height: 24),
                _DetailRow('Identifier No.', assessee.identifierNo),
                _DetailRow('Address', assessee.address.isEmpty ? '—' : assessee.address),
                if (assessee.wardNo != null) _DetailRow('Ward', assessee.wardNo!),
                if (assessee.zoneNo != null) _DetailRow('Zone', assessee.zoneNo!),
                if (assessee.propertyType != null)
                  _DetailRow('Property Type', _titleCase(assessee.propertyType!)),
                if (assessee.connectionSize != null)
                  _DetailRow('Connection Size', assessee.connectionSize!),
                if (assessee.builtUpArea != null)
                  _DetailRow('Built-up Area', '${assessee.builtUpArea} sq ft'),
              ],
            ),
          ),
        ),
      ],
    );
  }

  String _titleCase(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
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
            width: 120,
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
