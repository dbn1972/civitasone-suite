import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'models.dart';
import 'providers.dart';

/// Full employee profile view.
class EmployeeDetailScreen extends ConsumerWidget {
  const EmployeeDetailScreen({super.key, required this.employeeId});

  final String employeeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final employeeAsync = ref.watch(employeeByIdProvider(employeeId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Employee Profile'),
        centerTitle: false,
      ),
      body: employeeAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (employee) {
          if (employee == null) {
            return const Center(child: Text('Employee not found'));
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Profile header
              Center(
                child: Column(
                  children: [
                    CircleAvatar(
                      radius: 40,
                      backgroundColor: theme.colorScheme.primaryContainer,
                      child: Text(
                        employee.initials,
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(employee.fullName,
                        style: theme.textTheme.titleLarge),
                    const SizedBox(height: 4),
                    Text(employee.designation,
                        style: TextStyle(color: theme.colorScheme.outline)),
                    Text(employee.department,
                        style: TextStyle(
                            fontSize: 13, color: theme.colorScheme.outline)),
                    const SizedBox(height: 8),
                    _StatusBadge(status: employee.status),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Details
              _DetailTile(
                icon: Icons.badge,
                label: 'Employee Code',
                value: employee.employeeCode,
              ),
              _DetailTile(
                icon: Icons.email,
                label: 'Email',
                value: employee.email,
              ),
              if (employee.phone != null)
                _DetailTile(
                  icon: Icons.phone,
                  label: 'Phone',
                  value: employee.phone!,
                ),
              if (employee.officeLocation != null)
                _DetailTile(
                  icon: Icons.location_on,
                  label: 'Office',
                  value: employee.officeLocation!,
                ),
              _DetailTile(
                icon: Icons.calendar_today,
                label: 'Joining Date',
                value: _formatDate(employee.joiningDate),
              ),
              _DetailTile(
                icon: Icons.work_history,
                label: 'Years of Service',
                value: '${employee.yearsOfService} years',
              ),
              if (employee.bloodGroup != null)
                _DetailTile(
                  icon: Icons.water_drop,
                  label: 'Blood Group',
                  value: employee.bloodGroup!,
                ),
            ],
          );
        },
      ),
    );
  }

  String _formatDate(DateTime dt) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${dt.day} ${months[dt.month - 1]} ${dt.year}';
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final EmployeeStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status) {
      EmployeeStatus.active => (Colors.green, 'Active'),
      EmployeeStatus.onLeave => (Colors.orange, 'On Leave'),
      EmployeeStatus.transferred => (Colors.blue, 'Transferred'),
      EmployeeStatus.retired => (Colors.grey, 'Retired'),
      EmployeeStatus.suspended => (Colors.red, 'Suspended'),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 12, fontWeight: FontWeight.w500)),
    );
  }
}

class _DetailTile extends StatelessWidget {
  const _DetailTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Icon(icon, size: 20, color: theme.colorScheme.outline),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: TextStyle(
                      fontSize: 12, color: theme.colorScheme.outline)),
              Text(value,
                  style: const TextStyle(fontWeight: FontWeight.w500)),
            ],
          ),
        ],
      ),
    );
  }
}
