import 'package:dio/dio.dart';

// Fix: [AUDIT-P2-6] Shared error utility to avoid _userFriendlyError duplication

/// Maps exceptions to user-friendly messages for display in SnackBars/dialogs.
/// Never shows raw exception text to users.
String userFriendlyError(dynamic error) {
  if (error is DioException) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'Connection timed out. Please try again.';
      case DioExceptionType.connectionError:
        return 'No internet connection. Your action has been queued.';
      default:
        final status = error.response?.statusCode;
        if (status != null && status >= 500) return 'Server error. Please try again later.';
        if (status == 403) return 'You do not have permission for this action.';
        if (status == 409) return 'This item was modified by someone else. Please refresh.';
        return 'Something went wrong. Please try again.';
    }
  }
  return 'An unexpected error occurred. Please try again.';
}
