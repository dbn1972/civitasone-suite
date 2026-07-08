import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import 'file_actions.dart';

/// eFile — digital file management (equivalent to NIC eOffice).
/// View files, track movements, add notings, approve/move files.
/// GET /v1/estab/files — list
/// GET /v1/estab/files/:id — detail with notings + movements
class EFileScreen extends ConsumerStatefulWidget {
  const EFileScreen({super.key});
  @override
  ConsumerState<EFileScreen> createState() => _EFileScreenState();
}

class _EFileScreenState extends ConsumerState<EFileScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _files = [];
  String _filter = 'all'; // all, pending, with_me, closed

  @override
  void initState() { super.initState(); _fetch(); }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/estab/files');
      _files = ((res.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    } catch (e) { _error = e.toString(); }
    finally { if (mounted) setState(() => _loading = false); }
  }

  List<Map<String, dynamic>> get _filtered {
    if (_filter == 'all') return _files;
    return _files.where((f) {
      final status = (f['status'] as String? ?? '').toLowerCase();
      if (_filter == 'pending') return status == 'pending' || status == 'in_progress';
      if (_filter == 'with_me') return f['currentHolder'] == 'me'; // simplified
      if (_filter == 'closed') return status == 'closed';
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('eFile'), actions: [
        IconButton(icon: const Icon(Icons.sync), onPressed: _fetch),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.wifi_off, size: 48, color: theme.colorScheme.error),
                  const SizedBox(height: 12),
                  FilledButton.icon(onPressed: _fetch, icon: const Icon(Icons.refresh), label: const Text('Retry')),
                ]))
              : Column(children: [
                  // Filter tabs
                  SizedBox(height: 48, child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    children: [
                      for (final f in ['all', 'pending', 'with_me', 'closed'])
                        Padding(padding: const EdgeInsets.only(right: 8), child: FilterChip(
                          label: Text(_filterLabel(f)),
                          selected: _filter == f,
                          onSelected: (_) => setState(() => _filter = f),
                        )),
                    ],
                  )),
                  // File list
                  Expanded(child: _filtered.isEmpty
                      ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                          Icon(Icons.folder_open, size: 64, color: theme.colorScheme.outlineVariant),
                          const SizedBox(height: 16),
                          Text('No files', style: theme.textTheme.bodyLarge),
                        ]))
                      : RefreshIndicator(onRefresh: _fetch, child: ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _filtered.length,
                          itemBuilder: (_, i) => _FileCard(file: _filtered[i], onTap: () => _openFile(_filtered[i])),
                        )),
                  ),
                ]),
    );
  }

  String _filterLabel(String f) => switch (f) {
    'all' => 'All Files',
    'pending' => 'Pending',
    'with_me' => 'With Me',
    'closed' => 'Closed',
    _ => f,
  };

  void _openFile(Map<String, dynamic> file) {
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => _FileDetailScreen(fileId: file['id'] as String, fileName: file['fileNo'] as String? ?? 'File'),
    ));
  }
}

class _FileCard extends StatelessWidget {
  const _FileCard({required this.file, required this.onTap});
  final Map<String, dynamic> file;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fileNo = file['fileNo'] as String? ?? file['id'] as String;
    final subject = file['subject'] as String? ?? '';
    final status = file['status'] as String? ?? 'open';
    final section = file['section'] as String? ?? '';
    final currentHolder = file['currentHolder'] as String? ?? '';
    final pendingSince = file['pendingSince'] as String? ?? '';
    final classification = file['classification'] as String? ?? 'normal';

    Color classColor = theme.colorScheme.outline;
    if (classification == 'confidential') classColor = theme.colorScheme.tertiary;
    if (classification == 'secret' || classification == 'top_secret') classColor = theme.colorScheme.error;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // Header row
          Row(children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: theme.colorScheme.primaryContainer, borderRadius: BorderRadius.circular(8)),
              child: Icon(Icons.folder, color: theme.colorScheme.primary, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(fileNo, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
              if (section.isNotEmpty) Text(section, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
            ])),
            // Status pill
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: _statusColor(status, theme).withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(status.toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: _statusColor(status, theme))),
            ),
          ]),
          const SizedBox(height: 10),
          // Subject
          Text(subject, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodyMedium),
          const SizedBox(height: 8),
          // Footer
          Row(children: [
            if (currentHolder.isNotEmpty) ...[
              Icon(Icons.person, size: 14, color: theme.colorScheme.outline),
              const SizedBox(width: 4),
              Text('With: $currentHolder', style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
            ],
            const Spacer(),
            if (classification != 'normal')
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: classColor.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                child: Text(classification.toUpperCase(), style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: classColor)),
              ),
          ]),
        ])),
      ),
    );
  }

  Color _statusColor(String status, ThemeData theme) => switch (status.toLowerCase()) {
    'open' || 'in_progress' => theme.colorScheme.primary,
    'pending' => theme.colorScheme.tertiary,
    'closed' => theme.colorScheme.outline,
    _ => theme.colorScheme.outline,
  };
}

/// File detail — notings, movements, actions.
class _FileDetailScreen extends ConsumerStatefulWidget {
  const _FileDetailScreen({required this.fileId, required this.fileName});
  final String fileId;
  final String fileName;

  @override
  ConsumerState<_FileDetailScreen> createState() => _FileDetailState();
}

class _FileDetailState extends ConsumerState<_FileDetailScreen> with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;
  bool _loading = true;
  Map<String, dynamic>? _file;
  List<Map<String, dynamic>> _movements = [];

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
    _fetch();
  }

  @override
  void dispose() { _tabCtrl.dispose(); super.dispose(); }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(apiClientProvider);
      final fileRes = await api.get<Map<String, dynamic>>('/v1/estab/files/${widget.fileId}');
      _file = fileRes.data;

      final movRes = await api.get<Map<String, dynamic>>('/v1/estab/files/${widget.fileId}/movements');
      _movements = ((movRes.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  /// Whether the file is pending and the current user is the holder.
  bool get _canApproveReject {
    if (_file == null) return false;
    final status = (_file!['status'] as String? ?? '').toLowerCase();
    final session = ref.read(authSessionProvider);
    final currentHolder = _file!['currentHolderId'] as String? ?? '';
    return status == 'pending' && session != null && currentHolder == session.userId;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.fileName),
        bottom: TabBar(controller: _tabCtrl, tabs: const [
          Tab(text: 'Details'),
          Tab(text: 'Notings'),
          Tab(text: 'Movement'),
        ]),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(children: [
              Expanded(
                child: TabBarView(controller: _tabCtrl, children: [
                  _buildDetails(theme),
                  _buildNotings(theme),
                  _buildMovements(theme),
                ]),
              ),
              // Show approve/reject bar when file is pending with current user
              if (_canApproveReject)
                ApproveRejectActions(fileId: widget.fileId, onSuccess: _fetch),
            ]),
      floatingActionButton: _loading
          ? null
          : FloatingActionButton(
              onPressed: () => showFileActionsSheet(
                context: context,
                fileId: widget.fileId,
                showApproveReject: _canApproveReject,
                onRefresh: _fetch,
              ),
              child: const Icon(Icons.more_vert),
            ),
    );
  }

  Widget _buildDetails(ThemeData theme) {
    if (_file == null) return const Center(child: Text('File not found'));
    final f = _file!;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('File Information', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        _DetailRow(label: 'File No', value: f['fileNo'] as String? ?? ''),
        _DetailRow(label: 'Subject', value: f['subject'] as String? ?? ''),
        _DetailRow(label: 'Section', value: f['section'] as String? ?? ''),
        _DetailRow(label: 'Category', value: f['category'] as String? ?? ''),
        _DetailRow(label: 'Classification', value: f['classification'] as String? ?? 'Normal'),
        _DetailRow(label: 'Status', value: f['status'] as String? ?? ''),
        _DetailRow(label: 'Current Holder', value: f['currentHolder'] as String? ?? ''),
        _DetailRow(label: 'Created', value: (f['createdAt'] as String? ?? '').split('T').first),
      ]))),
    ]);
  }

  Widget _buildNotings(ThemeData theme) {
    final notings = (_file?['notings'] as List<dynamic>?) ?? [];
    if (notings.isEmpty) return Center(child: Text('No notings yet', style: theme.textTheme.bodyLarge));
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: notings.length,
      itemBuilder: (_, i) {
        final n = notings[i] as Map<String, dynamic>;
        return Card(margin: const EdgeInsets.only(bottom: 12), child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CircleAvatar(radius: 16, backgroundColor: theme.colorScheme.primaryContainer,
                child: Text('${i + 1}', style: TextStyle(fontSize: 12, color: theme.colorScheme.primary, fontWeight: FontWeight.bold))),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(n['author'] as String? ?? 'Officer', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                Text((n['createdAt'] as String? ?? '').split('T').first, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
              ])),
            ]),
            const SizedBox(height: 10),
            Text(n['body'] as String? ?? '', style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
          ]),
        ));
      },
    );
  }

  Widget _buildMovements(ThemeData theme) {
    if (_movements.isEmpty) return Center(child: Text('No movements recorded', style: theme.textTheme.bodyLarge));
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _movements.length,
      itemBuilder: (_, i) {
        final m = _movements[i] as Map<String, dynamic>;
        return Padding(padding: const EdgeInsets.only(bottom: 16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // Timeline dot + line
          Column(children: [
            Container(width: 12, height: 12, decoration: BoxDecoration(shape: BoxShape.circle, color: theme.colorScheme.primary)),
            if (i < _movements.length - 1) Container(width: 2, height: 50, color: theme.colorScheme.outlineVariant),
          ]),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(m['action'] as String? ?? 'Moved', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            Text('${m['fromHolder'] ?? '—'} → ${m['toHolder'] ?? '—'}', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
            Text((m['timestamp'] as String? ?? '').split('T').first, style: TextStyle(fontSize: 11, color: theme.colorScheme.outline)),
            if ((m['remarks'] as String?)?.isNotEmpty == true)
              Padding(padding: const EdgeInsets.only(top: 4), child: Text(m['remarks'] as String, style: theme.textTheme.bodySmall)),
          ])),
        ]));
      },
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label; final String value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(width: 110, child: Text(label, style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.outline))),
      Expanded(child: Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
    ]),
  );
}
