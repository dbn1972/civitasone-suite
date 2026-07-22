import 'package:intl/intl.dart';

// Fix: [AUDIT-P2-7] Shared format utilities for Indian number formatting

/// Formats paise amount to INR display string (e.g., 1500000 → ₹15,000).
/// Uses Indian numbering system (lakhs/crores).
String formatAmountInr(int amountPaise) {
  final rupees = amountPaise / 100;
  // Indian number format: 1,23,456.00
  final format = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
  return format.format(rupees);
}

/// Formats a date string (ISO) to a short display format.
String formatDateShort(String? isoDate) {
  if (isoDate == null || isoDate.isEmpty) return '—';
  try {
    final dt = DateTime.parse(isoDate);
    return DateFormat('dd MMM yyyy').format(dt);
  } catch (_) {
    return isoDate;
  }
}
