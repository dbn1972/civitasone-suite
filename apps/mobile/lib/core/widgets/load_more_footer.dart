import 'package:flutter/material.dart';

/// Shared pagination footer for `ApiClient`-backed list screens that page
/// through a server-side `{data, meta: {page, pageSize, total}}` response.
///
/// Purely presentational: the owning screen tracks `loaded`/`total` and
/// supplies the fetch callback. Always shows the "Showing X of Y" count so a
/// truncated list is never silent about how much more exists; shows either
/// a "Load more" button or a small spinner depending on [loading].
class LoadMoreFooter extends StatelessWidget {
  const LoadMoreFooter({
    super.key,
    required this.loaded,
    required this.total,
    required this.loading,
    required this.onLoadMore,
  });

  /// Number of records currently loaded into the list.
  final int loaded;

  /// Total number of records available server-side for this query.
  final int total;

  /// Whether a "load more" request is in flight.
  final bool loading;

  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: loading
          ? 'Loading more. Showing $loaded of $total'
          : 'Showing $loaded of $total. Load more available',
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Showing $loaded of $total',
                style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
              ),
              const SizedBox(height: 8),
              if (loading)
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                OutlinedButton(
                  onPressed: onLoadMore,
                  child: const Text('Load more'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
