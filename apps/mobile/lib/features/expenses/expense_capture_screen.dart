import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';

/// Camera-first expense capture. Tap to photograph receipt,
/// fill amount + category, save. Zero clutter, one action.
class ExpenseCaptureScreen extends ConsumerStatefulWidget {
  const ExpenseCaptureScreen({super.key});

  @override
  ConsumerState<ExpenseCaptureScreen> createState() =>
      _ExpenseCaptureScreenState();
}

enum ExpenseCategory { travel, food, office, utilities, salary, other }

class _ExpenseCaptureScreenState extends ConsumerState<ExpenseCaptureScreen> {
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  ExpenseCategory _category = ExpenseCategory.office;
  bool _hasReceipt = false;
  bool _saving = false;
  bool _saved = false;

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  IconData _categoryIcon(ExpenseCategory cat) {
    switch (cat) {
      case ExpenseCategory.travel:
        return Icons.directions_car;
      case ExpenseCategory.food:
        return Icons.restaurant;
      case ExpenseCategory.office:
        return Icons.business;
      case ExpenseCategory.utilities:
        return Icons.electrical_services;
      case ExpenseCategory.salary:
        return Icons.people;
      case ExpenseCategory.other:
        return Icons.more_horiz;
    }
  }

  Future<void> _captureReceipt() async {
    // Placeholder — would use image_picker in production
    setState(() => _hasReceipt = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Receipt captured')),
    );
  }

  Future<void> _saveExpense() async {
    final amount = double.tryParse(_amountController.text);
    if (amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a valid amount')),
      );
      return;
    }

    setState(() => _saving = true);

    final id = const Uuid().v4();
    final payload = {
      'id': id,
      'amountMinor': (amount * 100).round(),
      'category': _category.name,
      'description': _descriptionController.text.trim(),
      'hasReceipt': _hasReceipt,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    };

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'expenses',
        operation: 'create',
        entityId: id,
        payload: payload,
      );
      await db.upsertEntity(
        id: id,
        mailbox: 'expenses',
        data: payload,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        syncState: 'pending',
      );
    }

    ref.read(syncEngineProvider)?.syncMailbox('expenses');

    setState(() {
      _saving = false;
      _saved = true;
    });
  }

  void _reset() {
    setState(() {
      _saved = false;
      _hasReceipt = false;
      _amountController.clear();
      _descriptionController.clear();
      _category = ExpenseCategory.office;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (_saved) {
      return Scaffold(
        appBar: AppBar(title: const Text('Expense Saved')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      children: [
                        Icon(_categoryIcon(_category),
                            size: 40, color: theme.colorScheme.primary),
                        const SizedBox(height: 12),
                        Text(
                          '₹${_amountController.text}',
                          style: theme.textTheme.headlineSmall
                              ?.copyWith(fontWeight: FontWeight.bold),
                        ),
                        Text(
                          _category.name[0].toUpperCase() +
                              _category.name.substring(1),
                          style:
                              TextStyle(color: theme.colorScheme.outline),
                        ),
                        if (_descriptionController.text.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(_descriptionController.text,
                              style: const TextStyle(fontSize: 13)),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: FilledButton(
                    onPressed: _reset,
                    child: const Text('Add Another',
                        style: TextStyle(fontSize: 16)),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Done', style: TextStyle(fontSize: 16)),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Expense'),
        centerTitle: false,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Camera-first receipt capture
          InkWell(
            onTap: _captureReceipt,
            borderRadius: BorderRadius.circular(16),
            child: Container(
              height: 140,
              decoration: BoxDecoration(
                color: _hasReceipt
                    ? Colors.green.withOpacity(0.1)
                    : theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: _hasReceipt
                      ? Colors.green
                      : theme.colorScheme.outlineVariant,
                  width: 2,
                  style: _hasReceipt ? BorderStyle.solid : BorderStyle.none,
                ),
              ),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _hasReceipt ? Icons.check_circle : Icons.camera_alt,
                      size: 40,
                      color: _hasReceipt
                          ? Colors.green
                          : theme.colorScheme.outline,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _hasReceipt ? 'Receipt captured ✓' : 'Tap to photograph receipt',
                      style: TextStyle(
                        color: _hasReceipt
                            ? Colors.green
                            : theme.colorScheme.outline,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 20),

          // Amount
          TextField(
            controller: _amountController,
            decoration: const InputDecoration(
              labelText: 'Amount (₹)',
              prefixIcon: Icon(Icons.currency_rupee),
              border: OutlineInputBorder(),
            ),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[\d.]')),
            ],
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 16),

          // Category
          Text('Category', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: ExpenseCategory.values.map((cat) {
              final selected = _category == cat;
              return ChoiceChip(
                avatar: Icon(_categoryIcon(cat), size: 18),
                label: Text(cat.name[0].toUpperCase() + cat.name.substring(1)),
                selected: selected,
                onSelected: (_) => setState(() => _category = cat),
                showCheckmark: false,
              );
            }).toList(),
          ),
          const SizedBox(height: 16),

          // Description
          TextField(
            controller: _descriptionController,
            decoration: const InputDecoration(
              labelText: 'Description (optional)',
              border: OutlineInputBorder(),
            ),
            maxLines: 2,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 24),

          // Save button
          SizedBox(
            height: 52,
            child: FilledButton(
              onPressed: _saving ? null : _saveExpense,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Save Expense',
                      style: TextStyle(fontSize: 16)),
            ),
          ),
        ],
      ),
    );
  }
}
