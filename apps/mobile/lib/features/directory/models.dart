/// Employee Directory data models.
///
/// Supports employee search, ID card display with QR, and verification.

enum EmployeeStatus { active, onLeave, transferred, retired, suspended }

class Employee {
  const Employee({
    required this.id,
    required this.tenantId,
    required this.employeeCode,
    required this.firstName,
    required this.lastName,
    required this.designation,
    required this.department,
    required this.email,
    required this.status,
    required this.joiningDate,
    this.phone,
    this.photoUrl,
    this.reportingTo,
    this.officeLocation,
    this.bloodGroup,
  });

  final String id;
  final String tenantId;
  final String employeeCode;
  final String firstName;
  final String lastName;
  final String designation;
  final String department;
  final String email;
  final EmployeeStatus status;
  final DateTime joiningDate;
  final String? phone;
  final String? photoUrl;
  final String? reportingTo;
  final String? officeLocation;
  final String? bloodGroup;

  /// Full display name.
  String get fullName => '$firstName $lastName';

  /// Years of service computed from joining date.
  int get yearsOfService =>
      DateTime.now().toUtc().difference(joiningDate).inDays ~/ 365;

  /// Initials for avatar fallback.
  String get initials {
    final f = firstName.isNotEmpty ? firstName[0] : '';
    final l = lastName.isNotEmpty ? lastName[0] : '';
    return '$f$l'.toUpperCase();
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'employeeCode': employeeCode,
        'firstName': firstName,
        'lastName': lastName,
        'designation': designation,
        'department': department,
        'email': email,
        'status': status.name,
        'joiningDate': joiningDate.toIso8601String(),
        'phone': phone,
        'photoUrl': photoUrl,
        'reportingTo': reportingTo,
        'officeLocation': officeLocation,
        'bloodGroup': bloodGroup,
      };

  factory Employee.fromJson(Map<String, dynamic> json) => Employee(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        employeeCode: json['employeeCode'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        designation: json['designation'] as String,
        department: json['department'] as String,
        email: json['email'] as String,
        status: EmployeeStatus.values.firstWhere(
          (s) => s.name == (json['status'] as String? ?? 'active'),
          orElse: () => EmployeeStatus.active,
        ),
        joiningDate: DateTime.parse(json['joiningDate'] as String),
        phone: json['phone'] as String?,
        photoUrl: json['photoUrl'] as String?,
        reportingTo: json['reportingTo'] as String?,
        officeLocation: json['officeLocation'] as String?,
        bloodGroup: json['bloodGroup'] as String?,
      );
}

class IdCard {
  const IdCard({
    required this.employee,
    required this.cardId,
    required this.issuedAt,
    required this.validUntil,
    this.qrPayload,
  });

  final Employee employee;
  final String cardId;
  final DateTime issuedAt;
  final DateTime validUntil;

  /// QR code payload for verification (signed JWT or encoded ID).
  final String? qrPayload;

  /// Whether the card is currently valid.
  bool get isValid => DateTime.now().toUtc().isBefore(validUntil);

  /// Days until expiry (negative means expired).
  int get daysUntilExpiry =>
      validUntil.difference(DateTime.now().toUtc()).inDays;

  Map<String, dynamic> toJson() => {
        'employee': employee.toJson(),
        'cardId': cardId,
        'issuedAt': issuedAt.toIso8601String(),
        'validUntil': validUntil.toIso8601String(),
        'qrPayload': qrPayload,
      };

  factory IdCard.fromJson(Map<String, dynamic> json) => IdCard(
        employee:
            Employee.fromJson(json['employee'] as Map<String, dynamic>),
        cardId: json['cardId'] as String,
        issuedAt: DateTime.parse(json['issuedAt'] as String),
        validUntil: DateTime.parse(json['validUntil'] as String),
        qrPayload: json['qrPayload'] as String?,
      );
}

enum VerificationStatus { valid, expired, revoked, notFound }

class VerificationResult {
  const VerificationResult({
    required this.status,
    required this.verifiedAt,
    this.employee,
    this.message,
  });

  final VerificationStatus status;
  final DateTime verifiedAt;
  final Employee? employee;
  final String? message;

  /// Whether verification was successful.
  bool get isVerified => status == VerificationStatus.valid;

  Map<String, dynamic> toJson() => {
        'status': status.name,
        'verifiedAt': verifiedAt.toIso8601String(),
        'employee': employee?.toJson(),
        'message': message,
      };

  factory VerificationResult.fromJson(Map<String, dynamic> json) =>
      VerificationResult(
        status: VerificationStatus.values.firstWhere(
          (s) => s.name == (json['status'] as String? ?? 'notFound'),
          orElse: () => VerificationStatus.notFound,
        ),
        verifiedAt: DateTime.parse(json['verifiedAt'] as String),
        employee: json['employee'] != null
            ? Employee.fromJson(json['employee'] as Map<String, dynamic>)
            : null,
        message: json['message'] as String?,
      );
}
