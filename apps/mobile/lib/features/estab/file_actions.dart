import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

// ─── 1. AddNotingBottomSheet ───────────────────────────────────────────────────

/// Modal bottom sheet for adding a green or yellow noting to a file.
/// POST /v1/estab/files/:fileId/notings { body, type }
class AddNotingBottomSheet extends ConsumerStatefulWidget {
  const AddNotingBottomSheet({
    super.key,
    required this.fileId,
    required this.onSuccess,
  });

  final String fileId;
  final VoidCallback onSuccess;

  @override
  ConsumerState<AddNotingBottomSheet> createState() =>
      _AddNotingBottomSheetState();
}

class _AddNotingBottomSheetState extends ConsumerState<AddNotingBottomSheet> {
  final _formKey = GlobalKey<FormState>();
  final _bodyCtrl = TextEditingController();
  String _noteType = 'green_note';
  bool _submitting = false;

  @override
  void dispose() {
    _bodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      final api = ref.read(apiClientProvider);
      await api.post(
        '/v1/estab/files/${widget.fileId}/notings',
        data: {'body': _bodyCtrl.text.trim(), 'type': _noteType},
      );
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Noting added')),
      );
      widget.onSuccess();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${_extractError(e)}')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Add Noting',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            // Note type segmented control
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'green_note',
                  label: Text('Green Note'),
                  icon: Icon(Icons.note, size: 16),
                ),
                ButtonSegment(
                  value: 'yellow_note',
                  label: Text('Yellow Note'),
                  icon: Icon(Icons.sticky_note_2, size: 16),
                ),
              ],
              selected: {_noteType},
              onSelectionChanged: (v) => setState(() => _noteType = v.first),
            ),
            const SizedBox(height: 16),
            // Noting body
            TextFormField(
              controller: _bodyCtrl,
              decoration: const InputDecoration(
                labelText: 'Noting',
                hintText: 'Enter your noting here...',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
              maxLines: 5,
              minLines: 3,
              textInputAction: TextInputAction.newline,
              validator: (v) {
                if (v == null || v.trim().isEmpty) return 'Noting is required';
                if (v.trim().length < 10) return 'Minimum 10 characters';
                return null;
              },
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Submit'),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── 2. ForwardFileBottomSheet ─────────────────────────────────────────────────

/// Modal bottom sheet for forwarding a file to another officer.
/// POST /v1/estab/files/:fileId/forward { toOfficerId, remarks }
class ForwardFileBottomSheet extends ConsumerStatefulWidget {
  const ForwardFileBottomSheet({
    super.key,
    required this.fileId,
    required this.onSuccess,
  });

  final String fileId;
  final VoidCallback onSuccess;

  @override
  ConsumerState<ForwardFileBottomSheet> createState() =>
      _ForwardFileBottomSheetState();
}

class _ForwardFileBottomSheetState
    extends ConsumerState<ForwardFileBottomSheet> {
  final _remarksCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();
  bool _submitting = false;
  bool _searching = false;
  List<Map<String, dynamic>> _officers = [];
  Map<String, dynamic>? _selectedOfficer;

  @override
  void dispose() {
    _remarksCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _searchOfficers(String query) async {
    if (query.trim().length < 2) {
      setState(() => _officers = []);
      return;
    }
    setState(() => _searching = true);
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/estab/officers',
        params: {'q': query.trim()},
      );
      final data =
          ((res.data?['data'] as List<dynamic>?) ?? [])
              .cast<Map<String, dynamic>>();
      if (mounted) setState(() => _officers = data);
    } catch (_) {
      // Silently fail search — user can retry
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _submit() async {
    if (_selectedOfficer == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select an officer')),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final api = ref.read(apiClientProvider);
      final body = <String, dynamic>{
        'toOfficerId': _selectedOfficer!['id'] as String,
      };
      final remarks = _remarksCtrl.text.trim();
      if (remarks.isNotEmpty) body['remarks'] = remarks;

      await api.post('/v1/estab/files/${widget.fileId}/forward', data: body);
      if (!mounted) return;
      Navigator.pop(context);
      final name = _selectedOfficer!['name'] as String? ?? 'officer';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('File forwarded to $name')),
      );
      widget.onSuccess();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${_extractError(e)}')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Forward File',
            style: theme.textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          // Officer search
          TextFormField(
            controller: _searchCtrl,
            decoration: InputDecoration(
              labelText: 'Search Officer',
              hintText: 'Type name or designation...',
              border: const OutlineInputBorder(),
              suffixIcon: _searching
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : const Icon(Icons.search),
            ),
            onChanged: _searchOfficers,
          ),
          // Officer suggestions
          if (_officers.isNotEmpty)
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 150),
              child: Card(
                margin: const EdgeInsets.only(top: 4),
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: _officers.length,
                  itemBuilder: (_, i) {
                    final o = _officers[i];
                    final name = o['name'] as String? ?? '';
                    final designation = o['designation'] as String? ?? '';
                    final isSelected = _selectedOfficer?['id'] == o['id'];
                    return ListTile(
                      dense: true,
                      selected: isSelected,
                      leading: CircleAvatar(
                        radius: 16,
                        backgroundColor: theme.colorScheme.primaryContainer,
                        child: Text(
                          name.isNotEmpty ? name[0].toUpperCase() : '?',
                          style: TextStyle(
                            color: theme.colorScheme.primary,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      title: Text(name),
                      subtitle:
                          designation.isNotEmpty ? Text(designation) : null,
                      onTap: () {
                        setState(() {
                          _selectedOfficer = o;
                          _searchCtrl.text = name;
                          _officers = [];
                        });
                      },
                    );
                  },
                ),
              ),
            ),
          // Selected officer chip
          if (_selectedOfficer != null) ...[
            const SizedBox(height: 8),
            Chip(
              avatar: const Icon(Icons.person, size: 18),
              label: Text(
                _selectedOfficer!['name'] as String? ?? 'Selected',
              ),
              onDeleted: () => setState(() {
                _selectedOfficer = null;
                _searchCtrl.clear();
              }),
            ),
          ],
          const SizedBox(height: 16),
          // Remarks (optional)
          TextFormField(
            controller: _remarksCtrl,
            decoration: const InputDecoration(
              labelText: 'Remarks (optional)',
              hintText: 'Add forwarding remarks...',
              border: OutlineInputBorder(),
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Forward'),
          ),
        ],
      ),
    );
  }
}

// ─── 3. ApproveRejectActions ───────────────────────────────────────────────────

/// Bottom action bar with Approve and Send Back buttons.
/// Shown when file status is "pending" and current holder matches logged-in user.
class ApproveRejectActions extends ConsumerStatefulWidget {
  const ApproveRejectActions({
    super.key,
    required this.fileId,
    required this.onSuccess,
  });

  final String fileId;
  final VoidCallback onSuccess;

  @override
  ConsumerState<ApproveRejectActions> createState() =>
      _ApproveRejectActionsState();
}

class _ApproveRejectActionsState extends ConsumerState<ApproveRejectActions> {
  bool _processing = false;

  Future<void> _handleApprove() async {
    final remarks = await _showApproveDialog();
    if (remarks == null) return; // User cancelled
    setState(() => _processing = true);
    try {
      final api = ref.read(apiClientProvider);
      final body = <String, dynamic>{};
      if (remarks.isNotEmpty) body['remarks'] = remarks;
      await api.post('/v1/estab/files/${widget.fileId}/approve', data: body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('File approved')),
      );
      widget.onSuccess();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${_extractError(e)}')),
      );
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  Future<void> _handleReject() async {
    final result = await _showRejectDialog();
    if (result == null) return; // User cancelled
    setState(() => _processing = true);
    try {
      final api = ref.read(apiClientProvider);
      await api.post(
        '/v1/estab/files/${widget.fileId}/reject',
        data: {'reason': result.reason, 'remarks': result.remarks},
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('File sent back')),
      );
      widget.onSuccess();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${_extractError(e)}')),
      );
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  /// Shows approve confirmation dialog. Returns remarks string or null if cancelled.
  Future<String?> _showApproveDialog() {
    final remarksCtrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Approve File'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Are you sure you want to approve this file?'),
            const SizedBox(height: 16),
            TextField(
              controller: remarksCtrl,
              decoration: const InputDecoration(
                labelText: 'Remarks (optional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, remarksCtrl.text.trim()),
            child: const Text('Approve'),
          ),
        ],
      ),
    );
  }

  /// Shows reject dialog requiring reason + remarks. Returns result or null.
  Future<_RejectResult?> _showRejectDialog() {
    final reasonCtrl = TextEditingController();
    final remarksCtrl = TextEditingController();
    final formKey = GlobalKey<FormState>();
    return showDialog<_RejectResult>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Send Back'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: reasonCtrl,
                decoration: const InputDecoration(
                  labelText: 'Reason',
                  hintText: 'Reason for sending back',
                  border: OutlineInputBorder(),
                ),
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Reason is required'
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: remarksCtrl,
                decoration: const InputDecoration(
                  labelText: 'Remarks',
                  hintText: 'Additional remarks',
                  border: OutlineInputBorder(),
                ),
                maxLines: 2,
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Remarks are required'
                    : null,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () {
              if (formKey.currentState!.validate()) {
                Navigator.pop(
                  ctx,
                  _RejectResult(
                    reason: reasonCtrl.text.trim(),
                    remarks: remarksCtrl.text.trim(),
                  ),
                );
              }
            },
            child: const Text('Send Back'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _processing ? null : _handleReject,
              icon: const Icon(Icons.reply),
              label: const Text('Send Back'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.error,
                side: BorderSide(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FilledButton.icon(
              onPressed: _processing ? null : _handleApprove,
              icon: const Icon(Icons.check_circle_outline),
              label: const Text('Approve'),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.green.shade700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

class _RejectResult {
  const _RejectResult({required this.reason, required this.remarks});
  final String reason;
  final String remarks;
}

/// Extracts a user-friendly error message from an exception.
String _extractError(Object e) {
  if (e is Exception) {
    final str = e.toString();
    // Try to extract message from DioException response
    if (str.contains('message')) {
      final msgMatch = RegExp(r'"message"\s*:\s*"([^"]+)"').firstMatch(str);
      if (msgMatch != null) return msgMatch.group(1)!;
    }
    // Fallback: strip exception class prefix
    return str.replaceFirst(RegExp(r'^[A-Za-z]+:\s*'), '');
  }
  return e.toString();
}

// ─── 4. showFileActionsSheet — FAB action menu ─────────────────────────────────

/// Shows a bottom sheet with file action options (Add Noting, Forward, etc.)
void showFileActionsSheet({
  required BuildContext context,
  required String fileId,
  required bool showApproveReject,
  required VoidCallback onRefresh,
}) {
  showModalBottomSheet(
    context: context,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.note_add),
              title: const Text('Add Noting'),
              subtitle: const Text('Add a green or yellow note'),
              onTap: () {
                Navigator.pop(ctx);
                _openAddNoting(context: context, fileId: fileId, onRefresh: onRefresh);
              },
            ),
            ListTile(
              leading: const Icon(Icons.forward),
              title: const Text('Forward File'),
              subtitle: const Text('Forward to another officer'),
              onTap: () {
                Navigator.pop(ctx);
                _openForwardFile(context: context, fileId: fileId, onRefresh: onRefresh);
              },
            ),
            if (showApproveReject) ...[
              const Divider(),
              ListTile(
                leading: Icon(Icons.check_circle, color: Colors.green.shade700),
                title: const Text('Approve'),
                onTap: () {
                  Navigator.pop(ctx);
                  // Delegate to ApproveRejectActions by showing it inline
                  // For simplicity, we use a dialog approach
                  _triggerApprove(context: context, fileId: fileId, onRefresh: onRefresh);
                },
              ),
              ListTile(
                leading: Icon(Icons.reply, color: Theme.of(ctx).colorScheme.error),
                title: const Text('Send Back'),
                onTap: () {
                  Navigator.pop(ctx);
                  _triggerReject(context: context, fileId: fileId, onRefresh: onRefresh);
                },
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

void _openAddNoting({
  required BuildContext context,
  required String fileId,
  required VoidCallback onRefresh,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (_) => AddNotingBottomSheet(fileId: fileId, onSuccess: onRefresh),
  );
}

void _openForwardFile({
  required BuildContext context,
  required String fileId,
  required VoidCallback onRefresh,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (_) => ForwardFileBottomSheet(fileId: fileId, onSuccess: onRefresh),
  );
}

/// Triggers approve flow from the actions sheet.
void _triggerApprove({
  required BuildContext context,
  required String fileId,
  required VoidCallback onRefresh,
}) {
  final remarksCtrl = TextEditingController();
  showDialog(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Approve File'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Are you sure you want to approve this file?'),
          const SizedBox(height: 16),
          TextField(
            controller: remarksCtrl,
            decoration: const InputDecoration(
              labelText: 'Remarks (optional)',
              border: OutlineInputBorder(),
            ),
            maxLines: 2,
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            Navigator.pop(ctx, remarksCtrl.text.trim());
          },
          child: const Text('Approve'),
        ),
      ],
    ),
  ).then((remarks) {
    if (remarks == null) return;
    _executeApprove(
      context: context,
      fileId: fileId,
      remarks: remarks as String,
      onRefresh: onRefresh,
    );
  });
}

void _executeApprove({
  required BuildContext context,
  required String fileId,
  required String remarks,
  required VoidCallback onRefresh,
}) async {
  try {
    // Access provider scope via the Navigator's context
    final container = ProviderScope.containerOf(context);
    final api = container.read(apiClientProvider);
    final body = <String, dynamic>{};
    if (remarks.isNotEmpty) body['remarks'] = remarks;
    await api.post('/v1/estab/files/$fileId/approve', data: body);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('File approved')),
      );
    }
    onRefresh();
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${_extractError(e)}')),
      );
    }
  }
}

/// Triggers reject/send-back flow from the actions sheet.
void _triggerReject({
  required BuildContext context,
  required String fileId,
  required VoidCallback onRefresh,
}) {
  final reasonCtrl = TextEditingController();
  final remarksCtrl = TextEditingController();
  final formKey = GlobalKey<FormState>();
  showDialog(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Send Back'),
      content: Form(
        key: formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: reasonCtrl,
              decoration: const InputDecoration(
                labelText: 'Reason',
                hintText: 'Reason for sending back',
                border: OutlineInputBorder(),
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Reason is required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: remarksCtrl,
              decoration: const InputDecoration(
                labelText: 'Remarks',
                hintText: 'Additional remarks',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Remarks are required'
                  : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(ctx).colorScheme.error,
          ),
          onPressed: () {
            if (formKey.currentState!.validate()) {
              Navigator.pop(ctx, {
                'reason': reasonCtrl.text.trim(),
                'remarks': remarksCtrl.text.trim(),
              });
            }
          },
          child: const Text('Send Back'),
        ),
      ],
    ),
  ).then((result) {
    if (result == null) return;
    _executeReject(
      context: context,
      fileId: fileId,
      reason: (result as Map)['reason'] as String,
      remarks: result['remarks'] as String,
      onRefresh: onRefresh,
    );
  });
}

void _executeReject({
  required BuildContext context,
  required String fileId,
  required String reason,
  required String remarks,
  required VoidCallback onRefresh,
}) async {
  try {
    final container = ProviderScope.containerOf(context);
    final api = container.read(apiClientProvider);
    await api.post(
      '/v1/estab/files/$fileId/reject',
      data: {'reason': reason, 'remarks': remarks},
    );
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('File sent back')),
      );
    }
    onRefresh();
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${_extractError(e)}')),
      );
    }
  }
}
