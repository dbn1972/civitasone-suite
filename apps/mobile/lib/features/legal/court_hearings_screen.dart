import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

class CourtHearingsScreen extends ConsumerStatefulWidget {
  const CourtHearingsScreen({super.key});

  @override
  ConsumerState<CourtHearingsScreen> createState() =>
      _CourtHearingsScreenState();
}

class _CourtHearingsScreenState extends ConsumerState<CourtHearingsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('legal_hearings');
    });
  }

  Color _urgencyColor(String? hearingDate) {
    if (hearingDate == null) return const Color(0xFF64748B);
    try {
      final date = DateTime.parse(hearingDate);
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day);
      final diff = date.difference(today).inDays;
      if (diff <= 0) return const Color(0xFFEF4444); // today = red
      if (diff <= 7) return const Color(0xFFF97316); // this week = orange
      return const Color(0xFF64748B); // later = normal
    } catch (_) {
      return const Color(0xFF64748B);
    }
  }

  String _urgencyLabel(String? hearingDate) {
    if (hearingDate == null) return '';
    try {
      final date = DateTime.parse(hearingDate);
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day);
      final diff = date.difference(today).inDays;
      if (diff <= 0) return 'TODAY';
      if (diff == 1) return 'TOMORROW';
      if (diff <= 7) return 'THIS WEEK';
      return '';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Court Hearings'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: () =>
                ref.read(syncEngineProvider)?.syncMailbox('legal_hearings'),
          ),
        ],
      ),
      body: dbAsync.when(
        loading: () => const SkeletonList(),
        error: (e, _) => _ErrorState(
          message: e.toString(),
          onRetry: () =>
              ref.read(syncEngineProvider)?.syncMailbox('legal_hearings'),
        ),
        data: (db) => FutureBuilder(
          future: db.listEntities('legal_hearings'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const SkeletonList();
            final items = snap.data!;
            if (items.isEmpty) {
              return const _EmptyState(
                icon: Icons.gavel,
                message: 'No upcoming hearings',
              );
            }
            return RefreshIndicator(
              onRefresh: () async {
                await ref
                    .read(syncEngineProvider)
                    ?.syncMailbox('legal_hearings');
                if (mounted) setState(() {});
              },
              child: ListView.builder(
                padding: const EdgeInsets.only(bottom: 16, top: 8),
                itemCount: items.length,
                itemBuilder: (ctx, i) {
                  final data = items[i]['data'] as Map<String, dynamic>;
                  final caseNumber =
                      data['caseNumber'] as String? ?? '—';
                  final courtName =
                      data['courtName'] as String? ?? '—';
                  final hearingDate =
                      data['hearingDate'] as String?;
                  final hearingTime =
                      data['hearingTime'] as String? ?? '';
                  final judgeName =
                      data['judgeName'] as String? ?? '';
                  final purpose =
                      data['purpose'] as String? ?? '';
                  final color = _urgencyColor(hearingDate);
                  final urgency = _urgencyLabel(hearingDate);

                  return Semantics(
                    label:
                        'Case $caseNumber at $courtName on $hearingDate',
                    child: Card(
                      margin: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 6),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 4,
                                  height: 40,
                                  decoration: BoxDecoration(
                                    color: color,
                                    borderRadius:
                                        BorderRadius.circular(2),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        caseNumber,
                                        style: Theme.of(ctx)
                                            .textTheme
                                            .titleMedium
                                            ?.copyWith(
                                              fontWeight: FontWeight.w600,
                                            ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        courtName,
                                        style: Theme.of(ctx)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: Theme.of(ctx)
                                                  .colorScheme
                                                  .outline,
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                                if (urgency.isNotEmpty)
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                      vertical: 4,
                                    ),
                                    decoration: BoxDecoration(
                                      color: color.withOpacity(0.1),
                                      borderRadius:
                                          BorderRadius.circular(4),
                                    ),
                                    child: Text(
                                      urgency,
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w700,
                                        color: color,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                const Icon(Icons.calendar_today,
                                    size: 14, color: Color(0xFF94A3B8)),
                                const SizedBox(width: 4),
                                Text(
                                  '${hearingDate ?? '—'} ${hearingTime.isNotEmpty ? '· $hearingTime' : ''}',
                                  style: Theme.of(ctx)
                                      .textTheme
                                      .bodySmall,
                                ),
                              ],
                            ),
                            if (judgeName.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  const Icon(Icons.person_outline,
                                      size: 14, color: Color(0xFF94A3B8)),
                                  const SizedBox(width: 4),
                                  Text(
                                    'Hon. $judgeName',
                                    style: Theme.of(ctx)
                                        .textTheme
                                        .bodySmall,
                                  ),
                                ],
                              ),
                            ],
                            if (purpose.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  const Icon(Icons.info_outline,
                                      size: 14, color: Color(0xFF94A3B8)),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      purpose,
                                      style: Theme.of(ctx)
                                          .textTheme
                                          .bodySmall
                                          ?.copyWith(
                                            color: Theme.of(ctx)
                                                .colorScheme
                                                .outline,
                                          ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            );
          },
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.message});
  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon,
            size: 64, color: Theme.of(context).colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text(message,
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(color: Theme.of(context).colorScheme.outline)),
        const SizedBox(height: 8),
        const Text('Pull down to refresh',
            style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
      ]),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load hearings',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ]),
      ),
    );
  }
}
