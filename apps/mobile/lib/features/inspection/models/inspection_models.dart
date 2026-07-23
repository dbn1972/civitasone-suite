/// Inspection data models for the mobile app.
///
/// Plain Dart classes with fromJson/toJson serialization.
/// Follows offline-first pattern: all models are designed to be stored
/// locally (Hive/SQLite) and synced when connectivity is available.
///
/// SVC-102: Mobile Inspection Checklist
library;

import 'dart:convert';

// ─── InspectionSyncPackage ───────────────────────────────────────────────────

/// The full sync package downloaded from the backend for offline use.
/// Contains all data the inspector needs to perform inspections offline.
class InspectionSyncPackage {
  final String packageId;
  final String generatedAt;
  final int version;
  final List<SyncInspection> inspections;
  final List<ChecklistInstance> checklists;
  final List<InspectionEntity> entities;

  const InspectionSyncPackage({
    required this.packageId,
    required this.generatedAt,
    required this.version,
    required this.inspections,
    required this.checklists,
    required this.entities,
  });

  factory InspectionSyncPackage.fromJson(Map<String, dynamic> json) {
    return InspectionSyncPackage(
      packageId: json['packageId'] as String,
      generatedAt: json['generatedAt'] as String,
      version: json['version'] as int,
      inspections: (json['inspections'] as List<dynamic>)
          .map((e) => SyncInspection.fromJson(e as Map<String, dynamic>))
          .toList(),
      checklists: (json['checklists'] as List<dynamic>)
          .map((e) => ChecklistInstance.fromJson(e as Map<String, dynamic>))
          .toList(),
      entities: (json['entities'] as List<dynamic>)
          .map((e) => InspectionEntity.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'packageId': packageId,
        'generatedAt': generatedAt,
        'version': version,
        'inspections': inspections.map((e) => e.toJson()).toList(),
        'checklists': checklists.map((e) => e.toJson()).toList(),
        'entities': entities.map((e) => e.toJson()).toList(),
      };
}

// ─── SyncInspection ──────────────────────────────────────────────────────────

/// An inspection assignment included in the sync package.
class SyncInspection {
  final String id;
  final String entityId;
  final String inspectionTypeId;
  final String scheduledDate;
  final String status;
  final String checklistInstanceId;

  const SyncInspection({
    required this.id,
    required this.entityId,
    required this.inspectionTypeId,
    required this.scheduledDate,
    required this.status,
    required this.checklistInstanceId,
  });

  factory SyncInspection.fromJson(Map<String, dynamic> json) {
    return SyncInspection(
      id: json['id'] as String,
      entityId: json['entityId'] as String,
      inspectionTypeId: json['inspectionTypeId'] as String,
      scheduledDate: json['scheduledDate'] as String,
      status: json['status'] as String,
      checklistInstanceId: json['checklistInstanceId'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'entityId': entityId,
        'inspectionTypeId': inspectionTypeId,
        'scheduledDate': scheduledDate,
        'status': status,
        'checklistInstanceId': checklistInstanceId,
      };
}

// ─── ChecklistInstance ───────────────────────────────────────────────────────

/// A checklist instance bound to a specific inspection.
/// Contains sections, questions, responses, and computed scores.
class ChecklistInstance {
  final String id;
  final String templateId;
  final int templateVersion;
  final String inspectionId;
  final List<ChecklistSection> sections;
  final Map<String, ChecklistResponse> responses;
  final Map<String, double> sectionScores;
  final double overallScore;

  const ChecklistInstance({
    required this.id,
    required this.templateId,
    required this.templateVersion,
    required this.inspectionId,
    required this.sections,
    this.responses = const {},
    this.sectionScores = const {},
    this.overallScore = 0.0,
  });

  factory ChecklistInstance.fromJson(Map<String, dynamic> json) {
    return ChecklistInstance(
      id: json['id'] as String,
      templateId: json['templateId'] as String,
      templateVersion: json['templateVersion'] as int,
      inspectionId: json['inspectionId'] as String,
      sections: (json['sections'] as List<dynamic>)
          .map((e) => ChecklistSection.fromJson(e as Map<String, dynamic>))
          .toList(),
      responses: (json['responses'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, ChecklistResponse.fromJson(v as Map<String, dynamic>)),
          ) ??
          {},
      sectionScores: (json['sectionScores'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, (v as num).toDouble()),
          ) ??
          {},
      overallScore: (json['overallScore'] as num?)?.toDouble() ?? 0.0,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'templateId': templateId,
        'templateVersion': templateVersion,
        'inspectionId': inspectionId,
        'sections': sections.map((e) => e.toJson()).toList(),
        'responses': responses.map((k, v) => MapEntry(k, v.toJson())),
        'sectionScores': sectionScores,
        'overallScore': overallScore,
      };

  /// Create a copy with updated responses (used during checklist fill).
  ChecklistInstance copyWith({
    Map<String, ChecklistResponse>? responses,
    Map<String, double>? sectionScores,
    double? overallScore,
  }) {
    return ChecklistInstance(
      id: id,
      templateId: templateId,
      templateVersion: templateVersion,
      inspectionId: inspectionId,
      sections: sections,
      responses: responses ?? this.responses,
      sectionScores: sectionScores ?? this.sectionScores,
      overallScore: overallScore ?? this.overallScore,
    );
  }
}

// ─── ChecklistSection ────────────────────────────────────────────────────────

/// A section within a checklist containing questions.
class ChecklistSection {
  final String id;
  final String title;
  final int sortOrder;
  final double weight;
  final List<ChecklistQuestion> questions;

  const ChecklistSection({
    required this.id,
    required this.title,
    required this.sortOrder,
    required this.weight,
    required this.questions,
  });

  factory ChecklistSection.fromJson(Map<String, dynamic> json) {
    return ChecklistSection(
      id: json['id'] as String,
      title: json['title'] as String,
      sortOrder: json['sortOrder'] as int,
      weight: (json['weight'] as num).toDouble(),
      questions: (json['questions'] as List<dynamic>)
          .map((e) => ChecklistQuestion.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'sortOrder': sortOrder,
        'weight': weight,
        'questions': questions.map((e) => e.toJson()).toList(),
      };
}

// ─── ChecklistQuestion ───────────────────────────────────────────────────────

/// A question within a checklist section.
class ChecklistQuestion {
  final String id;
  final String text;
  final String fieldType;
  final int sortOrder;
  final double weight;
  final bool required;
  final String? helpText;

  const ChecklistQuestion({
    required this.id,
    required this.text,
    required this.fieldType,
    required this.sortOrder,
    required this.weight,
    required this.required,
    this.helpText,
  });

  factory ChecklistQuestion.fromJson(Map<String, dynamic> json) {
    return ChecklistQuestion(
      id: json['id'] as String,
      text: json['text'] as String,
      fieldType: json['fieldType'] as String,
      sortOrder: json['sortOrder'] as int,
      weight: (json['weight'] as num).toDouble(),
      required: json['required'] as bool,
      helpText: json['helpText'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'text': text,
        'fieldType': fieldType,
        'sortOrder': sortOrder,
        'weight': weight,
        'required': required,
        if (helpText != null) 'helpText': helpText,
      };
}

// ─── ChecklistResponse ───────────────────────────────────────────────────────

/// A single response to a checklist question, captured on device.
class ChecklistResponse {
  final String questionId;
  final dynamic value;
  final String capturedAt;
  final String deviceId;
  final double? gpsLatitude;
  final double? gpsLongitude;

  const ChecklistResponse({
    required this.questionId,
    required this.value,
    required this.capturedAt,
    required this.deviceId,
    this.gpsLatitude,
    this.gpsLongitude,
  });

  factory ChecklistResponse.fromJson(Map<String, dynamic> json) {
    return ChecklistResponse(
      questionId: json['questionId'] as String,
      value: json['value'],
      capturedAt: json['capturedAt'] as String,
      deviceId: json['deviceId'] as String,
      gpsLatitude: (json['gpsLatitude'] as num?)?.toDouble(),
      gpsLongitude: (json['gpsLongitude'] as num?)?.toDouble(),
    );
  }

  Map<String, dynamic> toJson() => {
        'questionId': questionId,
        'value': value,
        'capturedAt': capturedAt,
        'deviceId': deviceId,
        if (gpsLatitude != null) 'gpsLatitude': gpsLatitude,
        if (gpsLongitude != null) 'gpsLongitude': gpsLongitude,
      };
}

// ─── EvidenceCapture ─────────────────────────────────────────────────────────

/// Evidence captured during inspection (photo, document scan, etc.).
/// Stored locally and queued for upload when online.
class EvidenceCapture {
  final String id;
  final String inspectionId;
  final String filePath;
  final String mimeType;
  final String sha256Hash;
  final double? gpsLatitude;
  final double? gpsLongitude;
  final String capturedAt;
  final String deviceId;

  const EvidenceCapture({
    required this.id,
    required this.inspectionId,
    required this.filePath,
    required this.mimeType,
    required this.sha256Hash,
    this.gpsLatitude,
    this.gpsLongitude,
    required this.capturedAt,
    required this.deviceId,
  });

  factory EvidenceCapture.fromJson(Map<String, dynamic> json) {
    return EvidenceCapture(
      id: json['id'] as String,
      inspectionId: json['inspectionId'] as String,
      filePath: json['filePath'] as String,
      mimeType: json['mimeType'] as String,
      sha256Hash: json['sha256Hash'] as String,
      gpsLatitude: (json['gpsLatitude'] as num?)?.toDouble(),
      gpsLongitude: (json['gpsLongitude'] as num?)?.toDouble(),
      capturedAt: json['capturedAt'] as String,
      deviceId: json['deviceId'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'inspectionId': inspectionId,
        'filePath': filePath,
        'mimeType': mimeType,
        'sha256Hash': sha256Hash,
        if (gpsLatitude != null) 'gpsLatitude': gpsLatitude,
        if (gpsLongitude != null) 'gpsLongitude': gpsLongitude,
        'capturedAt': capturedAt,
        'deviceId': deviceId,
      };
}

// ─── InspectionEntity ────────────────────────────────────────────────────────

/// Entity (establishment) to be inspected.
class InspectionEntity {
  final String id;
  final String name;
  final String registrationNo;
  final String entityType;
  final double? latitude;
  final double? longitude;
  final String addressLine1;
  final String city;
  final String state;
  final String pincode;

  const InspectionEntity({
    required this.id,
    required this.name,
    required this.registrationNo,
    required this.entityType,
    this.latitude,
    this.longitude,
    required this.addressLine1,
    required this.city,
    required this.state,
    required this.pincode,
  });

  factory InspectionEntity.fromJson(Map<String, dynamic> json) {
    return InspectionEntity(
      id: json['id'] as String,
      name: json['name'] as String,
      registrationNo: json['registrationNo'] as String,
      entityType: json['entityType'] as String,
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      addressLine1: json['addressLine1'] as String,
      city: json['city'] as String,
      state: json['state'] as String,
      pincode: json['pincode'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'registrationNo': registrationNo,
        'entityType': entityType,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        'addressLine1': addressLine1,
        'city': city,
        'state': state,
        'pincode': pincode,
      };
}
