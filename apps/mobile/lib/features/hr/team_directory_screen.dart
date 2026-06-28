import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Team directory — searchable employee directory with call/email actions.
/// GET /v1/hrms/employees?search=&department=&limit=50
class TeamDirectoryScreen extends ConsumerStatefulWidget {
  const TeamDirectoryScreen({super.key});

  @override
  ConsumerState<TeamDirectoryScreen> createState() =>
      _TeamDirectoryScreenState();
}

class _TeamDirectoryScreenState extends ConsumerState<TeamDirectoryScreen> {
  final _searchCtrl = TextEditingController();
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _employees = [];
  List<Map<String, dynamic>> _filtered = [];
  String? _selectedDept;
  List<String> _departments = [];

  @override
  void initState() {
    super.initState();
    _fetchDirectory();
    _searchCtrl.addListener(_applyFilter);
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchDirectory() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>(
        '/v1/hrms/employees',
        params: {'limit': '200'},
      );
      final data = (res.data?['data'] as List<dynamic>?) ?? [];
      _employees = data.cast<Map<String, dynamic>>();
      _filtered = _employees;

      // Extract unique departments
      final depts = <String>{};
      for (final e in _employees) {
        final dept = e['department'] as String?;
        if (dept != null && dept.isNotEmpty) depts.add(dept);
      }
      _departments = depts.toList()..sort();
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applyFilter() {
    final query = _searchCtrl.text.toLowerCase().trim();
    setState(() {
      _filtered = _employees.where((e) {
        final name =
            ((e['name'] as String?) ?? '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}')
                .toLowerCase();
        final code = (e['employeeCode'] as String? ?? '').toLowerCase();
        final dept = (e['department'] as String? ?? '').toLowerCase();
        final designation =
            (e['designation'] as String? ?? '').toLowerCase();

        final matchesSearch = query.isEmpty ||
            name.contains(query) ||
            code.contains(query) ||
            dept.contains(query) ||
            designation.contains(query);

        final matchesDept = _selectedDept == null ||
            (e['department'] as String?) == _selectedDept;

        return matchesSearch && matchesDept;
      }).toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Team Directory'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchDirectory,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : Column(
                  children: [
                    // Search bar
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: TextField(
                        controller: _searchCtrl,
                        decoration: InputDecoration(
                          hintText:
                              'Search by name, code, department…',
                          prefixIcon: const Icon(Icons.search),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          contentPadding:
                              const EdgeInsets.symmetric(vertical: 12),
                          suffixIcon: _searchCtrl.text.isNotEmpty
                              ? IconButton(
                                  icon: const Icon(Icons.clear),
                                  onPressed: () {
                                    _searchCtrl.clear();
                                    _applyFilter();
                                  },
                                )
                              : null,
                        ),
                      ),
                    ),

                    // Department filter
                    if (_departments.isNotEmpty)
                      SizedBox(
                        height: 48,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 8),
                          children: [
                            _DeptChip(
                              label: 'All',
                              selected: _selectedDept == null,
                              onTap: () {
                                setState(() => _selectedDept = null);
                                _applyFilter();
                              },
                            ),
                            ..._departments.map((d) => _DeptChip(
                                  label: d,
                                  selected: _selectedDept == d,
                                  onTap: () {
                                    setState(() => _selectedDept = d);
                                    _applyFilter();
                                  },
                                )),
                          ],
                        ),
                      ),

                    // Count
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 4),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          '${_filtered.length} employees',
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.outline),
                        ),
                      ),
                    ),

                    // List
                    Expanded(
                      child: _filtered.isEmpty
                          ? Center(
                              child: Text('No results',
                                  style: theme.textTheme.bodyLarge),
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.all(16),
                              itemCount: _filtered.length,
                              itemBuilder: (ctx, i) =>
                                  _EmployeeCard(employee: _filtered[i]),
                            ),
                    ),
                  ],
                ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load directory',
              style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _fetchDirectory,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _DeptChip extends StatelessWidget {
  const _DeptChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label, style: const TextStyle(fontSize: 12)),
        selected: selected,
        onSelected: (_) => onTap(),
        selectedColor: const Color(0xFF6366F1).withOpacity(0.15),
        checkmarkColor: const Color(0xFF6366F1),
        padding: const EdgeInsets.symmetric(horizontal: 4),
      ),
    );
  }
}

class _EmployeeCard extends StatelessWidget {
  const _EmployeeCard({required this.employee});
  final Map<String, dynamic> employee;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = (employee['name'] as String?) ??
        '${employee['firstName'] ?? ''} ${employee['lastName'] ?? ''}'.trim();
    final code = employee['employeeCode'] as String? ?? '';
    final dept = employee['department'] as String? ?? '';
    final designation = employee['designation'] as String? ?? '';
    final phone = employee['phone'] as String? ?? '';
    final email = employee['email'] as String? ?? '';
    final photoUrl = employee['photoUrl'] as String?;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor:
                  const Color(0xFF6366F1).withOpacity(0.1),
              backgroundImage:
                  photoUrl != null ? NetworkImage(photoUrl) : null,
              child: photoUrl == null
                  ? Text(
                      name.isNotEmpty ? name[0].toUpperCase() : '?',
                      style: const TextStyle(
                          color: Color(0xFF6366F1),
                          fontWeight: FontWeight.bold),
                    )
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name.isEmpty ? 'Employee' : name,
                      style: theme.textTheme.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w600)),
                  Text('$designation • $dept',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.outline)),
                  Text(code,
                      style: TextStyle(
                          fontSize: 11,
                          color: theme.colorScheme.outline)),
                ],
              ),
            ),
            // Quick action buttons
            if (phone.isNotEmpty)
              IconButton(
                onPressed: () {
                  // In production: url_launcher tel:$phone
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Calling $phone…')),
                  );
                },
                icon: const Icon(Icons.phone, size: 20),
                style: IconButton.styleFrom(
                  backgroundColor:
                      const Color(0xFF22C55E).withOpacity(0.1),
                  foregroundColor: const Color(0xFF22C55E),
                ),
              ),
            if (email.isNotEmpty)
              IconButton(
                onPressed: () {
                  // In production: url_launcher mailto:$email
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Emailing $email…')),
                  );
                },
                icon: const Icon(Icons.email, size: 20),
                style: IconButton.styleFrom(
                  backgroundColor:
                      const Color(0xFF6366F1).withOpacity(0.1),
                  foregroundColor: const Color(0xFF6366F1),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
