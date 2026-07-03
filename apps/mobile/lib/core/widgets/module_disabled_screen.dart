import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// A friendly "Module Not Enabled" screen shown when a user navigates to a
/// route whose module is disabled for the current tenant. Matches the web
/// ModuleGate pattern with a clear message + actions.
class ModuleDisabledScreen extends StatelessWidget {
  const ModuleDisabledScreen({super.key, required this.moduleName});

  /// Display name of the disabled module (e.g. "Finance", "Procurement").
  final String moduleName;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: theme.colorScheme.errorContainer.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Icon(Icons.block,
                    size: 48, color: theme.colorScheme.error),
              ),
              const SizedBox(height: 24),
              Text(
                'Module Not Enabled',
                style: theme.textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              Text(
                'The $moduleName module is not enabled for your organisation. '
                'Contact your administrator to enable it.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: theme.colorScheme.outline),
              ),
              const SizedBox(height: 32),
              FilledButton(
                onPressed: () => context.go('/dashboard'),
                child: const Text('Back to Dashboard'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => context.go('/settings'),
                child: const Text('Go to Settings'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
