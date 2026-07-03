import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import 'models.dart';

/// All employees in the directory, sorted by name.
final employeeDirectoryProvider =
    FutureProvider.autoDispose<List<Employee>>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final engine = ref.read(syncEngineProvider);
  await engine?.syncMailbox('employees');
  final entities = await db.listEntities('employees');
  return entities
      .map((e) => Employee.fromJson(e['data'] as Map<String, dynamic>))
      .toList()
    ..sort((a, b) => a.fullName.compareTo(b.fullName));
});

/// Single employee by ID.
final employeeByIdProvider =
    FutureProvider.autoDispose.family<Employee?, String>((ref, id) async {
  final employees = await ref.watch(employeeDirectoryProvider.future);
  try {
    return employees.firstWhere((e) => e.id == id);
  } catch (_) {
    return null;
  }
});

/// Current user's ID card.
final idCardProvider =
    FutureProvider.autoDispose<IdCard?>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final engine = ref.read(syncEngineProvider);
  await engine?.syncMailbox('id_cards');
  final entities = await db.listEntities('id_cards');
  if (entities.isEmpty) return null;
  return IdCard.fromJson(entities.first['data'] as Map<String, dynamic>);
});
