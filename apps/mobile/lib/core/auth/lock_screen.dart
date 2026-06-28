import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'biometric_lock.dart';

/// Lock screen — biometric or PIN challenge before accessing the app.
/// Styled like banking apps: clean, minimal, brand-forward.
class LockScreen extends StatefulWidget {
  const LockScreen({super.key, required this.lockService, required this.onUnlocked});
  final BiometricLockService lockService;
  final VoidCallback onUnlocked;

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen> {
  String _pin = '';
  bool _biometricFailed = false;
  bool _showPinInput = false;
  String? _lockType;

  @override
  void initState() {
    super.initState();
    _initLock();
  }

  Future<void> _initLock() async {
    _lockType = await widget.lockService.lockType;
    if (_lockType == 'biometric') {
      _attemptBiometric();
    } else {
      setState(() => _showPinInput = true);
    }
  }

  Future<void> _attemptBiometric() async {
    final success = await widget.lockService.authenticateBiometric();
    if (success) {
      await widget.lockService.recordAuth();
      HapticFeedback.mediumImpact();
      widget.onUnlocked();
    } else {
      setState(() {
        _biometricFailed = true;
        _showPinInput = true;
      });
    }
  }

  Future<void> _verifyPin() async {
    if (_pin.length < 4) return;
    final valid = await widget.lockService.verifyPin(_pin);
    if (valid) {
      await widget.lockService.recordAuth();
      HapticFeedback.mediumImpact();
      widget.onUnlocked();
    } else {
      HapticFeedback.heavyImpact();
      setState(() => _pin = '');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Incorrect PIN'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _addDigit(String digit) {
    if (_pin.length >= 6) return;
    HapticFeedback.selectionClick();
    setState(() => _pin += digit);
    if (_pin.length >= 4) _verifyPin();
  }

  void _removeDigit() {
    if (_pin.isEmpty) return;
    HapticFeedback.selectionClick();
    setState(() => _pin = _pin.substring(0, _pin.length - 1));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // App icon
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Icon(Icons.lock_outline,
                      size: 36, color: theme.colorScheme.primary),
                ),
                const SizedBox(height: 24),
                Text('CivitasOne',
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text(
                  _showPinInput ? 'Enter your PIN to unlock' : 'Verifying identity…',
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: theme.colorScheme.outline),
                ),
                const SizedBox(height: 32),

                if (_showPinInput) ...[
                  // PIN dots
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(6, (i) => Container(
                      width: 16,
                      height: 16,
                      margin: const EdgeInsets.symmetric(horizontal: 8),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: i < _pin.length
                            ? theme.colorScheme.primary
                            : theme.colorScheme.outlineVariant,
                      ),
                    )),
                  ),
                  const SizedBox(height: 40),

                  // Number pad
                  _buildNumpad(theme),
                ] else ...[
                  const SizedBox(height: 32),
                  const CircularProgressIndicator(),
                ],

                // Biometric retry button
                if (_biometricFailed && _lockType == 'biometric') ...[
                  const SizedBox(height: 24),
                  TextButton.icon(
                    onPressed: _attemptBiometric,
                    icon: const Icon(Icons.fingerprint),
                    label: const Text('Try biometric again'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNumpad(ThemeData theme) {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    return SizedBox(
      width: 280,
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 3,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 1.3,
        children: digits.map((d) {
          if (d.isEmpty) return const SizedBox.shrink();
          if (d == '⌫') {
            return InkWell(
              onTap: _removeDigit,
              borderRadius: BorderRadius.circular(40),
              child: Center(
                child: Icon(Icons.backspace_outlined,
                    color: theme.colorScheme.onSurface),
              ),
            );
          }
          return InkWell(
            onTap: () => _addDigit(d),
            borderRadius: BorderRadius.circular(40),
            child: Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: theme.colorScheme.surfaceContainerHigh,
              ),
              child: Center(
                child: Text(d,
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w500)),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
