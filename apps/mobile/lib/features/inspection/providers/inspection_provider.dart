/// Inspection feature Riverpod providers.
///
/// Manages sync state, checklist fill state, and evidence upload queue.
/// Follows offline-first pattern: all state is persisted locally and synced
/// when online.
///
/// SVC-102: Mobile Inspection Checklist
library;

import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/inspection_models.dart';

// ─── Sync State ──────────────────────────────────────────────────────────────

/// Possible states for the inspection sync lifecycle.
enum SyncStatus {
  /// Initial state — no sync has been attempted.
  idle,
  /// Downloading sync package from server.
  downloading,
  /// Sync package downloaded, ready for offline use.
  ready,
  /// Uploading offline data back to server.
  uploading,
  /// All data synced successfully.
  synced,
  /// Sync failed (will retry automatically).
  error,
}

/// State for the inspection sync lifecycle.
class InspectionSyncState {
  final SyncStatus status;
  final InspectionSyncPackage? package;
  final DateTime? lastSyncAt;
  final int pendingUploads;
  final String? errorMessage;

  const InspectionSyncState({
    this.status = SyncStatus.idle,
    this.package,
    this.lastSyncAt,
    this.pendingUploads = 0,
    this.errorMessage,
  });

  InspectionSyncState copyWith({
    SyncStatus? status,
    InspectionSyncPackage? package,
    DateTime? lastSyncAt,
    int? pendingUploads,
    String? errorMessage,
  }) {
    return InspectionSyncState(
      status: status ?? this.status,
      package: package ?? this.package,
      lastSyncAt: lastSyncAt ?? this.lastSyncAt,
      pendingUploads: pendingUploads ?? this.pendingUploads,
      errorMessage: errorMessage,
    );
  }
}

/// Notifier that manages the sync lifecycle (download/upload).
class InspectionSyncNotifier extends StateNotifier<InspectionSyncState> {
  InspectionSyncNotifier() : super(const InspectionSyncState());

  /// Download sync package from server.
  Future<void> downloadPackage() async {
    state = state.copyWith(status: SyncStatus.downloading);
    try {
      // TODO: wire to actual API endpoint
      // final response = await dio.post('/v1/inspection/sync/packages', ...);
      // final package = InspectionSyncPackage.fromJson(response.data['data']);
      // state = state.copyWith(status: SyncStatus.ready, package: package, lastSyncAt: DateTime.now());

      // Placeholder: simulate download
      await Future<void>.delayed(const Duration(seconds: 2));
      state = state.copyWith(
        status: SyncStatus.ready,
        lastSyncAt: DateTime.now(),
      );
    } catch (e) {
      state = state.copyWith(
        status: SyncStatus.error,
        errorMessage: e.toString(),
      );
    }
  }

  /// Upload all pending offline data.
  Future<void> uploadPendingData() async {
    if (state.pendingUploads == 0) return;
    state = state.copyWith(status: SyncStatus.uploading);
    try {
      // TODO: wire to actual API endpoint
      // POST /v1/inspection/sync/upload with offline responses
      // POST /v1/inspection/sync/upload/chunked for evidence files

      await Future<void>.delayed(const Duration(seconds: 1));
      state = state.copyWith(
        status: SyncStatus.synced,
        pendingUploads: 0,
      );
    } catch (e) {
      state = state.copyWith(
        status: SyncStatus.error,
        errorMessage: e.toString(),
      );
    }
  }

  /// Increment pending upload count (called when new data is captured offline).
  void addPendingUpload() {
    state = state.copyWith(pendingUploads: state.pendingUploads + 1);
  }
}

/// Provider for inspection sync state.
final inspectionSyncProvider =
    StateNotifierProvider<InspectionSyncNotifier, InspectionSyncState>(
  (ref) => InspectionSyncNotifier(),
);

// ─── Checklist State ─────────────────────────────────────────────────────────

/// State for the active checklist being filled.
class ChecklistState {
  final ChecklistInstance? instance;
  final bool isDirty;
  final DateTime? lastAutoSave;

  const ChecklistState({
    this.instance,
    this.isDirty = false,
    this.lastAutoSave,
  });

  ChecklistState copyWith({
    ChecklistInstance? instance,
    bool? isDirty,
    DateTime? lastAutoSave,
  }) {
    return ChecklistState(
      instance: instance ?? this.instance,
      isDirty: isDirty ?? this.isDirty,
      lastAutoSave: lastAutoSave ?? this.lastAutoSave,
    );
  }
}

/// Notifier that holds the current checklist instance and auto-saves partial responses.
class ChecklistNotifier extends StateNotifier<ChecklistState> {
  Timer? _autoSaveTimer;

  ChecklistNotifier() : super(const ChecklistState());

  /// Load a checklist instance for filling.
  void loadChecklist(ChecklistInstance instance) {
    state = state.copyWith(instance: instance, isDirty: false);
    _startAutoSave();
  }

  /// Record a response for a question.
  void recordResponse(String questionId, ChecklistResponse response) {
    final instance = state.instance;
    if (instance == null) return;

    final updatedResponses = Map<String, ChecklistResponse>.from(instance.responses);
    updatedResponses[questionId] = response;

    state = state.copyWith(
      instance: instance.copyWith(responses: updatedResponses),
      isDirty: true,
    );
  }

  /// Auto-save partial responses every 30 seconds.
  void _startAutoSave() {
    _autoSaveTimer?.cancel();
    _autoSaveTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (state.isDirty) {
        _savePartial();
      }
    });
  }

  /// Save partial responses to local storage and queue for server sync.
  Future<void> _savePartial() async {
    // TODO: wire to actual API endpoint
    // POST /v1/inspection/sync/responses/partial
    // Also persist to local Hive/SQLite for offline resilience.
    state = state.copyWith(
      isDirty: false,
      lastAutoSave: DateTime.now(),
    );
  }

  /// Submit the completed checklist.
  Future<void> submitChecklist() async {
    // TODO: wire to actual API endpoint
    // POST /v1/inspection/sync/upload with final responses
    // Validate all required fields are filled before submission.
    state = state.copyWith(isDirty: false);
  }

  @override
  void dispose() {
    _autoSaveTimer?.cancel();
    super.dispose();
  }
}

/// Provider for active checklist state.
final checklistProvider =
    StateNotifierProvider<ChecklistNotifier, ChecklistState>(
  (ref) => ChecklistNotifier(),
);

// ─── Evidence Queue ──────────────────────────────────────────────────────────

/// State for the evidence upload queue.
class EvidenceQueueState {
  final List<EvidenceCapture> pending;
  final List<EvidenceCapture> uploading;
  final List<EvidenceCapture> completed;

  const EvidenceQueueState({
    this.pending = const [],
    this.uploading = const [],
    this.completed = const [],
  });

  int get totalPending => pending.length;
  int get totalCompleted => completed.length;

  EvidenceQueueState copyWith({
    List<EvidenceCapture>? pending,
    List<EvidenceCapture>? uploading,
    List<EvidenceCapture>? completed,
  }) {
    return EvidenceQueueState(
      pending: pending ?? this.pending,
      uploading: uploading ?? this.uploading,
      completed: completed ?? this.completed,
    );
  }
}

/// Notifier that queues evidence for upload when online.
class EvidenceQueueNotifier extends StateNotifier<EvidenceQueueState> {
  EvidenceQueueNotifier() : super(const EvidenceQueueState());

  /// Add a captured evidence item to the upload queue.
  void enqueue(EvidenceCapture evidence) {
    state = state.copyWith(
      pending: [...state.pending, evidence],
    );
  }

  /// Process the upload queue (called when connectivity is restored).
  Future<void> processQueue() async {
    if (state.pending.isEmpty) return;

    final toUpload = List<EvidenceCapture>.from(state.pending);
    state = state.copyWith(pending: [], uploading: toUpload);

    for (final evidence in toUpload) {
      try {
        // TODO: wire to actual API endpoint
        // POST /v1/inspection/sync/upload/chunked for each evidence file
        await Future<void>.delayed(const Duration(milliseconds: 500));

        state = state.copyWith(
          uploading: state.uploading.where((e) => e.id != evidence.id).toList(),
          completed: [...state.completed, evidence],
        );
      } catch (e) {
        // Re-queue failed uploads for retry
        state = state.copyWith(
          uploading: state.uploading.where((e) => e.id != evidence.id).toList(),
          pending: [...state.pending, evidence],
        );
      }
    }
  }
}

/// Provider for evidence upload queue.
final evidenceQueueProvider =
    StateNotifierProvider<EvidenceQueueNotifier, EvidenceQueueState>(
  (ref) => EvidenceQueueNotifier(),
);
