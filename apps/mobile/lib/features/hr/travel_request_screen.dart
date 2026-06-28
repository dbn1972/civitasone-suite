import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';
import '../../core/widgets/status_pill.dart';

/// Travel request — submit + track official travel approvals.
/// POST /v1/hrms/travel-requests (via outbox)
/// GET /v1/hrms/travel-requests
class TravelRequestScreen extends ConsumerStatefulWidget {
  const TravelRequestScreen({super.key});

  @override
  ConsumerState<TravelRequestScreen> createState() => _TravelRequestScreenState();
}

class _TravelRequestScreenState extends ConsumerState<TravelRequestScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _requests = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _fetchRequests();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchRequests() async {
    setState(() { _loading = true; _error = null; });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>('/v1/hrms/travel-requests');
      _requests = ((res.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    } catch (e) { _error = e.toString(); }
    finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Travel Requests'),
        bottom: TabBar(controller: _tabController, tabs: const [
          Tab(text: 'My Requests'),
          Tab(text: 'New Request'),
        ]),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text('Error: $_error'))
              : TabBarView(controller: _tabController, children: [
                  _buildList(),
                  _TravelForm(onSuccess: () { _tabController.animateTo(0); _fetchRequests(); }),
                ]),
    );
  }

  Widget _buildList() {
    final theme = Theme.of(context);
    if (_requests.isEmpty) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.flight, size: 64, color: theme.colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text('No travel requests', style: theme.textTheme.bodyLarge),
      ]));
    }
    return RefreshIndicator(
      onRefresh: _fetchRequests,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _requests.length,
        itemBuilder: (_, i) {
          final r = _requests[i];
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              leading: Icon(_modeIcon(r['mode'] as String? ?? 'rail'),
                  color: const Color(0xFF6366F1)),
              title: Text(r['destination'] as String? ?? ''),
              subtitle: Text('${r['from_date']} → ${r['to_date']}\n${r['purpose'] ?? ''}',
                  maxLines: 2, overflow: TextOverflow.ellipsis),
              trailing: StatusPill(status: r['status'] as String? ?? 'pending'),
              isThreeLine: true,
            ),
          );
        },
      ),
    );
  }

  IconData _modeIcon(String mode) {
    switch (mode) {
      case 'air': return Icons.flight;
      case 'rail': return Icons.train;
      case 'road': return Icons.directions_car;
      case 'own_vehicle': return Icons.two_wheeler;
      default: return Icons.directions;
    }
  }
}

class _TravelForm extends ConsumerStatefulWidget {
  const _TravelForm({required this.onSuccess});
  final VoidCallback onSuccess;

  @override
  ConsumerState<_TravelForm> createState() => _TravelFormState();
}

class _TravelFormState extends ConsumerState<_TravelForm> {
  final _formKey = GlobalKey<FormState>();
  final _destCtrl = TextEditingController();
  final _purposeCtrl = TextEditingController();
  final _advanceCtrl = TextEditingController();
  String _mode = 'rail';
  DateTime? _fromDate;
  DateTime? _toDate;
  bool _submitting = false;

  @override
  void dispose() {
    _destCtrl.dispose();
    _purposeCtrl.dispose();
    _advanceCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_fromDate == null || _toDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select travel dates')));
      return;
    }
    setState(() => _submitting = true);
    try {
      final db = ref.read(dbProvider).valueOrNull;
      if (db == null) throw Exception('Database not ready');
      final id = const Uuid().v4();
      final iso = (DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
      final payload = {
        'entityId': id,
        'destination': _destCtrl.text.trim(),
        'purpose': _purposeCtrl.text.trim(),
        'fromDate': iso(_fromDate!),
        'toDate': iso(_toDate!),
        'advanceRequired': ((double.tryParse(_advanceCtrl.text) ?? 0) * 100).toInt(),
        'mode': _mode,
        'status': 'pending',
      };
      await db.enqueueOutbox(mailbox: 'travel_requests', operation: 'create', entityId: id, payload: payload);
      await db.upsertEntity(id: id, mailbox: 'travel_requests', data: payload, updatedAt: DateTime.now().toUtc().toIso8601String(), syncState: 'queued');
      ref.read(syncEngineProvider)?.syncMailbox('travel_requests');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Travel request submitted'), backgroundColor: Color(0xFF15803D)));
        widget.onSuccess();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red));
    } finally { if (mounted) setState(() => _submitting = false); }
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: ListView(padding: const EdgeInsets.all(24), children: [
        TextFormField(
          controller: _destCtrl,
          decoration: const InputDecoration(labelText: 'Destination *', border: OutlineInputBorder(), prefixIcon: Icon(Icons.location_on)),
          validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          value: _mode,
          decoration: const InputDecoration(labelText: 'Mode of Travel', border: OutlineInputBorder(), prefixIcon: Icon(Icons.directions)),
          items: const [
            DropdownMenuItem(value: 'rail', child: Text('Rail')),
            DropdownMenuItem(value: 'air', child: Text('Air')),
            DropdownMenuItem(value: 'road', child: Text('Road')),
            DropdownMenuItem(value: 'own_vehicle', child: Text('Own Vehicle')),
          ],
          onChanged: (v) => setState(() => _mode = v!),
        ),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: InkWell(
            onTap: () async {
              final d = await showDatePicker(context: context, initialDate: DateTime.now(), firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)));
              if (d != null) setState(() => _fromDate = d);
            },
            child: InputDecorator(
              decoration: const InputDecoration(labelText: 'From *', border: OutlineInputBorder()),
              child: Text(_fromDate == null ? 'Select' : '${_fromDate!.day}/${_fromDate!.month}/${_fromDate!.year}'),
            ),
          )),
          const SizedBox(width: 12),
          Expanded(child: InkWell(
            onTap: () async {
              final d = await showDatePicker(context: context, initialDate: _fromDate ?? DateTime.now(), firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)));
              if (d != null) setState(() => _toDate = d);
            },
            child: InputDecorator(
              decoration: const InputDecoration(labelText: 'To *', border: OutlineInputBorder()),
              child: Text(_toDate == null ? 'Select' : '${_toDate!.day}/${_toDate!.month}/${_toDate!.year}'),
            ),
          )),
        ]),
        const SizedBox(height: 16),
        TextFormField(
          controller: _advanceCtrl,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Advance Required (₹)', border: OutlineInputBorder(), prefixIcon: Icon(Icons.currency_rupee)),
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: _purposeCtrl,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Purpose *', border: OutlineInputBorder(), alignLabelWithHint: true),
          validator: (v) => (v == null || v.trim().length < 5) ? 'Describe the purpose' : null,
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: _submitting ? null : _submit,
          icon: _submitting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send),
          label: Text(_submitting ? 'Submitting…' : 'Submit Travel Request'),
          style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
        ),
      ]),
    );
  }
}
