import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/public_case_status.dart';
import '../providers/court_providers.dart';
import 'cases_list_screen.dart' show CaseStatusPill;

/// Public case-status lookup — the citizen-facing, no-PII docket flow:
///   1. request an OTP for a mobile number,
///   2. enter CNR + the 6-digit OTP,
///   3. view the docket (never any party PII).
///
/// Courts configured as 'open' or 'captcha' won't require the OTP, but this
/// screen implements the OTP path (the service default) end-to-end.
class PublicLookupScreen extends ConsumerStatefulWidget {
  const PublicLookupScreen({super.key});

  @override
  ConsumerState<PublicLookupScreen> createState() => _PublicLookupScreenState();
}

class _PublicLookupScreenState extends ConsumerState<PublicLookupScreen> {
  final _mobileCtrl = TextEditingController();
  final _cnrCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();

  String? _challengeId;
  bool _sendingOtp = false;
  bool _looking = false;
  String? _error;
  PublicCaseStatus? _result;

  @override
  void dispose() {
    _mobileCtrl.dispose();
    _cnrCtrl.dispose();
    _otpCtrl.dispose();
    super.dispose();
  }

  Future<void> _requestOtp() async {
    setState(() {
      _sendingOtp = true;
      _error = null;
    });
    try {
      final api = ref.read(courtApiProvider);
      final challenge = await api.requestOtp(mobile: _mobileCtrl.text.trim());
      setState(() => _challengeId = challenge.challengeId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('OTP sent to your mobile.')),
        );
      }
    } catch (e) {
      setState(() => _error = 'Could not send OTP: $e');
    } finally {
      if (mounted) setState(() => _sendingOtp = false);
    }
  }

  Future<void> _lookup() async {
    setState(() {
      _looking = true;
      _error = null;
      _result = null;
    });
    try {
      final api = ref.read(courtApiProvider);
      final res = await api.publicCaseStatus(
        cnr: _cnrCtrl.text.trim(),
        challengeId: _challengeId,
        otp: _otpCtrl.text.trim().isEmpty ? null : _otpCtrl.text.trim(),
      );
      setState(() => _result = res);
    } catch (e) {
      setState(() => _error = 'Lookup failed: $e');
    } finally {
      if (mounted) setState(() => _looking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final establishments = ref.watch(establishmentsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Case Status Lookup')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Public court directory.
          establishments.when(
            loading: () => const LinearProgressIndicator(),
            error: (_, __) => const SizedBox.shrink(),
            data: (list) => list.isEmpty
                ? const SizedBox.shrink()
                : Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Participating Courts',
                              style: theme.textTheme.titleSmall
                                  ?.copyWith(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 8),
                          for (final e in list)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Text('• ${e.courtName} (${e.establishmentCode})',
                                  style: theme.textTheme.bodySmall),
                            ),
                        ],
                      ),
                    ),
                  ),
          ),
          const SizedBox(height: 16),

          // Step 1 — request OTP.
          Text('1. Verify your mobile',
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          TextField(
            controller: _mobileCtrl,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'Mobile number',
              prefixIcon: Icon(Icons.phone),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _sendingOtp ? null : _requestOtp,
              icon: _sendingOtp
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.sms),
              label: Text(_challengeId == null ? 'Send OTP' : 'Resend OTP'),
            ),
          ),
          const SizedBox(height: 20),

          // Step 2 — CNR + OTP.
          Text('2. Look up the case',
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          TextField(
            controller: _cnrCtrl,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: 'CNR number',
              prefixIcon: Icon(Icons.tag),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _otpCtrl,
            keyboardType: TextInputType.number,
            maxLength: 6,
            decoration: const InputDecoration(
              labelText: '6-digit OTP',
              prefixIcon: Icon(Icons.lock),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 4),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _looking ? null : _lookup,
              icon: _looking
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.search),
              label: const Text('View Case Status'),
            ),
          ),

          if (_error != null) ...[
            const SizedBox(height: 16),
            Card(
              color: theme.colorScheme.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(_error!,
                    style: TextStyle(
                        color: theme.colorScheme.onErrorContainer)),
              ),
            ),
          ],

          if (_result != null) ...[
            const SizedBox(height: 20),
            _DocketCard(status: _result!),
          ],
        ],
      ),
    );
  }
}

class _DocketCard extends StatelessWidget {
  const _DocketCard({required this.status});
  final PublicCaseStatus status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final d = status.docket;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(d.title ?? d.cnrNumber,
                style: theme.textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            CaseStatusPill(status: d.status),
            const SizedBox(height: 12),
            _kv(theme, 'CNR', d.cnrNumber),
            _kv(theme, 'Case Type', d.caseType ?? '—'),
            _kv(theme, 'Stage', d.stage ?? '—'),
            _kv(theme, 'Filing Date', d.filingDate ?? '—'),
            _kv(theme, 'Disposal Date', d.disposalDate ?? '—'),
            const SizedBox(height: 8),
            Text(
              'Verified via ${status.accessMode ?? 'public'} · no personal data shown',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.outline),
            ),
          ],
        ),
      ),
    );
  }

  Widget _kv(ThemeData theme, String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 110,
              child: Text(k,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: theme.colorScheme.outline)),
            ),
            Expanded(
              child: Text(v,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w500)),
            ),
          ],
        ),
      );
}
