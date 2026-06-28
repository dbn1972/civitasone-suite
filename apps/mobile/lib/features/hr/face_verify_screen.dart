import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Face verification screen during check-in.
/// Calls POST /v1/hrms/attendance/verify-face with employeeId + selfieKey.
class FaceVerifyScreen extends ConsumerStatefulWidget {
  const FaceVerifyScreen({super.key, this.employeeId, this.selfieKey});

  final String? employeeId;
  final String? selfieKey;

  @override
  ConsumerState<FaceVerifyScreen> createState() => _FaceVerifyScreenState();
}

class _FaceVerifyScreenState extends ConsumerState<FaceVerifyScreen> {
  bool _verifying = false;
  bool _capturing = false;
  int _attempts = 0;
  static const int _maxRetries = 3;

  String? _currentSelfieKey;

  // Verification result
  double? _score;
  String? _method; // 'ONNX' or 'Rekognition'
  bool? _passed;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _currentSelfieKey = widget.selfieKey;
  }

  Future<void> _captureSelfie() async {
    setState(() => _capturing = true);
    try {
      // Simulates camera capture — in production use image_picker
      await Future.delayed(const Duration(milliseconds: 600));
      setState(() {
        _currentSelfieKey = 'selfie_verify_${DateTime.now().millisecondsSinceEpoch}.jpg';
      });
    } finally {
      if (mounted) setState(() => _capturing = false);
    }
  }

  Future<void> _verifyFace() async {
    if (_currentSelfieKey == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please capture a selfie first.')),
      );
      return;
    }

    setState(() {
      _verifying = true;
      _errorMessage = null;
    });

    try {
      final syncEngine = ref.read(syncEngineProvider);
      if (syncEngine == null) throw Exception('Sync engine not ready');

      // POST /v1/hrms/attendance/verify-face
      // Payload: { employeeId, selfieKey }
      // Simulating API call and response
      await Future.delayed(const Duration(seconds: 2));

      // Simulated response — in production parse from Dio response
      final simulatedScore = 0.87 + (_attempts * 0.03);
      final passed = simulatedScore >= 0.80;

      setState(() {
        _attempts++;
        _score = simulatedScore.clamp(0.0, 1.0);
        _method = _attempts % 2 == 0 ? 'Rekognition' : 'ONNX';
        _passed = passed;
      });
    } catch (e) {
      setState(() {
        _errorMessage = e.toString();
        _attempts++;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Verification error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  bool get _canRetry => _passed != true && _attempts < _maxRetries;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Face Verification')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          // Camera / selfie area
          _buildCameraArea(theme, colorScheme),
          const SizedBox(height: 24),

          // Info text
          Text(
            'Position your face within the frame and ensure good lighting.',
            style: theme.textTheme.bodyMedium?.copyWith(color: colorScheme.outline),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),

          // Verify button
          if (_passed != true)
            FilledButton.icon(
              onPressed: (_verifying || !_canRetry && _attempts > 0) ? null : _verifyFace,
              icon: _verifying
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.verified_user),
              label: Text(_verifying
                  ? 'Verifying…'
                  : _attempts == 0
                      ? 'Verify Face'
                      : 'Retry Verification'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          const SizedBox(height: 8),

          // Attempts indicator
          if (_attempts > 0)
            Text(
              'Attempt $_attempts of $_maxRetries',
              style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.outline),
              textAlign: TextAlign.center,
            ),
          const SizedBox(height: 24),

          // Result card
          if (_score != null) _buildResultCard(theme, colorScheme),

          // Max retries exhausted
          if (!_canRetry && _passed != true && _attempts >= _maxRetries) ...[
            const SizedBox(height: 16),
            Card(
              color: Colors.red.withOpacity(0.05),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: Colors.red),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Maximum retry attempts reached. Please contact HR for manual verification.',
                        style: theme.textTheme.bodySmall?.copyWith(color: Colors.red.shade700),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],

          // Error message
          if (_errorMessage != null) ...[
            const SizedBox(height: 16),
            Text(
              _errorMessage!,
              style: theme.textTheme.bodySmall?.copyWith(color: Colors.red),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCameraArea(ThemeData theme, ColorScheme colorScheme) {
    return GestureDetector(
      onTap: _capturing ? null : _captureSelfie,
      child: Container(
        height: 280,
        decoration: BoxDecoration(
          color: colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: _passed == true
                ? colorScheme.primary
                : _passed == false
                    ? colorScheme.error
                    : colorScheme.outlineVariant,
            width: 3,
          ),
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Face outline guide
            Container(
              width: 160,
              height: 200,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(80),
                border: Border.all(
                  color: colorScheme.outline.withOpacity(0.3),
                  width: 2,
                  strokeAlign: BorderSide.strokeAlignInside,
                ),
              ),
            ),
            if (_currentSelfieKey != null)
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.face,
                    size: 64,
                    color: colorScheme.primary.withOpacity(0.6),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Photo captured',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.primary,
                    ),
                  ),
                ],
              )
            else
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.camera_alt,
                    size: 48,
                    color: colorScheme.outline,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Tap to capture selfie',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colorScheme.outline,
                    ),
                  ),
                ],
              ),
            if (_capturing)
              const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }

  Widget _buildResultCard(ThemeData theme, ColorScheme colorScheme) {
    final passed = _passed ?? false;
    final resultColor = passed ? colorScheme.primary : colorScheme.error;
    final scorePercent = ((_score ?? 0) * 100).toStringAsFixed(1);

    return Card(
      color: resultColor.withOpacity(0.05),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: resultColor.withOpacity(0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Icon(
              passed ? Icons.check_circle : Icons.cancel,
              color: resultColor,
              size: 48,
            ),
            const SizedBox(height: 12),
            Text(
              passed ? 'Verification Passed' : 'Verification Failed',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
                color: resultColor,
              ),
            ),
            const SizedBox(height: 16),
            // Score row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _ResultMetric(
                  label: 'Score',
                  value: '$scorePercent%',
                  color: resultColor,
                ),
                _ResultMetric(
                  label: 'Method',
                  value: _method ?? '—',
                  color: colorScheme.primary,
                ),
                _ResultMetric(
                  label: 'Status',
                  value: passed ? 'PASS' : 'FAIL',
                  color: resultColor,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ResultMetric extends StatelessWidget {
  const _ResultMetric({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.outline,
              ),
        ),
      ],
    );
  }
}
