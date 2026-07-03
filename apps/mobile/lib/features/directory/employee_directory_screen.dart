import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'models.dart';
import 'providers.dart';

/// Employee directory with search. Tap to view detail.
class EmployeeDirectoryScreen extends ConsumerStatefulWidget {
  const EmployeeDirectoryScreen({super.key, this.connectivityOverride});

  final bool? connectivityOverride;

  @override
  ConsumerState<EmployeeDirectoryScreen> createState() =>
      _EmployeeDirectoryScreenState();
}

class _EmployeeDirectoryScreenState
    extends ConsumerState<EmployeeDirectoryScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  bool _isOffline = false;

  @override
  void initState() {
    super.initState();
    _checkConnectivity();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _checkConnectivity() async {
    final override = widget.connectivityOverride;
    if (override != null) {
      if (mounted) setState(() => _isOffline = !override);
      return;
    }
    try {
      final result = await Connectivity().checkConnectivity();
      if (mounted) {
        setState(() {
          _isOffline =
              result.isEmpty || result.first == ConnectivityResult.none;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isOffline = false);
    }
  }

  List<Employee> _filter(List<Employee> employees) {
    if (_query.isEmpty) return employees;
    final q = _query.toLowerCase();
    return employees
        .where((e) =>
            e.fullName.toLowerCase().contains(q) ||
            e.designation.toLowerCase().contains(q) ||
            e.department.toLowerCase().contains(q) ||
            e.employeeCode.toLowerCase().contains(q))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final employeesAsync = ref.watch(employeeDirectoryProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Employee Directory'),
        centerTitle: false,
      ),
      body: Column(
        children: [
          if (_isOffline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.orange.shade100,
              child: Row(
                children: [
                  Icon(Icons.cloud_off,
                      size: 16, color: Colors.orange.shade800),
                  const SizedBox(width: 8),
                  Text(
                    'Offline — showing cached data',
                    style:
                        TextStyle(fontSize: 12, color: Colors.orange.shade800),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search by name, designation, or department',
                prefixIcon: const Icon(Icons.search),
                border: const OutlineInputBorder(),
                suffixIcon: _query.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _query = '');
                        },
                      )
                    : null,
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          Expanded(
            child: employeesAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (err, _) =>
                  Center(child: Text('Error: $err')),
              data: (employees) {
                final filtered = _filter(employees);
                if (filtered.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.people_outline,
                            size: 48, color: theme.colorScheme.outline),
                        const SizedBox(height: 8),
                        Text(
                          _query.isEmpty
                              ? 'No employees found'
                              : 'No results for "$_query"',
                          style:
                              TextStyle(color: theme.colorScheme.outline),
                        ),
                      ],
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async {
                    await _checkConnectivity();
                    ref.invalidate(employeeDirectoryProvider);
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: filtered.length,
                    itemBuilder: (context, index) {
                      final emp = filtered[index];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          onTap: () =>
                              context.go('/directory/${emp.id}'),
                          leading: CircleAvatar(
                            backgroundColor:
                                theme.colorScheme.primaryContainer,
                            child: Text(emp.initials,
                                style: TextStyle(
                                    color: theme.colorScheme.primary,
                                    fontWeight: FontWeight.bold)),
                          ),
                          title: Text(emp.fullName,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w500)),
                          subtitle: Text(
                              '${emp.designation} • ${emp.department}',
                              style: TextStyle(
                                  fontSize: 12,
                                  color: theme.colorScheme.outline)),
                          trailing: Icon(Icons.chevron_right,
                              color: theme.colorScheme.outline),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
