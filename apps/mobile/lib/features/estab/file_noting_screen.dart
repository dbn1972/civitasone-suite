import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// File Noting screen for eOffice.
/// Shows the green note chain for a file and allows adding notes.
class FileNotingScreen extends ConsumerStatefulWidget {
  const FileNotingScreen({super.key, required this.fileId});
  final String fileId;

  @override
  ConsumerState<FileNotingScreen> createState() => _FileNotingScreenState();
}

class _FileNotingScreenState extends ConsumerState<FileNotingScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _notes = [];
  final _noteCtrl = TextEditingController();
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _loadNotes();
  }

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadNotes() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get(
        '/api/v1/estab/files/${widget.fileId}/notes',
      );
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);

      if (mounted) {
        setState(() {
          _notes = list.cast<Map<String, dynamic>>();
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (e) {
      // Try local cache
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities(
          'file_notes_${widget.fileId}',
        );
        if (cached.isNotEmpty && mounted) {
          setState(() {
            _notes = cached
                .map((e) => e['data'] as Map<String, dynamic>)
                .toList();
            _isOffline = true;
            _loading = false;
          });
          return;
        }
      }
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
          _isOffline = true;
        });
      }
    }
  }

  Future<void> _addNote() async {
    final text = _noteCtrl.text.trim();
    if (text.isEmpty) return;

    setState(() => _submitting = true);

    final notePayload = {
      'fileId': widget.fileId,
      'text': text,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    };

    // Queue via outbox for offline support
    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'file_notes_${widget.fileId}',
        operation: 'create',
        entityId: '${widget.fileId}_${DateTime.now().millisecondsSinceEpoch}',
        payload: notePayload,
      );
    }

    ref.read(syncEngineProvider)?.syncMailbox(
      'file_notes_${widget.fileId}',
    );

    // Optimistic update
    setState(() {
      _notes.add({
        ...notePayload,
        'author': 'You',
        'timestamp': DateTime.now().toIso8601String(),
      });
      _submitting = false;
    });
    _noteCtrl.clear();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Note added — syncing')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('File Notes — ${widget.fileId}'),
        actions: [
          Semantics(
            label: 'Refresh notes',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadNotes,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Offline banner
          if (_isOffline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: 16, vertical: 8,
              ),
              color: Colors.orange.shade100,
              child: Row(
                children: [
                  Icon(Icons.cloud_off,
                      size: 16, color: Colors.orange.shade800),
                  const SizedBox(width: 8),
                  Text(
                    'Offline — notes queued for sync',
                    style: TextStyle(
                      fontSize: 12, color: Colors.orange.shade800,
                    ),
                  ),
                ],
              ),
            ),
          // Notes list
          Expanded(child: _buildNotesList(context)),
          // Add note input
          _buildNoteInput(context),
        ],
      ),
    );
  }

  Widget _buildNotesList(BuildContext context) {
    if (_loading) return const SkeletonList(count: 4);

    if (_error != null && _notes.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _loadNotes);
    }

    if (_notes.isEmpty) {
      return const Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.note_alt_outlined,
              size: 64, color: Color(0xFFD1D5DB)),
          SizedBox(height: 16),
          Text('No notes yet',
              style: TextStyle(color: Color(0xFF6B7280))),
          SizedBox(height: 4),
          Text('Add the first note below',
              style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
        ]),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadNotes,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _notes.length,
        itemBuilder: (ctx, i) {
          final note = _notes[i];
          return _NoteCard(
            author: note['author'] as String? ?? '—',
            text: note['text'] as String? ?? '',
            timestamp: note['timestamp'] as String? ??
                note['createdAt'] as String? ??
                '—',
            isLast: i == _notes.length - 1,
          );
        },
      ),
    );
  }

  Widget _buildNoteInput(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 12,
        bottom: MediaQuery.of(context).viewInsets.bottom + 12,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          top: BorderSide(
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Semantics(
              label: 'Note text input',
              child: TextField(
                controller: _noteCtrl,
                maxLines: 2,
                minLines: 1,
                decoration: const InputDecoration(
                  hintText: 'Add a note…',
                  border: OutlineInputBorder(),
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: 12, vertical: 10,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Semantics(
            label: 'Submit note',
            child: IconButton.filled(
              onPressed: _submitting ? null : _addNote,
              icon: _submitting
                  ? const SizedBox(
                      width: 20, height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send),
            ),
          ),
        ],
      ),
    );
  }
}

/// Green note card — resembles official eOffice noting style.
class _NoteCard extends StatelessWidget {
  const _NoteCard({
    required this.author,
    required this.text,
    required this.timestamp,
    required this.isLast,
  });
  final String author;
  final String text;
  final String timestamp;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FDF4),
        border: Border.all(color: const Color(0xFF86EFAC)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(author,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 13)),
              const Spacer(),
              Text(timestamp,
                  style: const TextStyle(
                    fontSize: 11, color: Color(0xFF6B7280))),
            ],
          ),
          const SizedBox(height: 8),
          Text(text, style: const TextStyle(fontSize: 14)),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load notes',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 12, color: Color(0xFF94A3B8))),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ]),
      ),
    );
  }
}
