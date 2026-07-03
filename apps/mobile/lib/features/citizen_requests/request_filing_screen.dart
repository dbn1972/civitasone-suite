import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../../core/providers.dart';
import 'models.dart';

/// Request filing screen: category → form → submit. ONE action: file a request.
class RequestFilingScreen extends ConsumerStatefulWidget {
  const RequestFilingScreen({super.key, this.connectivityOverride});

  final bool? connectivityOverride;

  @override
  ConsumerState<RequestFilingScreen> createState() =>
      _RequestFilingScreenState();
}

class _RequestFilingScreenState extends ConsumerState<RequestFilingScreen> {
  bool _isOffline = false;
  bool _submitting = false;
  RequestCategory? _selectedCategory;
  RequestPriority _priority = RequestPriority.medium;

  final _subjectController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _checkConnectivity();
  }

  @override
  void dispose() {
    _subjectController.dispose();
    _descriptionController.dispose();
    _nameController.dispose();
    _phoneController.dispose();
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

  Future<void> _submit() async {
    if (_selectedCategory == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a category')),
      );
      return;
    }
    if (_subjectController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a subject')),
      );
      return;
    }

    setState(() => _submitting = true);

    final request = CitizenRequest(
      id: const Uuid().v4(),
      tenantId: '',
      requestNo: _generateRequestNo(),
      category: _selectedCategory!,
      subject: _subjectController.text.trim(),
      description: _descriptionController.text.trim(),
      status: RequestStatus.submitted,
      priority: _priority,
      createdAt: DateTime.now().toUtc(),
      timeline: [
        RequestTimelineEntry(
          id: const Uuid().v4(),
          action: 'Request submitted',
          actor: _nameController.text.trim().isEmpty
              ? 'Citizen'
              : _nameController.text.trim(),
          timestamp: DateTime.now().toUtc(),
          toStatus: RequestStatus.submitted,
        ),
      ],
      citizenName: _nameController.text.trim().isEmpty
          ? null
          : _nameController.text.trim(),
      citizenPhone: _phoneController.text.trim().isEmpty
          ? null
          : _phoneController.text.trim(),
      slaDeadline: DateTime.now().toUtc().add(const Duration(hours: 72)),
    );

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'citizen_requests',
        operation: 'create',
        entityId: request.id,
        payload: request.toJson(),
      );
      await db.upsertEntity(
        id: request.id,
        mailbox: 'citizen_requests',
        data: request.toJson(),
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        syncState: 'pending',
      );
    }

    ref.read(syncEngineProvider)?.syncMailbox('citizen_requests');

    setState(() => _submitting = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Request ${request.requestNo} filed successfully'),
          backgroundColor: Colors.green,
        ),
      );
      Navigator.of(context).pop();
    }
  }

  String _generateRequestNo() {
    final year = DateTime.now().year;
    final seq = DateTime.now().millisecondsSinceEpoch % 10000;
    return 'REQ-$year-${seq.toString().padLeft(4, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Ensure dbProvider is watched so it resolves before submit.
    ref.watch(dbProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('File Request'),
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
                    'Offline — request will be submitted when connected',
                    style:
                        TextStyle(fontSize: 12, color: Colors.orange.shade800),
                  ),
                ],
              ),
            ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Category selection
                Text('Category', style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: RequestCategory.values.map((cat) {
                    final selected = _selectedCategory == cat;
                    return ChoiceChip(
                      label: Text(_categoryLabel(cat)),
                      selected: selected,
                      onSelected: (_) =>
                          setState(() => _selectedCategory = cat),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 20),

                // Subject
                TextField(
                  controller: _subjectController,
                  decoration: const InputDecoration(
                    labelText: 'Subject',
                    hintText: 'Brief description of your request',
                    border: OutlineInputBorder(),
                  ),
                  textCapitalization: TextCapitalization.sentences,
                ),
                const SizedBox(height: 12),

                // Description
                TextField(
                  controller: _descriptionController,
                  decoration: const InputDecoration(
                    labelText: 'Description',
                    hintText: 'Provide details...',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                ),
                const SizedBox(height: 12),

                // Priority
                DropdownButtonFormField<RequestPriority>(
                  value: _priority,
                  decoration: const InputDecoration(
                    labelText: 'Priority',
                    border: OutlineInputBorder(),
                  ),
                  items: RequestPriority.values
                      .map((p) => DropdownMenuItem(
                          value: p, child: Text(p.name.toUpperCase())))
                      .toList(),
                  onChanged: (v) => setState(
                      () => _priority = v ?? RequestPriority.medium),
                ),
                const SizedBox(height: 20),

                // Contact info
                Text('Contact Information (optional)',
                    style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                TextField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: 'Name',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.person),
                  ),
                  textCapitalization: TextCapitalization.words,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _phoneController,
                  decoration: const InputDecoration(
                    labelText: 'Phone',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.phone),
                  ),
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),

          // Sticky submit button
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.05),
                  blurRadius: 8,
                  offset: const Offset(0, -2),
                ),
              ],
            ),
            child: SafeArea(
              child: SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Submit Request',
                          style: TextStyle(fontSize: 16)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _categoryLabel(RequestCategory cat) => switch (cat) {
        RequestCategory.water => 'Water',
        RequestCategory.electricity => 'Electricity',
        RequestCategory.roads => 'Roads',
        RequestCategory.sanitation => 'Sanitation',
        RequestCategory.property => 'Property',
        RequestCategory.certificates => 'Certificates',
        RequestCategory.permits => 'Permits',
        RequestCategory.complaints => 'Complaints',
        RequestCategory.other => 'Other',
      };
}
