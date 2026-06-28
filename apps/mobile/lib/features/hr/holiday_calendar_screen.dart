import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Holiday calendar — shows gazetted + restricted holidays for current FY.
/// GET /v1/hrms/holidays?year=2026
class HolidayCalendarScreen extends ConsumerStatefulWidget {
  const HolidayCalendarScreen({super.key});

  @override
  ConsumerState<HolidayCalendarScreen> createState() =>
      _HolidayCalendarScreenState();
}

class _HolidayCalendarScreenState
    extends ConsumerState<HolidayCalendarScreen> {
  bool _loading = true;
  String? _error;
  List<_Holiday> _holidays = [];
  int _selectedYear = DateTime.now().year;

  @override
  void initState() {
    super.initState();
    _fetchHolidays();
  }

  Future<void> _fetchHolidays() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>(
        '/v1/hrms/holidays',
        params: {'year': _selectedYear.toString()},
      );
      final data = (res.data?['data'] as List<dynamic>?) ?? [];
      _holidays = data.map((item) {
        final h = item as Map<String, dynamic>;
        return _Holiday(
          name: h['name'] as String? ?? '',
          date: h['date'] as String? ?? '',
          type: h['type'] as String? ?? 'gazetted',
          day: h['day'] as String? ?? '',
        );
      }).toList();

      // Sort by date
      _holidays.sort((a, b) => a.date.compareTo(b.date));
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = DateTime.now();

    // Group by month
    final grouped = <int, List<_Holiday>>{};
    for (final h in _holidays) {
      final parts = h.date.split('-');
      if (parts.length >= 2) {
        final month = int.tryParse(parts[1]) ?? 1;
        grouped.putIfAbsent(month, () => []).add(h);
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Holiday Calendar'),
        actions: [
          // Year selector
          PopupMenuButton<int>(
            initialValue: _selectedYear,
            onSelected: (year) {
              setState(() => _selectedYear = year);
              _fetchHolidays();
            },
            itemBuilder: (_) => [
              for (int y = now.year - 1; y <= now.year + 1; y++)
                PopupMenuItem(value: y, child: Text('$y')),
            ],
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('$_selectedYear',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  const Icon(Icons.arrow_drop_down),
                ],
              ),
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : _holidays.isEmpty
                  ? _buildEmpty(theme)
                  : RefreshIndicator(
                      onRefresh: _fetchHolidays,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          // Summary card
                          _buildSummary(theme),
                          const SizedBox(height: 20),

                          // Month-wise list
                          for (int month = 1; month <= 12; month++)
                            if (grouped.containsKey(month))
                              _buildMonthSection(
                                  theme, month, grouped[month]!),
                        ],
                      ),
                    ),
    );
  }

  Widget _buildSummary(ThemeData theme) {
    final gazetted =
        _holidays.where((h) => h.type == 'gazetted').length;
    final restricted =
        _holidays.where((h) => h.type == 'restricted').length;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _SummaryItem(label: 'Total', value: '${_holidays.length}'),
          Container(width: 1, height: 40, color: Colors.white30),
          _SummaryItem(label: 'Gazetted', value: '$gazetted'),
          Container(width: 1, height: 40, color: Colors.white30),
          _SummaryItem(label: 'Restricted', value: '$restricted'),
        ],
      ),
    );
  }

  Widget _buildMonthSection(
      ThemeData theme, int month, List<_Holiday> holidays) {
    const monthNames = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            monthNames[month],
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          ...holidays.map((h) => _HolidayTile(holiday: h)),
        ],
      ),
    );
  }

  Widget _buildEmpty(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.event_busy, size: 64,
              color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No holidays found for $_selectedYear',
              style: theme.textTheme.bodyLarge),
        ],
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
            const SizedBox(height: 16),
            Text('Unable to load holidays',
                style: theme.textTheme.titleMedium),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchHolidays,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Holiday {
  final String name;
  final String date;
  final String type;
  final String day;

  _Holiday({
    required this.name,
    required this.date,
    required this.type,
    required this.day,
  });
}

class _HolidayTile extends StatelessWidget {
  const _HolidayTile({required this.holiday});
  final _Holiday holiday;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isGazetted = holiday.type == 'gazetted';
    final color = isGazetted
        ? const Color(0xFFEF4444)
        : const Color(0xFFF59E0B);

    // Parse day from date string
    final dayNum = holiday.date.split('-').last;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          // Date badge
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Center(
              child: Text(
                dayNum,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(holiday.name,
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w500)),
                Row(
                  children: [
                    Text(holiday.day,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.outline)),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: color.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        isGazetted ? 'Gazetted' : 'Restricted',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: color,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryItem extends StatelessWidget {
  const _SummaryItem({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value,
            style: const TextStyle(
                fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
        const SizedBox(height: 2),
        Text(label,
            style: const TextStyle(fontSize: 12, color: Colors.white70)),
      ],
    );
  }
}
