import 'package:flutter/material.dart';

/// Color-coded status pill matching web design system semantics.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (color, bg, label) = _resolve(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }

  static (Color fg, Color bg, String label) _resolve(String s) {
    switch (s.toLowerCase()) {
      case 'approved':
      case 'active':
      case 'completed':
      case 'closed':
        return (const Color(0xFF15803D), const Color(0xFFDCFCE7), _cap(s));
      case 'pending':
      case 'queued':
      case 'in_review':
        return (const Color(0xFFB45309), const Color(0xFFFEF3C7), _cap(s));
      case 'rejected':
      case 'overdue':
      case 'failed':
        return (const Color(0xFFB91C1C), const Color(0xFFFEE2E2), _cap(s));
      case 'open':
      case 'draft':
        return (const Color(0xFF1D4ED8), const Color(0xFFDBEAFE), _cap(s));
      case 'low':
        return (const Color(0xFF15803D), const Color(0xFFDCFCE7), 'Low');
      case 'medium':
        return (const Color(0xFFB45309), const Color(0xFFFEF3C7), 'Medium');
      case 'high':
        return (const Color(0xFFB91C1C), const Color(0xFFFEE2E2), 'High');
      case 'critical':
        return (const Color(0xFF7F1D1D), const Color(0xFFFCA5A5), 'Critical');
      default:
        return (const Color(0xFF475569), const Color(0xFFF1F5F9), _cap(s));
    }
  }

  static String _cap(String s) =>
      s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1).replaceAll('_', ' ')}';
}
