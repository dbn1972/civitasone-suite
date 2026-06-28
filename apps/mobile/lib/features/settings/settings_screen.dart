import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';
import '../../core/auth/biometric_lock.dart';
import 'legal_screen.dart';

/// Settings — security, preferences, about.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});
  @override
  ConsumerState<SettingsScreen> createState() => _State();
}

class _State extends ConsumerState<SettingsScreen> {
  final _lockService = BiometricLockService();
  bool _lockEnabled = false;
  String _lockType = 'none';

  @override
  void initState() { super.initState(); _loadPrefs(); }

  Future<void> _loadPrefs() async {
    _lockEnabled = await _lockService.isLockEnabled;
    _lockType = await _lockService.lockType;
    if (mounted) setState(() {});
  }

  Future<void> _toggleLock(bool enable) async {
    if (enable) {
      await _lockService.enableBiometric();
    } else {
      await _lockService.disable();
    }
    _loadPrefs();
  }

  Future<void> _signOut() async {
    final confirmed = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Sign Out'),
      content: const Text('This will clear all local data. You will need to sign in again.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: Colors.red), child: const Text('Sign Out')),
      ],
    ));
    if (confirmed != true) return;
    await ref.read(authProvider).signOut();
    if (mounted) context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(children: [
        // Security section
        _SectionHeader(title: 'Security'),
        SwitchListTile(
          title: const Text('App Lock'),
          subtitle: Text(_lockEnabled ? 'Biometric / PIN enabled' : 'Disabled'),
          secondary: Icon(Icons.fingerprint, color: theme.colorScheme.primary),
          value: _lockEnabled,
          onChanged: _toggleLock,
        ),
        ListTile(
          leading: Icon(Icons.pin, color: theme.colorScheme.primary),
          title: const Text('Change PIN'),
          subtitle: const Text('Set or update your 4-6 digit PIN'),
          trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
          enabled: _lockEnabled,
          onTap: () {/* TODO: PIN change flow */},
        ),
        const Divider(),

        // Preferences
        _SectionHeader(title: 'Preferences'),
        ListTile(
          leading: Icon(Icons.language, color: theme.colorScheme.primary),
          title: const Text('Language'),
          subtitle: const Text('English'),
          trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
          onTap: () {/* TODO: language picker */},
        ),
        ListTile(
          leading: Icon(Icons.notifications_outlined, color: theme.colorScheme.primary),
          title: const Text('Notifications'),
          subtitle: const Text('Push, email, SMS preferences'),
          trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
          onTap: () {},
        ),
        ListTile(
          leading: Icon(Icons.dark_mode, color: theme.colorScheme.primary),
          title: const Text('Theme'),
          subtitle: const Text('System default'),
          trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
          onTap: () {},
        ),
        const Divider(),

        // Data
        _SectionHeader(title: 'Data & Storage'),
        ListTile(
          leading: Icon(Icons.storage, color: theme.colorScheme.primary),
          title: const Text('Clear Cache'),
          subtitle: const Text('Free up local storage (sync data will re-download)'),
          onTap: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cache cleared'))),
        ),
        ListTile(
          leading: Icon(Icons.sync, color: theme.colorScheme.primary),
          title: const Text('Sync Now'),
          subtitle: const Text('Force sync all data immediately'),
          onTap: () {
            final engine = ref.read(syncEngineProvider);
            if (engine != null) {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Syncing…')));
            }
          },
        ),
        const Divider(),

        // About
        _SectionHeader(title: 'About'),
        ListTile(
          leading: Icon(Icons.info_outline, color: theme.colorScheme.primary),
          title: const Text('Version'),
          subtitle: const Text('0.1.0+1'),
        ),
        ListTile(
          leading: Icon(Icons.shield_outlined, color: theme.colorScheme.primary),
          title: const Text('Privacy Policy'),
          onTap: () => Navigator.push(context, MaterialPageRoute(
            builder: (_) => const LegalScreen(type: LegalDocType.privacy))),
        ),
        ListTile(
          leading: Icon(Icons.description, color: theme.colorScheme.primary),
          title: const Text('Terms of Use'),
          onTap: () => Navigator.push(context, MaterialPageRoute(
            builder: (_) => const LegalScreen(type: LegalDocType.terms))),
        ),
        ListTile(
          leading: Icon(Icons.security, color: theme.colorScheme.primary),
          title: const Text('Security Practices'),
          onTap: () => Navigator.push(context, MaterialPageRoute(
            builder: (_) => const LegalScreen(type: LegalDocType.security))),
        ),
        const Divider(),

        // Sign out
        Padding(padding: const EdgeInsets.all(16), child: OutlinedButton.icon(
          onPressed: _signOut,
          icon: const Icon(Icons.logout, color: Colors.red),
          label: const Text('Sign Out', style: TextStyle(color: Colors.red)),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
            side: const BorderSide(color: Colors.red),
          ),
        )),
      ]),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
    child: Text(title, style: Theme.of(context).textTheme.labelSmall?.copyWith(
      color: Theme.of(context).colorScheme.outline, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
  );
}
