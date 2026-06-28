import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Employee documents vault — Form 16, offer letter, ID card, payslips, etc.
/// GET /v1/hrms/me/documents — list all employee documents
/// GET /v1/hrms/me/documents/:id/download — download link
class DocumentsVaultScreen extends ConsumerStatefulWidget {
  const DocumentsVaultScreen({super.key});

  @override
  ConsumerState<DocumentsVaultScreen> createState() =>
      _DocumentsVaultScreenState();
}

class _DocumentsVaultScreenState extends ConsumerState<DocumentsVaultScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _documents = [];

  @override
  void initState() {
    super.initState();
    _fetchDocuments();
  }

  Future<void> _fetchDocuments() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient
          .get<Map<String, dynamic>>('/v1/hrms/me/documents');
      _documents = ((res.data?['data'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Documents'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchDocuments,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : _documents.isEmpty
                  ? _buildEmpty(theme)
                  : RefreshIndicator(
                      onRefresh: _fetchDocuments,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          // Group by category
                          ..._buildGrouped(theme),
                        ],
                      ),
                    ),
    );
  }

  List<Widget> _buildGrouped(ThemeData theme) {
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final doc in _documents) {
      final cat = doc['category'] as String? ?? 'Other';
      groups.putIfAbsent(cat, () => []).add(doc);
    }

    final widgets = <Widget>[];
    for (final entry in groups.entries) {
      widgets.add(Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 8),
        child: Text(
          entry.key,
          style: theme.textTheme.titleSmall
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
      ));
      for (final doc in entry.value) {
        widgets.add(_DocumentCard(
          document: doc,
          onDownload: () => _downloadDocument(doc),
        ));
      }
    }
    return widgets;
  }

  Future<void> _downloadDocument(Map<String, dynamic> doc) async {
    final name = doc['name'] as String? ?? 'Document';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Downloading $name…'),
        backgroundColor: Theme.of(context).colorScheme.primary,
      ),
    );
    // In production: fetch presigned URL and open in browser/viewer
    // final apiClient = ref.read(apiClientProvider);
    // final res = await apiClient.get('/v1/hrms/me/documents/${doc['id']}/download');
    // final url = res.data['url'];
    // await launchUrl(Uri.parse(url));
  }

  Widget _buildEmpty(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.folder_open, size: 64,
              color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No documents available', style: theme.textTheme.bodyLarge),
          const SizedBox(height: 8),
          Text('Your HR documents will appear here once uploaded',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.outline)),
        ],
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.wifi_off, size: 64, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Unable to load documents',
              style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _fetchDocuments,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _DocumentCard extends StatelessWidget {
  const _DocumentCard({required this.document, required this.onDownload});
  final Map<String, dynamic> document;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = document['name'] as String? ?? 'Document';
    final type = document['fileType'] as String? ?? 'pdf';
    final uploadedAt = document['uploadedAt'] as String? ?? '';
    final size = document['sizeBytes'] as int? ?? 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: _typeColor(theme, type).withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(_typeIcon(type), color: _typeColor(theme, type), size: 24),
        ),
        title: Text(name,
            style: theme.textTheme.bodyMedium
                ?.copyWith(fontWeight: FontWeight.w500)),
        subtitle: Text(
          '${_formatSize(size)} • ${uploadedAt.split('T').first}',
          style:
              theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
        ),
        trailing: IconButton(
          onPressed: onDownload,
          icon: const Icon(Icons.download),
          style: IconButton.styleFrom(
            backgroundColor: theme.colorScheme.primary.withOpacity(0.1),
            foregroundColor: theme.colorScheme.primary,
          ),
        ),
        onTap: onDownload,
      ),
    );
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)}KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)}MB';
  }

  Color _typeColor(ThemeData theme, String type) {
    switch (type.toLowerCase()) {
      case 'pdf':
        return theme.colorScheme.error;
      case 'jpg':
      case 'jpeg':
      case 'png':
        return theme.colorScheme.primary;
      case 'doc':
      case 'docx':
        return theme.colorScheme.primary;
      case 'xls':
      case 'xlsx':
        return theme.colorScheme.primary;
      default:
        return theme.colorScheme.onSurfaceVariant;
    }
  }

  IconData _typeIcon(String type) {
    switch (type.toLowerCase()) {
      case 'pdf':
        return Icons.picture_as_pdf;
      case 'jpg':
      case 'jpeg':
      case 'png':
        return Icons.image;
      case 'doc':
      case 'docx':
        return Icons.description;
      case 'xls':
      case 'xlsx':
        return Icons.table_chart;
      default:
        return Icons.insert_drive_file;
    }
  }
}
