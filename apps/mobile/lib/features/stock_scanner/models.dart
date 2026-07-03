/// Stock Scanner data models.
///
/// Supports barcode/QR scanning for goods receipt, stock adjustment, and lookup.
/// Quantities stored as integers to avoid floating-point issues.

enum ScannerMode { lookup, goodsReceipt, adjustment }

enum AdjustmentReason { damaged, expired, found, lost, transfer, correction }

class StockItem {
  const StockItem({
    required this.id,
    required this.tenantId,
    required this.sku,
    required this.name,
    required this.currentQty,
    required this.unit,
    this.barcode,
    this.category,
    this.location,
    this.minQty,
    this.maxQty,
    this.lastCountedAt,
  });

  final String id;
  final String tenantId;
  final String sku;
  final String name;

  /// Current quantity on hand.
  final int currentQty;
  final String unit;
  final String? barcode;
  final String? category;
  final String? location;

  /// Minimum stock level for reorder alerts.
  final int? minQty;
  final int? maxQty;
  final DateTime? lastCountedAt;

  /// Whether stock is below minimum level.
  bool get isBelowMin => minQty != null && currentQty < minQty!;

  /// Whether stock exceeds maximum level.
  bool get isAboveMax => maxQty != null && currentQty > maxQty!;

  /// Variance from min (negative = below min).
  int? get varianceFromMin => minQty != null ? currentQty - minQty! : null;

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'sku': sku,
        'name': name,
        'currentQty': currentQty,
        'unit': unit,
        'barcode': barcode,
        'category': category,
        'location': location,
        'minQty': minQty,
        'maxQty': maxQty,
        'lastCountedAt': lastCountedAt?.toIso8601String(),
      };

  factory StockItem.fromJson(Map<String, dynamic> json) => StockItem(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        sku: json['sku'] as String,
        name: json['name'] as String,
        currentQty: json['currentQty'] as int,
        unit: json['unit'] as String? ?? 'pcs',
        barcode: json['barcode'] as String?,
        category: json['category'] as String?,
        location: json['location'] as String?,
        minQty: json['minQty'] as int?,
        maxQty: json['maxQty'] as int?,
        lastCountedAt: json['lastCountedAt'] != null
            ? DateTime.tryParse(json['lastCountedAt'] as String)
            : null,
      );
}

class GoodsReceiptRecord {
  const GoodsReceiptRecord({
    required this.id,
    required this.tenantId,
    required this.itemId,
    required this.itemName,
    required this.receivedQty,
    required this.receivedAt,
    required this.receivedBy,
    this.poNumber,
    this.batchNo,
    this.expiryDate,
    this.notes,
  });

  final String id;
  final String tenantId;
  final String itemId;
  final String itemName;
  final int receivedQty;
  final DateTime receivedAt;
  final String receivedBy;
  final String? poNumber;
  final String? batchNo;
  final DateTime? expiryDate;
  final String? notes;

  /// Days until batch expiry (null if no expiry set).
  int? get daysUntilExpiry =>
      expiryDate?.difference(DateTime.now().toUtc()).inDays;

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'itemId': itemId,
        'itemName': itemName,
        'receivedQty': receivedQty,
        'receivedAt': receivedAt.toIso8601String(),
        'receivedBy': receivedBy,
        'poNumber': poNumber,
        'batchNo': batchNo,
        'expiryDate': expiryDate?.toIso8601String(),
        'notes': notes,
      };

  factory GoodsReceiptRecord.fromJson(Map<String, dynamic> json) =>
      GoodsReceiptRecord(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        itemId: json['itemId'] as String,
        itemName: json['itemName'] as String,
        receivedQty: json['receivedQty'] as int,
        receivedAt: DateTime.parse(json['receivedAt'] as String),
        receivedBy: json['receivedBy'] as String,
        poNumber: json['poNumber'] as String?,
        batchNo: json['batchNo'] as String?,
        expiryDate: json['expiryDate'] != null
            ? DateTime.tryParse(json['expiryDate'] as String)
            : null,
        notes: json['notes'] as String?,
      );
}

class StockAdjustment {
  const StockAdjustment({
    required this.id,
    required this.tenantId,
    required this.itemId,
    required this.itemName,
    required this.previousQty,
    required this.adjustedQty,
    required this.reason,
    required this.adjustedAt,
    required this.adjustedBy,
    this.notes,
  });

  final String id;
  final String tenantId;
  final String itemId;
  final String itemName;
  final int previousQty;
  final int adjustedQty;
  final AdjustmentReason reason;
  final DateTime adjustedAt;
  final String adjustedBy;
  final String? notes;

  /// Net change in quantity (positive = increase, negative = decrease).
  int get variance => adjustedQty - previousQty;

  /// Absolute variance.
  int get absoluteVariance => variance.abs();

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'itemId': itemId,
        'itemName': itemName,
        'previousQty': previousQty,
        'adjustedQty': adjustedQty,
        'reason': reason.name,
        'adjustedAt': adjustedAt.toIso8601String(),
        'adjustedBy': adjustedBy,
        'notes': notes,
      };

  factory StockAdjustment.fromJson(Map<String, dynamic> json) =>
      StockAdjustment(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        itemId: json['itemId'] as String,
        itemName: json['itemName'] as String,
        previousQty: json['previousQty'] as int,
        adjustedQty: json['adjustedQty'] as int,
        reason: AdjustmentReason.values.firstWhere(
          (r) => r.name == (json['reason'] as String? ?? 'correction'),
          orElse: () => AdjustmentReason.correction,
        ),
        adjustedAt: DateTime.parse(json['adjustedAt'] as String),
        adjustedBy: json['adjustedBy'] as String,
        notes: json['notes'] as String?,
      );
}
