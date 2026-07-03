import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import 'models.dart';

/// All bills, sorted by creation date (newest first).
final billsProvider =
    FutureProvider.autoDispose<List<Bill>>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final engine = ref.read(syncEngineProvider);
  await engine?.syncMailbox('bills');
  final entities = await db.listEntities('bills');
  return entities
      .map((e) => Bill.fromJson(e['data'] as Map<String, dynamic>))
      .toList()
    ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
});

/// Single bill by ID.
final billByIdProvider =
    FutureProvider.autoDispose.family<Bill?, String>((ref, id) async {
  final bills = await ref.watch(billsProvider.future);
  try {
    return bills.firstWhere((b) => b.id == id);
  } catch (_) {
    return null;
  }
});

/// Bills that are overdue.
final overdueBillsProvider =
    FutureProvider.autoDispose<List<Bill>>((ref) async {
  final bills = await ref.watch(billsProvider.future);
  return bills.where((b) => b.isOverdue).toList();
});
