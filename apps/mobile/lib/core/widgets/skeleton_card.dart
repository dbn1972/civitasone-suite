import 'package:flutter/material.dart';

/// Animated skeleton placeholder for loading states.
/// Uses theme-aware colors for proper dark mode support.
class SkeletonCard extends StatefulWidget {
  const SkeletonCard({super.key});

  @override
  State<SkeletonCard> createState() => _SkeletonCardState();
}

class _SkeletonCardState extends State<SkeletonCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double> _anim;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _anim = Tween<double>(begin: 0.4, end: 0.9).animate(
      CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final shimmerColor = theme.colorScheme.surfaceContainerHighest;

    return FadeTransition(
      opacity: _anim,
      child: Semantics(
        label: 'Loading content',
        child: Card(
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _box(double.infinity, 14, shimmerColor),
                const SizedBox(height: 10),
                _box(200, 12, shimmerColor),
                const SizedBox(height: 8),
                _box(120, 10, shimmerColor),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _box(double w, double h, Color color) => Container(
        width: w,
        height: h,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(4),
        ),
      );
}

/// Skeleton list of [count] cards.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 5});
  final int count;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading list',
      child: ListView.builder(
        physics: const NeverScrollableScrollPhysics(),
        itemCount: count,
        itemBuilder: (_, __) => const SkeletonCard(),
      ),
    );
  }
}
