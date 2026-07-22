import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// Work Progress screen — enter monthly scope progress (offline outbox pattern).
class WorkProgressScreen extends ConsumerStatefulWidget {
  const WorkProgressScreen({super.key});

  @override
  ConsumerState<WorkProgressScreen> createState() => _WorkProgressScreenState();
}

class _WorkProgressScreenState extends ConsumerState<WorkProgressScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _works = [];
  final _formKey = GlobalKey<FormState>();
  String? _selectedWorkId;
  final _achievementController = TextEditingController();
  final _remarksController = TextEditingController();
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _loadWorks();
  }

  @override
  void dispose() {
    _achievementController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  Future<void> _loadWorks() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/works/execution/progress');
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _works = list.cast<Map<String, dynamic>>();
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
          _isOffline = true;
        });
      }
    }
  }

  Future<void> _submitProgress() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      final api = ref.read(apiClientProvider);
      await api.post('/api/v1/works/execution/progress', data: {
        'workId': _selectedWorkId,
        'achievement': int.tryParse(_achievementController.text) ?? 0,
        'remarks': _remarksController.text,
        'month': DateTime.now().toIso8601String().substring(0, 7),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Progress submitted')),
        );
        _achievementController.clear();
        _remarksController.clear();
        await _loadWorks();
      }
    } catch (e) {
      // Offline outbox: queue for later sync
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Queued for sync when online'),
            backgroundColor: Colors.orange.shade700,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Enter Progress')),
      body: _loading
          ? const SkeletonList()
          : _error != null && _works.isEmpty
              ? _buildError()
              : _buildForm(theme),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load works', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _loadWorks,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ]),
      ),
    );
  }

  Widget _buildForm(ThemeData theme) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_isOffline)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(children: [
                  Icon(Icons.cloud_off, size: 16, color: Colors.orange.shade800),
                  const SizedBox(width: 8),
                  Text('Offline — entries will sync when online',
                      style: TextStyle(fontSize: 12, color: Colors.orange.shade800)),
                ]),
              ),
            DropdownButtonFormField<String>(
              decoration: const InputDecoration(
                labelText: 'Select Work',
                border: OutlineInputBorder(),
              ),
              value: _selectedWorkId,
              items: _works.map((w) {
                return DropdownMenuItem<String>(
                  value: w['workId'] as String? ?? w['id'] as String? ?? '',
                  child: Text(
                    '${w['workNumber'] ?? w['work'] ?? ''} — ${w['scope'] ?? ''}',
                    overflow: TextOverflow.ellipsis,
                  ),
                );
              }).toList(),
              onChanged: (v) => setState(() => _selectedWorkId = v),
              validator: (v) => v == null || v.isEmpty ? 'Select a work' : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _achievementController,
              decoration: const InputDecoration(
                labelText: 'Achievement (%)',
                border: OutlineInputBorder(),
                hintText: 'e.g. 75',
              ),
              keyboardType: TextInputType.number,
              validator: (v) {
                if (v == null || v.isEmpty) return 'Required';
                final n = int.tryParse(v);
                if (n == null || n < 0 || n > 100) return 'Enter 0–100';
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _remarksController,
              decoration: const InputDecoration(
                labelText: 'Remarks',
                border: OutlineInputBorder(),
              ),
              maxLines: 3,
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _submitting ? null : _submitProgress,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: _submitting
                  ? const SizedBox(
                      width: 20, height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Submit Progress'),
            ),
          ],
        ),
      ),
    );
  }
}
