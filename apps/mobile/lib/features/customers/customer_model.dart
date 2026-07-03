/// Customer data model for small business CRM.

class Customer {
  const Customer({
    required this.id,
    required this.name,
    this.phone,
    this.email,
    this.gstin,
    this.address,
    this.outstandingBalance = 0,
    this.createdAt,
  });

  final String id;
  final String name;
  final String? phone;
  final String? email;
  final String? gstin;
  final String? address;

  /// Outstanding balance in paise. Positive = they owe you. Negative = you owe them.
  final int outstandingBalance;
  final DateTime? createdAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'phone': phone,
        'email': email,
        'gstin': gstin,
        'address': address,
        'outstandingBalance': outstandingBalance,
        'createdAt': createdAt?.toIso8601String(),
      };

  factory Customer.fromJson(Map<String, dynamic> json) => Customer(
        id: json['id'] as String,
        name: json['name'] as String,
        phone: json['phone'] as String?,
        email: json['email'] as String?,
        gstin: json['gstin'] as String?,
        address: json['address'] as String?,
        outstandingBalance: json['outstandingBalance'] as int? ?? 0,
        createdAt: json['createdAt'] != null
            ? DateTime.tryParse(json['createdAt'] as String)
            : null,
      );
}
