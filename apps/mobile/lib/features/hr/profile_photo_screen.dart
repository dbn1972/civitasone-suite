import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// One-time profile photo upload screen.
/// POST /v1/hrms/employees/:id/profile-photo with photoKey.
class ProfilePhotoScreen extends ConsumerStatefulWidget {
  const ProfilePhotoScreen({super.key, this.employeeId});

  final String? employeeId;

  @override
  ConsumerState<ProfilePhotoScreen> createState() => _ProfilePhotoScreenState();
}

class _ProfilePhotoScreenState extends ConsumerState<ProfilePhotoScreen> {
  bool _uploading = false;
  bool _loading = true;
  String? _existingPhotoKey;
  String? _newPhotoKey;
  bool _uploadSuccess = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadExistingPhoto();
  }

  Future<void> _loadExistingPhoto() async {
    setState(() => _loading = true);
    try {
      // Check if employee already has a profile photo
      await Future.delayed(const Duration(milliseconds: 500));
      // Simulated: no existing photo for first-time setup
      _existingPhotoKey = null;
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _capturePhoto() async {
    // Simulates camera capture — in production use image_picker
    await Future.delayed(const Duration(milliseconds: 600));
    setState(() {
      _newPhotoKey = 'profile_${DateTime.now().millisecondsSinceEpoch}.jpg';
      _uploadSuccess = false;
    });
  }

  Future<void> _uploadPhoto() async {
    if (_newPhotoKey == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please capture a photo first.')),
      );
      return;
    }

    setState(() {
      _uploading = true;
      _error = null;
    });

    try {
      final syncEngine = ref.read(syncEngineProvider);
      if (syncEngine == null) throw Exception('Sync engine not ready');

      // POST /v1/hrms/employees/:id/profile-photo
      // Payload: { photoKey: _newPhotoKey }
      await Future.delayed(const Duration(seconds: 1));

      setState(() {
        _existingPhotoKey = _newPhotoKey;
        _uploadSuccess = true;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Profile photo uploaded successfully'),
            backgroundColor: Color(0xFF15803D),
          ),
        );
      }
    } catch (e) {
      setState(() => _error = e.toString());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Upload failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile Photo')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(24),
              children: [
                // Info banner
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF6366F1).withOpacity(0.05),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: const Color(0xFF6366F1).withOpacity(0.2),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline, color: Color(0xFF6366F1)),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'This photo will be used for daily attendance verification.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: const Color(0xFF4338CA),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 32),

                // Photo display area
                Center(child: _buildPhotoArea(theme, colorScheme)),
                const SizedBox(height: 24),

                // Capture button
                Center(
                  child: FilledButton.tonalIcon(
                    onPressed: _capturePhoto,
                    icon: const Icon(Icons.camera_alt),
                    label: Text(
                      _existingPhotoKey != null || _newPhotoKey != null
                          ? 'Retake Photo'
                          : 'Take Photo',
                    ),
                  ),
                ),
                const SizedBox(height: 32),

                // Upload button
                if (_newPhotoKey != null && !_uploadSuccess)
                  FilledButton.icon(
                    onPressed: _uploading ? null : _uploadPhoto,
                    icon: _uploading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.cloud_upload),
                    label: Text(_uploading ? 'Uploading…' : 'Upload Photo'),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                    ),
                  ),

                // Success state
                if (_uploadSuccess) ...[
                  const SizedBox(height: 16),
                  Card(
                    color: const Color(0xFF22C55E).withOpacity(0.05),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: BorderSide(
                        color: const Color(0xFF22C55E).withOpacity(0.3),
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          const Icon(Icons.check_circle, color: Color(0xFF22C55E)),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Photo uploaded successfully',
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    color: const Color(0xFF15803D),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Text(
                                  'Your photo is now set for attendance verification.',
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: const Color(0xFF15803D),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],

                // Error
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style: theme.textTheme.bodySmall?.copyWith(color: Colors.red),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
    );
  }

  Widget _buildPhotoArea(ThemeData theme, ColorScheme colorScheme) {
    final hasPhoto = _existingPhotoKey != null || _newPhotoKey != null;

    return Container(
      width: 200,
      height: 200,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: hasPhoto
            ? colorScheme.primaryContainer
            : colorScheme.surfaceContainerHigh,
        border: Border.all(
          color: hasPhoto
              ? colorScheme.primary.withOpacity(0.3)
              : colorScheme.outlineVariant,
          width: 3,
        ),
        boxShadow: hasPhoto
            ? [
                BoxShadow(
                  color: colorScheme.primary.withOpacity(0.1),
                  blurRadius: 20,
                  spreadRadius: 4,
                ),
              ]
            : null,
      ),
      child: hasPhoto
          ? Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.person,
                  size: 64,
                  color: colorScheme.primary.withOpacity(0.6),
                ),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFF22C55E).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Text(
                    'Photo ready',
                    style: TextStyle(
                      fontSize: 11,
                      color: Color(0xFF22C55E),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            )
          : Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.add_a_photo,
                  size: 48,
                  color: colorScheme.outline,
                ),
                const SizedBox(height: 8),
                Text(
                  'No photo',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.outline,
                  ),
                ),
              ],
            ),
    );
  }
}
