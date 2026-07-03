import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import 'models.dart';

/// All stock items, sorted by name.
final stockItemsProvider =
    FutureProvider.autoDispose<List<StockItem>>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final engine = ref.read(syncEngineProvider);
  await engine?.syncMailbox('stock_items');
  final entities = await db.listEntities('stock_items');
  return entities
      .map((e) => StockItem.fromJson(e['data'] as Map<String, dynamic>))
      .toList()
    ..sort((a, b) => a.name.compareTo(b.name));
});

/// Stock item by barcode.
final stockItemByBarcodeProvider =
    FutureProvider.autoDispose.family<StockItem?, String>((ref, barcode) async {
  final items = await ref.watch(stockItemsProvider.future);
  try {
    return items.firstWhere((i) => i.barcode == barcode);
  } catch (_) {
    return null;
  }
});

/// Items below minimum stock level.
final lowStockItemsProvider =
    FutureProvider.autoDispose<List<StockItem>>((ref) async {
  final items = await ref.watch(stockItemsProvider.future);
  return items.where((i) => i.isBelowMin).toList();
});

/// Recent goods receipts.
final goodsReceiptsProvider =
    FutureProvider.autoDispose<List<GoodsReceiptRecord>>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final engine = ref.read(syncEngineProvider);
  await engine?.syncMailbox('goods_receipts');
  final entities = await db.listEntities('goods_receipts');
  return entities
      .map((e) =>
          GoodsReceiptRecord.fromJson(e['data'] as Map<String, dynamic>))
      .toList()
    ..sort((a, b) => b.receivedAt.compareTo(a.receivedAt));
});
