import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';

/// Employee self-service profile screen.
/// GET /v1/hrms/me — full employee profile
/// Shows: personal info, employment details, leave summary, recent payslips,
/// loan status, documents, and quick actions.
class EmployeeProfileScreen extends ConsumerStatefulWidget {
  const EmployeeProfileScreen({super.key});

  @override
  ConsumerState<EmployeeProfileScreen> createState() =>
      _EmployeeProfileScreenState();
}

class _EmployeeProfileScreenState
    extends ConsumerState<EmployeeProfileScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _profile = {};

  @override
  void initState() {
    super.initState();
    _fetchProfile();
  }

  Future<void> _fetchProfile() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>('/v1/hrms/me');
      _profile = res.data ?? {};
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Profile'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchProfile,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : RefreshIndicator(
                  onRefresh: _fetchProfile,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _buildProfileHeader(theme),
                      const SizedBox(height: 20),
                      _buildEmploymentCard(theme),
                      const SizedBox(height: 16),
                      _buildQuickStats(theme),
                      const SizedBox(height: 16),
                      _buildQuickActions(theme),
                      const SizedBox(height: 16),
                      _buildPersonalInfo(theme),
                    ],
                  ),
                ),
    );
  }

  Widget _buildProfileHeader(ThemeData theme) {
    final name = _profile['name'] as String? ??
        '${_profile['firstName'] ?? ''} ${_profile['lastName'] ?? ''}'.trim();
    final designation = _profile['designation'] as String? ?? '';
    final department = _profile['department'] as String? ?? '';
    final employeeCode = _profile['employeeCode'] as String? ?? '';
    final photoUrl = _profile['photoUrl'] as String?;

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        children: [
          // Avatar
          CircleAvatar(
            radius: 44,
            backgroundColor: Colors.white.withOpacity(0.2),
            backgroundImage:
                photoUrl != null ? NetworkImage(photoUrl) : null,
            child: photoUrl == null
                ? Text(
                    name.isNotEmpty ? name[0].toUpperCase() : '?',
                    style: const TextStyle(
                        fontSize: 36, color: Colors.white),
                  )
                : null,
          ),
          const SizedBox(height: 16),
          Text(
            name.isEmpty ? 'Employee' : name,
            style: theme.textTheme.titleLarge?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(designation,
              style: const TextStyle(color: Colors.white70, fontSize: 14)),
          const SizedBox(height: 2),
          Text(department,
              style: const TextStyle(color: Colors.white60, fontSize: 13)),
          const SizedBox(height: 8),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.15),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              employeeCode,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmploymentCard(ThemeData theme) {
    final joiningDate = _profile['joiningDate'] as String? ?? '—';
    final employeeType = _profile['employeeType'] as String? ?? '—';
    final payLevel = _profile['payLevel'] as String? ?? '—';
    final branch = _profile['branch'] as String? ?? '—';
    final reportingTo = _profile['reportingTo'] as String? ?? '—';

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Employment Details',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            _InfoRow(label: 'Employee Type', value: employeeType),
            _InfoRow(label: 'Joining Date', value: joiningDate),
            _InfoRow(label: 'Pay Level', value: payLevel),
            _InfoRow(label: 'Branch', value: branch),
            _InfoRow(label: 'Reporting To', value: reportingTo),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickStats(ThemeData theme) {
    final leaveBalance = _profile['leaveBalance'] as int? ?? 0;
    final pendingApprovals = _profile['pendingApprovals'] as int? ?? 0;
    final loanOutstanding = _profile['loanOutstanding'] as int? ?? 0;

    return Row(
      children: [
        Expanded(
          child: _StatCard(
            label: 'Leave\nBalance',
            value: '$leaveBalance',
            icon: Icons.beach_access,
            color: const Color(0xFF22C55E),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            label: 'Pending\nApprovals',
            value: '$pendingApprovals',
            icon: Icons.pending_actions,
            color: const Color(0xFFF59E0B),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            label: 'Loan\nBalance',
            value: '₹${(loanOutstanding / 100).toStringAsFixed(0)}',
            icon: Icons.account_balance_wallet,
            color: const Color(0xFF6366F1),
          ),
        ),
      ],
    );
  }

  Widget _buildQuickActions(ThemeData theme) {
    final actions = [
      (label: 'Apply Leave', icon: Icons.event_note, route: '/hr/leave/apply', color: const Color(0xFF6366F1)),
      (label: 'View Payslips', icon: Icons.receipt_long, route: '/hr/payslips', color: const Color(0xFF22C55E)),
      (label: 'Mark Attendance', icon: Icons.location_on, route: '/hr/geo-checkin', color: const Color(0xFFF59E0B)),
      (label: 'Holidays', icon: Icons.event, route: '/hr/holidays', color: const Color(0xFFEF4444)),
      (label: 'Vacancies', icon: Icons.work, route: '/hr/vacancies', color: const Color(0xFF8B5CF6)),
      (label: 'Grievances', icon: Icons.feedback, route: '/hr/grievances', color: const Color(0xFF06B6D4)),
    ];

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Quick Actions',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: 3,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 1,
              children: actions.map((a) {
                return InkWell(
                  onTap: () => context.push(a.route),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    decoration: BoxDecoration(
                      color: a.color.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: a.color.withOpacity(0.15)),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(a.icon, color: a.color, size: 24),
                        const SizedBox(height: 6),
                        Text(a.label,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w500,
                                color: a.color)),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPersonalInfo(ThemeData theme) {
    final email = _profile['email'] as String? ?? '—';
    final phone = _profile['phone'] as String? ?? '—';
    final dob = _profile['dateOfBirth'] as String? ?? '—';
    final gender = _profile['gender'] as String? ?? '—';
    final address = _profile['address'] as String? ?? '—';

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Personal Information',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            _InfoRow(label: 'Email', value: email),
            _InfoRow(label: 'Phone', value: phone),
            _InfoRow(label: 'Date of Birth', value: dob),
            _InfoRow(label: 'Gender', value: gender),
            _InfoRow(label: 'Address', value: address),
          ],
        ),
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
            Text('Unable to load profile',
                style: theme.textTheme.titleMedium),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchProfile,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label,
                style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.outline)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w500)),
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withOpacity(0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(height: 6),
          Text(value,
              style: TextStyle(
                  fontSize: 18, fontWeight: FontWeight.bold, color: color)),
          const SizedBox(height: 2),
          Text(label,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 10, color: color.withOpacity(0.8))),
        ],
      ),
    );
  }
}
