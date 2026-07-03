import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'models.dart';

/// QR Scanner screen for verifying employee ID cards.
class IdCardVerifyScreen extends ConsumerStatefulWidget {
  const IdCardVerifyScreen({super.key});

  @override
  ConsumerState<IdCardVerifyScreen> createState() =>
      _IdCardVerifyScreenState();
}

class _IdCardVerifyScreenState extends ConsumerState<IdCardVerifyScreen> {
  bool _scanning = true;
  VerificationResult? _result;

  Future<void> _simulateScan() async {
    // In production: use mobile_scanner or qr_code_scanner package
    setState(() => _scanning = true);
    await Future.delayed(const Duration(seconds: 2));
    if (mounted) {
      setState(() {
        _scanning = false;
        _result = VerificationResult(
          status: VerificationStatus.valid,
          verifiedAt: DateTime.now().toUtc(),
          employee: Employee(
            id: 'demo-emp-1',
            tenantId: 'tenant-1',
            employeeCode: 'EMP-001',
            firstName: 'Rajesh',
            lastName: 'Kumar',
            designation: 'Section Officer',
            department: 'Finance',
            email: 'rajesh.kumar@gov.in',
            status: EmployeeStatus.active,
            joiningDate: _demoJoiningDate,
          ),
          message: 'Identity verified successfully',
        );
      });
    }
  }

  static final _demoJoiningDate = DateTime(2018, 3, 15);

  @override
  void initState() {
    super.initState();
    _simulateScan();
  }

  void _resetScan() {
    setState(() {
      _scanning = true;
      _result = null;
    });
    _simulateScan();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Verify ID Card'),
        centerTitle: false,
      ),
      body: _scanning
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 240,
                    height: 240,
                    decoration: BoxDecoration(
                      border: Border.all(
                          color: theme.colorScheme.primary, width: 2),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.qr_code_scanner,
                              size: 64, color: theme.colorScheme.primary),
                          const SizedBox(height: 12),
                          Text('Scanning...',
                              style: TextStyle(
                                  color: theme.colorScheme.outline)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text('Point camera at QR code on ID card',
                      style: TextStyle(color: theme.colorScheme.outline)),
                ],
              ),
            )
          : _result != null
              ? _VerificationResultWidget(
                  result: _result!, onRescan: _resetScan)
              : const Center(child: Text('No result')),
    );
  }
}

class _VerificationResultWidget extends StatelessWidget {
  const _VerificationResultWidget({
    required this.result,
    required this.onRescan,
  });

  final VerificationResult result;
  final VoidCallback onRescan;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isValid = result.isVerified;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Status indicator
        Center(
          child: Column(
            children: [
              CircleAvatar(
                radius: 36,
                backgroundColor: isValid
                    ? Colors.green.withOpacity(0.1)
                    : Colors.red.withOpacity(0.1),
                child: Icon(
                  isValid ? Icons.verified : Icons.error,
                  size: 40,
                  color: isValid ? Colors.green : Colors.red,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                isValid ? 'Identity Verified' : 'Verification Failed',
                style: theme.textTheme.titleMedium?.copyWith(
                  color: isValid ? Colors.green : Colors.red,
                ),
              ),
              if (result.message != null) ...[
                const SizedBox(height: 4),
                Text(result.message!,
                    style: TextStyle(color: theme.colorScheme.outline)),
              ],
            ],
          ),
        ),
        const SizedBox(height: 24),

        // Employee info (if verified)
        if (result.employee != null) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Employee Details',
                      style: theme.textTheme.titleSmall),
                  const Divider(),
                  _InfoRow('Name', result.employee!.fullName),
                  _InfoRow('Code', result.employee!.employeeCode),
                  _InfoRow('Designation', result.employee!.designation),
                  _InfoRow('Department', result.employee!.department),
                  _InfoRow('Status', result.employee!.status.name),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 24),

        // Rescan button
        SizedBox(
          height: 52,
          child: OutlinedButton.icon(
            onPressed: onRescan,
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('Scan Another'),
          ),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(color: Theme.of(context).colorScheme.outline)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}
