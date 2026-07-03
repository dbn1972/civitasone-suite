/// Invoice data models for small business invoicing.
///
/// Amounts stored as integers (paise) to avoid floating-point issues.
/// All fields serialize to/from JSON for SQLite storage via SyncDatabase.

class InvoiceItem {
  const InvoiceItem({
    required this.name,
    required this.qty,
    required this.rate,
    required this.gstPercent,
  });

  final String name;
  final int qty;

  /// Rate in paise (minor units).
  final int rate;

  /// GST percentage (0, 5, 12, 18, 28).
  final double gstPercent;

  /// Line amount before GST (qty × rate) in paise.
  int get amount => qty * rate;

  /// GST amount for this line item in paise.
  int get gstAmount => (amount * gstPercent / 100).round();

  /// Total including GST.
  int get totalWithGst => amount + gstAmount;

  Map<String, dynamic> toJson() => {
        'name': name,
        'qty': qty,
        'rate': rate,
        'gstPercent': gstPercent,
      };

  factory InvoiceItem.fromJson(Map<String, dynamic> json) => InvoiceItem(
        name: json['name'] as String,
        qty: json['qty'] as int,
        rate: json['rate'] as int,
        gstPercent: (json['gstPercent'] as num).toDouble(),
      );

  InvoiceItem copyWith({
    String? name,
    int? qty,
    int? rate,
    double? gstPercent,
  }) =>
      InvoiceItem(
        name: name ?? this.name,
        qty: qty ?? this.qty,
        rate: rate ?? this.rate,
        gstPercent: gstPercent ?? this.gstPercent,
      );
}

enum InvoiceStatus { unpaid, paid, partial }

class Invoice {
  const Invoice({
    required this.id,
    required this.tenantId,
    required this.invoiceNo,
    required this.customerId,
    required this.customerName,
    required this.items,
    required this.status,
    required this.createdAt,
    this.dueDate,
  });

  final String id;
  final String tenantId;
  final String invoiceNo;
  final String customerId;
  final String customerName;
  final List<InvoiceItem> items;
  final InvoiceStatus status;
  final DateTime createdAt;
  final DateTime? dueDate;

  /// Subtotal before GST in paise.
  int get subtotal => items.fold(0, (sum, item) => sum + item.amount);

  /// Total GST in paise.
  int get gstAmount => items.fold(0, (sum, item) => sum + item.gstAmount);

  /// Grand total (subtotal + GST) in paise.
  int get total => subtotal + gstAmount;

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'invoiceNo': invoiceNo,
        'customerId': customerId,
        'customerName': customerName,
        'items': items.map((i) => i.toJson()).toList(),
        'subtotal': subtotal,
        'gstAmount': gstAmount,
        'total': total,
        'status': status.name,
        'createdAt': createdAt.toIso8601String(),
        'dueDate': dueDate?.toIso8601String(),
      };

  factory Invoice.fromJson(Map<String, dynamic> json) => Invoice(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        invoiceNo: json['invoiceNo'] as String,
        customerId: json['customerId'] as String? ?? '',
        customerName: json['customerName'] as String,
        items: (json['items'] as List<dynamic>?)
                ?.map((i) => InvoiceItem.fromJson(i as Map<String, dynamic>))
                .toList() ??
            [],
        status: InvoiceStatus.values.firstWhere(
          (s) => s.name == (json['status'] as String? ?? 'unpaid'),
          orElse: () => InvoiceStatus.unpaid,
        ),
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.now(),
        dueDate: json['dueDate'] != null
            ? DateTime.tryParse(json['dueDate'] as String)
            : null,
      );
}
