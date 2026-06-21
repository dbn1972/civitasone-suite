import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';

class LeaveApplyScreen extends ConsumerStatefulWidget {
  const LeaveApplyScreen({super.key});

  @override
  ConsumerState<LeaveApplyScreen> createState() => _LeaveApplyScreenState();
}

class _LeaveApplyScreenState extends ConsumerState<LeaveApplyScreen> {
  final _formKey = GlobalKey<FormState>();
  final _reasonCtrl = TextEditingController();

  String _leaveType = 'casual';
  DateTime? _fromDate;
  DateTime? _toDate;
  bool _submitting = false;

  static const _leaveTypes = [
    ('casual', 'Casual Leave'),
    ('sick', 'Sick Leave'),
    ('earned', 'Earned Leave'),
    ('maternity', 'Maternity Leave'),
    ('paternity', 'Paternity Leave'),
  ];

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  int get _days {
    if (_fromDate == null || _toDate == null) return 0;
    return _toDate!.difference(_fromDate!).inDays + 1;
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? (_fromDate ?? now) : (_toDate ?? _fromDate ?? now),
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _fromDate = picked;
        if (_toDate != null && _toDate!.isBefore(picked)) _toDate = picked;
      } else {
        _toDate = picked;
      }
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_fromDate == null || _toDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select from and to dates')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final db = ref.read(dbProvider).valueOrNull;
      if (db == null) throw Exception('Database not ready');

      final entityId = const Uuid().v4();
      final iso = (DateTime d) =>
          '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

      await db.enqueueOutbox(
        mailbox: 'leave_requests',
        operation: 'create',
        entityId: entityId,
        payload: {
          'entityId': entityId,
          'leaveType': _leaveType,
          'fromDate': iso(_fromDate!),
          'toDate': iso(_toDate!),
          'days': _days,
          'reason': _reasonCtrl.text.trim(),
          'status': 'pending',
          'appliedAt': DateTime.now().toUtc().toIso8601String(),
        },
      );

      // Optimistic local insert so it shows in the list immediately.
      await db.upsertEntity(
        id: entityId,
        mailbox: 'leave_requests',
        data: {
          'leaveType': _leaveType,
          'fromDate': iso(_fromDate!),
          'toDate': iso(_toDate!),
          'days': _days,
          'reason': _reasonCtrl.text.trim(),
          'status': 'pending',
          'sync_state': 'queued',
        },
        updatedAt: DateTime.now().toUtc().toIso8601String(),
      );

      // Fire-and-forget sync.
      ref.read(syncEngineProvider)?.syncMailbox('leave_requests');

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Leave application submitted — syncing'),
            backgroundColor: Color(0xFF15803D),
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
      appBar: AppBar(title: const Text('Apply Leave')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text('Leave Details',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),

            // Leave type
            DropdownButtonFormField<String>(
              value: _leaveType,
              decoration: const InputDecoration(
                labelText: 'Leave Type *',
                border: OutlineInputBorder(),
              ),
              items: _leaveTypes
                  .map((t) => DropdownMenuItem(value: t.$1, child: Text(t.$2)))
                  .toList(),
              onChanged: (v) => setState(() => _leaveType = v!),
              validator: (v) => v == null ? 'Select leave type' : null,
            ),
            const SizedBox(height: 16),

            // Date range
            Row(children: [
              Expanded(
                child: _DateField(
                  label: 'From Date *',
                  value: _fromDate,
                  onTap: () => _pickDate(isFrom: true),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _DateField(
                  label: 'To Date *',
                  value: _toDate,
                  onTap: () => _pickDate(isFrom: false),
                ),
              ),
            ]),

            if (_fromDate != null && _toDate != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFFE0E7FF),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '$_days day${_days == 1 ? '' : 's'} of leave',
                  style: const TextStyle(
                    color: Color(0xFF4338CA),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 16),

            // Reason
            TextFormField(
              controller: _reasonCtrl,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Reason *',
                border: OutlineInputBorder(),
                hintText: 'Briefly describe the reason for leave…',
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Reason is required' : null,
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
                  : const Text('Submit Application',
                      style: TextStyle(fontSize: 16)),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField(
      {required this.label, required this.value, required this.onTap});
  final String label;
  final DateTime? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final display = value == null
        ? 'Select date'
        : '${value!.day.toString().padLeft(2, '0')}/'
            '${value!.month.toString().padLeft(2, '0')}/'
            '${value!.year}';
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        decoration: BoxDecoration(
          border: Border.all(color: Colors.grey.shade400),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label,
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
          const SizedBox(height: 2),
          Row(children: [
            const Icon(Icons.calendar_today, size: 14, color: Color(0xFF6366F1)),
            const SizedBox(width: 6),
            Text(display,
                style: TextStyle(
                    fontSize: 14,
                    color: value == null
                        ? Colors.grey.shade500
                        : Colors.grey.shade900)),
          ]),
        ]),
      ),
    );
  }
}
