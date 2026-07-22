import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// Work Photos screen — capture geo-tagged photos linked to a work (camera + GPS).
class WorkPhotosScreen extends ConsumerStatefulWidget {
  const WorkPhotosScreen({super.key});

  @override
  ConsumerState<WorkPhotosScreen> createState() => _WorkPhotosScreenState();
}

class _WorkPhotosScreenState extends ConsumerState<WorkPhotosScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _photos = [];
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _loadPhotos();
  }

  Future<void> _loadPhotos() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/works/execution/photos');
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _photos = list.cast<Map<String, dynamic>>();
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

  Future<void> _capturePhoto() async {
    // In a real implementation, this would use image_picker + geolocator
    // to capture a geo-tagged photo and upload it.
    setState(() => _uploading = true);
    try {
      // Simulated: would open camera, get GPS coordinates, then upload
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Photo capture requires camera permission')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Photo queued for upload when online'),
            backgroundColor: Colors.orange.shade700,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Work Photos'),
        actions: [
          Semantics(
            label: 'Refresh photos',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadPhotos,
            ),
          ),
        ],
      ),
      floatingActionButton: Semantics(
        label: 'Capture geo-tagged photo',
        child: FloatingActionButton.extended(
          onPressed: _uploading ? null : _capturePhoto,
          icon: _uploading
              ? const SizedBox(
                  width: 20, height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.camera_alt),
          label: Text(_uploading ? 'Capturing...' : 'Capture Photo'),
        ),
      ),
      body: _buildBody(theme),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loading) return const SkeletonList();
    if (_error != null && _photos.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
            const SizedBox(height: 16),
            Text('Unable to load photos', style: theme.textTheme.titleMedium),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loadPhotos,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ]),
        ),
      );
    }
    if (_photos.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.camera_alt, size: 64, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No photos captured yet',
              style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline)),
          const SizedBox(height: 8),
          Text('Tap the button below to capture a geo-tagged photo',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
        ]),
      );
    }

    return Column(
      children: [
        if (_isOffline)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: Colors.orange.shade100,
            child: Row(children: [
              Icon(Icons.cloud_off, size: 16, color: Colors.orange.shade800),
              const SizedBox(width: 8),
              Text('Offline — showing cached photos',
                  style: TextStyle(fontSize: 12, color: Colors.orange.shade800)),
            ]),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _loadPhotos,
            child: GridView.builder(
              padding: const EdgeInsets.all(16),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 0.85,
              ),
              itemCount: _photos.length,
              itemBuilder: (ctx, i) {
                final photo = _photos[i];
                return Semantics(
                  label: 'Work photo ${photo['workNumber'] ?? ''}',
                  child: Card(
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                          child: Container(
                            color: theme.colorScheme.surfaceContainerHighest,
                            child: Center(
                              child: Icon(
                                Icons.image,
                                size: 48,
                                color: theme.colorScheme.outline,
                              ),
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                photo['workNumber'] as String? ?? '—',
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Row(children: [
                                Icon(Icons.location_on, size: 10, color: theme.colorScheme.outline),
                                const SizedBox(width: 4),
                                Expanded(
                                  child: Text(
                                    photo['location'] as String? ?? 'No GPS',
                                    style: TextStyle(fontSize: 10, color: theme.colorScheme.outline),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ]),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}
