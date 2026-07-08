import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/providers.dart';

/// Medical Claim submission form for employees.
/// POST /v1/hrms/medical-claims
/// Fields: claimType, hospitalName, diagnosis, amountMinor, dependantName,
///         dependantRelation, documents[], remarks
class MedicalClaimScreen extends ConsumerStatefulWidget {
  const MedicalClaimScreen({super.key});

  @override
  ConsumerState<MedicalClaimScreen> createState() => _MedicalClaimScreenState();
}

class _MedicalClaimScreenState extends ConsumerState<MedicalClaimScreen> {
  final _formKey = GlobalKey<FormState>();
  final _hospitalCtrl = TextEditingController();
  final _diagnosisCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  final _dependantNameCtrl = TextEditingController();
  final _remarksCtrl = TextEditingController();

  String _claimType = 'Indoor';
  String _dependantRelation = 'Self';
  final List<XFile> _documents = [];
  bool _submitting = false;

  static const _claimTypes = ['Indoor', 'Outdoor', 'Reimbursement', 'Advance'];
  static const _relations = ['Self', 'Spouse', 'Child', 'Parent'];

  @override
  void dispose() {
    _hospitalCtrl.dispose();
    _diagnosisCtrl.dispose();
    _amountCtrl.dispose();
    _dependantNameCtrl.dispose();
    _remarksCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDocuments() async {
    try {
      final picker = ImagePicker();
      final images = await picker.pickMultiImage(
        imageQuality: 80,
        maxWidth: 1920,
      );
      if (images.isNotEmpty) {
        setState(() => _documents.addAll(images));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Unable to pick images: $e')),
        );
      }
    }
  }

  Future<void> _captureDocument() async {
    try {
      final picker = ImagePicker();
      final image = await picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 80,
        maxWidth: 1920,
      );
      if (image != null) {
        setState(() => _documents.add(image));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Unable to capture image: $e')),
        );
      }
    }
  }

  void _removeDocument(int index) {
    setState(() => _documents.removeAt(index));
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _submitting = true);
    try {
      final api = ref.read(apiClientProvider);
      final amountRupees = double.tryParse(_amountCtrl.text) ?? 0;
      final amountPaise = (amountRupees * 100).toInt();

      // Upload documents and collect refs
      final documentRefs = <String>[];
      for (final doc in _documents) {
        // In production, upload to S3 presigned URL and get the key
        // For now, using the file name as reference
        documentRefs.add(doc.name);
      }

      final body = <String, dynamic>{
        'claimType': _claimType,
        'hospitalName': _hospitalCtrl.text.trim(),
        'diagnosis': _diagnosisCtrl.text.trim(),
        'amountMinor': amountPaise,
        'documents': documentRefs,
      };

      if (_dependantNameCtrl.text.trim().isNotEmpty) {
        body['dependantName'] = _dependantNameCtrl.text.trim();
      }
      body['dependantRelation'] = _dependantRelation;

      if (_remarksCtrl.text.trim().isNotEmpty) {
        body['remarks'] = _remarksCtrl.text.trim();
      }

      await api.post('/v1/hrms/medical-claims', data: body);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Medical claim submitted successfully'),
            backgroundColor: Color(0xFF15803D),
          ),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to submit: $e'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Medical Claim'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // Claim Type
            DropdownButtonFormField<String>(
              value: _claimType,
              decoration: const InputDecoration(
                labelText: 'Claim Type *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.medical_services),
              ),
              items: _claimTypes
                  .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                  .toList(),
              onChanged: (v) => setState(() => _claimType = v!),
            ),
            const SizedBox(height: 16),

            // Hospital Name
            TextFormField(
              controller: _hospitalCtrl,
              decoration: const InputDecoration(
                labelText: 'Hospital / Clinic Name *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.local_hospital),
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Hospital name is required' : null,
            ),
            const SizedBox(height: 16),

            // Diagnosis
            TextFormField(
              controller: _diagnosisCtrl,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Diagnosis / Treatment Details *',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
                prefixIcon: Icon(Icons.description),
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Diagnosis is required' : null,
            ),
            const SizedBox(height: 16),

            // Amount
            TextFormField(
              controller: _amountCtrl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Amount (₹) *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.currency_rupee),
                hintText: '0.00',
              ),
              validator: (v) {
                if (v == null || v.isEmpty) return 'Amount is required';
                final amount = double.tryParse(v);
                if (amount == null || amount <= 0) return 'Enter a valid amount > 0';
                return null;
              },
            ),
            const SizedBox(height: 16),

            // Dependant Name (optional)
            TextFormField(
              controller: _dependantNameCtrl,
              decoration: const InputDecoration(
                labelText: 'Dependant Name (optional)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.person),
              ),
            ),
            const SizedBox(height: 16),

            // Dependant Relation
            DropdownButtonFormField<String>(
              value: _dependantRelation,
              decoration: const InputDecoration(
                labelText: 'Dependant Relation',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.family_restroom),
              ),
              items: _relations
                  .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                  .toList(),
              onChanged: (v) => setState(() => _dependantRelation = v!),
            ),
            const SizedBox(height: 20),

            // Documents section
            Text('Supporting Documents',
                style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            if (_documents.isNotEmpty) ...[
              SizedBox(
                height: 100,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  itemCount: _documents.length,
                  itemBuilder: (ctx, i) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Stack(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.file(
                            File(_documents[i].path),
                            width: 100,
                            height: 100,
                            fit: BoxFit.cover,
                          ),
                        ),
                        Positioned(
                          top: 2,
                          right: 2,
                          child: GestureDetector(
                            onTap: () => _removeDocument(i),
                            child: Container(
                              padding: const EdgeInsets.all(2),
                              decoration: const BoxDecoration(
                                color: Colors.black54,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.close,
                                  size: 16, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickDocuments,
                    icon: const Icon(Icons.photo_library, size: 18),
                    label: const Text('Gallery'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _captureDocument,
                    icon: const Icon(Icons.camera_alt, size: 18),
                    label: const Text('Camera'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Remarks
            TextFormField(
              controller: _remarksCtrl,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Remarks (optional)',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 24),

            // Submit
            FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.send),
              label: Text(_submitting ? 'Submitting…' : 'Submit Medical Claim'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
