import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';

/// Minimal payment recording: Customer → Amount → Mode → Record.
/// One clear action. Large tap targets. Works offline.
class PaymentRecordScreen extends ConsumerStatefulWidget {
  const PaymentRecordScreen({super.key});

  @override
  ConsumerState<PaymentRecordScreen> createState() =>
      _PaymentRecordScreenState();
}

enum PaymentMode { upi, cash, bank, cheque }

class _PaymentRecordScreenState extends ConsumerState<PaymentRecordScreen>
    with SingleTickerProviderStateMixin {
  final _customerController = TextEditingController();
  final _amountController = TextEditingController();
  final _referenceController = TextEditingController();
  final _noteController = TextEditingController();
  PaymentMode _mode = PaymentMode.upi;
  bool _saving = false;
  bool _success = false;
  String? _savedAmount;
  late AnimationController _checkAnimController;
  late Animation<double> _checkAnimation;

  @override
  void initState() {
    super.initState();
    _checkAnimController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _checkAnimation =
        CurvedAnimation(parent: _checkAnimController, curve: Curves.elasticOut);
  }

  @override
  void dispose() {
    _customerController.dispose();
    _amountController.dispose();
    _referenceController.dispose();
    _noteController.dispose();
    _checkAnimController.dispose();
    super.dispose();
  }

  Future<void> _recordPayment() async {
    if (_customerController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a customer/vendor name')),
      );
      return;
    }
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
      'customerName': _customerController.text.trim(),
      'amountMinor': (amount * 100).round(),
      'mode': _mode.name,
      'reference': _referenceController.text.trim(),
      'note': _noteController.text.trim(),
      'type': 'received',
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    };

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'biz_payments',
        operation: 'create',
        entityId: id,
        payload: payload,
      );
      await db.upsertEntity(
        id: id,
        mailbox: 'biz_payments',
        data: payload,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        syncState: 'pending',
      );
    }

    ref.read(syncEngineProvider)?.syncMailbox('biz_payments');

    setState(() {
      _saving = false;
      _success = true;
      _savedAmount = '₹${amount.toStringAsFixed(2)}';
    });
    _checkAnimController.forward();
  }

  void _reset() {
    setState(() {
      _success = false;
      _customerController.clear();
      _amountController.clear();
      _referenceController.clear();
      _noteController.clear();
      _mode = PaymentMode.upi;
    });
    _checkAnimController.reset();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (_success) {
      return Scaffold(
        appBar: AppBar(title: const Text('Payment Recorded')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ScaleTransition(
                  scale: _checkAnimation,
                  child: const Icon(Icons.check_circle,
                      color: Colors.green, size: 80),
                ),
                const SizedBox(height: 20),
                Text(
                  _savedAmount ?? '',
                  style: theme.textTheme.headlineMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text('Payment recorded successfully',
                    style: TextStyle(color: theme.colorScheme.outline)),
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: FilledButton(
                    onPressed: _reset,
                    child: const Text('Record Another',
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
        title: const Text('Record Payment'),
        centerTitle: false,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Customer/Vendor
          TextField(
            controller: _customerController,
            decoration: const InputDecoration(
              labelText: 'Customer / Vendor',
              prefixIcon: Icon(Icons.person),
              border: OutlineInputBorder(),
            ),
            textCapitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 16),

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

          // Payment mode
          Text('Payment Mode', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: PaymentMode.values.map((mode) {
              final selected = _mode == mode;
              return ChoiceChip(
                label: Text(mode.name.toUpperCase()),
                selected: selected,
                onSelected: (_) => setState(() => _mode = mode),
                showCheckmark: false,
                labelStyle: TextStyle(
                  fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 16),

          // Optional fields
          TextField(
            controller: _referenceController,
            decoration: const InputDecoration(
              labelText: 'Reference # (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _noteController,
            decoration: const InputDecoration(
              labelText: 'Note (optional)',
              border: OutlineInputBorder(),
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 24),

          // Record button
          SizedBox(
            height: 52,
            child: FilledButton(
              onPressed: _saving ? null : _recordPayment,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Record Payment',
                      style: TextStyle(fontSize: 16)),
            ),
          ),
        ],
      ),
    );
  }
}
