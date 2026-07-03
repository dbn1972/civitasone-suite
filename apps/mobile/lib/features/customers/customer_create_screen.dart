import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';

/// Minimal customer creation: Name (required), Phone, Email, GSTIN, Address.
/// One action: Save Customer. Large tap targets. Works offline.
class CustomerCreateScreen extends ConsumerStatefulWidget {
  const CustomerCreateScreen({super.key});

  @override
  ConsumerState<CustomerCreateScreen> createState() =>
      _CustomerCreateScreenState();
}

class _CustomerCreateScreenState extends ConsumerState<CustomerCreateScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _gstinController = TextEditingController();
  final _addressController = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _gstinController.dispose();
    _addressController.dispose();
    super.dispose();
  }

  Future<void> _saveCustomer() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);

    final id = const Uuid().v4();
    final payload = {
      'id': id,
      'name': _nameController.text.trim(),
      'phone': _phoneController.text.trim().isEmpty
          ? null
          : _phoneController.text.trim(),
      'email': _emailController.text.trim().isEmpty
          ? null
          : _emailController.text.trim(),
      'gstin': _gstinController.text.trim().isEmpty
          ? null
          : _gstinController.text.trim(),
      'address': _addressController.text.trim().isEmpty
          ? null
          : _addressController.text.trim(),
      'outstandingBalance': 0,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    };

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'customers',
        operation: 'create',
        entityId: id,
        payload: payload,
      );
      await db.upsertEntity(
        id: id,
        mailbox: 'customers',
        data: payload,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        syncState: 'pending',
      );
    }

    ref.read(syncEngineProvider)?.syncMailbox('customers');

    setState(() => _saving = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Customer saved')),
      );
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Watch dbProvider to ensure it resolves before save actions
    ref.watch(dbProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Customer'),
        centerTitle: false,
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Name *',
                prefixIcon: Icon(Icons.person),
                border: OutlineInputBorder(),
              ),
              textCapitalization: TextCapitalization.words,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Name is required' : null,
              autofocus: true,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _phoneController,
              decoration: const InputDecoration(
                labelText: 'Phone',
                prefixIcon: Icon(Icons.phone),
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _emailController,
              decoration: const InputDecoration(
                labelText: 'Email',
                prefixIcon: Icon(Icons.email),
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _gstinController,
              decoration: const InputDecoration(
                labelText: 'GSTIN (optional)',
                prefixIcon: Icon(Icons.assignment),
                border: OutlineInputBorder(),
              ),
              textCapitalization: TextCapitalization.characters,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _addressController,
              decoration: const InputDecoration(
                labelText: 'Address',
                prefixIcon: Icon(Icons.location_on),
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 24),
            SizedBox(
              height: 52,
              child: FilledButton(
                onPressed: _saving ? null : _saveCustomer,
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Save Customer',
                        style: TextStyle(fontSize: 16)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
