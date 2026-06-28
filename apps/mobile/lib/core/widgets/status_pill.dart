import 'package:flutter/material.dart';

/// Color-coded status pill with accessibility semantics.
/// Uses semantic color tokens that adapt to dark mode.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final (color, bg, label) = _resolve(status, isDark);

    return Semantics(
      label: 'Status: $label',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color),
        ),
      ),
    );
  }

  static (Color fg, Color bg, String label) _resolve(String s, bool isDark) {
    switch (s.toLowerCase()) {
      case 'approved':
      case 'active':
      case 'completed':
      case 'closed':
        return isDark
            ? (const Color(0xFF4ADE80), const Color(0xFF14532D), _cap(s))
            : (const Color(0xFF15803D), const Color(0xFFDCFCE7), _cap(s));
      case 'pending':
      case 'queued':
      case 'in_review':
        return isDark
            ? (const Color(0xFFFBBF24), const Color(0xFF451A03), _cap(s))
            : (const Color(0xFF92400E), const Color(0xFFFEF3C7), _cap(s));
      case 'rejected':
      case 'overdue':
      case 'failed':
        return isDark
            ? (const Color(0xFFFCA5A5), const Color(0xFF450A0A), _cap(s))
            : (const Color(0xFFB91C1C), const Color(0xFFFEE2E2), _cap(s));
      case 'open':
      case 'draft':
        return isDark
            ? (const Color(0xFF93C5FD), const Color(0xFF1E3A5F), _cap(s))
            : (const Color(0xFF1D4ED8), const Color(0xFFDBEAFE), _cap(s));
      case 'low':
        return isDark
            ? (const Color(0xFF4ADE80), const Color(0xFF14532D), 'Low')
            : (const Color(0xFF15803D), const Color(0xFFDCFCE7), 'Low');
      case 'medium':
        return isDark
            ? (const Color(0xFFFBBF24), const Color(0xFF451A03), 'Medium')
            : (const Color(0xFF92400E), const Color(0xFFFEF3C7), 'Medium');
      case 'high':
        return isDark
            ? (const Color(0xFFFCA5A5), const Color(0xFF450A0A), 'High')
            : (const Color(0xFFB91C1C), const Color(0xFFFEE2E2), 'High');
      case 'critical':
        return isDark
            ? (const Color(0xFFFECACA), const Color(0xFF7F1D1D), 'Critical')
            : (const Color(0xFF7F1D1D), const Color(0xFFFCA5A5), 'Critical');
      default:
        return isDark
            ? (const Color(0xFF94A3B8), const Color(0xFF1E293B), _cap(s))
            : (const Color(0xFF475569), const Color(0xFFF1F5F9), _cap(s));
    }
  }

  static String _cap(String s) =>
      s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1).replaceAll('_', ' ')}';
}
