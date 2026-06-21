import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';

class TicketCreateScreen extends ConsumerStatefulWidget {
  const TicketCreateScreen({super.key});

  @override
  ConsumerState<TicketCreateScreen> createState() => _TicketCreateScreenState();
}

class _TicketCreateScreenState extends ConsumerState<TicketCreateScreen> {
  final _formKey = GlobalKey<FormState>();
  final _subjectCtrl = TextEditingController();
  final _descCtrl = TextEditingController();

  String _priority = 'medium';
  String _category = 'general';
  bool _submitting = false;

  static const _priorities = [
    ('low', 'Low'),
    ('medium', 'Medium'),
    ('high', 'High'),
    ('critical', 'Critical'),
  ];

  static const _categories = [
    ('general', 'General'),
    ('it_support', 'IT Support'),
    ('finance', 'Finance'),
    ('hr', 'Human Resources'),
    ('procurement', 'Procurement'),
    ('facilities', 'Facilities'),
    ('other', 'Other'),
  ];

  @override
  void dispose() {
    _subjectCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _submitting = true);
    try {
      final db = ref.read(dbProvider).valueOrNull;
      if (db == null) throw Exception('Database not ready');

      final entityId = const Uuid().v4();
      final ticketNo =
          'TKT-${DateTime.now().millisecondsSinceEpoch.toString().substring(7)}';

      await db.enqueueOutbox(
        mailbox: 'helpdesk_tickets',
        operation: 'create',
        entityId: entityId,
        payload: {
          'entityId': entityId,
          'ticketNo': ticketNo,
          'subject': _subjectCtrl.text.trim(),
          'description': _descCtrl.text.trim(),
          'priority': _priority,
          'category': _category,
          'status': 'open',
          'createdAt': DateTime.now().toUtc().toIso8601String(),
        },
      );

      // Optimistic local insert.
      await db.upsertEntity(
        id: entityId,
        mailbox: 'helpdesk_tickets',
        data: {
          'ticketNo': ticketNo,
          'subject': _subjectCtrl.text.trim(),
          'description': _descCtrl.text.trim(),
          'priority': _priority,
          'category': _category,
          'status': 'open',
          'sync_state': 'queued',
        },
        updatedAt: DateTime.now().toUtc().toIso8601String(),
      );

      // Fire-and-forget sync.
      ref.read(syncEngineProvider)?.syncMailbox('helpdesk_tickets');

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Ticket $ticketNo created — syncing'),
            backgroundColor: const Color(0xFF15803D),
          ),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New Ticket')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text('Ticket Details',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),

            // Subject
            TextFormField(
              controller: _subjectCtrl,
              decoration: const InputDecoration(
                labelText: 'Subject *',
                border: OutlineInputBorder(),
                hintText: 'Brief description of the issue',
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Subject is required' : null,
            ),
            const SizedBox(height: 16),

            // Category & Priority in a row
            Row(children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _category,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Category *',
                    border: OutlineInputBorder(),
                  ),
                  items: _categories
                      .map((c) => DropdownMenuItem(
                          value: c.$1, child: Text(c.$2, overflow: TextOverflow.ellipsis)))
                      .toList(),
                  onChanged: (v) => setState(() => _category = v!),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _priority,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Priority *',
                    border: OutlineInputBorder(),
                  ),
                  items: _priorities
                      .map((p) => DropdownMenuItem(value: p.$1, child: Text(p.$2)))
                      .toList(),
                  onChanged: (v) => setState(() => _priority = v!),
                ),
              ),
            ]),
            const SizedBox(height: 16),

            // Description
            TextFormField(
              controller: _descCtrl,
              maxLines: 6,
              decoration: const InputDecoration(
                labelText: 'Description *',
                border: OutlineInputBorder(),
                hintText: 'Detailed description, steps to reproduce, impact…',
                alignLabelWithHint: true,
              ),
              validator: (v) => (v == null || v.trim().length < 10)
                  ? 'Please provide at least 10 characters'
                  : null,
            ),
            const SizedBox(height: 32),

            FilledButton(
              onPressed: _submitting ? null : _submit,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: _submitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Create Ticket', style: TextStyle(fontSize: 16)),
            ),
          ],
        ),
      ),
    );
  }
}
