import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Works & Billing hub screen — tile grid linking to sub-screens.
class WorksHubScreen extends ConsumerWidget {
  const WorksHubScreen({super.key});

  static const _tiles = [
    (label: 'Proposals', icon: Icons.description, route: '/works/proposals', color: Color(0xFF3B82F6)),
    (label: 'Progress', icon: Icons.trending_up, route: '/works/progress', color: Color(0xFF22C55E)),
    (label: 'Photos', icon: Icons.camera_alt, route: '/works/photos', color: Color(0xFFF59E0B)),
    (label: 'Billing', icon: Icons.receipt_long, route: '/works/billing', color: Color(0xFF8B5CF6)),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Works & Billing')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Engineering Works Lifecycle',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.outline,
              ),
            ),
            const SizedBox(height: 16),
            Expanded(
              child: GridView.count(
                crossAxisCount: 2,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 1.1,
                children: _tiles.map((t) {
                  return Semantics(
                    label: t.label,
                    button: true,
                    child: Card(
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => context.go(t.route),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: t.color.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(14),
                              ),
                              child: Icon(t.icon, color: t.color, size: 28),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              t.label,
                              style: theme.textTheme.titleSmall,
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
